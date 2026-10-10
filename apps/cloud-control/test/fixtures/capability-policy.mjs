import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { capabilityRegistry } from '@mission-control/capability-control';

// Synthetic policy lives beside each disposable Factory schema. Runtime queries
// use a restricted role; fixture provisioning retains the separate admin pool.
export async function capabilityPolicyFixture(admin, factorySchema, isolated, owners) {
  assert.match(factorySchema, /^[a-z_]+[a-f0-9]+$/);
  const suffix = randomUUID().replaceAll('-', '');
  const schema = `capability_test_${suffix}`, role = `capability_runtime_${suffix}`;
  const rewrite = sql => sql.replaceAll('capability_control', schema);
  for (const name of ['migration', 'enforcement']) {
    const sql = await readFile(new URL(`../../../../docs/capability-control/${name}.sql`, import.meta.url), 'utf8');
    await admin.query(rewrite(sql));
  }
  await admin.query(`CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  await admin.query(`GRANT USAGE ON SCHEMA ${schema},${factorySchema} TO ${role}`);
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
  await admin.query(`GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA ${factorySchema} TO ${role}`);
  await admin.query(`GRANT EXECUTE ON FUNCTION ${schema}.lock_admission_policy(text,text,text) TO ${role}`);
  const bindings = {};
  const facts = Object.fromEntries(capabilityRegistry.capabilities.map(item => [item.id, {
    supported: true, deployed: true, entitled: true, administrator: 'ALLOW', lifecycle: 'ACTIVE',
    setup: Object.fromEntries(item.setupRequirements.map(key => [key, true])),
    qualification: Object.fromEntries(item.qualificationRequirements.map(key => [key, 'QUALIFIED'])),
  }]));
  for (const [clientId, ownerId] of Object.entries(owners)) {
    const scope = { ownerId, organizationId: `synthetic-org-${clientId}`, installationId: `synthetic-install-${clientId}`,
      agentId: `synthetic-agent-${clientId}`, environment: 'qualification' };
    bindings[clientId] = scope;
    await admin.query(`INSERT INTO ${schema}.installations VALUES($1,$2,$3,true)`, [scope.installationId, scope.organizationId, scope.environment]);
    await admin.query(`INSERT INTO ${schema}.owner_state(installation_id,owner_id,preferences) VALUES($1,$2,$3)`,
      [scope.installationId, ownerId, { work: 'ENABLED', myfactory: 'ENABLED' }]);
    await admin.query(`INSERT INTO ${schema}.evidence VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour','synthetic-policy')`,
      [scope.installationId, scope.organizationId, ownerId, capabilityRegistry.version, facts]);
    await admin.query(`INSERT INTO ${schema}.relay_agent_evidence VALUES($1,$2,$3,$4,1,$5,'ACTIVE',clock_timestamp()+interval '1 hour','synthetic-agent')`,
      [scope.installationId, ownerId, scope.organizationId, scope.agentId, JSON.stringify(['work', 'myfactory'])]);
  }
  return {
    bindings,
    pool: { connect: async () => {
      const client = await isolated.connect();
      return { query: async (sql, args) => {
        const result = await client.query(rewrite(sql), args);
        if (sql === 'BEGIN') await client.query(`SET LOCAL ROLE ${role}`);
        return result;
      }, release: () => client.release() };
    } },
    cleanup: async () => {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.query(`DROP OWNED BY ${role}`);
      await admin.query(`DROP ROLE ${role}`);
    },
  };
}
