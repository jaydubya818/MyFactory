import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityNames, environmentSummary, parseEnvironment, negotiatedProtocol } from '../../../packages/contracts/src/environment.ts';
import { deriveRequirements, environmentIdentity, routeEnvironment } from '../src/environment-router.ts';

const now = 1_800_000_000_000;
const baseWork = { workId: 'work-1', generation: 1, ownerId: 'owner-a', businessId: null, repository: 'owner/project' };
function descriptor(type, id = type.toLowerCase()) {
  return { schemaVersion: 1, id, name: type === 'OWNER_COMPUTER' ? 'Your Mac' : 'Execution environment', type,
    ownerId: 'owner-a', businessId: null, provider: 'fixture-provider', runtime: type === 'CLOUD' ? 'sha256:' + 'c'.repeat(64) : 'fixture-runtime-v1',
    factoryVersion: type === 'OWNER_COMPUTER' ? null : 'a'.repeat(64), protocol: { min: 1, max: 1 },
    capabilities: capabilityNames.map(name => ({ name, version: 1, available: true })),
    connectivity: 'ONLINE', observedAt: now, capacity: 1, revoked: false };
}
function setup(resource = { kind: 'repository' }) {
  const environments = ['CLOUD', 'OWNER_COMPUTER', 'LOCAL_FACTORY'].map(type => descriptor(type));
  const { requirements: work } = deriveRequirements(baseWork, resource);
  const qualifications = environments.map(d => ({ identityDigest: environmentIdentity(d), capabilities: [...capabilityNames],
    evidenceRef: 'controlled-fixture-evidence', qualifiedAt: now - 1000, expiresAt: now + 60_000, status: 'QUALIFIED' }));
  const authority = { ...baseWork, capabilities: [...capabilityNames], repositories: ['owner/project'],
    environmentIds: environments.map(d => d.id), expiresAt: now + 60_000 };
  return { work, environments, qualifications, authority };
}
const route = f => routeEnvironment(f.work, f.environments, f.qualifications, f.authority, now);

for (const [name, mutate] of [
  ['credential field', d => d.token = 'not-permitted'],
  ['unknown capability', d => d.capabilities[0].name = 'sourceControlPublish'],
  ['duplicate capability', d => d.capabilities[1] = d.capabilities[0]],
  ['negative capacity', d => d.capacity = -1],
  ['fractional heartbeat', d => d.observedAt = 1.5],
  ['NaN heartbeat', d => d.observedAt = NaN],
  ['reversed protocol', d => d.protocol = { min: 2, max: 1 }],
  ['missing version pin', d => d.factoryVersion = null],
  ['mutable cloud runtime', d => d.runtime = 'latest'],
  ['wrong schema', d => d.schemaVersion = 2],
  ['unknown environment', d => d.type = 'ANYWHERE'],
  ['control characters', d => d.name = 'Host\nsecret'],
]) test(`descriptor rejects ${name}`, () => {
  const d = descriptor('CLOUD'); mutate(d); assert.throws(() => parseEnvironment(d));
});

test('descriptor parsing is defensive and missing capabilities stay absent', () => {
  const original = descriptor('OWNER_COMPUTER'); original.capabilities = [];
  const parsed = parseEnvironment(original); original.name = 'changed';
  assert.equal(parsed.name, 'Your Mac'); assert.deepEqual(parsed.capabilities, []);
  assert.equal(negotiatedProtocol({ ...parsed, protocol: { min: 2, max: 3 } }), null);
});

for (const [name, resource, cloud, mac, expected] of [
  ['repository with both online', { kind: 'repository' }, 'ONLINE', 'ONLINE', 'CLOUD'],
  ['repository with Mac offline', { kind: 'repository' }, 'ONLINE', 'OFFLINE', 'CLOUD'],
  ['Mac file', { kind: 'owner-file', environmentId: 'owner_computer' }, 'ONLINE', 'ONLINE', 'OWNER_COMPUTER'],
  ['offline Mac file', { kind: 'owner-file', environmentId: 'owner_computer' }, 'ONLINE', 'OFFLINE', null],
  ['offline cloud never falls back', { kind: 'repository' }, 'OFFLINE', 'ONLINE', null],
  ['explicit local qualification', { kind: 'local-qualification' }, 'ONLINE', 'ONLINE', 'LOCAL_FACTORY'],
]) test(`routing matrix: ${name}`, () => {
  const f = setup(resource); f.environments[0].connectivity = cloud; f.environments[1].connectivity = mac;
  const decision = route(f);
  if (expected) { assert.equal(decision.state, 'SELECTED'); assert.equal(decision.binding.environmentType, expected); }
  else assert.equal(decision.state, 'WAITING_FOR_ENVIRONMENT');
});

