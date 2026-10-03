import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSessionAttachmentScope, parseSessionAttachmentRequest } from '../../../packages/contracts/src/session-surface.ts';
import { capabilityNames, sessionCapabilityNames, parseEnvironment, environmentSummary } from '../../../packages/contracts/src/environment.ts';
import { deriveRequirements, environmentIdentity, routeEnvironment } from '../src/environment-router.ts';

const now = 1_800_000_000_000;
const execution = { workId: 'work-1', workGeneration: 1, executionId: 'run-1', executionGeneration: 1,
  environmentId: 'cloud-1', attemptId: 'attempt-1' };
const request = { schemaVersion: 1, surface: 'TMUX', execution };
function fixture() {
  return structuredClone({ request,
    scope: { operatorId: 'operator-1', ownerId: 'owner-1', businessId: 'business-1', execution: { ...execution },
      surfaces: ['TMUX', 'CMUX'], expiresAt: now + 1_000, revoked: false },
    current: { ownerId: 'owner-1', businessId: 'business-1', execution: { ...execution }, active: true, role: 'PRODUCER' } });
}
const check = f => assertSessionAttachmentScope(f.request, f.scope, f.current, now);

test('same exact authorized identity can be resolved again without mutating Current Truth', () => {
  const f = fixture(), before = structuredClone(f);
  assert.deepEqual(check(f), request); assert.deepEqual(check(f), request);
  assert.deepEqual(f, before);
  const parsed = check(f); parsed.execution.workId = 'changed';
  assert.deepEqual(f, before);
});

for (const [name, mutate] of [
  ['cross-Work request', f => f.request.execution.workId = 'work-2'],
  ['cross-Work grant', f => f.scope.execution.workId = 'work-2'],
  ['cross-owner', f => f.scope.ownerId = 'owner-2'],
  ['cross-business', f => f.scope.businessId = 'business-2'],
  ['cross-environment', f => f.request.execution.environmentId = 'cloud-2'],
  ['other execution', f => f.request.execution.executionId = 'run-2'],
  ['other attempt', f => f.request.execution.attemptId = 'attempt-2'],
  ['stale Work generation', f => f.current.execution.workGeneration = 2],
  ['stale execution generation', f => f.current.execution.executionGeneration = 2],
  ['expired scope', f => f.scope.expiresAt = now],
  ['invalid expiry', f => f.scope.expiresAt = NaN],
  ['revoked scope', f => f.scope.revoked = true],
  ['missing operator', f => f.scope.operatorId = ''],
  ['terminal execution', f => f.current.active = false],
  ['verifier attachment', f => f.current.role = 'VERIFIER'],
  ['ungranted surface', f => f.scope.surfaces = ['CMUX']],
]) test(`session scope guard denies ${name}`, () => {
  const f = fixture(); mutate(f); assert.throws(() => check(f), /SESSION_ATTACHMENT_DENIED/);
});

for (const [name, mutate] of [
  ['host selection', r => r.host = 'other-host'],
  ['native session selection', r => r.session = '$1'],
  ['credential', r => r.token = 'secret-canary'],
  ['command', r => r.command = 'kill-server'],
  ['owner chosen by caller', r => r.ownerId = 'owner-2'],
  ['nested path', r => r.execution.path = '/private/work'],
  ['shell text', r => r.execution.workId = 'work;touch /tmp/not-run'],
  ['HEADLESS interactive request', r => r.surface = 'HEADLESS'],
  ['unknown surface', r => r.surface = 'TERMINAL'],
  ['unknown version', r => r.schemaVersion = 2],
  ['missing field', r => delete r.execution.attemptId],
  ['fractional generation', r => r.execution.workGeneration = 1.5],
  ['zero generation', r => r.execution.executionGeneration = 0],
]) test(`session request rejects ${name}`, () => {
  const r = structuredClone(request); mutate(r);
  assert.throws(() => parseSessionAttachmentRequest(r), /INVALID_SESSION_ATTACHMENT/);
});

test('surface capabilities negotiate through the existing descriptor without granting execution', () => {
  const d = { schemaVersion: 1, id: 'cloud-1', name: 'Cloud', type: 'CLOUD', ownerId: 'owner-1', businessId: 'business-1',
    provider: 'fixture', runtime: 'sha256:' + 'a'.repeat(64), factoryVersion: 'b'.repeat(64), protocol: { min: 1, max: 1 },
    capabilities: sessionCapabilityNames.map(name => ({ name, version: 1, available: true })),
    connectivity: 'ONLINE', observedAt: now, capacity: 1, revoked: false };
  assert.deepEqual(environmentSummary(parseEnvironment(d), now).capabilities, [...sessionCapabilityNames].sort());
  d.capabilities[0].version = 2;
  assert.equal(environmentSummary(d, now).capabilities.includes('session.headless'), false);
  d.capabilities[0].version = 1;
  const work = deriveRequirements({ workId: 'work-1', generation: 1, ownerId: 'owner-1', businessId: 'business-1',
    repository: 'owner/project' }, { kind: 'repository' }).requirements;
  const q = [{ identityDigest: environmentIdentity(d), capabilities: [...capabilityNames], evidenceRef: 'fixture',
    qualifiedAt: now - 1, expiresAt: now + 1000, status: 'QUALIFIED' }];
  const authority = { ...work, capabilities: [...capabilityNames], repositories: ['owner/project'],
    environmentIds: [d.id], expiresAt: now + 1000 };
  assert.equal(routeEnvironment(work, [d], q, authority, now).state, 'WAITING_FOR_ENVIRONMENT');
  // Productive routing succeeds with every session capability absent, including session.headless.
  d.capabilities = capabilityNames.filter(n => !sessionCapabilityNames.includes(n)).map(name => ({ name, version: 1, available: true }));
  assert.equal(routeEnvironment(work, [d], q, authority, now).state, 'SELECTED');
  assert.equal(work.capabilities.some(n => n.startsWith('session.')), false);
});
