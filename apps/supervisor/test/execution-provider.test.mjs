import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openStorage } from '../../../packages/storage/src/index.ts';
import { LocalExecutionProvider } from '../src/local-execution-provider.ts';

function fixture(t, { active = false, absent = () => true, verifier = async () => true,
  readiness = async () => ({ ready: true, reason: null }) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-provider-'));
  const storage = openStorage(join(dir, 'factory.sqlite'));
  const work = storage.createWorkOrder({ title: 'Provider migration', description: 'No model calls', kind: 'feature',
    repositoryPath: dir, baseRef: 'a'.repeat(40), acceptanceCriteria: ['Preserve authority'],
    reproductionCommand: null, expectedFailureText: null, checkCommands: ['node --test'],
    allowedPaths: ['index.mjs'], workerProfile: 'mac' });
  const run = storage.createRun({ workOrderId: work.id, workerProfile: 'mac', inputCommit: work.baseRef, workspacePath: dir });
  const calls = [];
  const jobs = { activeRun: () => active, prepareRun: async value => { calls.push(['prepare', value.id]); return run; },
    executePrepared: (order, attempt, claim, gateway) => { calls.push(['start', order.id, attempt.id, gateway]); return claim(); },
    cancelRun: async order => { calls.push(['cancel', order.id]); } };
  const producer = { read: value => { calls.push(['collect', value.id]); return { state: 'COMPLETED', result: null }; } };
  const provider = new LocalExecutionProvider(storage, jobs, producer, { processAbsent: absent, verifierAbsent: verifier, readiness });
  const event = (type, payload = {}, attempt = run) => storage.appendEvent({ workOrderId: work.id, runId: attempt.id, type, payload });
  t.after(() => { storage.close(); rmSync(dir, { recursive: true, force: true }); });
  return { storage, work, run, calls, provider, event };
}

test('prepare does not start, and start retains the canonical atomic claim and gateway', async t => {
  const f = fixture(t), gateway = { marker: 'trusted-host-only' };
  await f.provider.prepare(f.work);
  assert.deepEqual(f.calls, [['prepare', f.work.id]]);
  let claims = 0;
  assert.equal(await f.provider.start(f.work, f.run, () => { claims++; return false; }, gateway), false);
  assert.equal(claims, 1);
  assert.equal(f.calls[1][3], gateway);
  assert.equal(f.provider.environment, 'LOCAL_FACTORY');
});

test('a live productive or completion group prevents quiescence and artifact collection', async t => {
  const f = fixture(t, { absent: pid => pid !== 42 });
  f.event('factory.dispatch_claimed', { supervisorPid: process.pid });
  f.event('agent.process_started', { pid: 41 });
  f.event('agent.completion_process_started', { pid: 42 });
  f.event('factory.execution_settled');
  const observation = await f.provider.reconcile(f.run);
  assert.equal(observation.quiescent, false);
  assert.deepEqual(observation.evidence.processGroups, [41, 42]);
  await assert.rejects(f.provider.collect(f.run), /not quiescent/);
  assert.equal(f.calls.length, 0);
});

test('unavailable verifier stays unresolved; read never changes business state', async t => {
  const f = fixture(t, { verifier: async () => { throw Error('unavailable'); } });
  f.event('run.candidate_committed');
  const before = f.storage.listEvents(f.work.id);
  const observation = await f.provider.reconcile(f.run);
  assert.equal(observation.quiescent, false);
  assert.equal(observation.evidence.verifierGone, false);
  assert.deepEqual(f.storage.listEvents(f.work.id), before);
  assert.equal(f.storage.getRun(f.run.id).state, 'planning');
});

test('malformed PID and foreign live supervisor never establish absence', async t => {
  const f = fixture(t, { absent: pid => Number.isSafeInteger(pid) && pid === 41 });
  f.event('factory.dispatch_claimed', { supervisorPid: 42 });
  f.event('agent.process_started', { pid: '41' });
  const observation = await f.provider.read(f.run);
  assert.equal(observation.quiescent, false);
  assert.equal(observation.evidence.ownerGone, false);
});

test('cancel requests stop without claiming the running executor has terminated', async t => {
  const f = fixture(t, { active: true });
  await f.provider.cancel(f.work, f.run);
  assert.deepEqual(f.calls, [['cancel', f.work.id]]);
  assert.equal((await f.provider.read(f.run)).quiescent, false);
  assert.equal((await f.provider.teardown(f.run)).destroyed, false);
});

test('cross-attempt inputs fail before resource operations', async t => {
  const f = fixture(t);
  await assert.rejects(f.provider.read({ ...f.run, attemptNumber: 2 }), /saved local attempt/);
  await assert.rejects(f.provider.collect({ ...f.run, workspacePath: '/another/work' }), /saved local attempt/);
  await assert.rejects(f.provider.start({ ...f.work, id: 'other' }, f.run, () => true), /WorkOrder mismatch/);
  await assert.rejects(f.provider.cancel({ ...f.work, id: 'other' }, f.run), /WorkOrder mismatch/);
  assert.equal(f.calls.length, 0);
});

test('a prior attempt cannot contribute resources or settlement to the current attempt', async t => {
  const f = fixture(t, { absent: () => false });
  const next = f.storage.createRun({ workOrderId: f.work.id, workerProfile: 'mac', inputCommit: f.work.baseRef,
    workspacePath: f.run.workspacePath });
  f.event('factory.dispatch_claimed', { supervisorPid: 42 });
  f.event('agent.process_started', { pid: 42 });
  f.event('factory.execution_settled');
  f.event('run.interrupted', { previousState: 'implementing' });
  const observation = await f.provider.read(next);
  assert.equal(observation.quiescent, true);
  assert.equal(observation.settled, false);
  assert.equal(observation.recoveryEligible, false);
  assert.deepEqual(observation.evidence.processGroups, []);
});

test('local teardown honestly retains candidate workspace required by legacy publication', async t => {
  const f = fixture(t);
  const result = await f.provider.teardown(f.run);
  assert.equal(result.destroyed, false);
  assert.match(result.reason, /retained/);
  assert.equal(f.storage.getRun(f.run.id).workspacePath, f.run.workspacePath);
});

test('readiness failure cannot expose provider errors or start work', async t => {
  const f = fixture(t, { readiness: async () => { throw Error('SECRET_CANARY'); } });
  const health = await f.provider.health();
  assert.equal(health.ready, false);
  assert.equal(JSON.stringify(health).includes('SECRET_CANARY'), false);
  assert.deepEqual(f.calls, []);
});


// Pure deferred caller regressions. Synthetic Booleans are no native absence proof.
// Tiny detached caller data; no native absence evidence or private guard.
function pureResourceFixture({pause=true,recovery=false}={}){
 const run={id:'public-run',workOrderId:'public-work',attemptNumber:1,inputCommit:'a'.repeat(40),workspacePath:'/unused',state:'implementing'};
 const events=[];const row=(type,payload={},runId=run.id)=>events.push({id:events.length+1,runId,workOrderId:run.workOrderId,type,payload});row('run.reproduction_started');
 if(recovery){row('agent.process_started',{pid:12345});row('run.interrupted')}
 let release,entered,collect=0,checkpoint=0;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const storage={getRun:()=>structuredClone(run),listEvents:()=>structuredClone(events)};
 const jobs={activeRun:()=>false,checkpointForRecovery:async()=>{checkpoint++;throw Error('inert recovery boundary')}};
 const producer={read(){collect++;throw Error('inert Result boundary')}};
 const probe={processAbsent(){return true},async verifierAbsent(){entered();if(pause)await held;return true},async readiness(){throw Error('No readiness operation')}};
 const provider=new LocalExecutionProvider(storage,jobs,producer,probe);
 return {provider,jobs,row,run,started,release:()=>release(),get collect(){return collect},get checkpoint(){return checkpoint}};
}
for(const change of ['productive process','completion process','settlement','saved Run'])test('actual resource read refuses stale '+change+' during verifier await',async()=>{
 const f=pureResourceFixture(),p=f.provider.read(f.run);await f.started;
 if(change==='saved Run')f.run.state='interrupted';else f.row(change==='settlement'?'factory.execution_settled':change==='productive process'?'agent.process_started':'agent.completion_process_started',{pid:12345});
 f.release();const r=await p;assert.equal(r.quiescent,false);assert.equal(r.settled,false);assert.equal(r.recoveryEligible,false);assert.equal(f.collect,0);assert.equal(f.checkpoint,0);
});
test('stable actual resource observation retains component Boolean data only',async()=>{const f=pureResourceFixture(),p=f.provider.read(f.run);await f.started;f.release();const r=await p;assert.equal(r.quiescent,true);assert.equal(r.recoveryEligible,false)});
test('unrelated prior-attempt event never enters current resource cut',async()=>{const f=pureResourceFixture(),p=f.provider.read(f.run);await f.started;f.row('agent.process_started',{pid:12345},'public-prior-run');f.release();const r=await p;assert.equal(r.quiescent,true);assert.deepEqual(r.evidence.processGroups,[])});
function holdAfterResourceRead(f){let entered,release;const started=new Promise(r=>entered=r),paused=new Promise(r=>release=r),read=f.provider.read.bind(f.provider);f.provider.read=async(...args)=>{const r=await read(...args);entered();await paused;return r};return {started,release:()=>release()}}
test('actual collect checks current rows after inner read returns',async()=>{const f=pureResourceFixture({pause:false}),gap=holdAfterResourceRead(f),p=f.provider.collect(f.run);await gap.started;f.row('agent.completion_process_started',{pid:12345});gap.release();await assert.rejects(p,/not quiescent/);assert.equal(f.collect,0);assert.equal(f.checkpoint,0)});
test('actual reconcile checks current rows after inner read returns',async()=>{const f=pureResourceFixture({pause:false,recovery:true}),gap=holdAfterResourceRead(f),p=f.provider.reconcile(f.run);await gap.started;f.row('agent.completion_process_started',{pid:12345});gap.release();const r=await p;assert.equal(r.quiescent,false);assert.equal(r.recoveryEligible,false);assert.equal(f.checkpoint,0);assert.equal(f.collect,0)});

// Actual reconcile's final await, with a deferred inert checkpoint callback.
// Rows and Booleans remain synthetic data; no native guard or writer executes.
function postCheckpointFixture() {
  const f = pureResourceFixture({pause:false,recovery:true});
  let entered, release, calls = 0;
  const started = new Promise(resolve => entered = resolve), pending = new Promise(resolve => release = resolve);
  f.jobs.checkpointForRecovery = async () => { calls++; entered(); await pending; };
  return { ...f, started, release:()=>release(), get calls(){return calls;} };
}
for (const change of ['stable checkpoint','own checkpoint row','new process row','saved Run drift']) test('post-checkpoint resource cut: '+change, async () => {
  const f=postCheckpointFixture(),pending=f.provider.reconcile(f.run);await f.started;
  if(change==='own checkpoint row')f.row('run.recovery_checkpoint',{verified:false,mode:'SYNTHETIC_LOCAL'});
  else if(change==='new process row')f.row('agent.completion_process_started',{pid:12345});
  else if(change==='saved Run drift')f.run.state='interrupted';
  f.release();const result=await pending;assert.equal(f.calls,1);
  assert.equal(result.quiescent,change==='stable checkpoint');
  if(change!=='stable checkpoint'){assert.equal(result.settled,false);assert.equal(result.recoveryEligible,false);assert.equal(result.evidence.observationCurrent,false);}
});
test('post-checkpoint resource cut: current connection denial precedes stale return',async()=>{
  const f=postCheckpointFixture();let revoked=false;
  const pending=f.provider.reconcile(f.run,()=>{if(revoked)throw Error('Connection revoked after checkpoint')});await f.started;
  f.row('agent.completion_process_started',{pid:12345});revoked=true;f.release();
  await assert.rejects(pending,/Connection revoked after checkpoint/);assert.equal(f.calls,1);
});
test('post-checkpoint resource cut: final connection callback cannot hide new current rows',async()=>{
  const f=postCheckpointFixture();let checks=0;
  const pending=f.provider.reconcile(f.run,()=>{checks++;if(checks===3)f.row('agent.completion_process_started',{pid:12345})});await f.started;f.release();
  const result=await pending;assert.equal(checks,3);assert.equal(f.calls,1);assert.equal(result.quiescent,false);assert.equal(result.recoveryEligible,false);assert.equal(result.evidence.observationCurrent,false);
});
