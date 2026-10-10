import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PostgresDispatchStore} from '../src/postgres-dispatch.mjs';
import {PostgresSpendLedger} from '../src/postgres-spend.mjs';
import {CloudWorkControl} from '../src/cloud-work-control.mjs';
import {capabilityPolicyFixture} from './fixtures/capability-policy.mjs';

test('LOCAL production race: real claim defaults, concurrent status read, zero model ledger and expiry fence',
 {skip:!process.env.FACTORY_PAID_TEST_DATABASE_URL},async t=>{
 const url=new URL(process.env.FACTORY_PAID_TEST_DATABASE_URL);assert(['localhost','127.0.0.1'].includes(url.hostname));
 const pool=new pg.Pool({connectionString:url.href}),schema='startup_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);
 const rewrite=s=>s.replace(/\bfactory\.(execution_resources|verification_resources|candidate_custody|delivery_intents|intake_receipts|events|work_orders|runs|work_spend_budgets|work_spend_operations)\b/g,schema+'.$1').replaceAll('IN SCHEMA factory','IN SCHEMA '+schema),query=(s,a)=>pool.query(rewrite(s),a);
 const isolated={connect:async()=>{const c=await pool.connect();return{query:(s,a)=>c.query(rewrite(s),a),release:()=>c.release()};}};
 let capability;
 t.after(async()=>{await capability?.cleanup();await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();});
 for(const version of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification'])await query(await readFile(new URL('../migrations/'+version+'.sql',import.meta.url),'utf8'));
 const source={repository:'fixture/producer',commit:'a'.repeat(40),tree:'b'.repeat(40)},grant={clientId:'sofie-alpha-a',ownerScope:'synthetic-startup-owner',source,commands:['node --test'],allowedPaths:['fixture.mjs'],maxDurationMs:180000,maxSpendUsd:1};
 const input={protocol:'MYFACTORY_EXECUTION_V2',requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:source.repository,source,deadline:new Date(Date.now()+170000).toISOString(),maxSpendUsd:1,input:{title:'Startup projection',description:'Disposable deterministic race reproduction',kind:'feature',acceptanceCriteria:['Pending is not UNKNOWN'],checkCommands:grant.commands,allowedPaths:grant.allowedPaths}};
 capability=await capabilityPolicyFixture(pool,schema,isolated,{[grant.clientId]:grant.ownerScope});
 const store=new PostgresDispatchStore(capability.pool,{capabilityBindings:capability.bindings}),spend=new PostgresSpendLedger(capability.pool);
 const row=await store.prepare(grant,input,(request,order,run)=>({requestId:request.requestId,workOrderId:order.id,runId:run.id,inputCommit:source.commit,factoryId:'fixture',factoryVersion:'c'.repeat(64)}));
 const identity={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:input.workId,workGeneration:1,factoryId:'fixture',factoryVersion:'c'.repeat(64),requestId:input.requestId,workOrderId:row.work_order_id,remoteRunId:row.run_id,repository:input.repository,baseSha:source.commit,allowedPaths:grant.allowedPaths,deadline:input.deadline};
 const binding={workId:identity.workId,workGeneration:identity.workGeneration,requestId:identity.requestId,workOrderId:identity.workOrderId,runId:row.run_id,dispatchIdentity:identity.dispatchIdentity,factoryVersion:identity.factoryVersion};
 await spend.createBudget(binding,1000000,input.deadline,{version:'WORK_LEDGER_V2',pricingRevision:'fixture',model:'fixture-model',validUntil:input.deadline,perOperationReserveMicrousd:100,plannedProductiveOperations:1,plannedCompletionOperations:1,maxPaidOperations:2,completionReserveMicrousd:100});await spend.bindAuthority(binding);
 const claimed=await store.claim(grant.clientId,identity);assert.equal(claimed.state,'ALLOCATING');assert.equal(claimed.allocation_unknown,true);
 const control=new CloudWorkControl({store,spend,grant});
 const observations=await Promise.all([control.read(input.requestId),control.result(input.requestId)]);for(const observation of observations)assert.equal(observation.state,'RUNNING');
 assert.equal((await store.claim(grant.clientId,identity)),null);assert.equal((await spend.read(input.workId)).operations.length,0);
 await store.recordAllocation(row.run_id,claimed.lease_owner,claimed.lease_generation,'sbx_fixture');await store.advanceResource(row.run_id,claimed.lease_owner,claimed.lease_generation,'PREPARING');
 assert.equal((await control.read(input.requestId)).state,'RUNNING');
 await query("UPDATE factory.execution_resources SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[row.run_id]);
 assert.equal((await control.read(input.requestId)).state,'UNKNOWN');assert.equal((await spend.read(input.workId)).operations.length,0);
 await assert.rejects(store.advanceResource(row.run_id,claimed.lease_owner,claimed.lease_generation,'READY'),/FENCED/);
});
