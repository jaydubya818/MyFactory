import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOwnerContainerProfile, containerExecutorVersion, OWNER_CONTAINER_POLICY, qualifyContainerClock } from '../src/owner-container-profile.mjs';
import { runContainer, assertCredentialBindIsolation } from '../src/owner-container-worker.mjs';

const p = { imageId: 'sha256:' + 'a'.repeat(64), dockerExecutable: '/usr/bin/docker', authFile: '/private/auth.json', stateDirectory: '/private/state' };
test('container profile is exact and its complete policy/image changes execution identity', () => {
  assert.deepEqual(parseOwnerContainerProfile(p), p);
  for (const raw of [{ ...p, network: 'host' }, { ...p, imageId: 'worker:latest' }, { ...p, authFile: '/private/../auth' }, { ...p, dockerExecutable: 'docker' }, { ...p, authFile: null }])
    assert.throws(() => parseOwnerContainerProfile(raw), /INVALID/);
  assert.match(OWNER_CONTAINER_POLICY, /^[a-f0-9]{64}$/);
  const a = containerExecutorVersion('codex-cli 0.163.0', p);
  assert.match(a, /OWNER_SUBSCRIPTION_LOCAL isolation=owner-container-v1/);
  assert.notEqual(a, containerExecutorVersion('codex-cli 0.163.0', { ...p, imageId: 'sha256:' + 'b'.repeat(64) }));
  assert.throws(() => containerExecutorVersion('codex-cli 0.164.0', p), /VERSION_INVALID/);
});
test('daemon failure cannot become proof of worker absence', async t => {
  const root = mkdtempSync(join(tmpdir(), 'container-daemon-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const authFile = join(root, 'auth.json'); writeFileSync(authFile, '{}', { mode: 0o600 });
  await assert.rejects(runContainer({ profile: { ...p, dockerExecutable: '/usr/bin/false', authFile, stateDirectory: join(root, 'state') } }, []), /DOCKER_UNAVAILABLE/);
});
test('syscall successor retains the Docker default deny and grants no administration capabilities', () => {
  const policy = JSON.parse(readFileSync(new URL('../container/seccomp.json', import.meta.url)));
  assert.equal(policy.defaultAction, 'SCMP_ACT_ERRNO');
  assert.deepEqual(policy.syscalls.at(-2).names, ['unshare', 'mount', 'umount2', 'pivot_root']);
  assert.deepEqual(policy.syscalls.at(-1), { names: ['clone'], action: 'SCMP_ACT_ALLOW', args: [{ index: 0, value: 268435456, valueTwo: 268435456, op: 'SCMP_CMP_MASKED_EQ' }] });
});
test('guest clock proof bounds the entire uncertainty interval; slow or changed clocks refuse', () => {
  qualifyContainerClock({wall:1000,mono:1000},1100,{wall:1200,mono:1200});
  for (const [guest,after] of [[1000,{wall:4000,mono:4000}],[NaN,{wall:1200,mono:1200}],[1500,{wall:1200,mono:1200}],[1100,{wall:1200,mono:1000}]])
    assert.throws(() => qualifyContainerClock({wall:1000,mono:1000},guest,after), /CLOCK_UNQUALIFIED/);
});
test('private credentials and state cannot enter any worker bind through a symlink alias', t => {
  const root=mkdtempSync(join(tmpdir(),'container-bind-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const workspace=join(root,'workspace'),state=join(root,'state'),auth=join(root,'auth.json');
  mkdirSync(workspace);mkdirSync(state,{mode:0o700});writeFileSync(auth,'synthetic',{mode:0o600});
  assertCredentialBindIsolation(auth,state,workspace);
  const inner=join(workspace,'private');mkdirSync(inner,{mode:0o700});symlinkSync(workspace,join(root,'alias'),'dir');
  assert.throws(()=>assertCredentialBindIsolation(auth,join(root,'alias','private'),workspace),/STATE_INSIDE_WORKSPACE/);
  const exposed=join(workspace,'auth.json');writeFileSync(exposed,'synthetic',{mode:0o600});
  assert.throws(()=>assertCredentialBindIsolation(join(root,'alias','auth.json'),state,workspace),/AUTH_EXPOSED_BY_BIND/);
  const stateAuth=join(state,'auth.json');writeFileSync(stateAuth,'synthetic',{mode:0o600});
  assert.throws(()=>assertCredentialBindIsolation(stateAuth,state,workspace),/AUTH_EXPOSED_BY_BIND/);
});
