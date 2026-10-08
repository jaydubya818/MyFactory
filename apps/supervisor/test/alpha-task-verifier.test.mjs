import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  verifyAlphaTask, loadHiddenSuite, attestationValid, productionRunnerIds, gitTreeId, producerVisible, acceptanceOutcome, policySha256, HIDDEN_SUITE_SHA256, supportedBaseTrees, unsupportedBaseTrees,
} from '../src/alpha-task-verifier.ts';
import { localNodeRunner } from '../src/alpha-task-runner.ts';
import { baseFiles, correctFiles, negativeFixtures, focusedTests } from './fixtures/alpha-tasks/index.mjs';

// Hidden acceptance material is held OUTSIDE this public repository. Tests that execute candidates need it.
const custodyBase = process.env.FACTORY_VERIFIER_CUSTODY_DIR;
const hasCustody = !!custodyBase;
const skipNoCustody = hasCustody ? false : 'NOT_RUN: set FACTORY_VERIFIER_CUSTODY_DIR to the verifier custody directory (hidden suite is not in the repository)';
const hidden = hasCustody ? await loadHiddenSuite() : undefined;
const stubHidden = { sha256: 'stub', probeSource: '', scenarios: {}, evaluators: {}, uiEvaluators: {} };
const runner = localNodeRunner();
const isolation = await runner.isolation();
const proven = isolation.fsConfined && isolation.networkDenied && isolation.envScrubbed;

const SOURCE_COMMIT = 'a'.repeat(40), CANDIDATE_COMMIT = 'b'.repeat(40);
function inputFor(files, over = {}) {
  const source = { commit: SOURCE_COMMIT, tree: gitTreeId(baseFiles), files: baseFiles };
  const candidate = { commit: CANDIDATE_COMMIT, tree: gitTreeId(files), files, parent: SOURCE_COMMIT };
  return {
    source, candidate, expected: { sourceCommit: source.commit, sourceTree: source.tree, candidateCommit: candidate.commit, candidateTree: candidate.tree },
    producer: { environmentId: 'producer-env-1' }, verifier: { environmentId: 'verifier-env-1' }, observedEffects: ['PRIVATE_SOURCE_READ', 'CANDIDATE_CUSTODY_WRITE'],
    runner, hidden: hidden ?? stubHidden, ...over,
  };
}
const byId = (report, id) => report.checks.find((c) => c.id === id);
function countingRunner() {
  const calls = { node: 0, workspace: 0 };
  return { calls, runner: { id: 'counting', isolation: () => runner.isolation(), workspace: (f) => { calls.workspace += 1; return runner.workspace(f); }, node: (w, a, o) => { calls.node += 1; return runner.node(w, a, o); } } };
}

