import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {SpendLedger} from '../../../packages/storage/src/spend.ts';
import {FactoryDispatchControl} from '../src/dispatch-control.ts';
import {LocalExecutionProvider} from '../src/local-execution-provider.ts';
import {JobManager} from '../src/jobs.ts';

function setup(t){
  const dir=mkdtempSync(join(tmpdir(),'factory-v2-review-'));
  const path=join(dir,'factory.sqlite'),storage=openStorage(path),ledger=new SpendLedger(path);
  const deadline=new Date(Date.now()+60000).toISOString();
  const plan={version:'WORK_LEDGER_V2',pricingRevision:'fixture',model:'fixture',validUntil:deadline,
    perOperationReserveMicrousd:1200,plannedProductiveOperations:2,plannedCompletionOperations:2,
    maxPaidOperations:4,completionReserveMicrousd:2400};
  const client={id:'review',repositoryPaths:[dir],actions:['factory.observe']};
  const jobs={activeRun:()=>false},producer={snapshot:()=>({})};
  const control=new FactoryDispatchControl(storage,new LocalExecutionProvider(storage,jobs,producer),producer,ledger);
  function attempt(workId,generation,requestId,{bind=true}={}){
    const order=storage.createWorkOrder({title:'Review fixture',description:'No paid provider',kind:'feature',
      repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['test'],reproductionCommand:null,
      expectedFailureText:null,checkCommands:[],allowedPaths:['test.txt'],workerProfile:'mac'});
    const run=storage.createRun({workOrderId:order.id,workerProfile:'mac',inputCommit:'a'.repeat(40),workspacePath:dir});
    const binding={workId,workGeneration:generation,requestId,workOrderId:order.id,
      dispatchIdentity:'dispatch-'+generation,factoryVersion:'a'.repeat(64),runId:run.id};
    const identity={...binding,remoteRunId:run.id};
    storage.recordIntake('gateb:review',requestId,'digest',order.id);
    const event=(type,payload={})=>storage.appendEvent({workOrderId:order.id,runId:run.id,type,payload});
    event('factory.prepare_requested',{...binding,deadline});event('run.prepared');event('factory.writer_bound',identity);
    ledger.createBudget(binding,6000,deadline,plan);
    if(bind)ledger.bindAuthority(binding);
    return {order,run,binding,identity,event};
  }
  t.after(()=>{ledger.close();storage.close();rmSync(dir,{recursive:true,force:true});});
  return {dir,storage,ledger,client,control,attempt};
}

test('historical terminal READ never fences a newer active Work generation',async t=>{
  const f=setup(t),old=f.attempt('shared-work',1,'old');
  old.event('factory.terminal',{state:'COMPLETED'});
  f.ledger.fenceAuthority(old.binding);
  const current=f.attempt('shared-work',2,'current');
  assert.equal(f.ledger.read('shared-work').authorityState,'active');
  const prior=await f.control.read(f.client,'old');
  assert.equal(prior.quiescent,true);
  assert.equal(prior.spend.workGeneration,2);
  assert.equal(f.ledger.read('shared-work').authorityState,'active');
  assert.equal(f.ledger.fenceAuthority(old.binding),false);
  assert.equal(f.ledger.read('shared-work').authorityState,'active');
  assert.equal(current.binding.workGeneration,2);
});

test('a live completion process blocks terminal resource reconciliation',async t=>{
  const f=setup(t),a=f.attempt('completion-work',1,'completion');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
  t.after(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}});
  a.event('factory.dispatch_claimed',{supervisorPid:process.pid});
  a.event('agent.process_started',{pid:2147483647});
  a.event('agent.completion_process_started',{pid:child.pid});
  a.event('run.interrupted',{previousState:'implementing',pid:2147483647});
  f.storage.saveRun({...a.run,state:'interrupted'});
  const held=await f.control.read(f.client,'completion');
  assert.equal(held.quiescent,false);
  assert.equal(held.state,'UNKNOWN');
  assert.equal(f.storage.listEvents(a.order.id).some(e=>e.type==='factory.terminal'),false);
  process.kill(-child.pid,0); // The process group is still alive at the attempted reconciliation.
  process.kill(-child.pid,'SIGKILL');
  await once(child,'exit');
  const ended=await f.control.read(f.client,'completion');
  assert.equal(ended.quiescent,true);
  const terminal=f.storage.listEvents(a.order.id).find(e=>e.type==='factory.terminal');
  assert(terminal.payload.resourceProof.processGroups.includes(child.pid));
});

test('restart holds a live completion process even when productive pid is absent',async t=>{
  const f=setup(t),a=f.attempt('restart-work',1,'restart');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
  t.after(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}});
  f.storage.saveRun({...a.run,state:'implementing'});
  a.event('factory.dispatch_claimed',{supervisorPid:2147483647});
  a.event('agent.process_started',{pid:2147483647});
  a.event('agent.completion_process_started',{pid:child.pid});
  const jobs=new JobManager(f.storage,f.dir,()=>{});
  t.after(()=>jobs.close());
  const recovery=f.storage.listEvents(a.order.id).find(e=>e.type==='run.recovery_hold');
  assert(recovery);
  assert.equal(recovery.payload.pid,child.pid);
  assert.equal(f.storage.getWorkOrder(a.order.id).state,'awaiting_environment');
  process.kill(-child.pid,0);
  process.kill(-child.pid,'SIGKILL');
  await once(child,'exit');
});
