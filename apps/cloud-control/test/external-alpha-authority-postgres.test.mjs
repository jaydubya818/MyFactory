import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,verify} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {ExternalAlphaAuthorityStore,receiptSigner,bindAuthorityEnvelope,RECEIPT_SCHEMA} from '../src/external-alpha-authority.mjs';
import {PostgresDispatchStore} from '../src/postgres-dispatch.mjs';
import {CloudWorkControl} from '../src/cloud-work-control.mjs';
import {PostgresSpendLedger} from '../src/postgres-spend.mjs';
import {productionConfiguration as configuration,productionSpendPlan} from '../src/production-execution-plan.mjs';
import {productionVerifierPolicy as policy,productionVerifierPolicySha256 as policySha256} from '../src/production-verifier-policy.mjs';
import {makeKeys,makeInstallation,build,uuid4} from './fixtures/external-alpha-authority.mjs';

// Real PostgreSQL concurrency. Disposable localhost server only, private schema per run.
const skip=process.env.FACTORY_POSTGRES_TEST!=='1';
const code=async p=>{try{await p;}catch(e){return e.code??e.message;}return 'ACCEPTED';};

async function setup(t){
 const url=new URL(process.env.DATABASE_URL_UNPOOLED);assert(['localhost','127.0.0.1'].includes(url.hostname),'Disposable localhost only');
 const pool=new pg.Pool({connectionString:url.href,max:16}),schema='ea_authority_'+randomUUID().replaceAll('-','');
 await pool.query('CREATE SCHEMA '+schema);
 const rewrite=sql=>sql.replace(/\bfactory\./g,schema+'.').replace(/IN SCHEMA factory\b/g,'IN SCHEMA '+schema);
 const isolated={connect:async()=>{const c=await pool.connect();return {query:(sql,args)=>c.query(rewrite(sql),args),release:()=>c.release()};}};
 const query=(sql,args)=>pool.query(rewrite(sql),args);
 t.after(async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();});
 for(const v of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification','009-paid-operation-release','011-external-alpha-work-authority'])await query(await readFile(new URL('../migrations/'+v+'.sql',import.meta.url),'utf8'));
 const ctx=makeInstallation(),receiptKeys=makeKeys();
 const store=new ExternalAlphaAuthorityStore(isolated,ctx.installation,{signReceipt:receiptSigner(receiptKeys.privateKey.export({type:'pkcs8',format:'pem'}))});
 return {pool,isolated,query,ctx,store,receiptKeys};
}
const count=async(query,where='true')=>Number((await query('SELECT count(*) FROM factory.external_alpha_work_authority WHERE '+where)).rows[0].count);

test('concurrent identical delivery consumes exactly once and every other delivery is an idempotent replay',{skip},async t=>{
 const {store,ctx,query}=await setup(t),a=build(ctx);
 const results=await Promise.all(Array.from({length:12},()=>store.consumeAtomically(a.envelope,a.prepare)));
 assert.equal(results.filter(r=>!r.replayed).length,1);
 assert.equal(results.filter(r=>r.replayed).length,11);
 assert.equal(await count(query),1);
 assert.equal(new Set(results.map(r=>r.row.writer_id)).size,1); // never a second writer
});

test('concurrent competing authorities for one Work generation yield exactly one success',{skip},async t=>{
 const {store,ctx,query}=await setup(t),workId=uuid4();
 // Same Work generation; versions and issue times differ, so ids and digests differ.
 const variants=Array.from({length:10},(_,i)=>build(ctx,{workId,version:1+(i%5),issuedAt:Date.now()+i}));
 const outcomes=await Promise.all(variants.map(v=>code(store.consumeAtomically(v.envelope,v.prepare))));
 assert.equal(outcomes.filter(o=>o==='ACCEPTED').length,1);
 assert.equal(outcomes.filter(o=>o==='AUTHORITY_CONSUMED').length,9);
 assert.equal(await count(query),1);
 // Same authority id with a different digest is a conflict, not a replay.
 const first=variants.find((_,i)=>outcomes[i]==='ACCEPTED');
 const tweak=build(ctx,{workId,version:first.document.work.version,issuedAt:first.issuedAt+5});
 assert.equal(await code(store.consumeAtomically(tweak.envelope,tweak.prepare)),'AUTHORITY_CONSUMED');
 assert.equal(await count(query),1);
});

