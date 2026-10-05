import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PostgresSpendLedger} from '../src/postgres-spend.mjs';
import {SpendGateway} from '../../supervisor/src/spend-gateway.ts';

// All upstream effects are injected. Only a disposable localhost database is permitted.
test('LOCAL PostgreSQL paid ambiguity faults A–L; real paid operations = 0',
 {skip:!process.env.FACTORY_PAID_TEST_DATABASE_URL,timeout:120000},async t=>{
 const url=new URL(process.env.FACTORY_PAID_TEST_DATABASE_URL);
 assert(['127.0.0.1','localhost'].includes(url.hostname));
 const pool=new pg.Pool({connectionString:url.href,max:8});
 const schema='paid_fault_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);
 const rewrite=sql=>sql.replaceAll('factory.',schema+'.').replaceAll('IN SCHEMA factory','IN SCHEMA '+schema);
 const query=(sql,args)=>pool.query(rewrite(sql),args);
 const isolated={connect:async()=>{const c=await pool.connect();return{query:(sql,args)=>c.query(rewrite(sql),args),release:()=>c.release()};}};
 t.after(async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();});
 for(const name of ['002-canonical-execution-ledger','009-paid-operation-release'])await query(await readFile(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
 async function fixture(){
  const binding={workId:randomUUID(),workGeneration:1,requestId:randomUUID(),workOrderId:randomUUID(),runId:randomUUID(),dispatchIdentity:randomUUID(),factoryVersion:'f'.repeat(64)};
  await query("INSERT INTO factory.work_orders(id,record,state) VALUES($1,'{}','queued')",[binding.workOrderId]);
  await query("INSERT INTO factory.runs(id,work_order_id,record,state) VALUES($1,$2,'{}','planning')",[binding.runId,binding.workOrderId]);
  const ledger=new PostgresSpendLedger(isolated,{requireExecutionLease:false});
  const price={revision:'disposable-price',model:'fixture-model',validUntil:new Date(Date.now()+600000).toISOString(),contextLimitTokens:1000,outputLimitTokens:100,inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:1000000};
  const plan={version:'WORK_LEDGER_V2',pricingRevision:price.revision,model:price.model,validUntil:price.validUntil,perOperationReserveMicrousd:1100,plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:1100};
  const deadline=new Date(Date.now()+120000).toISOString();
  await ledger.createBudget(binding,3300,deadline,plan);await ledger.bindAuthority(binding);
  const operationId=randomUUID(),childToken='a'.repeat(64);let calls=0;
  const request=(extra={})=>new Request('https://fixture.invalid/v1/responses',{method:'POST',headers:{authorization:'Bearer '+childToken},body:JSON.stringify({model:price.model,input:'disposable qualification',...extra})});
  const response=()=>Response.json({id:'provider-'+operationId,status:'completed',usage:{input_tokens:10,output_tokens:10},output:[]});
  const gateway=(fault,options={})=>new SpendGateway({ledger,binding,price,childToken,phase:'productive',operationId,upstreamOrigin:'https://fixture.invalid',upstreamApiKey:'disposable-not-a-credential',upstreamFetch:async()=>{calls++;return fault?fault():response();},...options});
  const reservation=(id=operationId)=>({...binding,operationId:id,model:price.model,pricingRevision:price.revision,reservedMicrousd:1100,phase:'productive'});
  const state=()=>ledger.read(binding.workId);
  const blocked=async()=>{assert.notEqual((await gateway().fetch(request())).status,200);await assert.rejects(ledger.beginCompletion(binding));};
  return{ledger,binding,plan,deadline,operationId,gateway,request,reservation,state,blocked,calls:()=>calls};
 }
 await t.test('A denied before dispatch: no exposure',async()=>{
  const f=await fixture();await f.ledger.cancelBound(f.binding);await f.blocked();assert.equal(f.calls(),0);assert.equal((await f.state()).retainedMicrousd,0);
 });
 await t.test('B settled once; duplicate controller delivery after success cannot spend again',async()=>{
  const f=await fixture();assert.equal((await f.gateway().fetch(f.request())).status,200);assert.equal((await f.state()).settledMicrousd,20);
  assert.notEqual((await f.gateway().fetch(f.request())).status,200);assert.equal(f.calls(),1);assert.equal((await f.state()).operations.length,1);
 });
 await t.test('C definite pre-dispatch cancellation releases only a reserved operation',async()=>{
  const f=await fixture();const original=f.ledger.markDispatched.bind(f.ledger);
  f.ledger.markDispatched=async id=>{await f.ledger.cancelBound(f.binding);return original(id);};
  assert.notEqual((await f.gateway().fetch(f.request())).status,200);assert.equal(f.calls(),0);
  const s=await f.state();assert.equal(s.operations[0].state,'released');assert.equal(s.retainedMicrousd,0);assert.equal(s.paidOperationsUsed,1);
 });
 for(const [label,fault] of [
  ['D timeout after boundary',()=>{throw new DOMException('fixture timeout','TimeoutError');}],
  ['E successful response with interrupted body',()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"status":"completed"'));c.error(Error('fixture disconnect'));}}))],
  // Production has no qualified authoritative no-generation error contract.
  // An HTTP error claiming zero generation is insufficient to release exposure.
  ['G unqualified provider no-generation claim',()=>Response.json({error:'no generation',usage:0},{status:429})],
 ])await t.test(label+': UNKNOWN, no retry, no release, no completion',async()=>{
  const f=await fixture();assert.notEqual((await f.gateway(fault).fetch(f.request())).status,200);
  assert.equal((await f.state()).unknownExposureMicrousd,1100);await f.blocked();assert.equal(f.calls(),1);
  await assert.rejects(f.ledger.releaseUndispatched(f.operationId),/not proven/);
 });
 await t.test('F crash after dispatch; independent ledger connection cannot spend and reconciliation is accounting-only',async()=>{
  const f=await fixture();await f.ledger.reserve(f.reservation());await f.ledger.markDispatched(f.operationId);
  const restart=new PostgresSpendLedger(isolated,{requireExecutionLease:false});
  await assert.rejects(restart.reserve(f.reservation(randomUUID())),/Unresolved/);await restart.recoverUnknown();
  assert.equal((await f.state()).unknownExposureMicrousd,1100);
  await assert.rejects(restart.createBudget({...f.binding,workGeneration:2,requestId:randomUUID()},3300,f.deadline,f.plan),/active spend/);
  await restart.fenceAuthority(f.binding);
  await restart.settle(f.operationId,20,'authoritative-fixture-operation',{input_tokens:10,output_tokens:10});
  assert.equal((await f.state()).settledMicrousd,20);assert.equal((await f.state()).unknownExposureMicrousd,0);
  await f.blocked();assert.equal(f.calls(),0); // Accounting evidence never reopens execution authority.
 });
 await t.test('H exhausted operation budget cannot dispatch',async()=>{
  const f=await fixture();for(let i=0;i<2;i++){const id=randomUUID();await f.ledger.reserve(f.reservation(id));await f.ledger.markDispatched(id);await f.ledger.settle(id,1100,'fixture-budget-'+id,{input_tokens:1000,output_tokens:100});}
  assert.notEqual((await f.gateway().fetch(f.request())).status,200);assert.equal(f.calls(),0);
 });
 await t.test('I expired deadline cannot dispatch',async()=>{
  const f=await fixture();await query("UPDATE factory.work_spend_budgets SET deadline=(clock_timestamp()-interval '1 second')::text WHERE work_id=$1",[f.binding.workId]);await f.blocked();assert.equal(f.calls(),0);
 });
 await t.test('J cancellation races dispatch: at most one exposure, retained unless proven absent',async()=>{
  const f=await fixture();await f.ledger.reserve(f.reservation());
  const [dispatch]=await Promise.allSettled([f.ledger.markDispatched(f.operationId),f.ledger.cancelBound(f.binding)]);
  if(dispatch.status==='fulfilled'){await f.ledger.markUnknown(f.operationId);assert.equal((await f.state()).unknownExposureMicrousd,1100);}
  else{await f.ledger.releaseUndispatched(f.operationId);assert.equal((await f.state()).retainedMicrousd,0);}
  await f.blocked();assert.equal(f.calls(),0);
 });
 await t.test('K fallback after UNKNOWN is denied',async()=>{
  const f=await fixture();await f.gateway(()=>{throw Error('fixture ambiguous');}).fetch(f.request());
  assert.notEqual((await f.gateway().fetch(f.request({model:'other-model',models:['other-model']}))).status,200);assert.equal(f.calls(),1);
 });
 await t.test('L concurrent controllers sharing phase identity invoke provider exactly once',async()=>{
  const f=await fixture();const results=await Promise.all([f.gateway().fetch(f.request()),f.gateway().fetch(f.request())]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(f.calls(),1);assert.equal((await f.state()).operations.length,1);
 });
});
