import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCloud} from '../api/cloud.mjs';
import {stagingProjectId} from '../src/config.mjs';
const token='qualification-token-'+'a'.repeat(64),env={VERCEL_PROJECT_ID:stagingProjectId,VERCEL_ENV:'preview',FACTORY_SOFIE_STAGING_TOKEN:token};
const request=(path,method='GET',body,authorization=token)=>new Request('https://factory.invalid'+path,{method,headers:{authorization:'Bearer '+authorization},...(body?{body:JSON.stringify(body)}:{})});
test('cloud Work API authenticates before touching any dependency and rejects production project/environment',async()=>{
 let accesses=0;const runtime=async()=>{accesses++;throw Error('UNEXPECTED');};
 assert.equal((await handleCloud(request('/api/connect/v2/actions','GET',null,'wrong'),env,runtime)).status,401);
 assert.equal((await handleCloud(request('/api/connect/v2/actions'),{...env,VERCEL_ENV:'production'},runtime)).status,503);
 assert.equal((await handleCloud(request('/api/connect/v2/actions'),{...env,VERCEL_PROJECT_ID:'sofie'},runtime)).status,503);assert.equal(accesses,0);
});
test('qualification controls retain disabled admission and cannot call arbitrary methods or routes',async()=>{
 let calls=0;const runtime=async(_env,action)=>action({control:{prepare:()=>{calls++;}}});
 const body=await(await handleCloud(request('/api/connect/v2/actions'),env,runtime)).json();assert.equal(body.admission,'DISABLED');assert.equal(body.qualificationOnly,true);
 assert.equal((await handleCloud(request('/api/connect/v2/anything'),env,runtime)).status,404);
 assert.equal((await handleCloud(request('/api/connect/v2/dispatches?image=other','POST',{image:'other'}),env,runtime)).status,400);
 assert.equal((await handleCloud(request('/api/connect/v2/dispatches','POST',{description:'x'.repeat(33000)}),env,runtime)).status,503);assert.equal(calls,0);
});

test('deployment bypass alone has no authority and Work grant denials remain explicit',async()=>{
 let calls=0;
 const unauth=new Request('https://factory.invalid/api/connect/v2/dispatches',{method:'POST',headers:{'x-vercel-protection-bypass':'provider-only'},body:'{}'});
 assert.equal((await handleCloud(unauth,env,async()=>{calls++;})).status,401);assert.equal(calls,0);
 for(const code of ['CLOUD_SOURCE_NOT_GRANTED','CLOUD_CAPABILITIES_NOT_GRANTED','WRITER_BINDING_MISMATCH']){
  const response=await handleCloud(request('/api/connect/v2/dispatches','POST',{}),env,async(_env,action)=>action({control:{prepare:()=>{throw Error(code);}}}));
  assert.equal(response.status,403);assert.equal((await response.json()).error,'WORK_AUTHORITY_DENIED');
 }
});

test('provider-only credential cannot create/read/dispatch/collect/verify/publish on any application path',async()=>{
 const id='00000000-0000-4000-8000-000000000001';let calls=0;
 for(const [path,method] of [['/dispatches','POST'],['/dispatches/'+id,'GET'],['/dispatches/'+id+'/dispatch','POST'],['/dispatches/'+id+'/custody','GET'],['/verify','POST'],['/publish','POST']]){
  const req=new Request('https://factory.invalid/api/connect/v2'+path,{method,headers:{'x-vercel-protection-bypass':'provider-only'}});
  assert.equal((await handleCloud(req,env,async()=>{calls++;})).status,401);
 }
 assert.equal(calls,0);
});

test('Vercel rewrite capture preserves the canonical route without accepting query overrides',async()=>{
 let calls=0;const runtime=async(_env,action)=>{calls++;return action({});};
 for(const path of ['/api/cloud?path=actions','/api/connect/v2/actions?path=actions']){
  const r=await handleCloud(request(path),env,runtime);assert.equal(r.status,200);assert.equal((await r.json()).admission,'DISABLED');
 }
 assert.equal(calls,2);
 for(const path of ['/api/connect/v2/actions?path=dispatches','/api/cloud?path=actions&image=other','/api/cloud?path=actions&path=dispatches','/api/cloud?path=../actions','/api/cloud?path=actions//','/other?path=actions'])assert.equal((await handleCloud(request(path),env,runtime)).status,400);
 assert.equal(calls,2);
 assert.equal((await handleCloud(request('/api/cloud?path=actions','GET',null,'wrong'),env,runtime)).status,401);
});
