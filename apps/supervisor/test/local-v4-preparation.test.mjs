// Portable refusals only: no native Mac execution, worker or provider claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalV4Preparation, bindLocalV4PreparationCapture } from '../src/local-v4-preparation.ts';
import { createLocalV4Supervisor } from '../src/server.ts';
for (const path of [undefined, null, '', 'relative', '/tmp/../tmp/example', '/synthetic/\ninvalid']) test(`portable preparation: noncanonical directory ${JSON.stringify(path)} refuses`, () => {
  assert.throws(() => createLocalV4Preparation(path), /^Error: LOCAL_V4_PREPARATION_REFUSED$/);
});
test('portable preparation: exactly three frozen existing dependency functions, no eager filesystem access', () => {
  const p = createLocalV4Preparation('/synthetic/no-filesystem-access'); assert(Object.isFrozen(p));
  assert.deepEqual(Object.keys(p).sort(), ['createTaskWorktree', 'removeTaskWorktree', 'resolveCommit']);
  for (const value of Object.values(p)) assert.equal(typeof value, 'function');
});
for (const ref of ['HEAD', 'main', '-x', 'a'.repeat(39), 'A'.repeat(40), 'a'.repeat(41), null]) test(`portable preparation: nonliteral commit ${ref} refuses`, async () => {
  const p = createLocalV4Preparation('/synthetic/no-filesystem-access');
  await assert.rejects(p.resolveCommit('/synthetic/repository', ref), /^Error: LOCAL_V4_PREPARATION_REFUSED$/);
});
test('portable preparation: no observed input and no ownership grant no creation or removal', async () => {
  const p = createLocalV4Preparation('/synthetic/no-filesystem-access');
  await assert.rejects(p.createTaskWorktree('/synthetic/repository', 'a'.repeat(40), '/synthetic/no-filesystem-access/workspaces'), /REFUSED/);
  await assert.rejects(p.removeTaskWorktree('/synthetic/repository', '/synthetic/no-filesystem-access/workspaces/foreign'), /RETAINED_HOLD/);
});
test('portable preparation: fixed capture marker refuses unknown workspace before forwarding', () => {
  let calls = 0; const p = createLocalV4Preparation('/synthetic/no-filesystem-access');
  const original = { capture() { calls++; }, snapshot() { return null; }, read() { return { state: 'synthetic', result: null }; }, finalize() { return null; } };
  const bound = bindLocalV4PreparationCapture(p, original);
  assert.throws(() => bound.capture({ repositoryPath: '/synthetic/repository' }, { workspacePath: '/synthetic/foreign' }, 'fixture', 'fixture'), /RETAINED_HOLD/);
  assert.equal(calls, 0); assert.equal(bound.snapshot({}), null); assert.deepEqual(bound.read({}), { state: 'synthetic', result: null });
  assert.throws(() => bindLocalV4PreparationCapture({}, original), /REFUSED/);
});
for (const key of ['resolveCommit', 'createTaskWorktree', 'removeTaskWorktree']) for (const value of [undefined, () => {}]) test(`portable preparation: V4 ${key} override presence refuses before storage`, () => {
  assert.throws(() => createLocalV4Supervisor({ dataDir: '/synthetic/no-filesystem-access', resultSigning: {}, jobDependencies: { [key]: value } }), /preparation overrides are not permitted/);
});
