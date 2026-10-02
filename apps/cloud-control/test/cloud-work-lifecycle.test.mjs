import test from 'node:test';
import assert from 'node:assert/strict';
import {executeCloudWork,reconcileCloudWork} from '../src/cloud-work-lifecycle.mjs';
function fixture(fault){
 const effects=[];const row={run_id:'run',resource:{run_id:'run',lease_owner:'owner',lease_generation:1,provider_name:'factory-run-run',provider_session_id:null,cleanup_confirmed:false,deadline:new Date(Date.now()+100000).toISOString(),evidence:{}},events:[],custody:null};let claimed=false;
 const store={claim:async()=>{if(claimed)return null;claimed=true;return structuredClone(row.resource);},read:async()=>structuredClone(row),heartbeat:async()=>{if(fault==='cancel')throw Error('LEASE_FENCED');},recordAllocation:async(_r,_o,_g,id)=>{row.resource.provider_session_id=id;},advanceResource:async(_r,_o,_g,state)=>{effects.push(state);row.resource.state=state;},noteResource:async(_r,_o,_g,data)=>Object.assign(row.resource.evidence,data),retainCustody:async(_r,_o,_g,data)=>{row.custody=data;},confirmCleanup:async()=>{row.resource.cleanup_confirmed=true;},finalize:async(_c,_q,status)=>{row.events.push({type:'factory.terminal',payload:{status}});},reconcileExpired:async()=>{effects.push('FENCE');}};
 const provider={allocate:async()=>{effects.push('ALLOCATE');if(fault==='allocate')throw Error('ALLOCATION_UNKNOWN');return{currentSession:()=>({sessionId:'sbx_test'})};},materialize:async()=>({commit:'base'}),execute:async()=>{effects.push('EXECUTE');if(fault==='execute')throw Error('EXECUTION_FAILED');return{};},quiesce:async()=>{effects.push('QUIESCE');return{};},collect:async()=>{effects.push('COLLECT');return{receipt:{commit:'candidate'},bundle:{checks:[{exitCode:0}]}};},destroy:async()=>{effects.push('DESTROY');if(fault==='cleanup')throw Error('CLEANUP_UNKNOWN');}};
 const recovery=async()=>{effects.push('RECOVERY_ACCEPTED');if(fault==='queue')throw Error('QUEUE_UNKNOWN');};
 return{effects,row,store,provider,recovery,identity:{requestId:'request'}};
}
test('hosted lifecycle schedules recovery before allocation, collects after quiescence, tears down before terminal and never re-executes',async()=>{
 const f=fixture();const run=()=>executeCloudWork(f.store,f.provider,'client',f.identity,f.recovery);await run();await run();
 assert.deepEqual(f.effects,['RECOVERY_ACCEPTED','ALLOCATE','PREPARING','READY','RUNNING','EXECUTE','QUIESCING','QUIESCE','COLLECTING','COLLECT','DESTROY']);
 assert.equal(f.row.resource.cleanup_confirmed,true);assert.equal(f.row.events.length,1);assert.equal(f.row.events[0].payload.status,'COMPLETED');
});
test('queue ambiguity or fenced authority prevents allocation; allocation ambiguity cannot claim early quiescence',async()=>{
 for(const fault of ['queue','cancel','allocate']){const f=fixture(fault);await executeCloudWork(f.store,f.provider,'client',f.identity,f.recovery);assert.equal(f.effects.includes('EXECUTE'),false);assert.equal(f.row.events.length,0);if(fault!=='allocate')assert.equal(f.effects.includes('ALLOCATE'),false);}
});
test('command failure still destroys resource; cleanup uncertainty prevents terminal result',async()=>{
 for(const fault of ['execute','cleanup']){const f=fixture(fault);await executeCloudWork(f.store,f.provider,'client',f.identity,f.recovery);assert.ok(f.effects.includes('DESTROY'));assert.equal(f.row.events.length,fault==='cleanup'?0:1);}
});
test('recovery fences first and never restarts productive execution',async()=>{
 const f=fixture('allocate');await executeCloudWork(f.store,f.provider,'client',f.identity,f.recovery);
 await assert.rejects(reconcileCloudWork(f.store,f.provider,'client','request'),/TOO_EARLY/);
 await reconcileCloudWork(f.store,f.provider,'client','request',()=>Date.now()+200000);
 assert.equal(f.effects.filter(x=>x==='ALLOCATE').length,1);assert.equal(f.effects.includes('EXECUTE'),false);assert.equal(f.row.events[0].payload.status,'FAILED');
});

test('HEADLESS cloud custody and teardown never consult unavailable operator session surfaces',async()=>{
 const f=fixture();
 // Any accidental surface discovery/construction is a failure, not a fallback.
 const provider=new Proxy(f.provider,{get(target,key){if(['sessionSurface','sessionSurfaceProvider','attach','tmux','cmux'].includes(String(key)))throw Error('SURFACE_MUST_NOT_BE_REQUIRED');return Reflect.get(target,key);}});
 await executeCloudWork(f.store,provider,'client',f.identity,f.recovery);
 assert.equal(f.row.resource.evidence.sessionSurface,'HEADLESS');
 assert.equal(f.row.custody.commit,'candidate');
 assert.equal(f.row.resource.cleanup_confirmed,true);
 assert.equal(f.row.events[0].payload.status,'COMPLETED');
});
