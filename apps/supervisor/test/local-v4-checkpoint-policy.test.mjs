// Tiny public data/control-flow fixtures. No native worker or absence proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import { planCheckpoint, selectCheckpointPhase, checkpointPolicyFailure } from '../src/local-v4-checkpoint-policy.ts';
import { requireStrictSourceOperations, contextPolicyKind } from '../src/local-v4-context-policy.ts';
import { finalizationPolicyFailure } from '../src/local-v4-finalization-policy.ts';
import { createLocalV4Preparation, bindLocalV4PreparationCapture } from '../src/local-v4-preparation.ts';
const root = '1'.repeat(40), command = 'public-check';
const identity = { sourceDigest: 'public-source', configurationDigest: 'public-config', inputCommit: '2'.repeat(40),
  inputTree: '3'.repeat(40), workspacePath: '/public-unused', attemptNumber: 1 };
const row = (id, type, payload = {}) => ({ id, type, payload, workOrderId: 'public-work', runId: 'public-run', createdAt: '2026-10-28T00:00:00Z' });
const result = (id, step) => row(id, 'run.agent_result', { checkpointVersion: 1, productiveStep: step, implementationEligible: true });
const settled = (id, resultId, step) => row(id, 'run.implementation_settled', { ...identity, checkpointVersion: 1,
  productiveStep: step, agentResultEventId: resultId, provenance: 'TRUSTED_IN_PROCESS_CALLBACK_RETURNED' });
