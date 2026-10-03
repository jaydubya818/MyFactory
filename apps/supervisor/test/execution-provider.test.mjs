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
