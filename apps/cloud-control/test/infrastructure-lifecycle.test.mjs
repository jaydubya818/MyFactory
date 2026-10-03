import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sandbox } from '@vercel/sandbox';
import { executeInfrastructure, reconcileInfrastructure } from '../src/infrastructure-lifecycle.mjs';
import { noReplayFetch, boundedBytes, infrastructureProvider } from '../src/infrastructure-provider.mjs';
import { handleInfrastructure } from '../api/infrastructure.mjs';
import { source } from '../src/infrastructure-plan.mjs';
import { stagingProjectId } from '../src/config.mjs';

function fixture(fault) {
  let row; const calls = [];
  const store = {
    read: async()=>row && structuredClone(row),
    reserve: async id => { calls.push('reserve'); row={id,provider_name:`factory-infra-${id}`,deadline:new Date(120000),state:'ALLOCATING',evidence:{},cleanup_confirmed:false};return structuredClone(row); },
    update: async(id,patch)=>{calls.push(`update:${patch.state??'command'}`);Object.assign(row,patch);},
  };
  const provider = {
    allocate: async()=>{calls.push('allocate');if(fault==='allocation')throw Error('ambiguous');return{currentSession:()=>({sessionId:'session-1'})};},
    execute: async(s,record)=>{calls.push('execute');await record('cmd-1');if(fault==='execution')throw Error('ambiguous');return Buffer.from('{}');},
    collect: async()=>{calls.push('collect');if(fault==='custody')throw Error('ambiguous');return{sha256:'a'.repeat(64),pathname:'private/artifact',bytes:2};},
    destroy: async()=>{calls.push('destroy');if(fault==='cleanup')throw Error('ambiguous');},
  };
  return{store,provider,calls};
}
test('durable intent precedes effects, custody precedes cleanup, replay never executes',async()=>{
  const f=fixture();const row=await executeInfrastructure(f.store,f.provider,'id',()=>0);
  assert.deepEqual(f.calls,['reserve','allocate','update:RUNNING','execute','update:command','collect','update:COLLECTED','destroy','update:DESTROYED']);
  assert.equal(row.evidence.outcome,'PASS');assert.equal(row.cleanup_confirmed,true);assert.equal(row.command_id,'cmd-1');
  const count=f.calls.length;assert.deepEqual(await executeInfrastructure(f.store,f.provider,'id'),row);assert.equal(f.calls.length,count);
});
test('allocation ambiguity holds the slot and never retries before delayed cleanup reconciliation',async()=>{
  const f=fixture('allocation');let row=await executeInfrastructure(f.store,f.provider,'id',()=>0);
  assert.equal(row.state,'UNKNOWN');assert.equal(row.cleanup_confirmed,false);assert.ok(!f.calls.includes('destroy'));
  await assert.rejects(reconcileInfrastructure(f.store,f.provider,'id',()=>149999),/TOO_EARLY/);
  row=await reconcileInfrastructure(f.store,f.provider,'id',()=>150000);
  assert.equal(row.cleanup_confirmed,true);assert.equal(row.evidence.outcome,'UNKNOWN');assert.equal(f.calls.filter(x=>x==='allocate').length,1);
});
for(const fault of ['execution','custody','cleanup'])test(`${fault} ambiguity never becomes PASS and preserves cleanup truth`,async()=>{
  const f=fixture(fault);const row=await executeInfrastructure(f.store,f.provider,'id',()=>0);
  assert.equal(row.evidence.outcome,'UNKNOWN');assert.equal(row.cleanup_confirmed,fault!=='cleanup');
  await executeInfrastructure(f.store,f.provider,'id');assert.equal(f.calls.filter(x=>x==='execute').length,1);
});
test('actual SDK allocation retries cannot repeat a mutating transport after 503 or network ambiguity',async()=>{
  for(const response of ['503','network']) {
    let calls=0;
    const transport=noReplayFetch(async()=>{calls++;if(response==='network')throw Error('lost receipt');return new Response(JSON.stringify({error:{message:'unknown'}}),{status:503});});
    await assert.rejects(Sandbox.create({name:'test-no-replay',image:'vercel/sandbox/node:24',projectId:'test',teamId:'test',token:'fixture',fetch:transport}));
    assert.equal(calls,1);
  }
});
test('artifact streaming enforces a bound before retaining excess bytes',async()=>{
  await assert.rejects(boundedBytes((async function*(){yield Buffer.alloc(3);yield Buffer.alloc(3);})(),5),/TOO_LARGE/);
  assert.equal((await boundedBytes((async function*(){yield Buffer.from('ok');})(),5)).toString(),'ok');
});
test('readiness credential, production scope, invalid IDs and caller code cannot reach effects',async()=>{
  const env={VERCEL_PROJECT_ID:stagingProjectId,VERCEL_ENV:'preview',FACTORY_INFRASTRUCTURE_TOKEN:'i'.repeat(40),FACTORY_QUALIFICATION_TOKEN:'r'.repeat(40)};
  const url='https://staging.invalid/api/infrastructure?id=ee6250bd-d97b-4ddc-953b-ae713d01045f';
  const fail=()=>{throw Error('MUST_NOT_REACH');};
  for(const [token,overrides,requestOverrides,status] of [
    ['r'.repeat(40),{},{},401],['i'.repeat(40),{VERCEL_ENV:'production'},{},503],['i'.repeat(40),{},{method:'POST',body:'arbitrary'},400],
  ]) {
    const request=new Request(url,{headers:{authorization:`Bearer ${token}`},...requestOverrides});
    assert.equal((await handleInfrastructure(request,{...env,...overrides},fail,fail)).status,status);
  }
  assert.equal((await handleInfrastructure(new Request(url+'&image=other',{headers:{authorization:`Bearer ${env.FACTORY_INFRASTRUCTURE_TOKEN}`}}),env,fail,fail)).status,400);
});

