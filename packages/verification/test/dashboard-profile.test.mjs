import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED_BROWSER_VERIFICATION_LIMITS, verifyWorkspaceTree } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/dashboard-baseline/', import.meta.url));
const profile = join(root, 'scripts/verification/dashboard');
const origin = JSON.parse(readFileSync(join(fixture, 'origin.json')));
const image = process.env.QDEV_DASHBOARD_VERIFICATION_IMAGE;
const options = { timeout: 180_000, skip: image ? false : 'requires explicitly built QDEV_DASHBOARD_VERIFICATION_IMAGE' };

function source(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dashboard-profile-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo'); mkdirSync(repo);
  for (const f of origin.files) {
    const packageFile = f.path === 'package.json' || f.path === 'package-lock.json';
    const bytes = readFileSync(join(packageFile ? profile : fixture, f.path));
    assert.equal(bytes.length, f.size);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), f.sha, f.path);
    const path = join(repo, f.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes, { mode: 0o644 });
  }
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { encoding: 'utf8' }).trim();
  const template = join(directory, 'empty-template'); mkdirSync(template);
  git('init', '-q', `--template=${template}`);
  const tree = () => { git('add', '--all'); return git('write-tree'); };
  assert.equal(tree(), origin.tree, 'The complete frozen source tree must match the designated baseline');
  const check = async (commands = ['node /opt/qdev-dashboard/check.mjs']) => {
    const result = await verifyWorkspaceTree({ repositoryPath: repo, tree: tree(), image, commands,
      artifactDir: join(directory, 'evidence'), limits: PINNED_BROWSER_VERIFICATION_LIMITS });
    assert.equal(result.exportStatus, 'ready');
    return { result, log: result.checks.map(c => readFileSync(c.logPath, 'utf8')).join('\n') };
  };
  return { repo, check };
}

test('dashboard: exact baseline builds and passes desktop/mobile browser tests in the isolated immutable image', options, async t => {
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const s = source(t), { result, log } = await s.check();
  assert.deepEqual(result.checks.map(c => c.status), ['passed'], log);
  assert.match(log, /2 passed/);
});

test('dashboard: actual TypeScript errors fail the real build', options, async t => {
  const s = source(t);
  writeFileSync(join(s.repo, 'src/App.tsx'), 'const invalid: string = 42; export default function App(){return <h1>{invalid}</h1>;}\n');
  const { result, log } = await s.check();
  assert.deepEqual(result.checks.map(c => c.status), ['failed'], log);
  assert.match(log, /not assignable to type 'string'/);
});

test('dashboard: a compiling application that violates the real browser expectations fails', options, async t => {
  const s = source(t), path = join(s.repo, 'src/App.tsx');
  writeFileSync(path, readFileSync(path, 'utf8').replace('Baseline established', 'Incorrect application'));
  const { result, log } = await s.check();
  assert.deepEqual(result.checks.map(c => c.status), ['failed'], log);
  assert.match(log, /2 failed/);
  assert.match(log, /Baseline established/);
});

test('dashboard: replacing the build script with a no-op is refused before any build', options, async t => {
  const s = source(t), path = join(s.repo, 'package.json'), packageJson = JSON.parse(readFileSync(path));
  packageJson.scripts.build = 'exit 0'; writeFileSync(path, JSON.stringify(packageJson));
  const { result, log } = await s.check();
  assert.deepEqual(result.checks.map(c => c.status), ['failed'], log);
  assert.match(log, /package.json differs from the qualified dependency profile/);
  assert.doesNotMatch(log, /Running 2 tests/);
});

test('dashboard: the new image preserves non-root, read-only source, denied egress and finite browser resource caps', options, async t => {
  const s = source(t);
  const script = `const fs=require('node:fs'),net=require('node:net');
    if(process.getuid()!==65534)process.exit(9);
    if(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim()!=='192')process.exit(10);
    if(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim()!=='1073741824')process.exit(11);
    try{fs.writeFileSync('/src/unauthorized','x');process.exit(12)}catch(e){if(!['EROFS','EACCES'].includes(e.code))throw e}
    const socket=net.connect(443,'1.1.1.1');socket.setTimeout(3000,()=>process.exit(13));
    socket.on('connect',()=>process.exit(14));socket.on('error',()=>process.exit(0));`;
  const quoted = "'" + script.replaceAll("'", "'\\''") + "'";
  const { result, log } = await s.check([`node -e ${quoted}`]);
  assert.deepEqual(result.checks.map(c => c.status), ['passed'], log);
});
