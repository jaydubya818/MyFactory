import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStorage} from '../src/index.ts';
import {SpendLedger} from '../src/spend.ts';

const worker=fileURLToPath(new URL('./spend-process-worker.mjs',import.meta.url));
function setup(t,{productive=2,completion=1,ceiling=(productive+completion)*1200}={}){
  const dir=mkdtempSync(join(tmpdir(),'factory-spend-process-')),path=join(dir,'factory.sqlite');
  const storage=openStorage(path);
  const order=storage.createWorkOrder({title:'Process matrix',description:'Synthetic',kind:'feature',
    repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['Safe'],reproductionCommand:null,
    expectedFailureText:null,checkCommands:[],allowedPaths:['test.txt'],workerProfile:'mac'});
  const run=storage.createRun({workOrderId:order.id,workerProfile:'mac',inputCommit:'a'.repeat(40),workspacePath:dir});
  const ledger=new SpendLedger(path),binding={workId:'matrix-work',workGeneration:1,dispatchIdentity:'dispatch',
    requestId:'request',workOrderId:order.id,factoryVersion:'version',runId:run.id};
  const plan={version:'WORK_LEDGER_V2',pricingRevision:'fixture-v1',model:'fixture-model',
    validUntil:new Date(Date.now()+60000).toISOString(),perOperationReserveMicrousd:1200,
    plannedProductiveOperations:productive,plannedCompletionOperations:completion,
    maxPaidOperations:productive+completion,completionReserveMicrousd:completion*1200};
  ledger.createBudget(binding,ceiling,new Date(Date.now()+60000).toISOString(),plan);ledger.bindAuthority(binding);
  const reserve=(id,phase='productive')=>ledger.reserve({...binding,operationId:id,model:plan.model,
    pricingRevision:plan.pricingRevision,reservedMicrousd:1200,phase});
  const settle=(id,amount=1200)=>{ledger.markDispatched(id);ledger.settle(id,amount,'parent-'+id,{input_tokens:10,output_tokens:10});};
  t.after(()=>{ledger.close();storage.close();rmSync(dir,{recursive:true,force:true});});
  return {path,ledger,binding,reserve,settle};
}
function actor(t,f){
  const child=spawn(process.execPath,[worker,f.path,JSON.stringify(f.binding)],
    {detached:true,stdio:['ignore','pipe','pipe','ipc']});
  const wait=kind=>new Promise((resolve,reject)=>{
    const onMessage=m=>{if(m.kind===kind){child.off('exit',onExit);child.off('message',onMessage);resolve(m);}};
    const onExit=()=>{child.off('message',onMessage);reject(new Error('Worker exited before '+kind));};
    child.on('message',onMessage);child.once('exit',onExit);
  });
  const ready=wait('ready');
  const control={
    ready,
    async arm(command){await ready;const received=wait('armed');child.send({kind:'arm',...command});await received;},
    async go(){const received=wait('result');child.send({kind:'go'});return received;},
    async kill(){if(child.exitCode!==null||child.signalCode!==null)return;
      const exited=once(child,'exit');try{process.kill(-child.pid,'SIGKILL');}catch{}await exited;},
  };
  t.after(()=>control.kill());
  return control;
}
async function race(t,f,first,second){
  const a=actor(t,f),b=actor(t,f);
  await Promise.all([a.arm(first),b.arm(second)]);
  const results=await Promise.all([a.go(),b.go()]);
  await Promise.all([a.kill(),b.kill()]);
  return results;
}

test('synchronized processes cannot oversubscribe last productive dollars or slot',async t=>{
  const f=setup(t);f.reserve('first');f.settle('first');
  const [a,b]=await race(t,f,{action:'reserve',operationId:'racer-a'},{action:'reserve',operationId:'racer-b'});
  assert.equal([a,b].filter(r=>r.ok).length,1);
  assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,2);
  assert.equal(f.ledger.read(f.binding.workId).productiveAllowanceRemainingMicrousd,0);
  assert.equal(f.ledger.read(f.binding.workId).completionReserveRemainingMicrousd,1200);
});

test('UNKNOWN and cancellation races deny subsequent provider dispatch',async t=>{
  const f=setup(t);f.reserve('initial');f.ledger.markDispatched('initial');
  const [unknown,reserved]=await race(t,f,{action:'unknown',operationId:'initial'},
    {action:'reserve',operationId:'candidate'});
  assert.equal(unknown.ok,true);
  if(reserved.ok)assert.throws(()=>f.ledger.markDispatched('candidate'),/UNKNOWN|authority/);
  assert.equal(f.ledger.read(f.binding.workId).unknownExposureMicrousd,1200);
  assert.throws(()=>f.reserve('after-unknown'),/UNKNOWN|authority/);

  // Reconcile the exact UNKNOWN before testing a separate cancel/admission race.
  f.ledger.settle('initial',30,'provider-initial',{input_tokens:10,output_tokens:10});
  if(reserved.ok)f.ledger.markUnknown('candidate');
  if(reserved.ok)f.ledger.settle('candidate',0,'provider-not-sent',{input_tokens:0,output_tokens:0});
  const [cancel,newReservation]=await race(t,f,{action:'cancel'},{action:'reserve',operationId:'post-cancel'});
  assert.equal(cancel.ok,true);
  if(newReservation.ok)assert.throws(()=>f.ledger.markDispatched('post-cancel'),/Post-cancel/);
  assert.equal(f.ledger.read(f.binding.workId).cancelled,true);
});

test('synchronized completion processes cannot exceed final reserve or slot',async t=>{
  const f=setup(t,{productive:1,completion:2});
  f.reserve('productive');f.settle('productive');f.ledger.beginCompletion(f.binding);
  f.reserve('completion-first','completion');f.settle('completion-first');
  const [a,b]=await race(t,f,{action:'reserve',operationId:'completion-a',phase:'completion'},
    {action:'reserve',operationId:'completion-b',phase:'completion'});
  assert.equal([a,b].filter(r=>r.ok).length,1);
  assert.equal(f.ledger.read(f.binding.workId).completionReserveRemainingMicrousd,0);
  assert.equal(f.ledger.read(f.binding.workId).completionOperationSlotsRemaining,0);
});

test('actual writer deaths retain exposure and settlement cannot reactivate the writer',async t=>{
 for(const stage of ['reserve','dispatch','unknown','completion']){
  const f=setup(t,{productive:3,completion:1});
  if(stage==='completion'){f.reserve('productive');f.settle('productive');f.ledger.beginCompletion(f.binding);}
  if(['dispatch','unknown'].includes(stage))f.reserve('operation');
  if(stage==='unknown')f.ledger.markDispatched('operation');
  const child=actor(t,f);await child.arm({action:stage==='completion'?'reserve':stage,operationId:'operation',phase:stage==='completion'?'completion':'productive'});
  const result=await child.go();assert.equal(result.ok,true,result.error);await child.kill();
  const reopened=new SpendLedger(f.path);t.after(()=>reopened.close());reopened.recoverUnknown();
  assert.equal(reopened.read(f.binding.workId).unknownExposureMicrousd,1200);
  assert.equal(reopened.read(f.binding.workId).authorityState,'fenced');
  reopened.settle('operation',30,'confirmed-operation',{input_tokens:10,output_tokens:10});
  assert.equal(reopened.read(f.binding.workId).accountingComplete,true);
  assert.throws(()=>f.reserve('automatic-retry'),/authority/);
  assert.equal(reopened.recoverUnknown(),0);
 }
});