test('DISTINCT Work admissions all succeed concurrently and none is lost',{skip},async t=>{
 const {store,ctx,query}=await setup(t);
 const many=Array.from({length:8},()=>build(ctx));
 const outcomes=await Promise.all(many.map(v=>code(store.consumeAtomically(v.envelope,v.prepare))));
 assert.deepEqual(outcomes,Array(8).fill('ACCEPTED'));
 assert.equal(await count(query),8);
});

test('a replay after expiry is idempotent but a first delivery after expiry is denied; denied attempts consume nothing',{skip},async t=>{
 const {store,ctx,query,isolated}=await setup(t),a=build(ctx,{issuedAt:Date.now()-400000}),b=build(ctx,{issuedAt:Date.now()-1000,ttl:2000,deadlineMs:1500});
 assert.equal(await code(store.consumeAtomically(a.envelope,a.prepare)),'AUTHORITY_EXPIRED');
 assert.equal(await count(query),0);
 const bad=build(ctx,{post:d=>{d.slot='2';}});
 assert.equal(await code(store.consumeAtomically(bad.envelope,bad.prepare)),'AUTHORITY_OWNER');
 assert.equal(await count(query),0);
 const first=await store.consumeAtomically(b.envelope,b.prepare);assert.equal(first.replayed,false);
 await new Promise(r=>setTimeout(r,2100));
 const again=await store.consumeAtomically(b.envelope,b.prepare);assert.equal(again.replayed,true);
 const client=await isolated.connect();
 try{assert.equal(await code(store.assertPhase(client,{requestId:b.prepare.requestId,workId:b.prepare.workId,workGeneration:1},Date.now(),'dispatch')),'AUTHORITY_EXPIRED');
  assert.equal(await code(store.assertPhase(client,{requestId:b.prepare.requestId,workId:b.prepare.workId,workGeneration:1},Date.now(),'verifier')),'ACCEPTED');}
 finally{client.release();}
});

test('revocation of an authority, a cohort or a key fences consumption and every later phase',{skip},async t=>{
 const {store,ctx,isolated}=await setup(t),a=build(ctx),b=build(ctx),c=build(ctx);
 await store.consumeAtomically(a.envelope,a.prepare);
 const phases=['claim','dispatch','model','heartbeat','verifier'],req=x=>({requestId:x.prepare.requestId,workId:x.prepare.workId,workGeneration:1});
 const check=async(x,phase)=>{const client=await isolated.connect();try{return await code(store.assertPhase(client,req(x),Date.now(),phase));}finally{client.release();}};
 for(const p of phases)assert.equal(await check(a,p),'ACCEPTED');
 await store.revoke('AUTHORITY',a.document.authorityId,'operator');
 for(const p of phases)assert.equal(await check(a,p),'AUTHORITY_REVOKED');
 await store.revoke('KEY',ctx.keys.keyId,'rotated');
 assert.equal(await code(store.consumeAtomically(b.envelope,b.prepare)),'AUTHORITY_REVOKED');
 const other=await setup(t),d=build(other.ctx);
 await other.store.revoke('COHORT',other.ctx.config.cohortId,'stop');
 assert.equal(await code(other.store.consumeAtomically(d.envelope,d.prepare)),'AUTHORITY_REVOKED');
 void c;
});

