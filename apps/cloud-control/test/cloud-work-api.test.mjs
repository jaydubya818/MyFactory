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
