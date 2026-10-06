import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {qualifyProducerStartup} from '../src/producer-startup-qualification.mjs';
import {productionConfiguration,productionCheckpointPlan} from '../src/production-execution-plan.mjs';

function fixture(fault){
 const evidence=[],calls=[];let paid=0;
 const user={runCommand:async input=>{calls.push(input.detached?'HARNESS':'TOOLS');if(fault==='TOOLS'&&!input.detached)return{exitCode:1};if(fault==='HARNESS'&&input.detached)throw Error('HARNESS_STARTUP_FAILED');return{exitCode:0,cmdId:'command',stdout:async()=>JSON.stringify({cwd:'/home/factoryproducer/workspace'})};},writeFiles:async()=>{},readFile:async()=>Readable.from([JSON.stringify({id:1,body:JSON.stringify({model:fault==='MODEL'?'unqualified':productionConfiguration.model})})])};
 const sandbox={image:productionConfiguration.cloud.workerImage,asUser:()=>user};
 const provider={allocate:async()=>{calls.push('ALLOCATE');if(fault==='ALLOCATION')throw Error('ALLOCATION_UNKNOWN');return sandbox;},materialize:async(_s,note)=>{for(const startupStage of ['SANDBOX_READINESS','HARNESS_INSTALLATION','SOURCE_MATERIALIZATION']){await note({startupStage});if(fault===startupStage)throw Error(startupStage+'_FAILED');}return {...productionCheckpointPlan.source,cwd:'/home/factoryproducer/workspace'};},destroy:async()=>{calls.push('DESTROY');},execute:async()=>{paid++;throw Error('MUST_NOT_EXECUTE');}};
 return{evidence,calls,paid:()=>paid,options:{provider,resource:{deadline:new Date(Date.now()+100000).toISOString()},record:async e=>evidence.push(e),wait:async ms=>{assert(ms>=30000);calls.push('WAIT_ALLOCATION_EXPIRY');}}};
}
test('qualification orchestrator reaches mailbox boundary with no gateway/Work/candidate capability',async()=>{
 const f=fixture();const r=await qualifyProducerStartup(f.options);assert.equal(r.status,'PASS');assert.equal(r.upstreamDispatches,0);assert.equal(r.workAuthority,'NOT_GRANTED');assert.equal(f.paid(),0);assert.equal(f.calls.at(-1),'DESTROY');assert.equal(f.evidence.at(-1).teardown,'PASS');
});
for(const stage of ['ALLOCATION','SANDBOX_READINESS','HARNESS_INSTALLATION','SOURCE_MATERIALIZATION','TOOLS','HARNESS','MODEL'])test(`startup ${stage} failure tears down without execution or retry`,async()=>{
 const f=fixture(stage);await assert.rejects(qualifyProducerStartup(f.options));assert.equal(f.calls.filter(x=>x==='ALLOCATE').length,1);assert.equal(f.calls.at(-1),'DESTROY');assert.equal(f.paid(),0);assert(f.evidence.some(e=>e.failure));
 if(stage==='ALLOCATION')assert(f.calls.includes('WAIT_ALLOCATION_EXPIRY'));
});
test('audit failure cannot skip uncertain-allocation grace or teardown',async()=>{
 const f=fixture('ALLOCATION');const record=f.options.record;
 f.options.record=async e=>{await record(e);if(e.allocation==='UNRESOLVED')throw Error('AUDIT_UNAVAILABLE');};
 await assert.rejects(qualifyProducerStartup(f.options),/AUDIT_UNAVAILABLE/);
 assert.deepEqual(f.calls,['ALLOCATE','WAIT_ALLOCATION_EXPIRY','DESTROY']);assert.equal(f.paid(),0);
});