test('UNKNOWN fences the cohort for paid phases only, and cannot be silently cleared',{skip},async t=>{
 const {store,ctx,isolated,query}=await setup(t),a=build(ctx),b=build(ctx);
 await store.consumeAtomically(a.envelope,a.prepare);
 await store.setState(a.document.authorityId,'UNKNOWN','transport ambiguity');
 const client=await isolated.connect();
 try{
  const r={requestId:a.prepare.requestId,workId:a.prepare.workId,workGeneration:1};
  for(const p of ['claim','dispatch','model'])assert.equal(await code(store.assertPhase(client,r,Date.now(),p)),'AUTHORITY_UNKNOWN_FENCE');
  for(const p of ['heartbeat','verifier'])assert.equal(await code(store.assertPhase(client,r,Date.now(),p)),'ACCEPTED'); // stop/verification stay reachable
 }finally{client.release();}
 assert.equal(await code(store.consumeAtomically(b.envelope,b.prepare)),'AUTHORITY_UNKNOWN_FENCE'); // another Work in the cohort is blocked
 await assert.rejects(query("UPDATE factory.external_alpha_work_authority SET state='CONSUMED' WHERE authority_id=$1",[a.document.authorityId]),/immutable/);
 await assert.rejects(query("UPDATE factory.external_alpha_work_authority SET state='FENCED' WHERE authority_id=$1",[a.document.authorityId]),/immutable/);
});

test('an UNKNOWN spend operation on any cohort Work fences the cohort',{skip},async t=>{
 const {store,ctx,query}=await setup(t),a=build(ctx),b=build(ctx);
 await store.consumeAtomically(a.envelope,a.prepare);
 await seedOperations(query,a,[{state:'unknown',reserved:100000}]);
 assert.equal(await code(store.consumeAtomically(b.envelope,b.prepare)),'AUTHORITY_UNKNOWN_FENCE');
});

async function seedOperations(query,a,ops){
 const id=a.prepare.workId,wo='wo-'+id,run='run-'+id;
 await query("INSERT INTO factory.work_orders(id,record,state) VALUES($1,'{}','queued') ON CONFLICT DO NOTHING",[wo]);
 await query("INSERT INTO factory.runs(id,work_order_id,record,state) VALUES($1,$2,'{}','planning') ON CONFLICT DO NOTHING",[run,wo]);
 await query("INSERT INTO factory.work_spend_budgets(work_id,work_generation,request_id,work_order_id,ceiling_microusd,deadline,created_at,contract_version) VALUES($1,1,$2,$3,1000000,$4,$4,'WORK_LEDGER_V2') ON CONFLICT DO NOTHING",[id,a.prepare.requestId,wo,new Date().toISOString()]);
 let i=Number((await query('SELECT count(*) FROM factory.work_spend_operations WHERE work_id=$1',[id])).rows[0].count);
 for(const o of ops)await query("INSERT INTO factory.work_spend_operations(operation_id,work_id,work_generation,dispatch_identity,request_id,work_order_id,factory_version,run_id,model,pricing_revision,reserved_microusd,actual_microusd,state,created_at,updated_at,phase) VALUES($1,$2,1,'d',$3,$4,'f',$5,'m','p',$6,$7,$8,$9,$9,'productive')",[`op-${id}-${i++}`,id,a.prepare.requestId,wo,run,o.reserved,o.state==='settled'?o.actual??o.reserved:null,o.state,new Date().toISOString()]);
}

test('Factory-side operation and micro-USD ceilings hold regardless of the ledger plan or MyEve',{skip},async t=>{
 const {store,ctx,isolated,query}=await setup(t),a=build(ctx);
 await store.consumeAtomically(a.envelope,a.prepare);
 const bind=(operationId,reservedMicrousd)=>({requestId:a.prepare.requestId,workId:a.prepare.workId,workGeneration:1,operationId,reservedMicrousd});
 const check=async b=>{const c=await isolated.connect();try{return await code(store.assertPaid(c,b));}finally{c.release();}};
 assert.equal(await check(bind('new-0',1000000)),'ACCEPTED'); // exactly at the ceiling
 assert.equal(await check(bind('new-0',1000001)),'AUTHORITY_LIMITS');
 assert.equal(await check(bind('new-0',0)),'AUTHORITY_LIMITS');
 assert.equal(await check({requestId:uuid4(),workId:a.prepare.workId,workGeneration:1,operationId:'x',reservedMicrousd:1}),'AUTHORITY_DISABLED'); // unknown request
 assert.equal(await check({...bind('x',1),workId:uuid4()}),'AUTHORITY_WORK'); // wrong Work
 await seedOperations(query,a,[{state:'settled',reserved:400000,actual:350000},{state:'dispatched',reserved:300000}]); // 650000 used
 assert.equal(await check(bind('new-1',350000)),'ACCEPTED');
 assert.equal(await check(bind('new-1',350001)),'AUTHORITY_LIMITS');
 await seedOperations(query,a,[{state:'released',reserved:50000}]); // a released reservation keeps its operation slot but frees its dollars
 assert.equal(await check(bind('new-2',350000)),'AUTHORITY_LIMITS'); // 4th operation
 const existing=`op-${a.prepare.workId}-1`;
 assert.equal(await check(bind(existing,300000)),'ACCEPTED'); // an existing operation may proceed within the ceiling
});

