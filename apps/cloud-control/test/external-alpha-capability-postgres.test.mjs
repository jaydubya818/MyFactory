import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import pg from 'pg';
import {PostgresDispatchStore} from '../src/postgres-dispatch.mjs';
import {externalAlphaCapabilityProvisioning,applyExternalAlphaCapabilityProvisioning,restrictedRolePool} from '../src/external-alpha-capability.mjs';

// LOCAL disposable database at the external-alpha host's migration level (001-012), provisioned ONLY through the
// operator provisioning SQL under test. Admission then runs through the real capability enforcement package.
const url=process.env.FACTORY_PAID_TEST_DATABASE_URL;
const migrations=new URL('../migrations/',import.meta.url),docs=new URL('../../../docs/capability-control/',import.meta.url);

async function hostDatabase(t,{through=12}={}){
 assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
 const suffix=randomUUID().replaceAll('-','').slice(0,16),name=`capprov_${suffix}`,role=`capprov_runtime_${suffix}`;
 const admin=new pg.Pool({connectionString:url});
 await admin.query(`CREATE DATABASE ${name}`);
 const target=new URL(url);target.pathname=`/${name}`;
 const pool=new pg.Pool({connectionString:target.toString()});
 t.after(async()=>{await pool.end();await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);await admin.query(`DROP ROLE IF EXISTS ${role}`);await admin.end();});
 for(const file of (await readdir(migrations)).filter(f=>Number(f.slice(0,3))<=through&&/^\d{3}-.*\.sql$/.test(f)).sort())await pool.query(await readFile(new URL(file,migrations),'utf8'));
 let schemaSql='';
 for(const part of ['migration','enforcement','decisions','ordering','lifecycle'])schemaSql+=await readFile(new URL(`${part}.sql`,docs),'utf8')+'\n';
 const connectingRole=(await pool.query('SELECT current_user AS u')).rows[0].u;
 return {pool,role,schemaSql,connectingRole};
}

const clientId='external-alpha-slot-one',ownerId='owner-slot-one';
const scope={ownerId,organizationId:'org-slot-one',installationId:'install-slot-one',agentId:'agent-slot-one',environment:'qualification'};
const source={repository:'fixture/capability',commit:'a'.repeat(40),tree:'b'.repeat(40)};
const grant={clientId,ownerScope:ownerId,source,commands:['node --test'],allowedPaths:['fixture.mjs'],maxDurationMs:120000,maxSpendUsd:1};
const input=()=>({protocol:'MYFACTORY_EXECUTION_V2',requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:source.repository,source,
 deadline:new Date(Date.now()+110000).toISOString(),maxSpendUsd:1,
 input:{title:'Capability provisioning fixture',description:'No provider operations',kind:'feature',acceptanceCriteria:['Exact owner'],checkCommands:grant.commands,allowedPaths:grant.allowedPaths}});
const snapshot=(request,order,run)=>({requestId:request.requestId,workOrderId:order.id,runId:run.id,inputCommit:source.commit});

