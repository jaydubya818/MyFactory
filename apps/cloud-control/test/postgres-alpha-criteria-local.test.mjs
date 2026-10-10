import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PostgresDispatchStore} from '../src/postgres-dispatch.mjs';
import {PostgresVerificationStore} from '../src/postgres-verification.mjs';
import {alphaTasksVerificationPolicy as cloudVerifierPolicy,alphaTasksVerificationPolicySha256 as cloudVerifierPolicySha256} from '../src/external-alpha-verifier.mjs';
const localDatabase=process.env.FACTORY_LOCAL_QE_DATABASE;
if(localDatabase && !/^postgresql:\/\/ux_fixture:local-only@localhost:(55491|55591)\/blocker_fixes$/.test(localDatabase))throw Error('Dedicated local QE fixture required');

test('Local PostgreSQL criterion evidence, admission, fencing and cleanup',{skip:!localDatabase,timeout:120000},async t=>{
 const pool=new pg.Pool({connectionString:localDatabase,max:5});
 const schema='factory_test_'+randomUUID().replaceAll('-','');await pool.query(`CREATE SCHEMA ${schema}`);
 const isolate=sql=>sql.replace(/\bfactory\.(verification_resources|candidate_custody|delivery_intents|intake_receipts|events|execution_resources|work_orders|runs|work_spend_budgets|work_spend_operations)\b/g,schema+'.$1');
 t.after(async()=>{await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();});
 for(const version of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification']){
  const sql=isolate(await readFile(new URL(`../migrations/${version}.sql`,import.meta.url),'utf8')).replace(/IN SCHEMA factory\b/g,'IN SCHEMA '+schema);await pool.query(sql);await pool.query(sql);
 }
 const query=(sql,args)=>pool.query(isolate(sql),args);
 const isolated={connect:async()=>{const c=await pool.connect();return{query:(sql,args)=>c.query(isolate(sql),args),release:()=>c.release()};}};
 const dispatch=new PostgresDispatchStore(isolated,{verificationPolicySha256:cloudVerifierPolicySha256}),store=new PostgresVerificationStore(dispatch,{policy:cloudVerifierPolicy,policySha256:cloudVerifierPolicySha256});
 // Isolated database fixtures establish only the already-tested producer
 // admission/custody preconditions. No provider allocation or model operation.
 async function fixture(){
  const run=randomUUID(),order=randomUUID(),request=randomUUID(),work=randomUUID(),deadline=new Date(Date.now()+120000).toISOString();
  await query("INSERT INTO factory.work_orders(id,record,state) VALUES($1,'{}','verifying')",[order]);
  await query("INSERT INTO factory.runs(id,work_order_id,record,state) VALUES($1,$2,'{}','verifying')",[run,order]);
  await query('INSERT INTO factory.intake_receipts(client_id,request_id,work_id,work_generation,input_digest,work_order_id,run_id,request,snapshot,deadline,identity) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)',['fixture',request,work,'a'.repeat(64),order,run,{}, {configuration:{cloud:{verificationPolicySha256:cloudVerifierPolicySha256}}},deadline,{workId:work}]);
  await query("INSERT INTO factory.execution_resources(run_id,provider_name,state,lease_owner,lease_expires_at,deadline,cleanup_confirmed,evidence) VALUES($1,$2,'DESTROYED',$3,$4,$4,true,$5)",[run,'factory-run-'+run,randomUUID(),deadline,{visibleChecksPassed:true}]);
  await query('INSERT INTO factory.candidate_custody(run_id,candidate_commit,candidate_tree,artifact_sha256,artifact_bytes,artifact_path) VALUES($1,$2,$3,$4,10,$5)',[run,'a'.repeat(40),'b'.repeat(40),'c'.repeat(64),'fixture/'+run]);
  return{run,request};
 }
 const pass=cloudVerifierPolicy.checks.map(c=>({id:c.id,result:'PASS',reportSha256:'d'.repeat(64)}));
 await t.test('one concurrent claim, exact policy pin and immutable provider identity',async()=>{
  const f=await fixture(),claims=await Promise.all([store.claim('fixture',f.request),store.claim('fixture',f.request)]);
  assert.equal(claims.filter(c=>c.created).length,1);assert.equal(claims[0].record.lease_owner,claims[1].record.lease_owner);
  const r=claims[0].record;await store.assertActive(f.run,r.lease_owner,'ALLOCATING');await store.allocated(f.run,r.lease_owner,'sbx_verifier');
  await assert.rejects(store.allocated(f.run,r.lease_owner,'sbx_other'),/RECEIPT_CONFLICT/);
  await assert.rejects(store.read('other-client',f.request),/NOT_FOUND/);
  await assert.rejects(store.finish(f.run,r.lease_owner,pass.slice(1)),/CHECK_BINDING/);
  await store.finish(f.run,r.lease_owner,pass);await store.allocated(f.run,r.lease_owner,'sbx_verifier');
  assert.equal((await store.read('fixture',f.request)).state,'FINISHED');
  await store.cleanup(f.run,r.lease_owner,'sbx_verifier');assert.equal((await store.claim('fixture',f.request)).created,false);
  const result=await store.read('fixture',f.request);assert.equal(result.outcome,'PASS');assert.equal(result.cleanup_confirmed,true);
 });
 await t.test('missing, substituted and contradictory report evidence is rejected; nine PASS outcomes remain nine',async()=>{
  const f=await fixture(),r=(await store.claim('fixture',f.request)).record;await store.allocated(f.run,r.lease_owner,'sbx_criteria');
  const missing=pass.map(({reportSha256,...check})=>check);
  await assert.rejects(store.finish(f.run,r.lease_owner,missing),/REPORT_BINDING/);
  const substituted=structuredClone(pass);substituted[0].reportSha256='e'.repeat(64);
  await assert.rejects(store.finish(f.run,r.lease_owner,substituted),/REPORT_BINDING/);
  const mixed=structuredClone(pass);mixed[9].result='FAIL';
  await assert.rejects(store.finish(f.run,r.lease_owner,mixed),/REPORT_BINDING/);
  mixed.at(-1).result='FAIL';await store.finish(f.run,r.lease_owner,mixed);
  const saved=await store.read('fixture',f.request);
  assert.equal(saved.outcome,'FAIL');assert.deepEqual(saved.checks,mixed);
  assert.equal(saved.checks.slice(0,10).filter(c=>c.result==='PASS').length,9);
  await store.cleanup(f.run,r.lease_owner,'sbx_criteria');
 });
 await t.test('producer presence, unpinned policy and cancellation deny verifier admission',async()=>{
  const f=await fixture();await query('UPDATE factory.execution_resources SET cleanup_confirmed=false WHERE run_id=$1',[f.run]);
  await assert.rejects(store.claim('fixture',f.request),/ADMISSION_DENIED/);
  await query('UPDATE factory.execution_resources SET cleanup_confirmed=true WHERE run_id=$1',[f.run]);
  await query("UPDATE factory.intake_receipts SET snapshot='{}' WHERE run_id=$1",[f.run]);await assert.rejects(store.claim('fixture',f.request),/ADMISSION_DENIED/);
  await query('UPDATE factory.intake_receipts SET snapshot=$2 WHERE run_id=$1',[f.run,{configuration:{cloud:{verificationPolicySha256:cloudVerifierPolicySha256}}}]);
  await dispatch.transaction(async client=>dispatch.event(client,await dispatch.record(client,'fixture',f.request),'factory.stop_requested',{}));
  await assert.rejects(store.claim('fixture',f.request),/AUTHORITY_FENCED/);
 });
 await t.test('cancellation races late success; cleanup cannot authorize a result',async()=>{
  const f=await fixture(),r=(await store.claim('fixture',f.request)).record;await store.allocated(f.run,r.lease_owner,'sbx_cancelled');
  await dispatch.transaction(async client=>dispatch.event(client,await dispatch.record(client,'fixture',f.request),'factory.stop_requested',{}));
  await assert.rejects(store.assertActive(f.run,r.lease_owner),/LEASE_FENCED/);await assert.rejects(store.finish(f.run,r.lease_owner,pass),/LEASE_FENCED/);
  await store.cleanup(f.run,r.lease_owner,'sbx_cancelled');assert.equal((await store.read('fixture',f.request)).outcome,'UNKNOWN');
 });
 await t.test('lost allocation receipt cannot establish early absence or allocate again',async()=>{
  const f=await fixture(),r=(await store.claim('fixture',f.request)).record;
  await store.failed(f.run,r.lease_owner,'VERIFIER_EXECUTION_UNKNOWN');
  await assert.rejects(store.cleanup(f.run,r.lease_owner,null),/CLEANUP_UNPROVEN/);
  await query("UPDATE factory.verification_resources SET deadline=clock_timestamp()-interval '31 seconds' WHERE run_id=$1",[f.run]);
  await store.cleanup(f.run,r.lease_owner,null);assert.equal((await store.claim('fixture',f.request)).created,false);
  assert.equal((await store.read('fixture',f.request)).outcome,'UNKNOWN');
 });
 await t.test('deadline and malformed checks fence results',async()=>{
  const f=await fixture(),r=(await store.claim('fixture',f.request)).record;await store.allocated(f.run,r.lease_owner,'sbx_expired');
  await assert.rejects(store.finish(f.run,r.lease_owner,[...pass.slice(1),pass[0]]),/CHECK_BINDING/);
  await query("UPDATE factory.verification_resources SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[f.run]);
  await assert.rejects(store.finish(f.run,r.lease_owner,pass),/LEASE_FENCED/);
  await store.cleanup(f.run,r.lease_owner,'sbx_expired');
 });
 await t.test('terminal Result waits for independent cleanup and retains failed protected verdict',async()=>{
  const f=await fixture(),r=(await store.claim('fixture',f.request)).record;await store.allocated(f.run,r.lease_owner,'sbx_final');
  const checks=structuredClone(pass);checks[0].result='FAIL';checks.at(-1).result='FAIL';await store.finish(f.run,r.lease_owner,checks);
  await assert.rejects(dispatch.finalize('fixture',f.request,'COMPLETED'),/CLEANUP_UNPROVEN/);
  await store.cleanup(f.run,r.lease_owner,'sbx_final');
  const terminal=await dispatch.finalize('fixture',f.request,'COMPLETED');
  assert.equal(terminal.status,'COMPLETED');assert.equal(terminal.protectedVerification,'FAIL');
 });
});