test('state rows are immutable and revocations are insert-only',{skip},async t=>{
 const {store,ctx,query}=await setup(t),a=build(ctx);
 await store.consumeAtomically(a.envelope,a.prepare);
 const id=a.document.authorityId;
 for(const sql of ["UPDATE factory.external_alpha_work_authority SET document='{}'::jsonb WHERE authority_id=$1","UPDATE factory.external_alpha_work_authority SET max_microusd=1 WHERE authority_id=$1","UPDATE factory.external_alpha_work_authority SET expires_at=expires_at+interval '1 day' WHERE authority_id=$1","DELETE FROM factory.external_alpha_work_authority WHERE authority_id=$1"])
  await assert.rejects(query(sql,[id]),/immutable|cannot be deleted/);
 await assert.rejects(query("INSERT INTO factory.external_alpha_work_authority(authority_id,authority_sha256,idempotency_key,request_id,writer_id,work_id,work_generation,cohort_id,slot,owner_id,policy_sha256,key_id,document,max_operations,max_microusd,expires_at) SELECT $2,authority_sha256,idempotency_key,request_id,writer_id,work_id,work_generation,cohort_id,slot,owner_id,policy_sha256,key_id,document,max_operations,max_microusd,expires_at FROM factory.external_alpha_work_authority WHERE authority_id=$1",[id,randomUUID()]),/unique|duplicate/i);
 await assert.rejects(query("INSERT INTO factory.external_alpha_work_authority(authority_id,authority_sha256,idempotency_key,request_id,writer_id,work_id,work_generation,cohort_id,slot,owner_id,policy_sha256,key_id,document,max_operations,max_microusd,expires_at) SELECT $2,authority_sha256,$3,$4,$5,$6,1,cohort_id,slot,owner_id,policy_sha256,key_id,document,4,max_microusd,expires_at FROM factory.external_alpha_work_authority WHERE authority_id=$1",[id,randomUUID(),'a'.repeat(64),randomUUID(),randomUUID(),randomUUID()]),/check/i); // ceilings are also a database constraint
 await store.setState(id,'REVOKED','operator');
 await assert.rejects(query("UPDATE factory.external_alpha_work_authority SET state='CONSUMED' WHERE authority_id=$1",[id]),/immutable/);
 await assert.rejects(query("UPDATE factory.external_alpha_revocation SET reason='x'"),/insert-only/);
 await assert.rejects(query("DELETE FROM factory.external_alpha_revocation"),/insert-only/);
});

