import assert from 'node:assert/strict';
import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { capabilityRegistry } from '@mission-control/capability-control';
import { PostgresDispatchStore } from '../apps/cloud-control/src/postgres-dispatch.mjs';
import { CLOUD_EXECUTION_PROTOCOL } from '../packages/contracts/src/cloud-execution.ts';

const execFile = promisify(callback), directory = await mkdtemp(join(tmpdir(), 'factory-capability-'));
const bin = process.env.CAPABILITY_TEST_POSTGRES_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const socket = join(directory, 'socket'); await mkdir(socket);
let started = false, admin, runtime;
const checks = [];
const check = async (name, action) => { await action(); checks.push(name); console.log(`PASS ${name}`); };
try {
  await execFile(join(bin, 'initdb'), ['-D', join(directory, 'data'), '-U', 'capability_admin', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8']);
  await execFile(join(bin, 'pg_ctl'), ['-D', join(directory, 'data'), '-l', join(directory, 'log'), '-o', `-k ${socket} -h '' -p 55494`, '-w', 'start']); started = true;
  admin = new pg.Pool({ host: socket, port: 55494, user: 'capability_admin', database: 'postgres' });
  for (const name of ['migration', 'enforcement']) await admin.query(await readFile(`docs/capability-control/${name}.sql`, 'utf8'));
  await admin.query('CREATE SCHEMA factory');
  for (const version of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification']) await admin.query(await readFile(`apps/cloud-control/migrations/${version}.sql`, 'utf8'));
  await admin.query('CREATE ROLE capability_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
  await admin.query('GRANT USAGE ON SCHEMA capability_control,factory TO capability_runtime');
  await admin.query('GRANT SELECT ON ALL TABLES IN SCHEMA capability_control TO capability_runtime');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA factory TO capability_runtime');
  await admin.query('GRANT EXECUTE ON FUNCTION capability_control.lock_admission_policy(text,text,text) TO capability_runtime');
  const scope = { ownerId: 'synthetic-factory-owner', organizationId: 'synthetic-organization', installationId: 'synthetic-factory-installation', agentId: 'synthetic-agent', environment: 'qualification' };
  await admin.query('INSERT INTO capability_control.installations VALUES($1,$2,$3,true)', [scope.installationId, scope.organizationId, scope.environment]);
  await admin.query('INSERT INTO capability_control.owner_state(installation_id,owner_id,preferences) VALUES($1,$2,$3)', [scope.installationId, scope.ownerId, { work:'ENABLED', myfactory:'ENABLED' }]);
  const facts = Object.fromEntries(capabilityRegistry.capabilities.map(item => [item.id, { supported:true, deployed:true, entitled:true, administrator:'ALLOW', lifecycle:'ACTIVE', setup:Object.fromEntries(item.setupRequirements.map(k=>[k,true])), qualification:Object.fromEntries(item.qualificationRequirements.map(k=>[k,'QUALIFIED'])) }]));
  await admin.query("INSERT INTO capability_control.evidence VALUES($1,$2,$3,'1',$4,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour','synthetic-relay-policy')", [scope.installationId,scope.organizationId,scope.ownerId,facts]);
  await admin.query("INSERT INTO capability_control.relay_agent_evidence VALUES($1,$2,$3,$4,1,$5,'ACTIVE',clock_timestamp()+interval '1 hour','synthetic-passport')", [scope.installationId,scope.ownerId,scope.organizationId,scope.agentId,JSON.stringify(['work','myfactory'])]);
  runtime = new pg.Pool({ host:socket, port:55494, user:'capability_runtime', database:'postgres' });
  const source={repository:'fixture/quantity',commit:'a'.repeat(40),tree:'b'.repeat(40)};
  const grant={clientId:'synthetic-client',ownerScope:scope.ownerId,source,commands:['node --test'],allowedPaths:['quantity.mjs'],maxDurationMs:120000,maxSpendUsd:1};
  const snapshot=(request,order,run)=>({requestId:request.requestId,workOrderId:order.id,runId:run.id,inputCommit:source.commit,factoryId:'synthetic-factory',factoryVersion:'c'.repeat(64)});
  const input=()=>({protocol:CLOUD_EXECUTION_PROTOCOL,requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:source.repository,source,deadline:new Date(Date.now()+110000).toISOString(),maxSpendUsd:1,input:{title:'Quantity',description:'Qualification only',kind:'feature',acceptanceCriteria:['Pass'],checkCommands:grant.commands,allowedPaths:grant.allowedPaths}});
  const bindings={ [grant.clientId]:scope }, store=new PostgresDispatchStore(runtime,{capabilityBindings:bindings});
  let admitted;
  await check('actual Factory admission checks canonical policy and retains backend authority',async()=>{
    admitted=await store.prepare(grant,input(),snapshot);
    assert.equal(admitted.client_id,grant.clientId);
    assert.equal((await admin.query("SELECT count(*) FROM factory.events WHERE type='factory.capability_admitted'")).rows[0].count,'1');
    const denied=new PostgresDispatchStore(runtime,{capabilityBindings:bindings,assertAuthority:async()=>{throw Error('EXISTING_BACKEND_AUTHORITY_DENIED');}});
    await assert.rejects(denied.prepare(grant,input(),snapshot),/EXISTING_BACKEND_AUTHORITY_DENIED/);
  });
  await check('direct backend call without server installation binding fails closed',async()=>{
    await assert.rejects(new PostgresDispatchStore(runtime).prepare(grant,input(),snapshot),/CAPABILITY_INSTALLATION_UNQUALIFIED/);
    await assert.rejects(store.prepare({...grant,ownerScope:'foreign-owner'},input(),snapshot),/CAPABILITY_INSTALLATION_UNQUALIFIED/);
    await assert.rejects(store.prepare({...grant,ownerScope:'foreign-owner'},admitted.request,snapshot),/CAPABILITY_INSTALLATION_UNQUALIFIED/);
  });
  await check('disable blocks new Factory preparation while exact old replay remains observational',async()=>{
    await admin.query("UPDATE capability_control.owner_state SET preferences=preferences||'{\"myfactory\":\"DISABLED\"}'::jsonb,revision=revision+1");
    await assert.rejects(store.prepare(grant,input(),snapshot),/POLICY_BLOCKED/);
    assert.equal((await store.prepare(grant,admitted.request,snapshot)).run_id,admitted.run_id);
    assert.equal((await admin.query('SELECT count(*) FROM factory.intake_receipts')).rows[0].count,'1');
  });
  await check('backend failure rolls back admission and its capability audit',async()=>{
    await admin.query("UPDATE capability_control.owner_state SET preferences=preferences||'{\"myfactory\":\"ENABLED\"}'::jsonb,revision=revision+1");
    await assert.rejects(store.prepare(grant,input(),()=>({})),/SNAPSHOT_BINDING_MISMATCH/);
    assert.equal((await admin.query("SELECT count(*) FROM factory.events WHERE type='factory.capability_admitted'")).rows[0].count,'1');
  });
  await check('revoked Relay agent policy independently denies direct Factory admission',async()=>{
    await admin.query("UPDATE capability_control.relay_agent_evidence SET status='REVOKED'");
    await assert.rejects(store.prepare(grant,input(),snapshot),/AGENT_POLICY_UNAVAILABLE/);
  });
  await mkdir('docs/capability-control/evidence',{recursive:true});
  await writeFile('docs/capability-control/evidence/postgres.json',JSON.stringify({passed:checks.length,checks,paidOperations:0,productionIntegration:'NOT_RUN'},null,2)+'\n');
} finally {
  await runtime?.end(); await admin?.end();
  if(started) await execFile(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-m','immediate','-w','stop']);
  await rm(directory,{recursive:true,force:true});
}