for (const [name, mutate] of [
  ['offline', f => f.environments[0].connectivity = 'OFFLINE'],
  ['stale heartbeat', f => f.environments[0].observedAt = now - 30_000],
  ['future heartbeat', f => f.environments[0].observedAt = now + 1],
  ['capacity exhausted', f => f.environments[0].capacity = 0],
  ['environment revoked', f => f.environments[0].revoked = true],
  ['protocol mismatch', f => f.environments[0].protocol = { min: 2, max: 2 }],
  ['missing capability', f => f.environments[0].capabilities = []],
  ['wrong capability version', f => f.environments[0].capabilities[0].version = 2],
  ['capability unavailable', f => f.environments[0].capabilities[0].available = false],
  ['advertisement without qualification', f => f.qualifications = []],
  ['unqualified FactoryVersion', f => f.environments[0].factoryVersion = 'b'.repeat(64)],
  ['runtime drift', f => f.environments[0].runtime = 'sha256:' + 'd'.repeat(64)],
  ['provider drift', f => f.environments[0].provider = 'unqualified-provider'],
  ['qualification expired', f => f.qualifications[0].expiresAt = now],
  ['qualification revoked', f => f.qualifications[0].status = 'REVOKED'],
  ['qualification not yet valid', f => f.qualifications[0].qualifiedAt = now + 1],
  ['qualification lacks required capability', f => f.qualifications[0].capabilities = ['shell']],
  ['conflicting qualification', f => f.qualifications.push({ ...f.qualifications[0], status: 'REVOKED' })],
  ['environment wrong owner', f => f.environments[0].ownerId = 'owner-b'],
  ['environment wrong business', f => f.environments[0].businessId = 'other-business'],
  ['environment not authorized', f => f.authority.environmentIds = ['owner_computer', 'local_factory']],
]) test(`cloud fails closed: ${name}`, () => {
  const f = setup(); mutate(f); const d = route(f);
  assert.deepEqual(d, { state: 'WAITING_FOR_ENVIRONMENT', reason: 'Waiting for cloud execution' });
});

for (const [name, mutate] of [
  ['owner', a => a.ownerId = 'owner-b'], ['business', a => a.businessId = 'other'],
  ['Work', a => a.workId = 'other'], ['generation', a => a.generation = 2],
  ['expiry', a => a.expiresAt = now], ['invalid expiry', a => a.expiresAt = NaN],
  ['repository', a => a.repositories = []], ['capability', a => a.capabilities = ['shell']],
]) test(`authority mismatch denies ${name}`, () => {
  const f = setup(); mutate(f.authority); assert.equal(route(f).state, 'DENIED');
});

test('Mac resource pins the device; permission loss never routes desktop elsewhere', () => {
  const f = setup({ kind: 'owner-desktop', environmentId: 'owner_computer' });
  f.environments[1].capabilities.find(c => c.name === 'desktop').available = false;
  f.environments.push(descriptor('OWNER_COMPUTER', 'another-mac'));
  assert.equal(route(f).state, 'WAITING_FOR_ENVIRONMENT');
  const read = setup({ kind: 'owner-file', environmentId: 'owner_computer' });
  read.environments[1].capabilities.find(c => c.name === 'desktop').available = false;
  assert.equal(route(read).state, 'SELECTED');
});

test('selection is deterministic across ordering and duplicate identity is rejected', () => {
  const f = setup(); const first = route(f);
  f.environments.reverse(); f.qualifications.reverse(); f.work.capabilities.reverse();
  assert.deepEqual(route(f), first);
  f.environments.push(f.environments[0]); assert.equal(route(f).reason, 'AMBIGUOUS_ENVIRONMENT_IDENTITY');
});

test('bound Work survives environment removal as readback, never new admission', () => {
  const f = setup(); const { binding } = route(f);
  const retained = routeEnvironment(f.work, [], [], f.authority, now, binding);
  assert.equal(retained.state, 'BOUND'); assert.deepEqual(retained.binding, binding);
  f.work.generation++; f.authority.generation++;
  assert.equal(routeEnvironment(f.work, [], [], f.authority, now, binding).state, 'DENIED');
});

test('safe read model omits scope/version internals and reflects stale/downgraded state', () => {
  const d = descriptor('OWNER_COMPUTER');
  assert.deepEqual(Object.keys(environmentSummary(d, now)), ['id', 'name', 'type', 'status', 'capabilities']);
  assert.equal(environmentSummary(d, now + 30_000).status, 'OFFLINE');
  d.protocol = { min: 2, max: 2 }; assert.equal(environmentSummary(d, now).status, 'UPDATE_REQUIRED');
  d.revoked = true; assert.equal(environmentSummary(d, now).status, 'REVOKED');
});

test('derivation requires real resource identity and evidence does not authorize execution', () => {
  assert.throws(() => deriveRequirements(baseWork, { kind: 'model-selected-anywhere' }));
  assert.throws(() => deriveRequirements({ ...baseWork, repository: null }, { kind: 'repository' }));
  assert.throws(() => deriveRequirements(baseWork, { kind: 'owner-file' }));
  const f = setup(); const derived = deriveRequirements(baseWork, { kind: 'repository' });
  assert.equal(derived.reasons.length, derived.requirements.capabilities.length);
  assert.equal(routeEnvironment(f.work, f.environments, f.qualifications, null, now).state, 'DENIED');
});