// 012: the original alpha host level. 014: the live host level, whose receiver schema revokes its lookup from PUBLIC.
for(const through of [12,14])test(`LOCAL operator provisioning (migrations 001-0${through}) admits only the bound owner under the restricted role and preserves every kill switch`,{skip:!url},async t=>{
 const db=await hostDatabase(t,{through});
 const client=await db.pool.connect();
 try{
  // pg.Pool.query cannot run BEGIN/COMMIT on one connection, so provisioning uses a dedicated client.
  const once=()=>applyExternalAlphaCapabilityProvisioning(client,externalAlphaCapabilityProvisioning({bindings:[{clientId,...scope}],runtimeRole:db.role,
   connectingRole:db.connectingRole,schemaSql:db.schemaSql,policyRecord:'unified-beta-capability-test',evidenceExpiresAt:new Date(Date.now()+3600e3).toISOString()}));
  await once();
  await once(); // idempotent re-provisioning
  const store=new PostgresDispatchStore(restrictedRolePool(db.pool,db.role),{capabilityBindings:{[clientId]:scope}});
  const intakes=async()=>Number((await db.pool.query('SELECT count(*) FROM factory.intake_receipts')).rows[0].count);

  const admitted=await store.prepare(grant,input(),snapshot);
  assert.ok(admitted.run_id);
  if(through>=13){
   // The receiver lookup ran under the restricted role inside admission; it is EXECUTE-only, never owned.
   assert.equal((await store.transaction(c=>c.query("SELECT factory.receiver_requires_ordering($1,$2) AS r",[ownerId,scope.installationId]))).rows[0].r,false);
   assert.equal((await db.pool.query("SELECT pg_get_userbyid(proowner)=$1 AS owned FROM pg_proc WHERE proname='receiver_requires_ordering'",[db.role])).rows[0].owned,false);
  }
  const events=(await db.pool.query('SELECT type FROM factory.events WHERE run_id=$1',[admitted.run_id])).rows.map(r=>r.type);
  assert.ok(events.includes('factory.capability_admitted')&&events.includes('factory.owner_scope_bound'));
  assert.equal(await intakes(),1);

  // The owner/admin connection itself is never an acceptable runtime role.
  await assert.rejects(new PostgresDispatchStore(db.pool,{capabilityBindings:{[clientId]:scope}}).prepare(grant,input(),snapshot),/RUNTIME_ROLE_UNQUALIFIED/);
  // Another owner's grant or a missing binding never admits.
  await assert.rejects(store.prepare({...grant,ownerScope:'foreign-owner'},input(),snapshot),/CAPABILITY_INSTALLATION_UNQUALIFIED/);
  await assert.rejects(new PostgresDispatchStore(restrictedRolePool(db.pool,db.role),{}).prepare(grant,input(),snapshot),/CAPABILITY_INSTALLATION_UNQUALIFIED/);
  assert.equal(await intakes(),1);

  // Owner kill switch: preference DISABLED denies, and re-provisioning does not re-enable it.
  await db.pool.query(`UPDATE capability_control.owner_state SET preferences=jsonb_set(preferences,'{myfactory}','"DISABLED"') WHERE owner_id=$1`,[ownerId]);
  await assert.rejects(store.prepare(grant,input(),snapshot),/POLICY_BLOCKED:myfactory/);
  await once();
  await assert.rejects(store.prepare(grant,input(),snapshot),/POLICY_BLOCKED:myfactory/);
  await db.pool.query(`UPDATE capability_control.owner_state SET preferences=jsonb_set(preferences,'{myfactory}','"ENABLED"') WHERE owner_id=$1`,[ownerId]);

  // Expired policy evidence denies until the operator explicitly re-provisions a new bounded window.
  await db.pool.query("UPDATE capability_control.evidence SET observed_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 second'");
  await assert.rejects(store.prepare(grant,input(),snapshot),/POLICY_EVIDENCE_STALE/);
  await once();
  await store.prepare(grant,input(),snapshot);

  // A custodian DENY on policy evidence survives routine renewal.
  await db.pool.query(`UPDATE capability_control.evidence SET facts=jsonb_set(facts,'{myfactory,administrator}','"DENY"') WHERE owner_id=$1`,[ownerId]);
  await assert.rejects(store.prepare(grant,input(),snapshot),/POLICY_BLOCKED:myfactory/);
  await once();
  await assert.rejects(store.prepare(grant,input(),snapshot),/POLICY_BLOCKED:myfactory/);
  assert.equal((await db.pool.query("SELECT facts->'myfactory'->>'administrator' AS a FROM capability_control.evidence WHERE owner_id=$1",[ownerId])).rows[0].a,'DENY');
  await db.pool.query(`UPDATE capability_control.evidence SET facts=jsonb_set(facts,'{myfactory,administrator}','"ALLOW"') WHERE owner_id=$1`,[ownerId]);
  // A narrowed agent capability set is never widened by renewal.
  await db.pool.query(`UPDATE capability_control.relay_agent_evidence SET capability_ids='["work"]'::jsonb WHERE owner_id=$1`,[ownerId]);
  await assert.rejects(store.prepare(grant,input(),snapshot),/AGENT_DENIED:myfactory/);
  await once();
  await assert.rejects(store.prepare(grant,input(),snapshot),/AGENT_DENIED:myfactory/);
  await db.pool.query(`UPDATE capability_control.relay_agent_evidence SET capability_ids='["myfactory","work"]'::jsonb WHERE owner_id=$1`,[ownerId]);
  assert.equal(await intakes(),2);

  // Revoked agent evidence stays revoked through re-provisioning.
  await db.pool.query("UPDATE capability_control.relay_agent_evidence SET status='REVOKED'");
  await assert.rejects(store.prepare(grant,input(),snapshot),/AGENT_POLICY_UNAVAILABLE/);
  await once();
  await assert.rejects(store.prepare(grant,input(),snapshot),/AGENT_POLICY_UNAVAILABLE/);
  assert.equal(await intakes(),2);

  // The runtime role can read its policy but never write it.
  await assert.rejects(store.transaction(c=>c.query("UPDATE capability_control.evidence SET facts='{}'")),/permission denied/);
  await assert.rejects(store.transaction(c=>c.query("UPDATE capability_control.owner_state SET preferences='{}'")),/permission denied/);
 }finally{client.release();}
});

