import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStorage } from '../src/index.ts';
import { SpendLedger } from '../src/spend.ts';

function setup(t, { ceiling = 4000, productive = 2, completion = 1, reserve = 1200 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-spend-v2-'));
  const path = join(dir, 'factory.sqlite');
  const storage = openStorage(path);
  const order = storage.createWorkOrder({ title: 'Spend fixture', description: 'Synthetic only', kind: 'feature',
    repositoryPath: dir, baseRef: 'a'.repeat(40), acceptanceCriteria: ['Safe'], reproductionCommand: null,
    expectedFailureText: null, checkCommands: [], allowedPaths: ['test.txt'], workerProfile: 'mac' });
  const run = storage.createRun({ workOrderId: order.id, workerProfile: 'mac', inputCommit: 'a'.repeat(40), workspacePath: dir });
  const ledger = new SpendLedger(path), workId = 'work-1';
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const binding = { workId, workGeneration: 2, dispatchIdentity: 'dispatch-1', requestId: 'request-1',
    workOrderId: order.id, factoryVersion: 'version-1', runId: run.id };
  const plan = { version: 'WORK_LEDGER_V2', pricingRevision: 'fixture-v1', model: 'fixture-model',validUntil:new Date(Date.now()+60000).toISOString(),
    perOperationReserveMicrousd: reserve, plannedProductiveOperations: productive,
    plannedCompletionOperations: completion, maxPaidOperations: productive + completion,
    completionReserveMicrousd: reserve * completion };
  ledger.createBudget(binding, ceiling, deadline, plan);
  ledger.bindAuthority(binding);
  const reserveOperation = (id, phase = 'productive', overrides = {}) => ledger.reserve({ ...binding,
    operationId: id, model: plan.model, pricingRevision: plan.pricingRevision, reservedMicrousd: reserve, phase,
    ...overrides });
  const settle = (id, actual = 30) => { ledger.markDispatched(id); ledger.settle(id, actual, 'provider-' + id,
    { input_tokens: 10, output_tokens: 10 }); };
  t.after(() => { ledger.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  return { path, ledger, binding, plan, deadline, reserve: reserveOperation, settle };
}

test('V2 rejects a plan that cannot fund all productive and completion calls', t => {
  const f = setup(t);
  assert.throws(() => f.ledger.createBudget(f.binding, 4000, f.deadline,
    {...f.plan,completionReserveMicrousd:100}), /Complete conservative paid operation plan/);
  assert.throws(() => f.ledger.createBudget({...f.binding,workId:'other'},3500,f.deadline,f.plan),
    /Complete conservative paid operation plan/);
});

test('UNKNOWN is a hard Work-level stop across restart, attempt and model changes', t => {
  const f = setup(t);
  f.reserve('first'); f.ledger.markDispatched('first'); f.ledger.markUnknown('first');
  const restarted = new SpendLedger(f.path); t.after(() => restarted.close());
  assert.equal(restarted.read(f.binding.workId).unknownExposureMicrousd,1200);
  assert.throws(() => f.reserve('second'), /UNKNOWN/);
  assert.throws(() => restarted.reserve({...f.binding,operationId:'retry',model:'other-model',
    pricingRevision:f.plan.pricingRevision,reservedMicrousd:1200,phase:'productive'}), /pricing|UNKNOWN/);
  const next={...f.binding,workGeneration:3,requestId:'next-request'};
  restarted.createBudget(next,4000,new Date(Date.now()+60000).toISOString(),f.plan);
  restarted.bindAuthority(next);
  assert.throws(() => restarted.reserve({...next,operationId:'next',model:f.plan.model,
    pricingRevision:f.plan.pricingRevision,reservedMicrousd:1200,phase:'productive'}), /UNKNOWN/);
  restarted.settle('first',30,'provider-first',{input_tokens:10,output_tokens:10});
  assert.equal(restarted.read(f.binding.workId).unknownExposureMicrousd,0);
});

test('productive calls cannot take completion reserve and host-only completion transition fences old phase', t => {
  const f = setup(t);
  f.reserve('one');f.settle('one',1200);
  f.reserve('two');f.settle('two',1200);
  assert.throws(() => f.reserve('three'), /phase|limit|reserve/);
  const read=f.ledger.read(f.binding.workId);
  assert.equal(read.productiveAllowanceRemainingMicrousd,400);
  assert.equal(read.completionReserveRemainingMicrousd,1200);
  f.ledger.beginCompletion(f.binding);
  assert.throws(()=>f.ledger.assertCompleted(f.binding),/Mandatory completion/);
  assert.throws(() => f.reserve('old'),/phase/);
  f.reserve('complete','completion');f.settle('complete',30);
  assert.doesNotThrow(()=>f.ledger.assertCompleted(f.binding));
  assert.equal(f.ledger.read(f.binding.workId).completionOperationSlotsRemaining,0);
  assert.throws(() => f.reserve('extra','completion'),/limit/);
});

test('paid operation slots persist across process restart and exact replay cannot dispatch twice', t => {
  const f = setup(t);
  f.reserve('a');f.settle('a');
  const restarted=new SpendLedger(f.path);t.after(()=>restarted.close());
  assert.throws(()=>restarted.reserve({...f.binding,operationId:'a',model:f.plan.model,
    pricingRevision:f.plan.pricingRevision,reservedMicrousd:1200,phase:'productive'}),/already exists/);
  f.reserve('b');f.settle('b');
  assert.equal(restarted.read(f.binding.workId).paidOperationsUsed,2);
  assert.throws(()=>restarted.reserve({...f.binding,operationId:'c',model:f.plan.model,
    pricingRevision:f.plan.pricingRevision,reservedMicrousd:1200,phase:'productive'}),/limit/);
});

test('reservation, UNKNOWN, cancellation and authority are checked again at paid dispatch', t => {
  const f=setup(t);
  f.reserve('reserved');f.reserve('unknown');f.ledger.markDispatched('unknown');f.ledger.markUnknown('unknown');
  assert.throws(()=>f.ledger.markDispatched('reserved'),/UNKNOWN/);
  f.ledger.cancel(f.binding.workId);
  assert.throws(()=>f.ledger.markDispatched('reserved'),/Post-cancel/);
  assert.equal(f.ledger.read(f.binding.workId).authorityState,'fenced');
  assert.equal(f.ledger.read(f.binding.workId).retainedMicrousd,2400);
});

test('concurrent ledger connections share the last operation slot', t => {
  const f=setup(t),other=new SpendLedger(f.path);t.after(()=>other.close());
  f.reserve('a');f.settle('a');
  other.reserve({...f.binding,operationId:'b',model:f.plan.model,pricingRevision:f.plan.pricingRevision,
    reservedMicrousd:1200,phase:'productive'});
  assert.throws(()=>f.reserve('c'),/limit/);
  assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,2);
});

test('legacy V1 Work budget has no paid admission', t => {
  const f=setup(t);
  f.ledger.createBudget({...f.binding,workId:'legacy'},4000,f.deadline);
  assert.throws(()=>f.ledger.bindAuthority({...f.binding,workId:'legacy'}),/V2|authority/);
  assert.throws(()=>f.ledger.reserve({...f.binding,workId:'legacy',operationId:'legacy-op',model:f.plan.model,
    pricingRevision:f.plan.pricingRevision,reservedMicrousd:1200,phase:'productive'}),/V2/);
});

test('process loss retains slot and dollars before dispatch, after dispatch, and in completion', t => {
  const f=setup(t);
  f.reserve('pre-dispatch');
  const reopened=new SpendLedger(f.path);t.after(()=>reopened.close());
  assert.equal(reopened.recoverUnknown(),1);
  assert.equal(reopened.read(f.binding.workId).paidOperationsUsed,1);
  assert.equal(reopened.read(f.binding.workId).unknownExposureMicrousd,1200);
  assert.throws(()=>f.reserve('blocked'),/UNKNOWN/);
  reopened.settle('pre-dispatch',0,'authoritative-not-sent',{input_tokens:0,output_tokens:0});
  f.reserve('dispatched');f.ledger.markDispatched('dispatched');
  assert.equal(reopened.recoverUnknown(),1);
  assert.throws(()=>f.reserve('still-blocked'),/UNKNOWN/);
  reopened.settle('dispatched',30,'authoritative-dispatched',{input_tokens:10,output_tokens:10});
  f.ledger.beginCompletion(f.binding);
  f.reserve('completion','completion');
  assert.equal(reopened.recoverUnknown(),1);
  assert.equal(reopened.read(f.binding.workId).completionReserveRemainingMicrousd,0);
  assert.equal(reopened.read(f.binding.workId).completionOperationSlotsRemaining,0);
  assert.equal(reopened.read(f.binding.workId).accountingComplete,false);
  reopened.settle('completion',30,'authoritative-completion',{input_tokens:10,output_tokens:10});
  assert.equal(reopened.read(f.binding.workId).accountingComplete,true);
  assert.equal(reopened.read(f.binding.workId).paidOperationsUsed,3);
  const afterSettlement=new SpendLedger(f.path);t.after(()=>afterSettlement.close());
  assert.equal(afterSettlement.recoverUnknown(),0);
  assert.equal(afterSettlement.read(f.binding.workId).paidOperationsUsed,3);
  assert.equal(afterSettlement.read(f.binding.workId).completionOperationSlotsRemaining,0);
});

test('two completion operations cannot race past protected completion slots or dollars', t => {
  const f=setup(t,{ceiling:4000,productive:1,completion:2}),other=new SpendLedger(f.path);
  t.after(()=>other.close());
  f.reserve('productive');f.settle('productive');f.ledger.beginCompletion(f.binding);
  f.reserve('completion-one','completion');
  other.reserve({...f.binding,operationId:'completion-two',model:f.plan.model,
    pricingRevision:f.plan.pricingRevision,reservedMicrousd:1200,phase:'completion'});
  assert.throws(()=>f.reserve('completion-three','completion'),/limit/);
  assert.equal(f.ledger.read(f.binding.workId).completionReserveRemainingMicrousd,0);
  assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,3);
});

test('wrong authority, old generation, wrong pricing and phase cannot start paid operation', t => {
  const f=setup(t);
  assert.throws(()=>f.reserve('wrong-authority','productive',{dispatchIdentity:'other'}),/authority/);
  assert.throws(()=>f.reserve('wrong-version','productive',{factoryVersion:'other'}),/authority/);
  assert.throws(()=>f.reserve('wrong-model','productive',{model:'other'}),/pricing/);
  assert.throws(()=>f.reserve('wrong-phase','completion'),/phase/);
  assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,0);
});