test('readback carries a verifiable receipt on every read and never mints a second one',{skip},async t=>{
 const {store,ctx,isolated,query,receiptKeys}=await setup(t),a=build(ctx);
 await store.consumeAtomically(a.envelope,a.prepare);
 const client=await isolated.connect();
 try{
  let rb=await store.readback(client,a.prepare.requestId);
  assert.equal(rb.authorityReceipt,null); // no WorkOrder yet: nothing is claimed
  const wo='wo-'+a.prepare.workId;
  await query("INSERT INTO factory.work_orders(id,record,state) VALUES($1,'{}','queued')",[wo]);
  await query("INSERT INTO factory.runs(id,work_order_id,record,state) VALUES($1,$2,'{}','planning')",['run-'+wo,wo]);
  await query("INSERT INTO factory.intake_receipts(client_id,request_id,work_id,work_generation,input_digest,work_order_id,run_id,request,snapshot,deadline) VALUES($1,$2,$3,1,$4,$5,$6,'{}','{}',now())",[ctx.config.application.clientId,a.prepare.requestId,a.prepare.workId,'a'.repeat(64),wo,'run-'+wo]);
  rb=await store.readback(client,a.prepare.requestId);const rb2=await store.readback(client,a.prepare.requestId);
  assert.deepEqual(rb,rb2);
  assert.equal(rb.authorityReceipt.workOrderId,wo);assert.equal(rb.authorityReceipt.authoritySha256,a.envelope.authoritySha256);
  assert.equal(verify(null,Buffer.concat([Buffer.from(RECEIPT_SCHEMA),Buffer.from([0]),Buffer.from(digest(rb.authorityReceipt))]),receiptKeys.publicKey,Buffer.from(rb.authorityReceiptSignature,'base64url')),true);
  assert.equal(await store.readback(client,uuid4()),null);
 }finally{client.release();}
});

test('end to end: the real dispatch store admits only through the authority, once; failed admission consumes nothing; revocation fences later phases',{skip},async t=>{
 const {isolated,query,ctx:base,store}=await setup(t);
 const files=[...configuration.allowedPaths].sort(),ctx=makeInstallation(base.keys,{...base.config,checkCommands:[...configuration.commands],source:{...base.config.source,allowedFiles:files}});
 const authority=new ExternalAlphaAuthorityStore(isolated,ctx.installation,{signReceipt:store.signReceipt});
 const s=ctx.config.source,grant={clientId:ctx.config.application.clientId,source:{repository:s.repository,commit:s.baseSha,tree:s.treeSha},commands:configuration.commands,allowedPaths:files,maxDurationMs:300000,maxSpendUsd:1,derivedRequestId:true};
 const dispatch=new PostgresDispatchStore(isolated,{maxWorks:1,custodyPrefix:'factory/production',verificationPolicySha256:policySha256,assertAuthority:authority.assertAuthority()});
 const spend=new PostgresSpendLedger(isolated,{assertPaidAuthority:authority.assertPaidAuthority()});
 const control=new CloudWorkControl({store:dispatch,spend,grant,configuration,sourceDigest:ctx.config.source.sourceDigest,signing:{factoryId:'myfactory-cloud-production'},executionSpendPlan:productionSpendPlan,verificationPolicy:{policy,policySha256}});
 const a=build(ctx,{checkCommands:configuration.commands});
 // No envelope bound to this exact request object: nothing is admitted.
 assert.equal(await code(control.prepare(structuredClone(a.prepare))),'AUTHORITY_DISABLED');
 assert.equal((await query('SELECT count(*) FROM factory.intake_receipts')).rows[0].count,'0');
 // A second Work cannot be admitted (maxWorks=1); its authority is NOT left consumed.
 const first=bindAuthorityEnvelope(a.prepare,a.envelope);
 const [x,y]=await Promise.all([control.prepare(first),control.prepare(first)]);
 assert.equal(x.runId,y.runId);
 assert.equal(await count(query),1);assert.equal((await query('SELECT count(*) FROM factory.intake_receipts')).rows[0].count,'1');
 const b=build(ctx,{checkCommands:configuration.commands});bindAuthorityEnvelope(b.prepare,b.envelope);
 assert.equal(await code(control.prepare(b.prepare)),'STAGING_WORK_LIMIT');
 assert.equal(await count(query),1);
 // The ledger budget is capped by the Factory-side authority, and receipts are readable.
 const client=await isolated.connect();
 try{
  const rb=await authority.readback(client,a.prepare.requestId);assert.equal(rb.authorityReceipt.requestId,a.prepare.requestId);assert.ok(rb.authorityReceiptSignature);
  const row=(await client.query('SELECT request FROM factory.intake_receipts WHERE request_id=$1',[a.prepare.requestId])).rows[0];
  assert.equal(await code(dispatch.transaction((c,now)=>dispatch.assertAuthority(c,row.request,now,'claim'))),'ACCEPTED');
  await authority.revoke('AUTHORITY',a.document.authorityId,'test');
  assert.equal(await code(dispatch.transaction((c,now)=>dispatch.assertAuthority(c,row.request,now,'claim'))),'AUTHORITY_REVOKED');
  assert.equal(await code(dispatch.transaction((c,now)=>dispatch.assertAuthority(c,row.request,now,'model'))),'AUTHORITY_REVOKED');
 }finally{client.release();}
});

