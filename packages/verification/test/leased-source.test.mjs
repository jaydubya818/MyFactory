import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { verifyLeasedCandidate, verifyLeasedTree, verifyCandidate } from '../src/index.ts';

// Real Docker verification of a host-leased source: --network=none, read-only mount, no repository involved.
const IMAGE = 'node:22-bookworm';
let docker = true;
try { execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore', timeout: 20000 }); } catch { docker = false; }
const dtest = (name, options, fn) => test(name, { ...options, skip: docker ? false : `requires a local ${IMAGE} Docker image` }, fn);

const roots = [];
after(() => { for (const r of roots) { try { execFileSync('chmod', ['-R', 'u+w', r]); } catch {} rmSync(r, { recursive: true, force: true }); } });
const tree = 'b'.repeat(40), commit = 'a'.repeat(40);
function lease(files, kind = 'FINAL') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'leased-'))); roots.push(root);
  const source = join(root, 'source'); mkdirSync(source);
  for (const [name, text] of Object.entries(files)) { writeFileSync(join(source, name), text); chmodSync(join(source, name), 0o444); }
  chmodSync(source, 0o555);
  const sourceInput = Object.freeze({ schema: 'local-v4-fixture-source/v1', runId: 'run', workOrderId: 'work', kind, commit: kind === 'FINAL' ? commit : null, tree, files: Object.freeze({ ...files }) });
  return { root, source, sourceInput, sourceArtifact: { schema: 'local-v4-source-artifact/v1', path: source, tree, manifestSha256: 'c'.repeat(64) } };
}
const base = (l, extra = {}) => ({ repositoryPath: '/nonexistent-repository', candidateSha: commit, commands: ['node quantity.mjs'], artifactDir: join(l.root, 'evidence'), image: IMAGE, sourceInput: l.sourceInput, sourceArtifact: l.sourceArtifact, ...extra });

dtest('leased candidate runs in the no-network read-only container without any repository', { timeout: 120000 }, async () => {
  const l = lease({ 'quantity.mjs': 'console.log(2);\n' });
  const result = await verifyLeasedCandidate(base(l));
  assert.equal(result.candidateTree, tree); assert.equal(result.exportStatus, 'ready');
  assert.deepEqual(result.checks.map(c => c.status), ['passed']);
  const failing = await verifyLeasedCandidate(base(l, { commands: ['node -e "process.exit(3)"'] }));
  assert.deepEqual(failing.checks.map(c => c.status), ['failed']);
  const network = await verifyLeasedCandidate(base(l, { commands: ['node -e "require(\'net\').connect(80,\'1.1.1.1\').on(\'error\',()=>process.exit(0)).on(\'connect\',()=>process.exit(9))"'] }));
  assert.deepEqual(network.checks.map(c => c.status), ['passed']);
});
dtest('leased tree verification requires a tree-kind lease with no commit', { timeout: 120000 }, async () => {
  const l = lease({ 'quantity.mjs': 'console.log(2);\n' }, 'IMPLEMENTATION');
  const result = await verifyLeasedTree({ repositoryPath: '/nonexistent-repository', tree, commands: ['node quantity.mjs'], artifactDir: join(l.root, 'evidence'), image: IMAGE, sourceInput: l.sourceInput, sourceArtifact: l.sourceArtifact });
  assert.deepEqual(result.checks.map(c => c.status), ['passed']);
  await assert.rejects(() => verifyLeasedCandidate(base(l)), /does not match/);   // a tree lease cannot satisfy a commit verification
});
test('a leased verifier never falls back to the repository, and refuses mismatched, tampered or writable leases', async () => {
  const l = lease({ 'quantity.mjs': 'console.log(2);\n' });
  await assert.rejects(() => verifyLeasedCandidate({ ...base(l), sourceInput: undefined }), /complete leased source/);
  await assert.rejects(() => verifyLeasedCandidate({ ...base(l), sourceArtifact: undefined }), /complete leased source/);
  await assert.rejects(() => verifyLeasedCandidate(base(l, { candidateSha: 'd'.repeat(40) })), /does not match/);
  await assert.rejects(() => verifyLeasedCandidate(base(l, { sourceArtifact: { ...l.sourceArtifact, tree: 'e'.repeat(40) } })), /complete leased source/);
  await assert.rejects(() => verifyLeasedCandidate(base(l, { commands: ['git diff --check'] })), /complete leased source/);
  await assert.rejects(() => verifyLeasedCandidate(base(l, { sourceInput: { ...l.sourceInput, files: { 'quantity.mjs': 'console.log(9);\n' } } })), /bytes differ/);
  await assert.rejects(() => verifyLeasedCandidate(base(l, { sourceInput: { ...l.sourceInput, files: { 'quantity.mjs': 'console.log(2);\n', 'extra.mjs': '' } } })), /file set differs/);
  chmodSync(l.source, 0o755);
  await assert.rejects(() => verifyLeasedCandidate(base(l)), /read-only directory/);
  chmodSync(l.source, 0o555);
  chmodSync(join(l.source, 'quantity.mjs'), 0o644);
  await assert.rejects(() => verifyLeasedCandidate(base(l)), /read-only entry/);
});
test('the ordinary verifier is unchanged and still requires a repository', async () => {
  await assert.rejects(() => verifyCandidate({ repositoryPath: '/nonexistent-repository', candidateSha: commit, commands: ['true'], artifactDir: join(tmpdir(), 'x-' + Date.now()) }).then(r => { if (r.exportStatus !== 'unavailable') throw new Error('expected unavailable'); throw new Error('unavailable'); }), /unavailable/);
});
