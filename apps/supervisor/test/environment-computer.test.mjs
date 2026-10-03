import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityNames, computerCapabilityNames, environmentTypes, parseEnvironment } from '../../../packages/contracts/src/environment.ts';
import { deriveRequirements, environmentIdentity, requirementsDigest, routeEnvironment } from '../src/environment-router.ts';

const now = 1_800_000_000_000;
const work = { workId: 'work-1', generation: 1, ownerId: 'owner-1', businessId: null, repository: 'owner/project' };
function environment(type = 'CLOUD', capabilities = ['repositoryExecution']) {
  return { schemaVersion: 1, id: type.toLowerCase(), name: 'Qualified environment', type,
    ownerId: work.ownerId, businessId: null, provider: 'resource-provider',
    runtime: type === 'CLOUD' ? 'sha256:' + 'a'.repeat(64) : 'local-runtime',
    factoryVersion: type === 'OWNER_COMPUTER' ? null : 'b'.repeat(64), protocol: { min: 1, max: 1 },
    capabilities: capabilities.map(name => ({ name, version: 1, available: true })),
    connectivity: 'ONLINE', observedAt: now, capacity: 1, revoked: false };
}
function fixture() {
  const d = environment('CLOUD', [...computerCapabilityNames]);
  return { requirements: { ...work, repository: null, environmentType: 'CLOUD', environmentId: null, capabilities: [...computerCapabilityNames] },
    environments: [d, environment('OWNER_COMPUTER', [...computerCapabilityNames])],
    qualifications: [{ identityDigest: environmentIdentity(d), capabilities: [...computerCapabilityNames],
      status: 'QUALIFIED', qualifiedAt: now - 1, expiresAt: now + 1000, evidenceRef: 'synthetic-computer-policy-fixture' }],
    authority: { ...work, capabilities: [...computerCapabilityNames], environmentIds: ['cloud', 'owner_computer'], repositories: [], expiresAt: now + 1000 } };
}
const route = f => routeEnvironment(f.requirements, f.environments, f.qualifications, f.authority, now);

test('CLOUD_COMPUTER is not a new environment type or implied cloud capability', () => {
  assert.deepEqual(environmentTypes, ['CLOUD', 'OWNER_COMPUTER', 'LOCAL_FACTORY']);
  const d = parseEnvironment(environment());
  assert.deepEqual(d.capabilities.map(c => c.name), ['repositoryExecution']);
  assert.throws(() => parseEnvironment({ ...d, type: 'CLOUD_COMPUTER' }));
});

for (const field of ['agentId', 'specialistRole', 'harness', 'codex', 'claudeCode', 'deepAgent', 'cursor']) {
  test(`environment wire contract rejects agent/harness field ${field}`, () => {
    assert.throws(() => parseEnvironment({ ...environment(), [field]: 'not-environment-identity' }));
  });
}

for (const role of ['Software Engineer', 'Designer', 'Researcher', 'Sofie', 'Future Specialist']) {
  test(`${role} retains identity across resource-driven environments`, () => {
    const agent = { agentId: 'stable-agent', specialistRole: role, harness: 'future-qualified-harness' };
    const input = { ...work, ...agent }, before = structuredClone(input);
    for (const [resource, expected] of [
      [{ kind: 'repository' }, 'CLOUD'],
      [{ kind: 'owner-desktop', environmentId: 'paired-device' }, 'OWNER_COMPUTER'],
      [{ kind: 'local-qualification' }, 'LOCAL_FACTORY'],
    ]) {
      const actual = deriveRequirements(input, resource);
      const canonical = deriveRequirements(work, resource);
      assert.deepEqual(actual, canonical);
      assert.equal(actual.requirements.environmentType, expected);
      assert.equal(requirementsDigest(actual.requirements), requirementsDigest(canonical.requirements));
      const d = environment(expected, actual.requirements.capabilities);
      if (expected === 'OWNER_COMPUTER') d.id = 'paired-device';
      const q = [{ identityDigest: environmentIdentity(d), capabilities: actual.requirements.capabilities,
        qualifiedAt: now - 1, expiresAt: now + 1000, status: 'QUALIFIED', evidenceRef: 'fixture' }];
      const authority = { ...work, capabilities: actual.requirements.capabilities, environmentIds: [d.id], repositories: [work.repository], expiresAt: now + 1000 };
      assert.equal(routeEnvironment(actual.requirements, [d], q, authority, now).state, 'SELECTED');
    }
    assert.deepEqual(input, before);
  });
}

test('explicit cloud computer requirements use existing capability/policy/qualification routing', () => {
  const f = fixture(); assert.equal(route(f).state, 'SELECTED');
  assert.equal(route(f).binding.environmentType, 'CLOUD');
});
for (const capability of computerCapabilityNames) {
  test(`CLOUD may qualify ${capability} without the other computer capabilities`, () => {
    const f = fixture(); f.requirements.capabilities = [capability];
    f.environments[0].capabilities = [{ name: capability, version: 1, available: true }];
    f.qualifications[0].capabilities = [capability]; f.authority.capabilities = [capability];
    assert.equal(route(f).state, 'SELECTED');
  });
  for (const denial of ['absent', 'unavailable', 'incompatible', 'unqualified', 'unauthorized']) {
    test(`${capability} ${denial} cannot become qualified cloud computer access`, () => {
      const f = fixture(), d = f.environments[0];
      if (denial === 'absent') d.capabilities = d.capabilities.filter(c => c.name !== capability);
      if (denial === 'unavailable') d.capabilities.find(c => c.name === capability).available = false;
      if (denial === 'incompatible') d.capabilities.find(c => c.name === capability).version = 2;
      if (denial === 'unqualified') f.qualifications[0].capabilities = f.qualifications[0].capabilities.filter(c => c !== capability);
      if (denial === 'unauthorized') f.authority.capabilities = f.authority.capabilities.filter(c => c !== capability);
      const decision = route(f);
      assert.equal(decision.state, denial === 'unauthorized' ? 'DENIED' : 'WAITING_FOR_ENVIRONMENT');
      assert.equal(decision.binding, undefined); // No fallback to the capable owner's Mac.
    });
  }
}
test('operator browser surface is not an agent browser capability', () => {
  const f = fixture(); f.requirements.capabilities = ['browser'];
  f.environments[0].capabilities = [{ name: 'session.browser', version: 1, available: true }];
  assert.equal(route(f).state, 'WAITING_FOR_ENVIRONMENT');
});
test('repository Work stays independent of future computer capabilities', () => {
  const requirements = deriveRequirements(work, { kind: 'repository' }).requirements;
  assert.equal(requirements.capabilities.some(c => computerCapabilityNames.includes(c)), false);
  assert.ok(computerCapabilityNames.every(c => capabilityNames.includes(c)));
});
