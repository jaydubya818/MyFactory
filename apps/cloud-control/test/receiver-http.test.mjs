import test from 'node:test';
import assert from 'node:assert/strict';
import endpoint,{handleFactoryCapabilityAdmission} from '../api/capability-admission.mjs';
import {receiverJson} from '../src/receiver-http.mjs';
const request=(body,headers={})=>new Request('https://fixture.invalid/api/capability-admission/prepare',{method:'POST',headers,body:JSON.stringify(body)});
test('uninstalled receiver is unavailable and does not inspect or admit',async()=>{
 assert.equal((await endpoint.fetch(request({}))).status,503);
});
test('original transport authentication precedes parsing and cannot be supplied by the caller',async()=>{
 let admissions=0;
 const runtime={receiver:{prepare:async()=>{admissions++;}},authenticate:async r=>r.headers.get('authorization')==='fixture-original'};
 const body={schema:'factory-capability-admission-prepare/v1',request:{fixture:true},missionId:'fixture-mission',capabilityPermits:{}};
 assert.equal((await handleFactoryCapabilityAdmission(request(body),runtime)).status,401);assert.equal(admissions,0);
 assert.equal((await handleFactoryCapabilityAdmission(request({...body,enrollment:{owner:'foreign'}},{authorization:'fixture-original'}),runtime)).status,400);assert.equal(admissions,0);
});
test('oversized body cannot reach receiving authority',async()=>{
 let effects=0;const runtime={receiver:{prepare:async()=>{effects++;}},authenticate:async()=>true};
 assert.equal((await handleFactoryCapabilityAdmission(request({bytes:'x'.repeat(65537)}),runtime)).status,503);assert.equal(effects,0);
});
test('complete input deadline includes a stream which yields no bytes',async()=>{
 let cancelled=false;
 const stream=new ReadableStream({cancel(){cancelled=true;}}),r=new Request('https://fixture.invalid/api/capability-admission/prepare',{method:'POST',body:stream,duplex:'half'});
 await assert.rejects(receiverJson(r,65536,25),/BODY_TIMEOUT/);assert.equal(cancelled,true);
});
test('readback returns404 only for a never-admitted exact terminal request; ambiguity is unavailable',async()=>{
 const body={schema:'factory-capability-admission-readback/v1',request:{fixture:true},missionId:'fixture-mission'};
 const r=()=>new Request('https://fixture.invalid/api/capability-admission/readback',{method:'POST',body:JSON.stringify(body)});
 for(const [error,status] of [['FACTORY_TERMINAL_UNAVAILABLE',404],['FACTORY_RECEIVER_PENDING',503],['FACTORY_NATIVE_LINEAGE_MISSING',503]]){
  const runtime={receiver:{terminal:async()=>{throw Error(error);}},authenticate:async()=>true};
  assert.equal((await handleFactoryCapabilityAdmission(r(),runtime)).status,status);
 }
});
