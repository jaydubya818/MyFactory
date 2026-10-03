import assert from 'node:assert/strict';
import test from 'node:test';
import { ownerComputerEnvironment, localFactoryEnvironment } from '../src/environment-adapters.ts';
import { environmentSummary } from '../../../packages/contracts/src/environment.ts';
import { deriveRequirements, routeEnvironment } from '../src/environment-router.ts';

const now = 1_800_000_000_000;
const mac = () => ({ ownerId: 'owner', businessId: null, deviceId: 'paired-mac', runtime: 'sofie-local-v1',
  status: 'ready', lastSeenAt: new Date(now).toISOString(), permissions: { accessibility: false, screenRecording: true },
  filesystemAvailable: true, shellAvailable: true });

test('Owner Computer capabilities track permissions independently and omit local roots', () => {
  const descriptor = ownerComputerEnvironment({ ...mac(), roots: ['/private/owner-files'], token: 'secret-canary' });
  assert.equal(descriptor.type, 'OWNER_COMPUTER');
  assert.equal(descriptor.capabilities.find(c => c.name === 'desktop').available, false);
  assert.equal(descriptor.capabilities.find(c => c.name === 'screenshot').available, true);
  assert.equal(descriptor.capabilities.find(c => c.name === 'filesystem').available, true);
  assert.equal(JSON.stringify(descriptor).includes('secret-canary'), false);
  assert.equal(JSON.stringify(descriptor).includes('/private/owner-files'), false);
});

test('offline, revoked, stale and absent heartbeat never advertise an online Mac', () => {
  for (const patch of [{ status: 'offline' }, { status: 'revoked' }, { lastSeenAt: null },
    { lastSeenAt: new Date(now - 30_000).toISOString() }]) {
    const summary = environmentSummary(ownerComputerEnvironment({ ...mac(), ...patch }), now);
    assert.notEqual(summary.status, 'ONLINE'); assert.deepEqual(summary.capabilities, []);
  }
  assert.throws(() => ownerComputerEnvironment({ ...mac(), lastSeenAt: 'invalid' }));
});

test('Local Factory health cannot qualify background or protected verification authority', () => {
  const descriptor = localFactoryEnvironment({ id: 'local-factory', ownerId: 'owner', businessId: null,
    provider: 'local-execution-v1', runtime: 'node-24', factoryVersion: 'a'.repeat(64), observedAt: now, ready: true, capacity: 1 });
  assert.equal(descriptor.type, 'LOCAL_FACTORY');
  assert.equal(descriptor.capabilities.some(c => c.name === 'backgroundExecution'), false);
  const work = { workId: 'work', generation: 1, ownerId: 'owner', businessId: null, repository: 'owner/project' };
  const { requirements } = deriveRequirements(work, { kind: 'local-qualification' });
  const authority = { ...work, environmentIds: [descriptor.id], capabilities: requirements.capabilities,
    repositories: [work.repository], expiresAt: now + 60_000 };
  assert.equal(routeEnvironment(requirements, [descriptor], [], authority, now).state, 'WAITING_FOR_ENVIRONMENT');
});
