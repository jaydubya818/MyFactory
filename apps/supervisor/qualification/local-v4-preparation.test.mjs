// Actual owned Mac Git preparation. No worker, provider, Docker or holdouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createLocalV4Preparation, bindLocalV4PreparationCapture } from '../src/local-v4-preparation.ts';
const GIT = '/opt/homebrew/Cellar/git/2.48.1/bin/git';
function fixture(t, ignored = false, format = 'sha1') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'v4-native-preparation-'))), repo = join(dir, 'repo'), data = join(dir, 'data');
  mkdirSync(repo, { mode: 0o700 }); mkdirSync(data, { mode: 0o700 });
  const git = (...args) => execFileSync(GIT, ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.allow=never', '-C', repo, ...args], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    env: { PATH: '/opt/homebrew/Cellar/git/2.48.1/libexec/git-core', GIT_EXEC_PATH: '/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', LANG: 'C', LC_ALL: 'C' },
  }).trim();
  git('init', '-q', '--template=', '--object-format=' + format); git('config', 'user.name', 'Owned preparation fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(repo, 'sample.txt'), 'ordinary text\n');
  if (ignored) writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n');
  git('add', '.'); git('commit', '-qm', 'Ordinary input');
  const input = git('rev-parse', 'HEAD'), refs = git('show-ref'), preparation = createLocalV4Preparation(data);
  // All fixture processes are ordinary completed commands; no productive process
  // exists. This owned-fixture teardown is not product cleanup qualification.
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, repo, data, input, git, refs, preparation,
    async create() { assert.equal(await preparation.resolveCommit(repo, input), input); return preparation.createTaskWorktree(repo, input, join(data, 'workspaces')); } };
}
test('native V4 preparation: exact immutable detached checkout and proven clean nonforced removal', async t => {
  const f = fixture(t), workspace = await f.create();
  assert.match(basename(workspace), /^[a-f0-9-]{36}$/); assert.equal(readFileSync(join(workspace, 'sample.txt'), 'utf8'), 'ordinary text\n');
  assert.equal(f.git('show-ref'), f.refs); assert.equal(f.git('worktree', 'list', '--porcelain').includes('detached'), true);
  const admin = join(f.repo, '.git/worktrees', basename(workspace)); assert(existsSync(admin));
  await f.preparation.removeTaskWorktree(f.repo, workspace); assert(!existsSync(workspace)); assert(!existsSync(admin));
  assert.equal(f.git('show-ref'), f.refs);
});
test('native V4 preparation: branch names refuse before native creation', async t => {
  const f = fixture(t); await assert.rejects(f.preparation.resolveCommit(f.repo, 'HEAD'), /LOCAL_V4_PREPARATION_REFUSED/);
  assert(!existsSync(join(f.data, 'workspaces'))); assert.equal(f.git('show-ref'), f.refs);
});
test('native V4 preparation: input profile refuses SHA256 before workspace creation', async t => {
  const f = fixture(t, false, 'sha256'); assert.match(f.input, /^[a-f0-9]{64}$/);
  await assert.rejects(f.preparation.resolveCommit(f.repo, f.input), /REFUSED/);
  assert(!existsSync(join(f.data, 'workspaces'))); assert.equal(f.git('show-ref'), f.refs);
});
test('native V4 preparation: no create without this instance exact input observation', async t => {
  const f = fixture(t); await assert.rejects(f.preparation.createTaskWorktree(f.repo, f.input, join(f.data, 'workspaces')), /REFUSED/);
  assert(!existsSync(join(f.data, 'workspaces')));
});
test('native V4 preparation: foreign workspaces root refuses without filesystem effects', async t => {
  const f = fixture(t); await f.preparation.resolveCommit(f.repo, f.input);
  await assert.rejects(f.preparation.createTaskWorktree(f.repo, f.input, join(f.dir, 'foreign')), /REFUSED/);
  assert(!existsSync(join(f.dir, 'foreign'))); assert(!existsSync(join(f.data, 'workspaces')));
});
test('native V4 preparation: reopened helper does not adopt an old workspace', async t => {
  const f = fixture(t), workspace = await f.create(), reopened = createLocalV4Preparation(f.data);
  await assert.rejects(reopened.removeTaskWorktree(f.repo, workspace), /RETAINED_HOLD/); assert(existsSync(workspace));
});
for (const change of ['tracked', 'untracked', 'ignored', 'empty-directory']) test(`native V4 preparation: ${change} contents retained on cleanup HOLD`, async t => {
  const f = fixture(t, change === 'ignored'), workspace = await f.create();
  const path = join(workspace, change === 'tracked' ? 'sample.txt' : change === 'ignored' ? 'ignored.txt' : 'additional');
  if (change === 'empty-directory') mkdirSync(path); else writeFileSync(path, 'retain owned fixture bytes\n');
  await assert.rejects(f.preparation.removeTaskWorktree(f.repo, workspace), /RETAINED_HOLD/); assert(existsSync(path));
  if (change !== 'empty-directory') assert.equal(readFileSync(path, 'utf8'), 'retain owned fixture bytes\n');
  await assert.rejects(f.preparation.createTaskWorktree(f.repo, f.input, join(f.data, 'workspaces')), /RETAINED_HOLD/);
});
for (const flag of ['--assume-unchanged', '--skip-worktree']) test(`native V4 preparation: ${flag} index refuses cleanup`, async t => {
  const f = fixture(t), workspace = await f.create(); f.git('-C', workspace, 'update-index', flag, 'sample.txt');
  await assert.rejects(f.preparation.removeTaskWorktree(f.repo, workspace), /RETAINED_HOLD/); assert(existsSync(workspace));
});
test('native V4 preparation: replaced workspace identity refuses physical removal', async t => {
  const f = fixture(t), workspace = await f.create(); renameSync(workspace, workspace + '-retained'); mkdirSync(workspace);
  await assert.rejects(f.preparation.removeTaskWorktree(f.repo, workspace), /RETAINED_HOLD/);
  assert(existsSync(workspace)); assert(existsSync(workspace + '-retained'));
});
for (const throws of [false, true]) test(`native V4 preparation: capture entry irreversibly holds cleanup even when producer throws=${throws}`, async t => {
  const f = fixture(t), workspace = await f.create(); let captures = 0;
  const producer = bindLocalV4PreparationCapture(f.preparation, {
    capture() { captures++; if (throws) throw Error('ordinary synthetic capture failure'); return { marker: 'synthetic-only' }; },
    snapshot() { return null; }, read() { return null; }, finalize() { return null; },
  });
  const capture = () => producer.capture({ repositoryPath: f.repo }, { workspacePath: workspace }, 'synthetic', 'synthetic');
  if (throws) assert.throws(capture, /ordinary synthetic/); else assert.deepEqual(capture(), { marker: 'synthetic-only' });
  assert.equal(captures, 1); await assert.rejects(f.preparation.removeTaskWorktree(f.repo, workspace), /RETAINED_HOLD/);
  assert(existsSync(workspace)); assert.throws(capture, /RETAINED_HOLD/); assert.equal(captures, 1);
});
test('native V4 preparation: parent PATH and helper environment cannot select an alternate Git', async t => {
  const f = fixture(t), previous = { PATH: process.env.PATH, GIT_EXEC_PATH: process.env.GIT_EXEC_PATH };
  process.env.PATH = '/synthetic/unavailable'; process.env.GIT_EXEC_PATH = '/synthetic/unavailable';
  try { const workspace = await f.create(); await f.preparation.removeTaskWorktree(f.repo, workspace); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
