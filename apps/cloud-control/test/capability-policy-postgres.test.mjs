import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PostgresDispatchStore } from '../src/postgres-dispatch.mjs';
import { capabilityPolicyFixture } from './fixtures/capability-policy.mjs';

const url = process.env.FACTORY_PAID_TEST_DATABASE_URL;
test('LOCAL capability policy fixtures retain real admission, owner isolation and restricted evidence access', { skip: !url }, async t => {
  assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
  const admin = new pg.Pool({ connectionString: url });
  const schema = `capability_factory_${randomUUID().replaceAll('-', '')}`;
  let capability;
  await admin.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    await capability?.cleanup();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  const rewrite = sql => sql.replace(/\bfactory\.(verification_resources|candidate_custody|delivery_intents|intake_receipts|events|execution_resources|work_orders|runs|work_spend_budgets|work_spend_operations)\b/g, `${schema}.$1`).replaceAll('IN SCHEMA factory', `IN SCHEMA ${schema}`);
  for (const version of ['002-canonical-execution-ledger', '004-canonical-dispatch', '005-cloud-custody', '006-cloud-verification']) {
    await admin.query(rewrite(await readFile(new URL(`../migrations/${version}.sql`, import.meta.url), 'utf8')));
  }
  const isolated = { connect: async () => {
    const client = await admin.connect();
    return { query: (sql, args) => client.query(rewrite(sql), args), release: () => client.release() };
  } };
  capability = await capabilityPolicyFixture(admin, schema, isolated, { 'client-a': 'owner-a', 'client-b': 'owner-b' });
  const store = new PostgresDispatchStore(capability.pool, { capabilityBindings: capability.bindings });
  const source = { repository: 'fixture/capability', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const grant = { clientId: 'client-a', ownerScope: 'owner-a', source, commands: ['node --test'], allowedPaths: ['fixture.mjs'], maxDurationMs: 120000, maxSpendUsd: 1 };
  const input = { protocol: 'MYFACTORY_EXECUTION_V2', requestId: randomUUID(), workId: randomUUID(), workGeneration: 1,
    repository: source.repository, source, deadline: new Date(Date.now() + 110000).toISOString(), maxSpendUsd: 1,
    input: { title: 'Admission fixture', description: 'No provider operations', kind: 'feature', acceptanceCriteria: ['Exact owner'], checkCommands: grant.commands, allowedPaths: grant.allowedPaths } };
  const snapshot = (request, order, run) => ({ requestId: request.requestId, workOrderId: order.id, runId: run.id, inputCommit: source.commit });
  const [first, replay] = await Promise.all([store.prepare(grant, input, snapshot), store.prepare(grant, input, snapshot)]);
  assert.equal(first.run_id, replay.run_id);
  await assert.rejects(store.prepare({ ...grant, ownerScope: 'owner-b' }, input, snapshot), /INSTALLATION_UNQUALIFIED/);
  await assert.rejects(store.read('client-b', input.requestId), /NOT_FOUND/);
  await assert.rejects(store.prepare({ ...grant, clientId: 'client-b', ownerScope: 'owner-b' }, { ...input, requestId: randomUUID() }, snapshot), /WORK_SCOPE_OR_GENERATION_CONFLICT/);
  await assert.rejects(store.transaction(client => client.query("UPDATE capability_control.evidence SET facts='{}'")), /permission denied/);
  await store.transaction(async client => {
    await client.query("SELECT set_config('myeve.capability_owner',$1,true),set_config('myeve.capability_installation',$2,true)",
      ['owner-a', capability.bindings['client-a'].installationId]);
    assert.equal((await client.query("SELECT * FROM capability_control.evidence WHERE owner_id='owner-a'")).rows.length, 1);
    const rows = (await client.query("SELECT * FROM capability_control.evidence WHERE owner_id='owner-b'")).rows;
    assert.equal(rows.length, 0);
  });
  assert.equal((await admin.query(`SELECT count(*) FROM ${schema}.intake_receipts`)).rows[0].count, '1');
  assert.equal((await admin.query(`SELECT count(*) FROM ${schema}.work_spend_operations`)).rows[0].count, '0');
});
