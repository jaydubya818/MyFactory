import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { collectBrowserEvidence } from '../src/browser-evidence.ts';
import { isTrustedCandidatePreview, startCandidatePreview } from '../src/candidate-preview.ts';
import { EVIDENCE_LIMITS, evaluateEvidence, evidencePolicyFor, listEvidence, proofEvidenceReference, storeEvidence } from '../src/evidence.ts';

const roots = [];
after(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });
const binding = { workOrderId: 'work-1', runId: 'run-1', candidateCommit: 'a'.repeat(40), factoryVersion: 'b'.repeat(64) };
async function root() { const path = await mkdtemp(join(tmpdir(), 'factory-evidence-')); roots.push(path); return path; }

test('durable evidence survives readback and tampering cannot satisfy policy', async () => {
  const directory = await root();
  const ref = await storeEvidence(directory, binding, 'TestEvidence', 'text/plain', 'protected-verifier', Buffer.from('passed'));
  const policy = { policyRevision: 'v1', requiredKinds: ['TestEvidence'] };
  const readback = await listEvidence(directory, binding.runId);
  assert.deepEqual(readback, [ref]);
  assert.match(proofEvidenceReference(ref), /^factory-evidence:sha256:[a-f0-9]{64}$/);
  assert.equal((await evaluateEvidence(directory, binding, policy, readback)).status, 'SATISFIED');
  assert.equal((await evaluateEvidence(directory, { ...binding, candidateCommit: 'c'.repeat(40) }, policy, readback)).status, 'INVALID');
  await writeFile(resolve(directory, ref.relativePath), 'changed');
  assert.equal((await evaluateEvidence(directory, binding, policy, readback)).status, 'INVALID');
});

test('screenshot and journey are collected from bounded local preview; video is optional', async () => {
  const directory = await root();
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Fixture</title><main><h1>Saved successfully</h1></main>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const capture = await collectBrowserEvidence(directory, binding, {
      url: `http://127.0.0.1:${address.port}/`, path: '/', expectedText: ['Saved successfully'],
    });
    assert.equal(capture.httpStatus, 200);
    assert.deepEqual(capture.assertions, [{ text: 'Saved successfully', found: true }]);
    assert.deepEqual(capture.refs.map(ref => ref.kind), ['ScreenshotEvidence', 'BrowserJourneyEvidence']);
    assert.ok((await readFile(resolve(directory, capture.refs[0].relativePath))).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
    const policy = { policyRevision: 'ui-v1', requiredKinds: ['ScreenshotEvidence', 'BrowserJourneyEvidence'] };
    assert.equal((await evaluateEvidence(directory, binding, policy, await listEvidence(directory, binding.runId))).status, 'SATISFIED');
    assert.deepEqual(evidencePolicyFor('browser').requiredKinds,
      ['TestEvidence', 'DiffEvidence', 'ScreenshotEvidence', 'BrowserJourneyEvidence']);
    assert.equal((await evaluateEvidence(directory, binding, { ...policy, requiredKinds: [...policy.requiredKinds, 'VideoEvidence'] }, capture.refs)).status, 'MISSING');
    const failed = await collectBrowserEvidence(directory, binding, {
      url: `http://127.0.0.1:${address.port}/`, path: '/', expectedText: ['Missing text'],
    });
    assert.deepEqual(failed.assertions, [{ text: 'Missing text', found: false }]);
    assert.equal((await evaluateEvidence(directory, binding, policy, failed.refs)).status, 'INVALID');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('public and credentialed URLs are refused before launching a browser', async () => {
  const directory = await root();
  for (const url of ['https://example.com/', 'http://127.0.0.1:1/?token=secret', 'http://user:pass@localhost:1234/']) {
    await assert.rejects(collectBrowserEvidence(directory, binding, { url, path: '/', expectedText: ['ok'] }), /bounded local preview/);
  }
});

test('every evidence kind has an enforced individual byte ceiling', async () => {
  const directory = await root();
  for (const [kind, limit] of Object.entries(EVIDENCE_LIMITS)) {
    await assert.rejects(storeEvidence(directory, binding, kind, 'application/octet-stream', 'fixture', Buffer.alloc(limit + 1)), /Invalid evidence artifact/);
  }
  assert.deepEqual(await listEvidence(directory, binding.runId), []);
});

test('exact committed static UI survives working-tree mutation and yields candidate-bound Playwright evidence', async () => {
  const directory = await root();
  const repo = join(directory, 'candidate');
  await mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Evidence Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(repo, 'index.html'), '<!doctype html><h1>Candidate A verified</h1>');
  git('add', 'index.html'); git('commit', '-qm', 'Candidate A');
  const candidateCommit = git('rev-parse', 'HEAD');
  await writeFile(join(repo, 'index.html'), '<!doctype html><h1>Uncommitted hostile page</h1>');
  const preview = await startCandidatePreview({ repositoryPath: repo, workOrderId: binding.workOrderId,
    runId: binding.runId, candidateCommit, staticRoot: '.', path: '/', expectedText: ['Candidate A verified'] });
  assert.equal(isTrustedCandidatePreview(preview), true);
  assert.equal(isTrustedCandidatePreview({ ...preview }), false);
  try {
    assert.equal(preview.identity.candidateCommit, candidateCommit);
    assert.equal(preview.identity.candidateTree, git('rev-parse', `${candidateCommit}^{tree}`));
    const captured = await collectBrowserEvidence(directory, { ...binding, candidateCommit }, preview.journey);
    assert.deepEqual(captured.assertions, [{ text: 'Candidate A verified', found: true }]);
    assert.equal((await evaluateEvidence(directory, { ...binding, candidateCommit },
      { policyRevision: 'static-ui-v1', requiredKinds: ['ScreenshotEvidence', 'BrowserJourneyEvidence'] }, captured.refs)).status, 'SATISFIED');
    assert.equal((await evaluateEvidence(directory, { ...binding, candidateCommit: 'f'.repeat(40) },
      { policyRevision: 'static-ui-v1', requiredKinds: ['ScreenshotEvidence', 'BrowserJourneyEvidence'] }, captured.refs)).status, 'INVALID');
  } finally { await preview.close(); }
  await assert.rejects(fetch(preview.journey.url));
});
