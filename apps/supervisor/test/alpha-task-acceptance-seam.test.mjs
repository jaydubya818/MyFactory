import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openStorage } from '../../../packages/storage/src/index.ts';
import { JobManager } from '../src/jobs.ts';
import { verifyAlphaTask, loadHiddenSuite, gitTreeId, acceptanceOutcome } from '../src/alpha-task-verifier.ts';
import { localNodeRunner } from '../src/alpha-task-runner.ts';
import { baseFiles, correctFiles, negativeFixtures } from './fixtures/alpha-tasks/index.mjs';

const INPUT_COMMIT = 'a'.repeat(40), CANDIDATE_COMMIT = 'b'.repeat(40);
const skipNoCustody = process.env.FACTORY_VERIFIER_CUSTODY_DIR ? false : 'NOT_RUN: FACTORY_VERIFIER_CUSTODY_DIR not set';
const orderInput = () => ({ title: 'Add priority', description: 'Add a Priority field', kind: 'feature', repositoryPath: '/tmp/disposable-repo', baseRef: 'main',
  acceptanceCriteria: ['Priority Low|Medium|High'], reproductionCommand: null, expectedFailureText: null, checkCommands: ['npm test'], allowedPaths: ['src/**', 'test/**'], workerProfile: 'mac' });

async function verification(input) {
  await mkdir(input.artifactDir, { recursive: true });
  const checks = [];
  for (const [index, command] of input.commands.entries()) {
    const logPath = join(input.artifactDir, `check-${index}.log`); await writeFile(logPath, 'ok', 'utf8');
    checks.push({ candidateCommit: input.candidateSha, candidateTree: 'c'.repeat(40), command, status: 'passed', exitCode: 0, startedAt: '2026-09-24T00:00:00.000Z', finishedAt: '2026-09-24T00:00:01.000Z', logPath, reason: null });
  }
  return { checks, reason: null };
}
async function waitFor(storage, runId, state) {
  for (let i = 0; i < 6000; i += 1) { const run = storage.getRun(runId); if (run?.state === state) return run; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error(`Run ${runId} did not reach ${state}`);
}
async function drive(t, independentAcceptance, extra = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'factory-acceptance-'));
  const storage = openStorage(join(dataDir, 'factory.sqlite')), events = [];
  const jobs = new JobManager(storage, dataDir, (e) => events.push(e), {
    resolveCommit: async () => INPUT_COMMIT, createTaskWorktree: async () => join(tmpdir(), 'fake-worktree'), verifyCandidate: verification,
    preflightCodex: async () => ({ binaryAvailable: true, authenticated: true, version: 'fixture', error: null }),
    runCodex: async () => ({ success: true, status: 'completed', threadId: 't', usage: null, eventsPath: '/tmp/e.jsonl' }),
    commitCandidate: async (_w, _i, _p, artifactDir) => { await mkdir(artifactDir, { recursive: true }); const diffPath = join(artifactDir, 'candidate.patch'); await writeFile(diffPath, 'diff --git a/src/x b/src/x\n', 'utf8');
      return { commit: CANDIDATE_COMMIT, tree: 'c'.repeat(40), changedPaths: ['src/tasks.js'], diffPath }; },
    ...(independentAcceptance ? { independentAcceptance } : {}), ...extra,
  });
  t.after(async () => { await jobs.close(); storage.close(); await rm(dataDir, { recursive: true, force: true }); });
  const order = storage.createWorkOrder(orderInput());
  // The legacy managed-dispatch guard needs the gateway for paid Codex; the established tests reach this stage the same way.
  return { order, storage, events, jobs };
}
// Reach the post-verification stage through the established private seam used by the existing implementation-loop tests.
async function run(t, independentAcceptance) {
  const w = await drive(t, independentAcceptance);
  const started = await w.jobs.startRun(w.order);
  return { ...w, started };
}

const outcome = (verdict, extra = {}) => ({ policyId: 'alpha-tasks-priority-acceptance-v1', verdict, reportSha256: 'd'.repeat(64), criteria: [{ id: 1, status: verdict }], failedChecks: [], inconclusive: [], ...extra });

test('without an independent policy the legacy host-check flow is unchanged', async (t) => {
  const w = await run(t, undefined);
  await waitFor(w.storage, w.started.id, 'ready_for_review');
  assert.ok(!w.events.some((e) => e.type.startsWith('run.acceptance')), 'no acceptance events when no policy is wired');
});

test('a policy returning null (Work not governed) leaves the legacy flow unchanged', async (t) => {
  const w = await run(t, async () => null);
  await waitFor(w.storage, w.started.id, 'ready_for_review');
  assert.ok(!w.events.some((e) => e.type.startsWith('run.acceptance')));
});

