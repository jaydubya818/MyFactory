// Ordinary small owned text repositories only. No native malformed/collision,
// compressed-growth, timeout, hook, child, provider or protected experiment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalV4Preparation } from '../src/local-v4-preparation.ts';
const GIT = '/opt/homebrew/Cellar/git/2.48.1/bin/git';
function fixture(t, files = [['src/sample.txt', '\ufeffcafé\n'], ['readme.txt', 'ordinary input\n']]) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'v4-text-input-'))), repo = join(dir, 'repo'), data = join(dir, 'data');
  mkdirSync(repo, { mode: 0o700 }); mkdirSync(data, { mode: 0o700 });
  const git = (...args) => execFileSync(GIT, ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-C', repo, ...args], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    env: { PATH: '/opt/homebrew/Cellar/git/2.48.1/libexec/git-core', GIT_EXEC_PATH: '/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', LANG: 'C', LC_ALL: 'C' },
  }).trim();
  git('init', '-q', '--template=', '--object-format=sha1'); git('config', 'user.name', 'Owned input fixture'); git('config', 'user.email', 'fixture@example.invalid');
  for (const [path, value] of files) { const parts = path.split('/'); parts.pop(); if (parts.length) mkdirSync(join(repo, ...parts), { recursive: true }); writeFileSync(join(repo, path), value); }
  git('add', '.'); git('commit', '-qm', 'Ordinary input'); const input = git('rev-parse', 'HEAD'), refs = git('show-ref');
  const preparation = createLocalV4Preparation(data);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { repo, data, files, git, input, refs, preparation,
    async create() { assert.equal(await preparation.resolveCommit(repo, input), input); return preparation.createTaskWorktree(repo, input, join(data, 'workspaces')); } };
}
test('native text input: complete ordinary nested tree preserves exact checkout bytes and refs', async t => {
  const f = fixture(t), workspace = await f.create();
  for (const [path, value] of f.files) assert.equal(readFileSync(join(workspace, path), 'utf8'), value);
  assert.equal(f.git('-C', workspace, 'rev-parse', 'HEAD'), f.input); assert.equal(f.git('show-ref'), f.refs);
  await f.preparation.removeTaskWorktree(f.repo, workspace); assert(!existsSync(workspace));
});
test('native text input: pending observation is consumed once and a new host observation is distinct', async t => {
  const f = fixture(t); assert.equal(await f.preparation.resolveCommit(f.repo, f.input), f.input);
  assert.equal(await f.preparation.resolveCommit(f.repo, f.input), f.input);
  const first = await f.preparation.createTaskWorktree(f.repo, f.input, join(f.data, 'workspaces'));
  await assert.rejects(f.preparation.createTaskWorktree(f.repo, f.input, join(f.data, 'workspaces')), /REFUSED/);
  const second = await f.create(); assert.notEqual(first, second); assert.equal(f.git('show-ref'), f.refs);
  await f.preparation.removeTaskWorktree(f.repo, first); await f.preparation.removeTaskWorktree(f.repo, second);
  // Primitive bookkeeping grants no Work, replay, writer or financial authority.
});
for (const path of ['space name.txt', 'plus+name.txt']) test(`native text input: unsupported ordinary path ${JSON.stringify(path)} refuses before workspace creation`, async t => {
  const f = fixture(t, [[path, 'ordinary text\n']]);
  await assert.rejects(f.preparation.resolveCommit(f.repo, f.input), /RETAINED_HOLD/);
  assert(!existsSync(join(f.data, 'workspaces'))); assert.equal(readFileSync(join(f.repo, path), 'utf8'), 'ordinary text\n');
  assert.equal(f.git('show-ref'), f.refs); await assert.rejects(f.preparation.resolveCommit(f.repo, f.input), /RETAINED_HOLD/);
});
test('native text input: mutable repository HEAD cannot replace the exact observed immutable input', async t => {
  const f = fixture(t, [['sample.txt', 'original\n']]); await f.preparation.resolveCommit(f.repo, f.input);
  writeFileSync(join(f.repo, 'sample.txt'), 'later main repository text\n'); f.git('add', 'sample.txt'); f.git('commit', '-qm', 'Later ordinary input');
  const later = f.git('rev-parse', 'HEAD'); assert.notEqual(later, f.input);
  const workspace = await f.preparation.createTaskWorktree(f.repo, f.input, join(f.data, 'workspaces'));
  assert.equal(readFileSync(join(workspace, 'sample.txt'), 'utf8'), 'original\n'); assert.equal(f.git('rev-parse', 'HEAD'), later);
  await f.preparation.removeTaskWorktree(f.repo, workspace); assert.equal(f.git('rev-parse', 'HEAD'), later);
});