const cp = (id, resultId, settlementId, step, passed) => row(id, 'run.implementation_checkpoint', {
  checkpointVersion: 1, contextVersion: 1, productiveStep: step, agentResultEventId: resultId, settlementEventId: settlementId,
  tree: root, passed, exportStatus: 'ready', checks: [{ command, status: passed ? 'passed' : 'failed' }],
});
function fixture(step = 1, recheck = false) {
  const events = [row(1, 'run.implementing'), result(2, 1), settled(3, 2, 1)];
  if (step === 2) events.push(cp(4, 2, 3, 1, false), row(5, 'run.productive_repair_admitted', {
    contextVersion: 1, productiveStep: 2, checkpointEventId: 4, checkedTree: root,
  }), result(6, 2), settled(7, 6, 2));
  const phase = { kind: 'CAPTURE', productiveStep: step, agentResultEventId: step === 1 ? 2 : 6, settlementEventId: step === 1 ? 3 : 7 };
  if (recheck) { events.push(cp(step === 1 ? 4 : 8, phase.agentResultEventId, phase.settlementEventId, step, true));
    Object.assign(phase, { kind: 'RECHECK', checkpointEventId: step === 1 ? 4 : 8, expectedTree: root }); }
  return { events, phase };
}
const select = f => selectCheckpointPhase(f.events, f.phase, [command], identity);
for (const step of [1, 2]) for (const recheck of [false, true]) test(`phase data: exact step${step} ${recheck ? 'recheck' : 'capture'} joins actual synthetic rows`, () => {
  const f = fixture(step, recheck); assert.equal(select(f).at(-1).id, f.events.at(-1).id);
});
for (const variant of ['missing settlement', 'duplicate settlement', 'pre-result settlement', 'foreign source', 'wrong step', 'stale frame',
  'ineligible result', 'extra frame key', 'future completion', 'wrong checkpoint settlement', 'unavailable checks', 'wrong repair']) test('phase data: refuses ' + variant, () => {
  const f = fixture(variant === 'wrong repair' ? 2 : 1, ['wrong checkpoint settlement', 'unavailable checks'].includes(variant));
  const s = f.events.find(e => e.type === 'run.implementation_settled');
  if (variant === 'missing settlement') f.events = f.events.filter(e => e !== s);
  if (variant === 'duplicate settlement') f.events.push({ ...s, id: 20 });
  if (variant === 'pre-result settlement') { s.id = 2; f.events[1].id = 3; f.events.sort((a, b) => a.id - b.id); }
  if (variant === 'foreign source') s.payload.sourceDigest = 'different';
  if (variant === 'wrong step') s.payload.productiveStep = 2;
  if (variant === 'stale frame') f.phase.settlementEventId = 19;
  if (variant === 'ineligible result') f.events[1].payload.implementationEligible = false;
  if (variant === 'extra frame key') f.phase.nativeAbsence = true;
  if (variant === 'future completion') f.events.push(row(20, 'run.completion_started'));
  if (variant === 'wrong checkpoint settlement') f.events.at(-1).payload.settlementEventId = 2;
  if (variant === 'unavailable checks') f.events.at(-1).payload.checks[0].status = 'unavailable';
  if (variant === 'wrong repair') f.events.find(e => e.type === 'run.productive_repair_admitted').payload.checkpointEventId = 99;
  assert.throws(() => select(f), { code: 'local_checkpoint_hold', status: 503 });
});
test('pure pending control-flow: eligible result cannot select a writer basis before post-settlement row', async () => {
  const f = fixture(); const settlement = f.events.pop(); let finish;
  const pending = new Promise(resolve => { finish = resolve; }).then(() => f.events.push(settlement));
  assert.throws(() => select(f), { code: 'local_checkpoint_hold' }); finish(); await pending; assert.equal(select(f).length, 3);
});
test('graph data: canonical raw blobs and nested trees validate without a native writer', async () => {
  const files = { 'README.md': 'ordinary\n', 'src/sample.txt': 'hello\n', 'empty.txt': '' };
  const plan = await planCheckpoint(files, performance.now() + 30000);
  assert.equal(plan.objects.at(-1).id, plan.tree); assert.equal(plan.objects.at(-1).kind, 'tree');
  for (const object of plan.objects) assert.equal(object.id, createHash('sha1').update(object.kind + ' ' + object.bytes.length + '\0').update(object.bytes).digest('hex'));
  assert.equal(plan.objects.filter(o => o.kind === 'blob').length, 3);
});
for (const files of [{}, { '../sample.txt': 'x' }, { 'sample.txt': '\0' }, { '.Git': 'x' }, { 'A.txt': 'x', 'a.txt': 'y' },
  { src: 'x', 'src/sample.txt': 'y' }]) test('graph data: tiny unsupported graph refuses ' + JSON.stringify(Object.keys(files)), async () => {
  await assert.rejects(planCheckpoint(files, performance.now() + 30000), { code: 'local_checkpoint_hold' });
});
for (const version of [null, 1, 2, 3, 4]) for (const marker of ['checkpoint', 'checkpointBasis']) test(`strict seam: ${marker} with ${version} snapshot cannot downgrade`, () => {
  assert.throws(() => requireStrictSourceOperations(version === null ? null : { version }, { [marker]() {} }), { code: 'local_context_hold' });
});
test('strict seam: actual binder hides raw checkpoint basis and exposes fixed checkpoint only', () => {
  let calls = 0;
  const bound = bindLocalV4PreparationCapture(createLocalV4Preparation('/public-no-native-checkpoint'), {
    capture() { throw Error('No capture'); }, snapshot() { return null; }, read() { throw Error('No read'); }, finalize() { throw Error('No sign'); },
    checkpointBasis() { calls++; throw checkpointPolicyFailure(null); },
  });
  assert.equal(Object.hasOwn(bound, 'checkpointBasis'), false); assert.equal(typeof bound.checkpoint, 'function');
  assert.throws(() => requireStrictSourceOperations(null, bound), { code: 'local_context_hold' }); assert.equal(calls, 0);
});
const jobsText = readFileSync(new URL('../src/jobs.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('jobs.ts', jobsText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'JobManager');
const member = name => declaration.members.find(n => n.name?.getText(ast) === name).getText(ast);
let checkpointSelector, connectedSelector, finalizationSelector;
function findSelector(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'strictCheckpoint') checkpointSelector = node.initializer.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'connectedCompletion') connectedSelector = node.initializer.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'strictFinalization') finalizationSelector = node.initializer.getText(ast);
  ts.forEachChild(node, findSelector);
}
findSelector(declaration); assert(checkpointSelector);
for (const checkpointFlow of [false, true]) test('exact caller selector: ' + (checkpointFlow ? 'checkpoint flow requires complete strict seams' : 'existing nongateway candidate flow remains separate'), () => {
  let snapshots = 0;
  const instance = { producer: { snapshot() { snapshots++; return { version: 4 }; } } };
  const code = 'class Probe {constructor(){this.producer=producer;}\n' + member('#strictConnectedCompletion') + '\ninvoke(active,run){const connectedCompletion=' + connectedSelector + ';const strictFinalization=' + finalizationSelector + ';return (' + checkpointSelector + ');}};return new Probe().invoke(active,run);';
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const select = function(active, requireStrictSourceOperations, run) { return new Function('producer', 'active', 'run', 'requireStrictSourceOperations', 'contextPolicyKind', 'finalizationPolicyFailure', js)(this.producer, active, run, requireStrictSourceOperations, contextPolicyKind, finalizationPolicyFailure); };
  const active = checkpointFlow ? { gateway: { beginCompletion() {} } } : {};
  if (checkpointFlow) assert.throws(() => select.call(instance, active, requireStrictSourceOperations, {}), { code: 'local_context_hold' });
  else { assert.equal(select.call(instance, active, requireStrictSourceOperations, {}), false); assert.equal(snapshots, 0); }
});
function wrapperFixture() {
  let resolve, calls = 0, activeChecks = 0, legacy = 0; const pending = new Promise(r => { resolve = r; });
  const run = { id: 'public-run', workOrderId: 'public-work', workspacePath: '/unused', inputCommit: identity.inputCommit };
  const active = { controller: new AbortController(), reason: null, runId: run.id };
  const producer = { assertVerificationInputReady(){throw Error('Unused input readiness in source fixture')},prepareVerificationInput(){throw Error('Unused input preparation in source fixture')},closeVerificationInput(){throw Error('Unused input close in source fixture')},snapshot: () => ({ version: 4 }), context() {}, assertProgress() {}, commitCandidate() { throw Error('No finalization in checkpoint fixture'); }, checkpoint: async () => { calls++; await pending; return { tree: root, changedPaths: ['sample.txt'] }; } };
  const code = 'class Probe {#active=new Map();constructor(){this.producer=producer;this.#active.set(run.workOrderId,active)} assertActive(){activeChecks++}\n' +
    member('#checkpointActive') + '\n' + member('#implementationCheckpoint') + '\ninvoke(){return this.#implementationCheckpoint(run,active,controller,phase,[],"/unused")} replace(){this.#active.set(run.workOrderId,{...active,controller:new AbortController()})}}';
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const Type = new Function('producer', 'run', 'active', 'phase', 'requireStrictSourceOperations', 'checkpointPolicyFailure', 'snapshotCandidateTree', 'controller', js + '\nreturn Probe;')(
    producer, run, active, fixture().phase, requireStrictSourceOperations, checkpointPolicyFailure, () => { legacy++; throw Error('No ambient helper'); }, active.controller);
  // The exact method uses this assertion counter through a lexical closure.
  const instance = new Type(); instance.assertActive = () => { activeChecks++; };
  return { instance, active, resolve: () => resolve(), get calls() { return calls; }, get legacy() { return legacy; }, get activeChecks() { return activeChecks; } };
}
for (const variant of ['unchanged', 'abort', 'replace', 'replace-controller']) test('exact checkpoint caller: pending return ' + variant, async () => {
  const f = wrapperFixture(), pending = f.instance.invoke(); assert.equal(f.calls, 1); assert.equal(f.legacy, 0);
  if (variant === 'abort') f.active.controller.abort(); if (variant === 'replace') f.instance.replace(); if (variant === 'replace-controller') f.active.controller = new AbortController(); f.resolve();
  if (variant === 'unchanged') { assert.equal((await pending).tree, root); assert.equal(f.activeChecks, 2); }
  else await assert.rejects(pending, { code: 'local_checkpoint_hold' });
});
test('static issuer: settlement is after unchanged process guard and before capture, all three callers use fixed operation', () => {
  const guard = jobsText.indexOf("throw Error('Productive process is not quiescent')"), issuer = jobsText.indexOf("'run.implementation_settled'"), capture = jobsText.indexOf("{kind:'CAPTURE'");
  assert(guard > 0 && issuer > guard && capture > issuer);
  assert.equal((jobsText.match(/await this\.#implementationCheckpoint\(/g) ?? []).length, 3);
  assert.equal((jobsText.match(/return snapshotCandidateTree\(/g) ?? []).length, 1);
});
