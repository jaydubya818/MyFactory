import {handleCloud} from '../api/cloud.mjs';
import {cloudGrant} from '../src/cloud-work-plan.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PostgresDispatchStore } from '../src/postgres-dispatch.mjs';
import { PostgresSpendLedger } from '../src/postgres-spend.mjs';
import { assertStagingEnvironment,databaseConfig,stagingProjectId } from '../src/config.mjs';
import { CLOUD_EXECUTION_PROTOCOL } from '../../../packages/contracts/src/cloud-execution.ts';

test('CONNECTED canonical cloud dispatch admission, concurrency, cancellation and leases',{skip:process.env.FACTORY_POSTGRES_TEST!=='1',timeout:120000},async t=>{
 assertStagingEnvironment(process.env);
 const pool=new pg.Pool({...databaseConfig(process.env.DATABASE_URL_UNPOOLED),max:5});
 assert.equal((await pool.query('SELECT project_id FROM factory.environment WHERE singleton')).rows[0].project_id,stagingProjectId);
 const schema='factory_test_'+randomUUID().replaceAll('-','');await pool.query(`CREATE SCHEMA ${schema}`);
 const isolate=sql=>sql.replace(/\bfactory\.(verification_resources|candidate_custody|delivery_intents|intake_receipts|events|execution_resources|work_orders|runs|work_spend_budgets|work_spend_operations)\b/g,schema+'.$1');
 t.after(async()=>{await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();});
 for(const version of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification']){
  const sql=isolate(await readFile(new URL(`../migrations/${version}.sql`,import.meta.url),'utf8')).replace(/IN SCHEMA factory\b/g,'IN SCHEMA '+schema);await pool.query(sql);await pool.query(sql);
 }
 const query=(sql,args)=>pool.query(isolate(sql),args);
 const isolated={connect:async()=>{const c=await pool.connect();return{query:(sql,args)=>c.query(isolate(sql),args),release:()=>c.release()};}};
 const source={repository:'fixture/quantity',commit:'a'.repeat(40),tree:'b'.repeat(40)};
 const grant={clientId:'staging-client',source,commands:['node --test'],allowedPaths:['quantity.mjs'],maxDurationMs:120000,maxSpendUsd:1};
 const store=new PostgresDispatchStore(isolated),spend=new PostgresSpendLedger(isolated);
 assert.equal(isolate("SELECT * FROM factory.events WHERE type='factory.dispatch_claimed'"),`SELECT * FROM ${schema}.events WHERE type='factory.dispatch_claimed'`);
 const snapshot=(request,order,run)=>({requestId:request.requestId,workOrderId:order.id,runId:run.id,inputCommit:source.commit,factoryId:'factory-staging',factoryVersion:'c'.repeat(64)});
 async function fixture(){
  const input={protocol:CLOUD_EXECUTION_PROTOCOL,requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:source.repository,source,deadline:new Date(Date.now()+110000).toISOString(),maxSpendUsd:1,input:{title:'Quantity',description:'Implement positive integer input.',kind:'feature',acceptanceCriteria:['Visible tests pass'],checkCommands:grant.commands,allowedPaths:grant.allowedPaths}};
  const row=await store.prepare(grant,input,snapshot);
  const identity={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:input.workId,workGeneration:1,factoryId:row.snapshot.factoryId,factoryVersion:row.snapshot.factoryVersion,requestId:input.requestId,workOrderId:row.work_order_id,remoteRunId:row.run_id,repository:input.repository,baseSha:source.commit,allowedPaths:grant.allowedPaths,deadline:input.deadline};
  const binding={workId:input.workId,workGeneration:1,dispatchIdentity:identity.dispatchIdentity,requestId:input.requestId,workOrderId:row.work_order_id,factoryVersion:identity.factoryVersion,runId:row.run_id};
  const plan={version:'WORK_LEDGER_V2',pricingRevision:'fixture',model:'fixture-model',validUntil:input.deadline,perOperationReserveMicrousd:100,plannedProductiveOperations:1,plannedCompletionOperations:1,maxPaidOperations:2,completionReserveMicrousd:100};
  await spend.createBudget(binding,1000000,input.deadline,plan);await spend.bindAuthority(binding);
  return{input,row,identity,binding};
 }
 await t.test('Evidence HTTP detail/read uses real PG identity lookup, durable owner binding and signed receipt',async()=>{
  const input={protocol:CLOUD_EXECUTION_PROTOCOL,requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:source.repository,source,deadline:new Date(Date.now()+110000).toISOString(),maxSpendUsd:1,input:{title:'Evidence',description:'Read-only evidence qualification',kind:'feature',acceptanceCriteria:['Evidence custody'],checkCommands:grant.commands,allowedPaths:grant.allowedPaths}};
  const row=await store.prepare({...grant,clientId:cloudGrant.clientId,ownerScope:'proof-owner'},input,snapshot);
  const bundle={commit:'d'.repeat(40),checks:[{command:'node --test',exitCode:0}],patchBase64:Buffer.from('fixture patch').toString('base64')};
  const finishedAt=new Date().toISOString();
  await store.transaction(async c=>{
   await store.event(c,row,'factory.terminal',{status:'COMPLETED',candidateCommit:bundle.commit,finishedAt});
   await store.event(c,row,'run.signed_result',{encoded:Buffer.from(JSON.stringify({status:'COMPLETED',candidate:{commit:bundle.commit},execution:row.snapshot})).toString('base64url')});
  });
  assert.deepEqual(await store.findRun(cloudGrant.clientId,row.work_order_id,row.run_id),{request_id:row.request_id});
  const proofToken='a'.repeat(64),env={...process.env,FACTORY_PROOF_TOKEN:proofToken,FACTORY_PROOF_OWNER_SCOPE:'proof-owner',FACTORY_PROOF_EXPIRES_AT:new Date(Date.now()+60000).toISOString(),FACTORY_SOFIE_STAGING_TOKEN:'b'.repeat(64)};
  const runtime=async(_env,action)=>action({store:Object.assign(store,{pool:{...isolated,query}}),provider:{readCustody:async()=>bundle},control:{}});
  const get=new Request('https://factory.invalid/api/connect/v2/work-orders/'+row.work_order_id,{headers:{authorization:'Bearer '+proofToken}});
  const response=await handleCloud(get,env,runtime);assert.equal(response.status,200);const refs=(await response.json()).events[0].payload.refs;assert.equal(refs.length,2);
  for(const ref of refs){
   const binding={ownerScope:'proof-owner',repository:source.repository,workId:input.workId,workGeneration:1,requestId:row.request_id,workOrderId:row.work_order_id,runId:row.run_id,candidateCommit:bundle.commit,factoryVersion:row.snapshot.factoryVersion,evidenceKind:ref.kind,expectedDigest:ref.sha256,evidenceReference:ref.proofReference};
   const post=b=>new Request('https://factory.invalid/api/connect/v2/evidence/read',{method:'POST',headers:{authorization:'Bearer '+proofToken,'content-type':'application/json'},body:JSON.stringify(b)});
   assert.equal((await handleCloud(post(binding),env,runtime)).status,200);
   assert.equal((await handleCloud(post({...binding,ownerScope:'other'}),env,runtime)).status,404);
   assert.equal((await handleCloud(post({...binding,workId:randomUUID()}),env,runtime)).status,404);
  }
 });
 await t.test('prepare replay retains canonical IDs; conflicting input and cross-client read fail',async()=>{
  const f=await fixture();assert.equal((await store.prepare(grant,f.input,snapshot)).run_id,f.row.run_id);
  await assert.rejects(store.prepare(grant,{...f.input,maxSpendUsd:0.5},snapshot),/REPLAY_CONFLICT/);
  await assert.rejects(store.read('other-client',f.input.requestId),/NOT_FOUND/);
  await assert.rejects(store.prepare({...grant,clientId:'other-client'},{...f.input,requestId:randomUUID(),workGeneration:2},snapshot),/SCOPE_OR_GENERATION/);
 });
 await t.test('two dispatchers claim once; cancelled late allocation remains recorded without replacement',async()=>{
  const f=await fixture();const second=new PostgresDispatchStore(isolated);
  const results=await Promise.all([store.claim(grant.clientId,f.identity),second.claim(grant.clientId,f.identity)]);
  assert.equal(results.filter(Boolean).length,1);const lease=results.find(Boolean);
  const operation={...f.binding,operationId:randomUUID(),model:'fixture-model',pricingRevision:'fixture',reservedMicrousd:100,phase:'productive'};
  await assert.rejects(spend.reserve(operation),/lease/);
  await store.recordAllocation(f.row.run_id,lease.lease_owner,1,'sbx_lateReceipt');
  await query("UPDATE factory.execution_resources SET state='RUNNING' WHERE run_id=$1",[f.row.run_id]);
  await spend.reserve(operation);
  await store.stop(grant.clientId,f.identity);
  await assert.rejects(store.heartbeat(f.row.run_id,lease.lease_owner,1),/LEASE_FENCED/);
  const observed=await store.recordAllocation(f.row.run_id,lease.lease_owner,1,'sbx_lateReceipt');assert.ok(observed.cancelled_at);
  assert.equal((await second.read(grant.clientId,f.input.requestId)).resource.provider_session_id,'sbx_lateReceipt');
  assert.equal(await second.claim(grant.clientId,f.identity),null);
  assert.equal((await spend.read(f.input.workId)).authorityState,'fenced');
  await assert.rejects(spend.markDispatched(operation.operationId),/cancel|authority/);
  await assert.rejects(spend.reserve({...f.binding,operationId:randomUUID(),model:'fixture-model',pricingRevision:'fixture',reservedMicrousd:100,phase:'productive'}),/cancel|authority/);
  await assert.rejects(store.prepare(grant,{...f.input,requestId:randomUUID(),workGeneration:2},snapshot),/RESOURCE_UNRESOLVED/);
  // Test-only cleanup of isolated fixture rows; never a production reconciliation path.
  await query("UPDATE factory.execution_resources SET cleanup_confirmed=true,state='DESTROYED' WHERE run_id=$1",[f.row.run_id]);
 });
 await t.test('stop before queue delivery creates a durable tombstone and prevents any resource allocation',async()=>{
  const f=await fixture();await store.stop(grant.clientId,f.identity);await store.stop(grant.clientId,f.identity);
  assert.equal(await store.claim(grant.clientId,f.identity),null);
  const read=await store.read(grant.clientId,f.input.requestId);assert.equal(read.resource,null);assert.equal(read.events.filter(e=>e.type==='factory.stop_requested').length,1);
  assert.equal((await store.finalize(grant.clientId,f.input.requestId,'CANCELLED')).status,'CANCELLED');
 });
 await t.test('delivery receipts cannot grant new authority or regress callback-before-send observation',async()=>{
  const f=await fixture(),nonce='1'.repeat(64),deployment='dpl_fixture';
  const reserved=await store.reserveDelivery(grant.clientId,f.identity,deployment,nonce);assert.equal(reserved.created,true);
  const replay=await store.reserveDelivery(grant.clientId,f.identity,deployment,'2'.repeat(64));assert.equal(replay.created,false);
  await assert.rejects(store.acceptDelivery(f.row.run_id,deployment,'2'.repeat(64),'message-1'),/BINDING/);
  await assert.rejects(store.acceptDelivery(f.row.run_id,'dpl_other',nonce,'message-1'),/BINDING/);
  assert.equal((await store.acceptDelivery(f.row.run_id,deployment,nonce,'message-1')).run_id,f.row.run_id);
  await store.recordDeliverySend(f.row.run_id,'message-1');await store.recordDeliverySend(f.row.run_id);
  assert.equal((await query('SELECT state FROM factory.delivery_intents WHERE run_id=$1',[f.row.run_id])).rows[0].state,'DELIVERED');
  await assert.rejects(store.acceptDelivery(f.row.run_id,deployment,nonce,'message-2'),/BINDING/);
  await store.stop(grant.clientId,f.identity);
  assert.equal((await store.acceptDelivery(f.row.run_id,deployment,nonce,'message-1')).run_id,f.row.run_id);
  assert.equal(await store.claim(grant.clientId,f.identity),null);
 });
 await t.test('private custody is immutable, survives cancel/cleanup and never revives execution',async()=>{
  const f=await fixture(),lease=await store.claim(grant.clientId,f.identity),owner=lease.lease_owner;
  const receipt={commit:'c'.repeat(40),tree:'d'.repeat(40),sha256:'e'.repeat(64),bytes:200,pathname:`factory/staging/runs/${f.row.run_id}/${'e'.repeat(64)}.json`};
  await assert.rejects(store.confirmCleanup(f.row.run_id,owner,1,null),/TOO_EARLY/);
  await store.recordAllocation(f.row.run_id,owner,1,'sbx_custody');
  await assert.rejects(store.retainCustody(f.row.run_id,owner,1,receipt),/BEFORE_QUIESCENCE/);
  await assert.rejects(store.advanceResource(f.row.run_id,owner,1,'RUNNING'),/TRANSITION_FENCED/);
  for(const state of ['PREPARING','READY','RUNNING','QUIESCING','COLLECTING'])await store.advanceResource(f.row.run_id,owner,1,state);
  await store.stop(grant.clientId,f.identity);
  await store.retainCustody(f.row.run_id,owner,1,receipt);
  await assert.rejects(store.retainCustody(f.row.run_id,owner,1,{...receipt,bytes:201}),/CONFLICT/);
  await assert.rejects(store.confirmCleanup(f.row.run_id,owner,1,'sbx_other'),/MISMATCH/);
  await store.confirmCleanup(f.row.run_id,owner,1,'sbx_custody');await store.confirmCleanup(f.row.run_id,owner,1,'sbx_custody');
  const read=await store.read(grant.clientId,f.input.requestId);assert.equal(read.custody.artifact_sha256,receipt.sha256);assert.equal(read.resource.cleanup_confirmed,true);
  assert.equal(read.events.filter(e=>e.type==='factory.resource_destroyed').length,1);
  assert.equal((await store.finalize(grant.clientId,f.input.requestId,'COMPLETED')).status,'CANCELLED');
  assert.equal((await store.finalize(grant.clientId,f.input.requestId,'FAILED')).status,'CANCELLED');
  assert.equal((await spend.read(f.input.workId)).authorityState,'fenced');
  await assert.rejects(store.heartbeat(f.row.run_id,owner,1),/FENCED/);
  await assert.rejects(store.advanceResource(f.row.run_id,owner,1,'RUNNING'),/FENCED/);
  assert.equal(await store.claim(grant.clientId,f.identity),null);
 });
 await t.test('database lease expiry cannot be revived; restart reconciles the same ambiguous resource',async()=>{
  const f=await fixture();const lease=await store.claim(grant.clientId,f.identity);
  await assert.rejects(store.finalize(grant.clientId,f.input.requestId,'COMPLETED'),/NOT_QUIESCENT/);
  await query("UPDATE factory.execution_resources SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[f.row.run_id]);
  await assert.rejects(store.heartbeat(f.row.run_id,lease.lease_owner,1),/LEASE_FENCED/);
  await assert.rejects(spend.reserve({...f.binding,operationId:randomUUID(),model:'fixture-model',pricingRevision:'fixture',reservedMicrousd:100,phase:'productive'}),/lease/);
  const restarted=new PostgresDispatchStore(isolated);const resource=await restarted.reconcileExpired(grant.clientId,f.input.requestId);
  assert.equal(resource.provider_name,lease.provider_name);assert.equal(resource.allocation_unknown,true);
  assert.equal(await restarted.claim(grant.clientId,f.identity),null);assert.equal((await spend.read(f.input.workId)).authorityState,'fenced');
  const other=await fixture();await assert.rejects(store.claim(grant.clientId,other.identity),error=>error.code==='23505');
  assert.equal((await store.read(grant.clientId,other.input.requestId)).events.filter(e=>e.type==='factory.dispatch_claimed').length,0);
 });
 await t.test('qualification lifetime limit cannot expand with a fresh request or Work ID',async()=>{
  const count=Number((await query('SELECT count(*) FROM factory.intake_receipts WHERE client_id=$1',[grant.clientId])).rows[0].count);
  for(let i=count;i<8;i++)await fixture();
  await assert.rejects(fixture(),/STAGING_WORK_LIMIT/);
 });

});
