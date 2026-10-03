import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sendQueueCheck, receiveQueueCheck, queueTopic } from '../src/queue-delivery.mjs';
import { handleQueueCheck } from '../api/queue-check.mjs';
import { stagingProjectId } from '../src/config.mjs';
const env = { VERCEL_ENV:'preview', VERCEL_PROJECT_ID:stagingProjectId, FACTORY_INFRASTRUCTURE_TOKEN:'staging-operator-qualification-token' };
function memoryStore() {
  let row; let nonce;
  return {
    read:async()=>row,
    reserve:async(id,value)=>{ if(row) return {created:false,row}; nonce=value; row={id,state:'SENDING'}; return {created:true,row}; },
    sent:async(id,messageId)=>{if(row.state==='SENDING') row={...row,state:'ACCEPTED',message_id:messageId};},
    unknown:async()=>{if(row.state==='SENDING')row={...row,state:'UNKNOWN'};},
    delivered:async(payload,metadata)=>{if(payload.nonce!==nonce||row.state==='DELIVERED')return false;row={...row,state:'DELIVERED',message_id:metadata.messageId};return true;},
  };
}
const metadata = {topicName:queueTopic,region:'iad1',messageId:'message-1',deliveryCount:1};
test('durable intent precedes send; replay never resends; late delivery resolves UNKNOWN once',async()=>{
  const store=memoryStore(); const id=randomUUID(); let sends=0; let payload;
  const send=async(topic,body,options)=>{sends++;assert.equal((await store.read()).state,'SENDING');assert.equal(topic,queueTopic);assert.deepEqual(options,{idempotencyKey:id,retentionSeconds:120,delaySeconds:10});payload=body;throw Error('ambiguous network response');};
  assert.equal((await sendQueueCheck(store,send,id)).state,'UNKNOWN');
  await sendQueueCheck(store,send,id); assert.equal(sends,1);
  assert.equal(await receiveQueueCheck(store,{...payload,nonce:'0'.repeat(64)},metadata),false);
  assert.equal(await receiveQueueCheck(store,payload,metadata),true);
  assert.equal(await receiveQueueCheck(store,payload,metadata),false);
  await sendQueueCheck(store,send,id); assert.equal(sends,1);
});
test('delivery before send acknowledgement never regresses DELIVERED',async()=>{
  const store=memoryStore();
  const result=await sendQueueCheck(store,async(topic,payload)=>{await receiveQueueCheck(store,payload,metadata);return{messageId:metadata.messageId};},randomUUID());
  assert.equal(result.state,'DELIVERED');
});
test('forged payload or wrong queue scope cannot reach durable update',async()=>{
  const store={delivered:async()=>assert.fail('must not update')};
  const payload={version:1,id:randomUUID(),nonce:'a'.repeat(64)};
  for(const body of [null,{...payload,command:'sh'},{...payload,id:'bad'},{...payload,nonce:'bad'}]) await assert.rejects(()=>receiveQueueCheck(store,body,metadata),/INVALID_CHECK_MESSAGE/);
  for(const patch of [{topicName:'other'},{region:'sfo1'},{deliveryCount:0},{messageId:''}]) await assert.rejects(()=>receiveQueueCheck(store,payload,{...metadata,...patch}),/INVALID_CHECK_METADATA/);
});
test('HTTP authorization, environment and body guards run before queue or database access',async()=>{
  const withStore=async()=>assert.fail('must not open store'); const id=randomUUID(); const url=`https://factory.example/api/queue-check?id=${id}`;
  assert.equal((await handleQueueCheck(new Request(url),env,withStore)).status,401);
  const headers={authorization:'Bearer staging-operator-qualification-token'};
  assert.equal((await handleQueueCheck(new Request(url,{headers}),{...env,VERCEL_ENV:'production'},withStore)).status,503);
  assert.equal((await handleQueueCheck(new Request(url,{method:'POST',headers,body:'{}'}),env,withStore)).status,400);
  assert.equal((await handleQueueCheck(new Request(url+'&command=sh',{headers}),env,withStore)).status,400);
});
test('empty streamed POST is supported; GET never sends',async()=>{
  const store=memoryStore();let sends=0;const id=randomUUID();const url=`https://factory.example/api/queue-check?id=${id}`; const headers={authorization:'Bearer staging-operator-qualification-token'};
  const send=async()=>{sends++;return{messageId:'message-1'};};
  const request=new Request(url,{method:'POST',headers,body:new ReadableStream({start(c){c.close();}}),duplex:'half'});
  const result=await handleQueueCheck(request,env,async(e,fn)=>fn(store),send);
  assert.equal(result.status,200);assert.equal((await result.json()).check.state,'ACCEPTED');
  await handleQueueCheck(new Request(url,{headers}),env,async(e,fn)=>fn(store),send);assert.equal(sends,1);
});
