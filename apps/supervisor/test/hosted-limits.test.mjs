import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStorage } from '../../../packages/storage/src/index.ts';
import { SpendLedger } from '../../../packages/storage/src/spend.ts';
import { SpendGateway } from '../src/spend-gateway.ts';
import { HostedSpendGuard, parseHostedLimits, APPROVED_HOSTED_LIMITS, monthWindow } from '../src/hosted-limits.ts';
import { FactoryDispatchControl } from '../src/dispatch-control.ts';

const plan = { version: 'WORK_LEDGER_V2', pricingRevision: 'local-v1', model: 'fixture-model', validUntil: new Date(Date.now() + 3_600_000).toISOString(),
  perOperationReserveMicrousd: 1200, plannedProductiveOperations: 2, plannedCompletionOperations: 1, maxPaidOperations: 3, completionReserveMicrousd: 1200 };
function fixture(t, limits = APPROVED_HOSTED_LIMITS, now) {
  const dir = mkdtempSync(join(tmpdir(), 'hosted-limits-'));
  const path = join(dir, 'factory.sqlite'), storage = openStorage(path), ledger = new SpendLedger(path);
  const open = () => new HostedSpendGuard(join(dir, 'hosted-limits.sqlite'), path, limits, now);
  const guard = open();
  t.after(() => { try { guard.close(); } catch {} ledger.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  const work = (ceiling = 4000) => {
    const order = storage.createWorkOrder({ title: 'w', description: 'd', kind: 'feature', repositoryPath: dir, baseRef: 'a'.repeat(40), acceptanceCriteria: ['x'],
      reproductionCommand: null, expectedFailureText: null, checkCommands: [], allowedPaths: ['a.txt'], workerProfile: 'mac' });
    const run = storage.createRun({ workOrderId: order.id, workerProfile: 'mac', inputCommit: 'a'.repeat(40), workspacePath: dir });
    const binding = { workId: randomUUID(), workGeneration: 1, dispatchIdentity: randomUUID(), requestId: randomUUID(), workOrderId: order.id, factoryVersion: 'f', runId: run.id };
    ledger.createBudget(binding, ceiling, new Date(Date.now() + 600_000).toISOString(), plan); ledger.bindAuthority(binding);
    return binding;
  };
  const spendSettled = (binding, actual) => {
    const id = randomUUID();
    ledger.reserve({ ...binding, operationId: id, model: plan.model, pricingRevision: plan.pricingRevision, reservedMicrousd: 1200, phase: 'productive' });
    ledger.markDispatched(id);
    if (actual !== null) ledger.settle(id, actual, 'req-' + id, { input_tokens: 1, output_tokens: 1 });
    return id;
  };
  return { dir, guard, open, ledger, storage, work, spendSettled };
}

test('limits are the approved ceilings: absent means approved, lowering is allowed, raising refuses', () => {
  assert.deepEqual(APPROVED_HOSTED_LIMITS, { maxWorkMicrousd: 1_300_000, maxWorksPerPerson: 4, monthlyBudgetMicrousd: 25_000_000 });
  assert.deepEqual(parseHostedLimits(undefined), APPROVED_HOSTED_LIMITS);
  assert.deepEqual(parseHostedLimits({ maxWorkMicrousd: 1_000_000, maxWorksPerPerson: 2, monthlyBudgetMicrousd: 10_000_000 }).maxWorksPerPerson, 2);
  for (const raw of [{ ...APPROVED_HOSTED_LIMITS, maxWorkMicrousd: 1_300_001 }, { ...APPROVED_HOSTED_LIMITS, maxWorksPerPerson: 5 },
    { ...APPROVED_HOSTED_LIMITS, monthlyBudgetMicrousd: 25_000_001 }, { ...APPROVED_HOSTED_LIMITS, maxWorksPerPerson: 0 }, { ...APPROVED_HOSTED_LIMITS, extra: 1 }, null])
    assert.throws(() => parseHostedLimits(raw), /HOSTED_LIMITS_/);
});

test('per-Work ceiling: $1.30 admits, one micro-dollar more refuses', t => {
  const { guard } = fixture(t);
  assert.throws(() => guard.admit({ clientId: 'c', ownerScope: 'tester-a', workId: randomUUID(), ceilingMicrousd: 1_300_001 }), /HOSTED_WORK_CEILING/);
  assert.equal(guard.admit({ clientId: 'c', ownerScope: 'tester-a', workId: randomUUID(), ceilingMicrousd: 1_300_000 }), 'ADMITTED');
});

test('four Works per person, durable across restart, replay not counted, other people independent, never increased automatically', t => {
  const f = fixture(t);
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const workId of ids) assert.equal(f.guard.admit({ clientId: 'myeve', ownerScope: 'tester-a', workId, ceilingMicrousd: 1_000_000 }), 'ADMITTED');
  assert.equal(f.guard.admit({ clientId: 'myeve', ownerScope: 'tester-a', workId: ids[0], ceilingMicrousd: 1_000_000 }), 'REPLAY');
  assert.throws(() => f.guard.admit({ clientId: 'myeve', ownerScope: 'tester-a', workId: randomUUID(), ceilingMicrousd: 1 }), /HOSTED_PERSON_WORK_LIMIT/);
  assert.throws(() => f.guard.admit({ clientId: 'myeve', ownerScope: 'tester-b', workId: ids[0], ceilingMicrousd: 1_000_000 }), /BINDING_CONFLICT/);
  assert.throws(() => f.guard.admit({ clientId: 'myeve', ownerScope: 'tester-a', workId: ids[1], ceilingMicrousd: 999_999 }), /BINDING_CONFLICT/);
  assert.equal(f.guard.admit({ clientId: 'myeve', ownerScope: 'tester-b', workId: randomUUID(), ceilingMicrousd: 1_000_000 }), 'ADMITTED');
  f.guard.close();
  const reopened = f.open();
  t.after(() => reopened.close());
  assert.equal(reopened.worksAdmitted('myeve', 'tester-a'), 4);
  assert.throws(() => reopened.admit({ clientId: 'myeve', ownerScope: 'tester-a', workId: randomUUID(), ceilingMicrousd: 1 }), /HOSTED_PERSON_WORK_LIMIT/);
  assert.throws(() => reopened.admit({ clientId: '', ownerScope: 'tester-a', workId: randomUUID(), ceilingMicrousd: 1 }), /HOSTED_PERSON_REQUIRED/);
});

test('monthly guard: settled + reserved + UNKNOWN exposure this UTC month; admission and each reservation refuse beyond the budget', t => {
  const limits = { maxWorkMicrousd: 1_300_000, maxWorksPerPerson: 4, monthlyBudgetMicrousd: 5000 };
  const f = fixture(t, limits);
  const a = f.work();
  f.spendSettled(a, 900);              // settled: counts its actual (900)
  const b = f.work();
  const unknown = f.spendSettled(b, null); f.ledger.markUnknown(unknown);   // UNKNOWN: counts its reservation (1200)
  assert.equal(f.guard.recordedMonthMicrousd(), 2100);
  assert.throws(() => f.guard.admit({ clientId: 'c', ownerScope: 'p', workId: randomUUID(), ceilingMicrousd: 3000 }), /HOSTED_MONTHLY_BUDGET/);
  assert.equal(f.guard.admit({ clientId: 'c', ownerScope: 'p', workId: randomUUID(), ceilingMicrousd: 2900 }), 'ADMITTED');
  f.guard.assertReservation(2900);
  assert.throws(() => f.guard.assertReservation(2901), /HOSTED_MONTHLY_BUDGET/);
  // The guard wrapper refuses BEFORE the ledger writes anything.
  const c = f.work(), wrapped = f.guard.wrapLedger(f.ledger);
  const blocked = { ...c, operationId: randomUUID(), model: plan.model, pricingRevision: plan.pricingRevision, reservedMicrousd: 3000, phase: 'productive' };
  assert.throws(() => wrapped.reserve(blocked), /HOSTED_MONTHLY_BUDGET/);
  assert.equal(f.ledger.getOperation(blocked.operationId), null);
  // A new UTC month starts from zero recorded exposure (the OpenAI project budget is also per month; set by Jay, not code).
  const next = new HostedSpendGuard(join(f.dir, 'hosted-limits.sqlite'), join(f.dir, 'factory.sqlite'), limits, () => new Date(Date.parse(monthWindow(new Date()).end) + 1000));
  t.after(() => next.close());
  assert.equal(next.recordedMonthMicrousd(), 0);
});

test('spend gateway with the guarded ledger: the reservation that would cross the month budget is refused before any provider I/O', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hosted-gateway-'));
  const path = join(dir, 'factory.sqlite'), storage = openStorage(path), ledger = new SpendLedger(path);
  const guard = new HostedSpendGuard(join(dir, 'hosted-limits.sqlite'), path, { maxWorkMicrousd: 1_300_000, maxWorksPerPerson: 4, monthlyBudgetMicrousd: 2000 });
  let calls = 0;
  const upstream = createServer((req, res) => { calls++; req.resume(); req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req-' + calls });
    res.end(JSON.stringify({ id: 'resp', status: 'completed', usage: { input_tokens: 900, output_tokens: 100 } })); }); });   // settles 1100 µUSD
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const order = storage.createWorkOrder({ title: 'w', description: 'd', kind: 'feature', repositoryPath: dir, baseRef: 'a'.repeat(40), acceptanceCriteria: ['x'],
    reproductionCommand: null, expectedFailureText: null, checkCommands: [], allowedPaths: ['a.txt'], workerProfile: 'mac' });
  const run = storage.createRun({ workOrderId: order.id, workerProfile: 'mac', inputCommit: 'a'.repeat(40), workspacePath: dir });
  const binding = { workId: 'w', workGeneration: 1, dispatchIdentity: 'd', requestId: 'r', workOrderId: order.id, factoryVersion: 'f', runId: run.id };
  const price = { revision: 'local-v1', model: 'fixture-model', validUntil: plan.validUntil, contextLimitTokens: 1000, outputLimitTokens: 100,
    inputMicrousdPerMillion: 1_000_000, outputMicrousdPerMillion: 2_000_000 };
  ledger.createBudget(binding, 4000, new Date(Date.now() + 600_000).toISOString(), plan); ledger.bindAuthority(binding);
  const gateway = new SpendGateway({ ledger: guard.wrapLedger(ledger), binding, price, upstreamOrigin: `http://127.0.0.1:${upstream.address().port}`,
    upstreamApiKey: 'provider-secret', childToken: 'a'.repeat(64), phase: 'productive' });
  const base = await gateway.listen();
  t.after(async () => { await gateway.close(); await new Promise(r => upstream.close(r)); guard.close(); ledger.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = () => fetch(base + '/responses', { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'fixture-model', input: 'hi' }) });
  assert.equal((await call()).status, 200);
  assert.equal(calls, 1);
  const second = await call();
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, 'LOCAL_ADMISSION_DENIED');
  assert.equal(calls, 1, 'no provider I/O after the month guard refused');
  assert.equal(ledger.read('w').operations.length, 1);
});

test('hosted limits compose only with the metered host provider', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hosted-compose-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const control = new FactoryDispatchControl({}, {}, {}, {}, false, undefined, true);
  assert.throws(() => control.useHostedLimits({}), /only to the metered host composition/);
});