test('hosted empty POST stream is accepted without accepting a caller payload',async()=>{
  const token='i'.repeat(40);
  const env={VERCEL_PROJECT_ID:stagingProjectId,VERCEL_ENV:'preview',FACTORY_INFRASTRUCTURE_TOKEN:token};
  const request=new Request('https://staging.invalid/api/infrastructure?id=ee6250bd-d97b-4ddc-953b-ae713d01045f',{method:'POST',headers:{authorization:`Bearer ${token}`},body:new ReadableStream({start(controller){controller.close();}}),duplex:'half'});
  const row={id:'existing',cleanup_confirmed:true};
  const response=await handleInfrastructure(request,env,async(e,m,action)=>action({read:async()=>row}),()=>({}));
  assert.equal(response.status,200);assert.deepEqual((await response.json()).attempt,row);
});

test('failed worker commands retain diagnostics before artifact access or teardown',async()=>{
  const observations=[];
  let commands=0;
  const sandbox={cwd:'/',createUser:async()=>({runCommand:async params=>{
    assert.equal(params.sudo,undefined);commands++;
    if(commands===1)return{exitCode:0,stderr:async()=>'',stdout:async()=>JSON.stringify({...source,cwd:'/home/factoryproducer/workspace'})};
    assert.equal(params.cwd,'/home/factoryproducer/workspace');
    return{cmdId:'failed',wait:async()=>({exitCode:1,stderr:async()=> 'fixture command error'})};
  }}),runCommand:async()=>{throw Error('NO_PRIVILEGED_SETUP');},updateNetworkPolicy:async()=>{},readFile:async()=>{throw Error('MUST_NOT_READ_ARTIFACT');}};
  await assert.rejects(infrastructureProvider().execute(sandbox,async()=>{},async evidence=>observations.push(evidence)),/WORKER_COMMAND_FAILED/);
  assert.deepEqual(observations,[{stage:'MATERIALIZATION',sourceExit:0,sourceStderr:''},{commandExit:1,stderr:'fixture command error'}]);
});
