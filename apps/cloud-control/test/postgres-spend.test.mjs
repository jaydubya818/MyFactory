import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresSpendLedger } from '../src/postgres-spend.mjs';
import { SpendLedger } from '../../../packages/storage/src/spend.ts';
import { openStorage } from '../../../packages/storage/src/index.ts';
import { assertStagingEnvironment,databaseConfig,stagingProjectId } from '../src/config.mjs';

test('CONNECTED PostgreSQL canonical ledger parity, race, recovery and fencing', {skip:process.env.FACTORY_POSTGRES_TEST!=='1',timeout:120000},async t=>{
  assertStagingEnvironment(process.env);
  const pool=new pg.Pool({...databaseConfig(process.env.DATABASE_URL_UNPOOLED),max:5});
  const marker=(await pool.query('SELECT * FROM factory.environment WHERE singleton')).rows[0];assert.equal(marker.project_id,stagingProjectId);
  const schema='factory_test_'+randomUUID().replaceAll('-','');
  assert.match(schema,/^factory_test_[a-f0-9]{32}$/);
  await pool.query(`CREATE SCHEMA ${schema}`);
  t.after(async()=>{await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();});
  const sql=(await readFile(new URL('../migrations/002-canonical-execution-ledger.sql',import.meta.url),'utf8')).replace(/\bfactory\b/g,schema);
  await pool.query(sql);await pool.query(sql); // Explicit idempotence before adoption.
  // Test-only SQL namespace rewriting keeps all fixtures out of authoritative tables.
  const isolated={connect:async()=>{const c=await pool.connect();return{query:(sql,args)=>c.query(sql.replaceAll('factory.',schema+'.'),args),release:()=>c.release()};}};
  const query=(sql,args)=>pool.query(sql.replaceAll('factory.',schema+'.'),args);
  const dir=await mkdtemp(join(tmpdir(),'factory-pg-parity-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let serial=0;
  async function fixture({productive=2,completion=1,ceiling=4000,reserve=1200}={}){
    const database=join(dir,`${serial++}.sqlite`),storage=openStorage(database);
    const order=storage.createWorkOrder({title:'Parity fixture',description:'Synthetic; never dispatched',kind:'feature',repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['policy parity'],reproductionCommand:null,expectedFailureText:null,checkCommands:[],allowedPaths:['fixture.txt'],workerProfile:'mac'});
    const run=storage.createRun({workOrderId:order.id,workerProfile:'mac',inputCommit:'a'.repeat(40),workspacePath:dir});
    const local=new SpendLedger(database);t.after(()=>{local.close();storage.close();});
    await query("INSERT INTO factory.work_orders(id,record,state) VALUES ($1,$2,'queued')",[order.id,JSON.stringify(order)]);
    await query("INSERT INTO factory.runs(id,work_order_id,record,state) VALUES ($1,$2,$3,'planning')",[run.id,order.id,JSON.stringify(run)]);
    const remote=new PostgresSpendLedger(isolated),id=randomUUID();
    const binding={workId:id,workGeneration:1,dispatchIdentity:randomUUID(),requestId:randomUUID(),workOrderId:order.id,factoryVersion:'qualified-fixture',runId:run.id};
    const deadline=new Date(Date.now()+90000).toISOString();
    const plan={version:'WORK_LEDGER_V2',pricingRevision:'fixture-v1',model:'fixture-model',validUntil:deadline,perOperationReserveMicrousd:reserve,plannedProductiveOperations:productive,plannedCompletionOperations:completion,maxPaidOperations:productive+completion,completionReserveMicrousd:reserve*completion};
    for(const ledger of [local,remote]){await ledger.createBudget(binding,ceiling,deadline,plan);await ledger.bindAuthority(binding);}
    const reservation=(id,phase='productive')=>({...binding,operationId:id,model:plan.model,pricingRevision:plan.pricingRevision,reservedMicrousd:reserve,phase});
    const both=async(method,...args)=>{const l=local[method](...args);const r=await remote[method](...args);assert.deepEqual(r,l);assert.deepEqual(await remote.read(id),local.read(id));return r;};
    return{local,remote,binding,plan,deadline,reservation,both};
  }
  await t.test('identical V2 accounting through checkpoint, repair allowance and completion',async()=>{
    const f=await fixture();
    for(const id of ['first','repair']){await f.both('reserve',f.reservation(f.binding.workId+id));await f.both('markDispatched',f.binding.workId+id);await f.both('settle',f.binding.workId+id,30,f.binding.workId+'provider-'+id,{input_tokens:10,output_tokens:10});}
    await assert.rejects(f.remote.reserve(f.reservation(randomUUID())),/limit/);
    await f.both('beginCompletion',f.binding);
    await assert.rejects(f.remote.reserve(f.reservation(randomUUID())),/phase/);
    const id=randomUUID();await f.both('reserve',f.reservation(id,'completion'));await f.both('markDispatched',id);await f.both('settle',id,30,'p-'+id,{input_tokens:10,output_tokens:10});await f.both('assertCompleted',f.binding);
  });
  await t.test('two connections racing for the last productive slot admit exactly one',async()=>{
    const f=await fixture({productive:1});
    const other=new PostgresSpendLedger(isolated);
    const outcomes=await Promise.allSettled([f.remote.reserve(f.reservation(randomUUID())),other.reserve(f.reservation(randomUUID()))]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal((await f.remote.read(f.binding.workId)).paidOperationsUsed,1);
    const admitted=outcomes.find(x=>x.status==='fulfilled').value.operationId;
    await assert.rejects(other.reserve(f.reservation(admitted)),/replay/);
    await f.remote.markDispatched(admitted);await assert.rejects(other.markDispatched(admitted),/fresh/);
  });
  await t.test('UNKNOWN persists across connection restart and generation changes',async()=>{
    const f=await fixture(),id=randomUUID();await f.remote.reserve(f.reservation(id));await f.remote.markDispatched(id);await f.remote.markUnknown(id);
    const restarted=new PostgresSpendLedger(isolated);
    await assert.rejects(restarted.reserve(f.reservation(randomUUID())),/UNKNOWN/);
    const next={...f.binding,workGeneration:2,requestId:randomUUID()};await restarted.createBudget(next,4000,f.deadline,f.plan);await restarted.bindAuthority(next);
    await assert.rejects(restarted.reserve({...f.reservation(randomUUID()),...next}),/UNKNOWN/);
    assert.equal((await restarted.read(next.workId)).unknownExposureMicrousd,1200);
    assert.equal(await restarted.fenceAuthority(f.binding),false);
    await assert.rejects(restarted.cancelBound(f.binding),/Stale/);
  });
  await t.test('cancel after reservation prevents dispatch, and stale writers cannot spend',async()=>{
    const f=await fixture(),id=randomUUID();await f.remote.reserve(f.reservation(id));await f.remote.cancelBound(f.binding);
    await assert.rejects(f.remote.markDispatched(id),/cancel|authority/);
    await assert.rejects(f.remote.reserve(f.reservation(randomUUID())),/cancel|authority/);
    assert.equal((await f.remote.read(f.binding.workId)).retainedMicrousd,1200);
  });
  await t.test('database time denies expired pricing and recovery keeps unsettled exposure',async()=>{
    const f=await fixture(),id=randomUUID();await f.remote.reserve(f.reservation(id));
    await query("UPDATE factory.work_spend_budgets SET pricing_valid_until=(clock_timestamp()-interval '1 second')::text WHERE work_id=$1",[f.binding.workId]);
    await assert.rejects(f.remote.markDispatched(id),/pricing/);
    assert.ok(await f.remote.recoverUnknown()>=1);
    assert.equal((await f.remote.read(f.binding.workId)).unknownExposureMicrousd,1200);
    await assert.rejects(f.remote.settle(id,1201,'too-high',{input_tokens:1,output_tokens:1}),/exceeded/);
    assert.equal((await f.remote.getOperation(id)).state,'unknown');
  });
});
