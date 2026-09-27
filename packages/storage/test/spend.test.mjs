import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStorage } from '../src/index.ts';
import { SpendLedger } from '../src/spend.ts';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-spend-'));
  const path = join(dir, 'factory.sqlite');
  const storage = openStorage(path);
  const order = storage.createWorkOrder({ title: 'Spend fixture', description: 'Synthetic only', kind: 'feature',
    repositoryPath: dir, baseRef: 'a'.repeat(40), acceptanceCriteria: ['Safe'], reproductionCommand: null,
    expectedFailureText: null, checkCommands: [], allowedPaths: ['test.txt'], workerProfile: 'mac' });
  const run = storage.createRun({ workOrderId: order.id, workerProfile: 'mac', inputCommit: 'a'.repeat(40), workspacePath: dir });
  const ledger = new SpendLedger(path);
  const workId = 'work-1';
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const binding = { workId, workGeneration: 2, dispatchIdentity: 'dispatch-1', requestId: 'request-1',
    workOrderId: order.id, factoryVersion: 'version-1', runId: run.id };
  ledger.createBudget(binding, 100, deadline);
  const reserve = (id, amount, overrides = {}) => ledger.reserve({ ...binding, ...overrides,
    operationId: id, model: 'fixture-model', pricingRevision: 'fixture-v1', reservedMicrousd: amount });
  t.after(() => { ledger.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  return { path, ledger, binding, reserve, deadline };
}

test('same Work ceiling covers concurrent connections, generations, retries and replay', t => {
  const f = setup(t), other = new SpendLedger(f.path);
  t.after(() => other.close());
  const a = f.reserve('a', 70);
  assert.equal(a.state, 'reserved');
  assert.throws(() => other.createBudget({ ...f.binding, workGeneration: 3, requestId: 'request-2' },
    100, new Date(Date.now() + 60_000).toISOString()), /active spend/);
  assert.throws(() => other.reserve({ ...f.binding, operationId: 'b',
    model: 'other-provider', pricingRevision: 'fixture-v1', reservedMicrousd: 70 }), /ceiling/);
  assert.throws(() => f.reserve('a', 1), /already exists/);
  assert.throws(() => f.ledger.createBudget(f.binding, 200, f.deadline), /cannot reset/);
  f.ledger.markDispatched('a');
  f.ledger.settle('a', 25, 'provider-a', { input_tokens: 5, output_tokens: 5 });
  other.createBudget({ ...f.binding, workGeneration: 3, requestId: 'request-2' }, 100, new Date(Date.now() + 60_000).toISOString());
  const b = other.reserve({ ...f.binding, operationId: 'b', workGeneration: 3, requestId: 'request-2',
    model: 'other-provider', pricingRevision: 'fixture-v1', reservedMicrousd: 70 });
  assert.equal(b.workGeneration, 3);
  assert.throws(() => f.reserve('stale', 1), /binding/);
  assert.equal(f.ledger.read(f.binding.workId).availableMicrousd, 5);
});

test('process loss and unknown usage retain full exposure across reopen', t => {
  const f = setup(t);
  f.reserve('a', 90);
  f.ledger.markDispatched('a');
  const restarted = new SpendLedger(f.path);
  t.after(() => restarted.close());
  assert.equal(restarted.recoverUnknown(), 1);
  assert.equal(restarted.read(f.binding.workId).status, 'UNKNOWN');
  assert.equal(restarted.read(f.binding.workId).retainedMicrousd, 90);
  assert.throws(() => f.reserve('b', 20), /ceiling/);
  assert.throws(() => restarted.settle('a', 91, 'provider-a', { input_tokens: 1, output_tokens: 1 }), /exceeded reservation/);
  assert.equal(restarted.read(f.binding.workId).retainedMicrousd, 90);
});

test('cancellation denies new starts but preserves dispatched exposure', t => {
  const f = setup(t);
  f.reserve('a', 80);
  f.ledger.markDispatched('a');
  f.ledger.cancel(f.binding.workId);
  f.ledger.markUnknown('a');
  assert.throws(() => f.reserve('b', 1), /cancelled/);
  assert.equal(f.ledger.read(f.binding.workId).retainedMicrousd, 80);
  assert.equal(f.ledger.read(f.binding.workId).cancelled, true);
  assert.throws(() => f.ledger.createBudget(f.binding, 100, f.deadline), /cannot reset/);
});

test('cancel between reservation and dispatch prevents paid start', t => {
  const f = setup(t);
  f.reserve('a', 50);
  f.ledger.cancel(f.binding.workId);
  assert.throws(() => f.ledger.markDispatched('a'), /Post-cancel/);
  f.ledger.recoverUnknown();
  assert.equal(f.ledger.read(f.binding.workId).retainedMicrousd, 50);
});

test('a different Work cannot use another Work budget or WorkOrder binding', t => {
  const f = setup(t);
  assert.throws(() => f.reserve('cross-work', 1, { workId: 'work-b' }), /missing/);
  assert.throws(() => f.reserve('cross-order', 1, { workOrderId: 'different-order' }), /binding/);
  assert.equal(f.ledger.read(f.binding.workId).operations.length, 0);
});