// C2: the spend UNKNOWN transition fences the cohort in the SAME transaction, under the same lock order as admission.
const GLOBAL_LOCK='SELECT pg_advisory_xact_lock(81427603)';
async function inTx(isolated,fn){const c=await isolated.connect();try{await c.query('BEGIN');await c.query(GLOBAL_LOCK);const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}

test('spend UNKNOWN fences the owning cohort atomically; later admissions are denied and the fence is never cleared',{skip},async t=>{
 const {store,ctx,isolated,query}=await setup(t),a=build(ctx),b=build(ctx);
 await store.consumeAtomically(a.envelope,a.prepare);
 await inTx(isolated,c=>store.fenceUnknownSpend()(c,[a.prepare.workId]));
 assert.equal((await query('SELECT state,state_reason FROM factory.external_alpha_work_authority WHERE authority_id=$1',[a.document.authorityId])).rows[0].state,'FENCED');
 assert.equal(await code(store.consumeAtomically(b.envelope,b.prepare)),'AUTHORITY_UNKNOWN_FENCE');
 assert.equal(await count(query),1);
 await assert.rejects(query("UPDATE factory.external_alpha_work_authority SET state='CONSUMED' WHERE authority_id=$1",[a.document.authorityId]),/immutable|fence/i);
 // unknown work ids are a no-op, not a fence of someone else
 await inTx(isolated,c=>store.fenceUnknownSpend()(c,[uuid4()]));
 assert.equal(await count(query,"state='FENCED'"),1);
});

test('fence takes the cohort lock: it waits for an in-flight admission and no admission can slip past it',{skip},async t=>{
 const {store,ctx,isolated,query}=await setup(t),a=build(ctx);
 await store.consumeAtomically(a.envelope,a.prepare);
 const holder=await isolated.connect();
 try{
  await holder.query('BEGIN');await holder.query(GLOBAL_LOCK);
  await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('external-alpha-cohort:'||$1::text,0))",[ctx.config.cohortId]);
  let done=false;
  const fence=inTx(isolated,c=>store.fenceUnknownSpend()(c,[a.prepare.workId])).then(()=>{done=true;});
  await new Promise(r=>setTimeout(r,400));
  assert.equal(done,false,'fence must wait for the cohort lock');
  await holder.query('COMMIT');await fence;assert.equal(done,true);
 }finally{holder.release();}
 assert.equal(await count(query,"state='FENCED'"),1);
});

test('racing admissions against the fence: every admission is either before the fence or denied by it',{skip},async t=>{
 const {store,ctx,isolated,query}=await setup(t),seed=build(ctx);
 await store.consumeAtomically(seed.envelope,seed.prepare);
 const racers=Array.from({length:10},()=>build(ctx));
 const [,...outcomes]=await Promise.all([inTx(isolated,c=>store.fenceUnknownSpend()(c,[seed.prepare.workId])),...racers.map(r=>code(store.consumeAtomically(r.envelope,r.prepare)))]);
 assert.ok(outcomes.every(o=>['ACCEPTED','AUTHORITY_UNKNOWN_FENCE'].includes(o)),outcomes.join());
 // After the fence committed, nothing more is admitted.
 const late=build(ctx);assert.equal(await code(store.consumeAtomically(late.envelope,late.prepare)),'AUTHORITY_UNKNOWN_FENCE');
 assert.equal(await count(query,"state='FENCED'")>=1,true);
 assert.equal(await count(query),1+outcomes.filter(o=>o==='ACCEPTED').length);
});
