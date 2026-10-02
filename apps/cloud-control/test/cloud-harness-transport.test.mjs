import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {harnessMailbox} from '../src/cloud-harness-mailbox.mjs';
import {relayHarnessRequests} from '../src/cloud-harness-relay.mjs';
const token='a'.repeat(64);
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'cloud-harness-'));
 let yields=0;
 const directory=join(root,'mailbox');
 const box=await harnessMailbox({directory,childToken:token,deadline:Date.now()+10000,onYield:()=>yields++});
 t.after(async()=>{await box.close();await rm(root,{recursive:true,force:true});});
 const send=(body='{}',authorization='Bearer '+token)=>fetch(box.baseUrl+'/responses',{method:'POST',headers:{authorization},body});
 const request=async(id=1)=>{for(let n=0;n<100;n++){try{return JSON.parse(await readFile(join(directory,`request-${id}.json`),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;await delay(10);}}throw Error('Missing request');};
 const reply=(value,id=1)=>writeFile(join(directory,`response-${id}.json`),JSON.stringify(value),{flag:'wx'});
 return{root,directory,box,send,request,reply,yields:()=>yields};
}
test('mailbox requires a fresh canonical directory',async t=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-harness-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const directory of [root,root+'/../escape','/',root+'/'])await assert.rejects(harnessMailbox({directory,childToken:token,deadline:Date.now()+1000,onYield(){}}));
});
test('worker loopback authenticates, serializes and transports without credentials in files',async t=>{
 const b=await setup(t);assert.equal((await b.send('{}','Bearer invalid')).status,401);
 const pending=b.send(JSON.stringify({model:'pinned-model'}));const req=await b.request();
 assert.deepEqual(req,{id:1,body:'{"model":"pinned-model"}'});assert(!JSON.stringify(req).includes(token));
 assert.equal((await b.send()).status,409);
 await b.reply({id:1,kind:'response',status:200,contentType:'text/event-stream',bodyBase64:Buffer.from('data: complete\n\n').toString('base64')});
 const response=await pending;assert.equal(response.status,200);assert.equal(await response.text(),'data: complete\n\n');
});
test('host boundary yields and rejects malformed or symlink replies',async t=>{
 for(const mode of ['yield','wrong-id','symlink']){
  const b=await setup(t),pending=b.send();await b.request();
  if(mode==='symlink'){await writeFile(join(b.root,'fake'),'{}');await symlink(join(b.root,'fake'),join(b.directory,'response-1.json'));}
  else await b.reply({id:mode==='wrong-id'?2:1,kind:'yield'});
  const response=await pending;assert.equal(response.status,mode==='yield'?409:503);assert.equal(b.yields(),mode==='yield'?1:0);
 }
});
test('relay fixes gateway destination and identity, writes no token, and never replays failure',async()=>{
 let done=false,calls=0,reply;
 const options={readRequest:async()=>Buffer.from(JSON.stringify({id:1,body:'{"model":"exact"}'})),writeResponse:async(id,bytes)=>{assert.equal(id,1);reply=JSON.parse(bytes);done=true;},gateway:{fetch:async request=>{calls++;assert.equal(request.url,'https://factory.internal/v1/responses');assert.equal(request.headers.get('authorization'),'Bearer '+token);return Response.json({ok:true});}},childToken:token,deadline:Date.now()+1000,finished:()=>done};
 await relayHarnessRequests(options);assert.equal(calls,1);assert.equal(reply.kind,'response');assert(!JSON.stringify(reply).includes(token));
 done=false;calls=0;
 await assert.rejects(relayHarnessRequests({...options,gateway:{fetch:async()=>{calls++;throw Error('ambiguous');}}}),/ambiguous/);assert.equal(calls,1);
});
test('relay rejects extra authority fields, mismatched IDs, deadlines and cancellation',async()=>{
 let calls=0;const options={writeResponse:async()=>{},gateway:{fetch:async()=>{calls++;}},childToken:token,deadline:Date.now()+1000,finished:()=>false};
 for(const packet of [{id:2,body:'{}'},{id:1,body:'{}',provider:'other'},{id:1,body:'x'.repeat(210001)}])await assert.rejects(relayHarnessRequests({...options,readRequest:async()=>Buffer.from(JSON.stringify(packet))}));
 await assert.rejects(relayHarnessRequests({...options,readRequest:async()=>null,signal:AbortSignal.abort()}),/RELAY_CANCELLED/);
 await assert.rejects(relayHarnessRequests({...options,deadline:Date.now()-1}),/RELAY_CONFIGURATION/);assert.equal(calls,0);
});