test('LOCAL provisioning aborts before any grant when the runtime role already exists with login or elevated attributes',{skip:!url},async t=>{
 const db=await hostDatabase(t);
 await db.pool.query(`CREATE ROLE ${db.role} LOGIN NOSUPERUSER`);
 const client=await db.pool.connect();
 try{
  await assert.rejects(applyExternalAlphaCapabilityProvisioning(client,externalAlphaCapabilityProvisioning({bindings:[{clientId,...scope}],runtimeRole:db.role,
   connectingRole:db.connectingRole,schemaSql:db.schemaSql,policyRecord:'unified-beta-capability-test',evidenceExpiresAt:new Date(Date.now()+3600e3).toISOString()})),/CAPABILITY_RUNTIME_ROLE_UNSAFE/);
  // The whole transaction rolled back: no capability schema, no membership granted to the connecting role.
  assert.equal((await db.pool.query("SELECT to_regnamespace('capability_control') IS NULL AS absent")).rows[0].absent,true);
  assert.equal(Number((await db.pool.query('SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE r.rolname=$1 AND u.rolname=current_user',[db.role])).rows[0].count),0);
 }finally{client.release();}
});

test('LOCAL the printed operator SQL is exactly the qualified provisioning and refuses a non-Factory database',{skip:!url},async t=>{
 const {externalAlphaCapabilitySql}=await import('../scripts/prepare-external-alpha-capability.mjs');
 const db=await hostDatabase(t);
 const out=await externalAlphaCapabilitySql({bindings:[{clientId,...scope}],runtimeRole:db.role,connectingRole:db.connectingRole,
  evidenceExpiresAt:new Date(Date.now()+3600e3).toISOString(),policyRecord:'unified-beta-capability-test'});
 assert.match(out.sql,/^BEGIN;/);assert.match(out.sql,/COMMIT;\n$/);
 assert.equal(JSON.parse(out.env.FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS)[0].clientId,clientId);
 assert.match(out.env.FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS_SHA256,/^[a-f0-9]{64}$/);
 assert.equal(out.env.FACTORY_EXTERNAL_ALPHA_CAPABILITY_RUNTIME_ROLE,db.role);
 await db.pool.query(out.sql);
 await db.pool.query(out.sql); // re-running is safe
 const store=new PostgresDispatchStore(restrictedRolePool(db.pool,db.role),{capabilityBindings:{[clientId]:scope}});
 assert.ok((await store.prepare(grant,input(),snapshot)).run_id);
 // A database without the Factory schema refuses the whole transaction.
 const admin=new pg.Pool({connectionString:url}),name=`capprov_empty_${randomUUID().replaceAll('-','').slice(0,12)}`;
 await admin.query(`CREATE DATABASE ${name}`);
 const target=new URL(url);target.pathname=`/${name}`;const empty=new pg.Pool({connectionString:target.toString()});
 try{
  await assert.rejects(empty.query(out.sql),/FACTORY_DATABASE_REQUIRED/);
  assert.equal((await empty.query("SELECT to_regnamespace('capability_control') IS NULL AS absent")).rows[0].absent,true);
 }finally{await empty.end();await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);await admin.end();}
});