test('seam: only PASS reaches ready_for_review; FAIL, PARTIAL and verifier errors are blocked and visible', async (t) => {
  const seen = [];
  const pass = await run(t, async (input) => { seen.push(input); return outcome('PASS'); });
  await waitFor(pass.storage, pass.started.id, 'ready_for_review');
  assert.equal(seen[0].candidateCommit, CANDIDATE_COMMIT); assert.equal(seen[0].candidateTree, 'c'.repeat(40)); assert.equal(seen[0].sourceCommit, INPUT_COMMIT);
  assert.ok(pass.events.some((e) => e.type === 'run.acceptance_evaluated' && e.payload.verdict === 'PASS'));

  const fail = await run(t, async () => outcome('FAIL', { failedChecks: ['paths.allowed'] }));
  await waitFor(fail.storage, fail.started.id, 'failed');
  assert.equal(fail.storage.getWorkOrder(fail.order.id).state, 'failed');
  assert.ok(fail.events.some((e) => e.type === 'run.acceptance_failed'));
  assert.ok(!fail.events.some((e) => e.type === 'run.ready_for_review'));

  for (const [name, policy] of [['PARTIAL', async () => outcome('PARTIAL', { inconclusive: [{ check: 'profile.supported', code: 'WORKSPACE_HAS_NO_APPLICATION' }] })], ['throws', async () => { throw new Error('boom'); }]]) {
    const w = await run(t, policy);
    const finished = await waitFor(w.storage, w.started.id, 'failed');
    assert.equal(w.storage.getWorkOrder(w.order.id).state, 'needs_investigation', name);
    assert.match(finished.failure, /PARTIAL/, name);
    assert.ok(w.events.some((e) => e.type === 'run.acceptance_partial'), name);
    assert.ok(!w.events.some((e) => e.type === 'run.ready_for_review'), name);
    const evaluated = w.events.find((e) => e.type === 'run.acceptance_evaluated');
    assert.equal(evaluated.payload.verdict, 'PARTIAL');
    assert.ok(!JSON.stringify(evaluated.payload).includes('hidden'), 'persisted event carries no hidden material');
  }
});

test('end to end with the real verifier: correct candidate is accepted, defective candidates are not', { skip: skipNoCustody }, async (t) => {
  const hidden = await loadHiddenSuite(), runner = localNodeRunner();
  const iso = await runner.isolation();
  const verifierFor = (files) => async ({ sourceCommit, candidateCommit, candidateTree }) => {
    const source = { commit: sourceCommit, tree: gitTreeId(baseFiles), files: baseFiles };
    const candidate = { commit: candidateCommit, tree: gitTreeId(files), files, parent: sourceCommit };
    // The host's own record of the candidate tree (from run.candidate_committed) is the independent expectation.
    const report = await verifyAlphaTask({ source, candidate, expected: { sourceCommit, sourceTree: source.tree, candidateCommit, candidateTree: candidate.tree },
      producer: { environmentId: 'producer-env' }, verifier: { environmentId: 'verifier-env' }, observedEffects: ['PRIVATE_SOURCE_READ', 'CANDIDATE_CUSTODY_WRITE'], runner, hidden });
    return acceptanceOutcome(report);
  };
  const good = await run(t, verifierFor(correctFiles()));
  if (!(iso.fsConfined && iso.networkDenied && iso.envScrubbed)) { await waitFor(good.storage, good.started.id, 'failed'); return; }
  await waitFor(good.storage, good.started.id, 'ready_for_review');
  const bad = await run(t, verifierFor(negativeFixtures().notPersisted.files));
  await waitFor(bad.storage, bad.started.id, 'failed');
  assert.ok(bad.events.some((e) => e.type === 'run.acceptance_failed'));
  const unsupported = await run(t, async (input) => acceptanceOutcome(await verifyAlphaTask({
    source: { commit: input.sourceCommit, tree: 'f'.repeat(40), files: {} }, candidate: { commit: input.candidateCommit, tree: gitTreeId({}), files: {}, parent: input.sourceCommit },
    expected: { sourceCommit: input.sourceCommit, sourceTree: 'f'.repeat(40), candidateCommit: input.candidateCommit, candidateTree: gitTreeId({}) },
    producer: { environmentId: 'p' }, verifier: { environmentId: 'v' }, runner, hidden })));
  await waitFor(unsupported.storage, unsupported.started.id, 'failed');
  assert.ok(!unsupported.events.some((e) => e.type === 'run.ready_for_review'));
});