test('expired pinned pricing is denied at the ledger even after an earlier reservation', t => {
  const f=setup(t);
  f.reserve('pricing-held');
  const db=new DatabaseSync(f.path);
  t.after(()=>db.close());
  db.prepare('UPDATE work_spend_budgets SET pricing_valid_until = ? WHERE work_id = ?')
    .run('2000-01-01T00:00:00Z',f.binding.workId);
  assert.equal(f.ledger.read(f.binding.workId).pricingQualified,false);
  assert.throws(()=>f.ledger.markDispatched('pricing-held'),/pricing expired/);
  assert.throws(()=>f.reserve('pricing-new'),/pricing expired/);
});

test('Attempt 5 completion eligibility rejects UNKNOWN, stale generation, fenced writer and used completion',t=>{
 const f=setup(t);f.reserve('first');f.settle('first',30);
 assert.doesNotThrow(()=>f.ledger.assertCompletionEligible(f.binding));
 assert.throws(()=>f.ledger.assertCompletionEligible({...f.binding,workGeneration:0}));
 f.reserve('second');f.ledger.markDispatched('second');f.ledger.markUnknown('second');
 assert.throws(()=>f.ledger.assertCompletionEligible(f.binding),/Outstanding/);
 f.ledger.settle('second',30,'provider-second',{input_tokens:10,output_tokens:10});
 f.ledger.beginCompletion(f.binding);assert.throws(()=>f.ledger.beginCompletion(f.binding));
 f.reserve('completion','completion');f.settle('completion',30);
 assert.throws(()=>f.reserve('again','completion'),/limit/);assert.throws(()=>f.reserve('productive-again'),/phase/);
 f.ledger.fenceAuthority(f.binding);assert.throws(()=>f.ledger.assertCompletionEligible(f.binding));
});
