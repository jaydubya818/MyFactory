// Canonical pure-contract cases reused from Fabric 9983ccfcc6881b090e3d11bc575d1af1e710195e.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSessionAttachmentScope, parseSessionAttachmentRequest } from '../../../packages/contracts/src/session-surface.ts';

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