test('gitTreeId is git-identical for the reference trees', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alpha-git-'));
  try {
    for (const [name, files] of [['base', baseFiles], ['correct', correctFiles()]]) {
      const work = join(dir, name); await mkdir(work);
      for (const [p, t] of Object.entries(files)) { await mkdir(join(work, p, '..'), { recursive: true }); await writeFile(join(work, p), t); }
      const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
      execFileSync('git', ['init', '-q'], { cwd: work, env }); execFileSync('git', ['add', '-A'], { cwd: work, env });
      assert.equal(execFileSync('git', ['write-tree'], { cwd: work, env, encoding: 'utf8' }).trim(), gitTreeId(files), name);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  assert.ok(supportedBaseTrees[gitTreeId(baseFiles)], 'reference fixture is the registered supported base');
});

test('local runner proves filesystem, network and environment isolation (or says it cannot)', () => {
  if (!proven) { assert.equal(proven, false); assert.ok(isolation.detail.length > 0); return; }
  assert.deepEqual([isolation.fsConfined, isolation.networkDenied, isolation.envScrubbed], [true, true, true]);
});

test('POSITIVE: a correct candidate on the pristine snapshot is PASS with all ten criteria evidenced', { skip: skipNoCustody }, async () => {
  const report = await verifyAlphaTask(inputFor(correctFiles()));
  if (!proven) { assert.equal(report.verdict, 'PARTIAL'); return; } // honest degradation on hosts that cannot prove isolation
  assert.equal(report.verdict, 'PASS', JSON.stringify(report.checks.filter((c) => c.status !== 'PASS')));
  assert.deepEqual(report.criteria.map((c) => c.status), Array(10).fill('PASS'));
  assert.deepEqual(report.notApplicable, ['typecheck']);
  assert.equal(report.separation.producerReportConsulted, false);
  assert.equal(report.hiddenSuiteSha256, HIDDEN_SUITE_SHA256);
  for (const c of report.criteria) assert.ok(c.checks.length > 0, `criterion ${c.id} maps to at least one check`);
  assert.deepEqual(report.criteria.find((c) => c.id === 7).checks, ['candidate.tests']);
  assert.equal(report.policySha256, policySha256);
  assert.equal(report.identities.candidateTree, gitTreeId(correctFiles()));
});

test('NEGATIVE fixtures are never PASS and fail on the intended check', { skip: skipNoCustody }, async () => {
  for (const [name, { files, expect }] of Object.entries(negativeFixtures())) {
    const report = await verifyAlphaTask(inputFor(files));
    if (!proven) { assert.notEqual(report.verdict, 'PASS', name); continue; }
    assert.equal(report.verdict, expect.verdict, `${name}: ${JSON.stringify(report.checks.filter((c) => c.status !== 'PASS' && c.status !== 'NOT_APPLICABLE').map((c) => [c.id, c.status, c.code]))}`);
    for (const id of expect.fail ?? []) assert.equal(byId(report, id)?.status, 'FAIL', `${name} -> ${id}`);
    for (const id of expect.inconclusive ?? []) assert.equal(byId(report, id)?.status, 'INCONCLUSIVE', `${name} -> ${id}`);
    assert.ok(report.criteria.some((c) => c.status !== 'PASS'), name);
  }
});

test('static violations FAIL without any hidden material and without executing candidate code', async () => {
  const fixtures = negativeFixtures();
  for (const name of ['disallowedFileStyles', 'prohibitedPackageJson', 'prohibitedWorkflow', 'prohibitedDeployFile', 'hiddenTestTampering', 'forgedProbeOutput', 'externalEgress', 'embeddedSecret']) {
    const counter = countingRunner();
    const report = await verifyAlphaTask(inputFor(fixtures[name].files, { runner: counter.runner, hidden: stubHidden }));
    assert.equal(report.verdict, 'FAIL', name);
    for (const id of fixtures[name].expect.fail) assert.equal(byId(report, id).status, 'FAIL', name);
    assert.equal(counter.calls.node, 0, `${name}: candidate code was not executed`);
    assert.equal(byId(report, 'hidden.custody').status, 'INCONCLUSIVE'); // stub suite is never accepted as custody
  }
  const deleted = await verifyAlphaTask(inputFor(fixtures.existingTestDeleted.files, { hidden: stubHidden }));
  assert.equal(deleted.verdict, 'FAIL'); assert.equal(byId(deleted, 'existing.tests').code, 'EXISTING_TEST_DELETED');
});

test('candidate and source identity mismatches fail closed before execution', async () => {
  const files = correctFiles();
  const cases = {
    hostRecordedOtherTree: i => ({ ...i, expected: { ...i.expected, candidateTree: 'c'.repeat(40) } }),
    hostRecordedOtherCommit: i => ({ ...i, expected: { ...i.expected, candidateCommit: 'd'.repeat(40) } }),
    labelDoesNotMatchBytes: i => ({ ...i, candidate: { ...i.candidate, files: { ...i.candidate.files, 'src/tasks.js': i.candidate.files['src/tasks.js'] + '// late edit\n' } } }),
    wrongParent: i => ({ ...i, candidate: { ...i.candidate, parent: 'e'.repeat(40) } }),
    sourceBytesDiffer: i => ({ ...i, source: { ...i.source, files: { ...i.source.files, 'README.md': 'swapped\n' } } }),
    sourceCommitDiffers: i => ({ ...i, expected: { ...i.expected, sourceCommit: 'f'.repeat(40) } }),
    malformedPath: i => ({ ...i, candidate: { ...i.candidate, files: { ...i.candidate.files, '../escape.js': 'x' } } }),
    missingParent: i => ({ ...i, candidate: { ...i.candidate, parent: undefined } }),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const counter = countingRunner();
    const report = await verifyAlphaTask({ ...mutate(inputFor(files)), runner: counter.runner });
    assert.equal(report.verdict, 'FAIL', name);
    assert.equal(counter.calls.node + counter.calls.workspace, 0, `${name}: nothing executed`);
  }
});

test('unsupported project is PARTIAL (never PASS): a workspace without an application cannot be verified', async () => {
  assert.deepEqual(unsupportedBaseTrees, {}, 'no deploy-time workspace identity is listed in this public repository');
  const markdownOnly = { 'README.md': '# Synthetic workspace stand-in\n', 'workspace/README.md': '# Notes\n', 'workspace/notes.md': '# Draft\n' };
  const sourceTree = gitTreeId(markdownOnly);
  for (const profiles of [undefined, { unsupported: { [sourceTree]: 'WORKSPACE_HAS_NO_APPLICATION' } }]) {
    const counter = countingRunner();
    const candidateFiles = { ...markdownOnly, 'src/tasks.js': correctFiles()['src/tasks.js'], 'src/render.js': correctFiles()['src/render.js'], 'test/priority.test.mjs': focusedTests() };
    const input = { ...inputFor(candidateFiles, { runner: counter.runner, profiles }), source: { commit: SOURCE_COMMIT, tree: sourceTree, files: markdownOnly } };
    input.expected.sourceTree = sourceTree;
    input.candidate.parent = SOURCE_COMMIT;
    const report = await verifyAlphaTask(input);
    assert.equal(report.verdict, 'PARTIAL');
    assert.equal(byId(report, 'profile.supported').status, 'INCONCLUSIVE');
    assert.equal(byId(report, 'profile.supported').code, profiles ? 'WORKSPACE_HAS_NO_APPLICATION' : 'UNSUPPORTED_BASE_TREE');
    assert.equal(counter.calls.node, 0, 'a fabricated app on an unsupported base is not executed');
    assert.ok(report.criteria.filter((c) => c.id <= 8).every((c) => c.status === 'NOT_VERIFIED'));
    assert.ok(report.inconclusive.some((i) => i.check === 'profile.supported'));
  }
});

test('producer/verifier separation and effect set are enforced', { skip: skipNoCustody }, async () => {
  const good = correctFiles();
  const same = await verifyAlphaTask(inputFor(good, { verifier: { environmentId: 'producer-env-1' } }));
  assert.equal(same.verdict, 'PARTIAL'); assert.equal(byId(same, 'separation').code, 'SEPARATION_NOT_PROVEN');
  const blank = await verifyAlphaTask(inputFor(good, { producer: { environmentId: '' } }));
  assert.equal(blank.verdict, 'PARTIAL');
  for (const effect of ['PUBLICATION', 'PULL_REQUEST_CREATE', 'DEPLOYMENT', 'BRANCH_PUSH', 'MERGE', 'PACKAGE_PUBLISH']) {
    const r = await verifyAlphaTask(inputFor(good, { observedEffects: ['PRIVATE_SOURCE_READ', effect] }));
    assert.equal(r.verdict, 'FAIL', effect); assert.equal(byId(r, 'effects').status, 'FAIL'); assert.equal(r.criteria.find((c) => c.id === 9).status, 'FAIL');
  }
  const unknown = await verifyAlphaTask(inputFor(good, { observedEffects: undefined }));
  assert.equal(unknown.verdict, 'PARTIAL'); assert.equal(byId(unknown, 'effects').code, 'EFFECTS_NOT_OBSERVED');
});

test('unproven runner isolation is PARTIAL and nothing runs', { skip: skipNoCustody }, async () => {
  for (const weak of [{ fsConfined: false, networkDenied: true, envScrubbed: true }, { fsConfined: true, networkDenied: false, envScrubbed: true }, { fsConfined: true, networkDenied: true, envScrubbed: false }]) {
    const counter = countingRunner();
    const r = await verifyAlphaTask(inputFor(correctFiles(), { runner: { ...counter.runner, isolation: async () => ({ ...weak, detail: 'attested weak' }) } }));
    assert.equal(r.verdict, 'PARTIAL'); assert.equal(byId(r, 'runner.isolation').code, 'ISOLATION_UNPROVEN'); assert.equal(counter.calls.node, 0);
  }
  const throwing = await verifyAlphaTask(inputFor(correctFiles(), { runner: { ...runner, isolation: async () => { throw new Error('x'); } } }));
  assert.equal(throwing.verdict, 'PARTIAL');
});

test('the producer report is not evidence: it cannot raise or lower a verdict', { skip: skipNoCustody }, async () => {
  if (!proven) return;
  const claim = { allCriteriaPass: true, testsGreen: true, verdict: 'PASS', criteria: Array(10).fill('PASS') };
  const bad = negativeFixtures().notPersisted.files;
  const [a, b] = [await verifyAlphaTask(inputFor(bad)), await verifyAlphaTask(inputFor(bad, { producer: { environmentId: 'producer-env-1', report: claim } }))];
  assert.equal(a.verdict, 'FAIL'); assert.equal(b.verdict, 'FAIL');
  assert.deepEqual(b.checks, a.checks);
  assert.equal(b.separation.producerReportConsulted, false); assert.match(b.separation.producerReportSha256, /^[a-f0-9]{64}$/); assert.equal(a.separation.producerReportSha256, null);
  const good = await verifyAlphaTask(inputFor(correctFiles(), { producer: { environmentId: 'producer-env-1', report: { verdict: 'FAIL', everythingBroken: true } } }));
  assert.equal(good.verdict, 'PASS');
});

test('timeouts and runner failures are PARTIAL, never PASS', { skip: skipNoCustody }, async () => {
  if (!proven) return;
  const files = correctFiles();
  files['src/tasks.js'] = files['src/tasks.js'].replace('list() {\n', 'list() {\n      for (;;) {}\n');
  const slow = await verifyAlphaTask(inputFor(files, { limits: { runMs: 1500 } }));
  assert.equal(slow.verdict, 'PARTIAL'); assert.equal(byId(slow, 'existing.tests').status, 'INCONCLUSIVE'); assert.equal(byId(slow, 'hidden.C1').code, 'HIDDEN_PROBE_TIMED_OUT');
  const broken = { ...runner, node: async () => { throw new Error('spawn failed'); }, workspace: runner.workspace };
  const err = await verifyAlphaTask(inputFor(correctFiles(), { runner: { ...broken, isolation: async () => ({ fsConfined: true, networkDenied: true, envScrubbed: true, detail: 'attested' }) } }));
  assert.equal(err.verdict, 'PARTIAL'); assert.ok(err.inconclusive.length > 0);
});

test('hidden suite custody: digest-bound, unavailable custody is an error, producer-visible output carries no hidden material', { skip: skipNoCustody }, async () => {
  const tamper = await mkdtemp(join(tmpdir(), 'alpha-custody-'));
  try {
    await cp(join(custodyBase, 'alpha-tasks-v1'), join(tamper, 'alpha-tasks-v1'), { recursive: true });
    await writeFile(join(tamper, 'alpha-tasks-v1/suite.mjs'), (await readFile(join(tamper, 'alpha-tasks-v1/suite.mjs'), 'utf8')) + '\n// tampered\n');
    await assert.rejects(loadHiddenSuite(join(tamper, 'alpha-tasks-v1')), /VERIFIER_CUSTODY_DIGEST_MISMATCH/);
    await writeFile(join(tamper, 'alpha-tasks-v1/probe.mjs'), 'process.exit(0)\n');
    await assert.rejects(loadHiddenSuite(join(tamper, 'alpha-tasks-v1')), /VERIFIER_CUSTODY_DIGEST_MISMATCH/);
  } finally { await rm(tamper, { recursive: true, force: true }); }
  await assert.rejects(loadHiddenSuite(join(tmpdir(), 'does-not-exist-custody')), /ENOENT/);
  const saved = process.env.FACTORY_VERIFIER_CUSTODY_DIR; delete process.env.FACTORY_VERIFIER_CUSTODY_DIR;
  try { await assert.rejects(loadHiddenSuite(), /VERIFIER_CUSTODY_UNAVAILABLE/); } finally { process.env.FACTORY_VERIFIER_CUSTODY_DIR = saved; }
  if (!proven) return;
  // nothing the producer can see (or the persisted outcome) contains hidden scenario values, test names or logs
  const fixtureBodies = JSON.stringify(Object.values(negativeFixtures()).map((f) => f.files)) + JSON.stringify(correctFiles());
  for (const files of [correctFiles(), negativeFixtures().invalidValueAccepted.files, negativeFixtures().extraUrgentValue.files]) {
    const report = await verifyAlphaTask(inputFor(files));
    const surfaces = JSON.stringify(producerVisible(report)) + JSON.stringify(acceptanceOutcome(report)) + JSON.stringify(report);
    for (const secret of ['Persist2', 'T-Medium', 'Critical', 'Normal', 'PROBE_', 'evaluators', 'scenarios', 'AssertionError', 'stack']) {
      assert.ok(!surfaces.includes(secret), `report leaks ${secret}`);
    }
    assert.ok(!JSON.stringify(producerVisible(report)).includes('hidden.'), 'hidden check ids are not enumerated to the producer');
  }
  assert.ok(!fixtureBodies.includes('Persist2'), 'fixtures given to producers/tests are free of hidden scenario content');
});

// ---- production runner isolation (C3) ------------------------------------------------------------------------
const attestation = (over = {}) => ({ runnerId: 'vercel-sandbox-verifier-v1', kind: 'SANDBOX_DENY_ALL_V1', networkPolicy: 'deny-all', filesystem: 'UNPRIVILEGED_UID_WORKSPACE_READ_SCRATCH_WRITE', environment: 'SCRUBBED',
  hiddenMaterialVisibleToCandidate: false, disposable: true, image: 'vercel/sandbox/node@sha256:' + 'a'.repeat(64), sessionId: 'sbx_fixture123', attestedBy: 'factory-host', ...over });
const prodRunner = (inner, id = 'vercel-sandbox-verifier-v1') => ({ ...inner, id });

test('production mode: no attestation is PARTIAL and nothing runs, even when the local self-test is clean', async () => {
  const counter = countingRunner();
  const r = await verifyAlphaTask(inputFor(correctFiles(), { mode: 'production', runner: prodRunner(counter.runner) }));
  assert.equal(r.verdict, 'PARTIAL');
  assert.equal(byId(r, 'runner.isolation').status, 'INCONCLUSIVE');
  assert.equal(byId(r, 'runner.isolation').code, 'ISOLATION_ATTESTATION_REQUIRED');
  assert.equal(counter.calls.node + counter.calls.workspace, 0, 'candidate code is never executed without an attestation');
  assert.ok(r.inconclusive.some((i) => i.check === 'runner.isolation'));
});

test('production mode: the local sandbox-exec runner can never satisfy production, with or without an attestation', async () => {
  for (const over of [{ mode: 'production' }, { mode: 'production', isolationAttestation: attestation({ runnerId: runner.id }) }, { mode: 'production', isolationAttestation: attestation() }]) {
    const counter = countingRunner(); // id: 'counting' (not allow-listed)
    const r = await verifyAlphaTask(inputFor(correctFiles(), { runner: counter.runner, ...over }));
    assert.equal(r.verdict, 'PARTIAL'); assert.equal(byId(r, 'runner.isolation').code, 'ISOLATION_ATTESTATION_REQUIRED'); assert.equal(counter.calls.node, 0);
  }
  assert.equal(attestationValid(attestation(), { id: runner.id }), false);
  assert.deepEqual([...productionRunnerIds], ['vercel-sandbox-verifier-v1']);
});

test('production mode: every malformed attestation is rejected', () => {
  const ok = { id: 'vercel-sandbox-verifier-v1' };
  assert.equal(attestationValid(attestation(), ok), true);
  for (const bad of [undefined, null, {}, 'yes', attestation({ networkPolicy: 'allow' }), attestation({ networkPolicy: undefined }), attestation({ kind: 'OTHER' }), attestation({ filesystem: 'ROOT' }), attestation({ environment: 'INHERITED' }),
    attestation({ hiddenMaterialVisibleToCandidate: true }), attestation({ disposable: false }), attestation({ attestedBy: 'runner' }), attestation({ image: 'node:latest' }), attestation({ sessionId: 'x' }), attestation({ runnerId: 'other' }), { ...attestation(), extra: 1 }])
    assert.equal(attestationValid(bad, ok), false, JSON.stringify(bad));
  assert.equal(attestationValid(attestation(), undefined), false);
});

test('production mode: a renamed local runner and test profile table cannot authorize a product tree', { skip: skipNoCustody }, async () => {
  if (!proven) return; // the stand-in executes through the local runner; hosts that cannot confine it cannot run this proof
  const r = await verifyAlphaTask(inputFor(correctFiles(), { mode: 'production', runner: prodRunner(runner), isolationAttestation: attestation() }));
  assert.equal(r.verdict, 'PARTIAL'); assert.equal(byId(r, 'runner.isolation').code, 'ISOLATION_ATTESTED');
  assert.equal(byId(r,'profile.supported').status,'INCONCLUSIVE');
  // A FAIL is still a FAIL in production mode.
  const f = await verifyAlphaTask(inputFor(Object.values(negativeFixtures())[0].files, { mode: 'production', runner: prodRunner(runner), isolationAttestation: attestation() }));
  assert.notEqual(f.verdict, 'PASS');
});
