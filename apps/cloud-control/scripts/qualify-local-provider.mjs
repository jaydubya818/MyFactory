import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {binding} from '../src/cloud-work-control.mjs';
import {localFixture,qualifyHost,createLocalFactory} from '../test/fixtures/local-factory.mjs';
import {startPostgres} from '../test/fixtures/local-postgres.mjs';
import {localExecutionProvider} from '../src/local-execution-provider.mjs';
import {verifyResult,digest,signResult} from '../../../packages/hosted-routing/src/result.ts';
const checks=[],fixtures=[];let db;
const check=async(name,action)=>{await action();checks.push(name);console.log('PASS '+name);};
const fixture=async()=>{const f=await localFixture(process.cwd());fixtures.push(f);await qualifyHost(f);return f;};
const options=(f,p)=>({factoryId:f.signing.factoryId,factoryVersion:f.version(),requestId:f.request.requestId,workOrderId:p.workOrderId,runId:p.runId,keys:[f.signing.key],localProvider:{provider:'local-docker',...f.executionBinding}});
try{
 const f=await fixture();db=await startPostgres(process.cwd());
 const factory=await createLocalFactory(f,db.pool,async()=>{});
 await check('failed or foreign host qualification is rejected even with a matching report hash',async()=>{
  for(const change of [r=>r.checks.seccomp=false,r=>r.runtimeSha256='f'.repeat(64),r=>r.policySha256='f'.repeat(64)]){
   const hostQualification=structuredClone(f.hostQualification),configuration=structuredClone(f.configuration);change(hostQualification);configuration.local.hostQualificationSha256=digest(hostQualification);
   await assert.rejects(createLocalFactory({...f,hostQualification,configuration},db.pool,async()=>{}),/LOCAL_PROVENANCE_DENIED/);
  }
 });
 const verify=factory.verifier.verify;
 let immutableProbe=false;
 factory.verifier.verify=async(s,bundle,active)=>verify(s,bundle,async()=>{
  await active();
  if(!immutableProbe){
   const path='/opt/candidate/fixtures/cloud-work/project-slug/slug.mjs';
   const probe=JSON.parse(await factory.node(s,`const fs=require('node:fs');const path=${JSON.stringify(path)};let denied=0;for(const action of [()=>fs.chmodSync(path,0o666),()=>fs.writeFileSync(path,'substitution'),()=>fs.unlinkSync(path),()=>fs.renameSync('/opt/candidate','/opt/replaced')]){try{action();}catch{denied++;}}process.stdout.write(JSON.stringify({denied,uid:fs.statSync(path).uid}));`));
   assert.deepEqual(probe,{denied:4,uid:0});immutableProbe=true;
  }
 });
 await check('provider, runtime, implementation and source mismatch denied before allocation',async()=>{
  for(const change of [x=>x.configuration.local.provider='vercel-sandbox',x=>x.configuration.local.runtimeSha256='f'.repeat(64),x=>x.configuration.local.implementationSha256='f'.repeat(64),x=>x.request.source.tree='f'.repeat(40),x=>x.executionBinding.sourceSnapshotSha256='f'.repeat(64)]){
   const x={...f,configuration:structuredClone(f.configuration),request:structuredClone(f.request),executionBinding:structuredClone(f.executionBinding),custodyRoot:f.temp,assertAuthority:async()=>{}};change(x);await assert.rejects(localExecutionProvider(x));
  }
 });
 let prepared,identity;
 await check('eight concurrent admissions reserve one canonical Work and allowance',async()=>{
  const rows=await Promise.all(Array.from({length:8},()=>factory.control.prepare(f.request)));prepared=rows[0];identity=factory.identity(prepared);
  assert.equal(new Set(rows.map(r=>r.runId)).size,1);
  const n=await db.pool.query('SELECT count(*) FROM factory.work_spend_budgets WHERE work_id=$1',[f.request.workId]);assert.equal(Number(n.rows[0].count),1);
 });
 await factory.control.dispatch(identity);
 await check('paid reservation is denied transactionally before any model operation',async()=>{
  await assert.rejects(factory.spend.reserve({...binding(identity),operationId:randomUUID(),phase:'productive',model:'fixture/deterministic',pricingRevision:'deterministic-no-paid-v1',reservedMicrousd:1}),/LOCAL_PAID_EXECUTION_UNSUPPORTED/);
  assert.equal((await factory.spend.read(f.request.workId)).operations.length,0);
 });
 await check('wrong FactoryVersion and stale writer cannot claim',async()=>{
  for(const patch of [{factoryVersion:'f'.repeat(64)},{writerGeneration:2}])await assert.rejects(factory.execute({...identity,...patch}));
 });
 await check('eight concurrent deliveries execute one producer and one separate verifier',async()=>{
  await Promise.all(Array.from({length:8},()=>factory.execute(identity)));
  assert.equal(factory.evidence.productiveExecutions,1);assert.equal(factory.evidence.producerAllocations,1);assert.equal(factory.evidence.verifierAllocations,1);
  assert.equal(immutableProbe,true);
 });
 await check('verifier cannot chmod, overwrite, unlink or replace the root-owned candidate',async()=>assert.equal(immutableProbe,true));
 const result=await factory.control.result(f.request.requestId),verified=verifyResult(result.result,options(f,prepared));
 await check('authenticated V3 Result binds candidate, separate verifier and cleanup',async()=>{
  assert.equal(result.state,'COMPLETED');assert.equal(verified.manifest.verification.outcome,'PASS');assert.equal(verified.manifest.execution.version,3);
  for(const c of factory.evidence.containers)assert.equal(await factory.inspect(c.id),null);
  assert.deepEqual(await factory.control.result(f.request.requestId),result);
 });
 await check('explicit negotiation, impersonation, candidate and verifier substitutions denied',async()=>{
  const o=options(f,prepared);delete o.localProvider;assert.throws(()=>verifyResult(result.result,o));
  assert.throws(()=>verifyResult(result.result,{...options(f,prepared),localProvider:{provider:'local-docker',ownerScope:'other',delegationDigest:f.executionBinding.delegationDigest}}));
  for(const change of [m=>m.execution.version=2,m=>m.localExecution.runtimeSha256='f'.repeat(64),m=>m.execution.localBinding.sourceSnapshotSha256='f'.repeat(64),m=>m.candidate.commit='f'.repeat(40),m=>m.localExecution.verifierAllocation=m.localExecution.producerAllocation,m=>m.localExecution.producerDestroyed=false]){
   const m=structuredClone(verified.manifest);change(m);assert.throws(()=>{const r=signResult(m,result.result.artifacts,f.signing.privateKey);verifyResult(r,options(f,prepared));});
  }
 });
 await check('cross-owner read, custody and stop denied',async()=>{
  const other={...f,executionBinding:{...f.executionBinding,ownerScope:'other'}};
  const peer=await createLocalFactory(other,db.pool,async()=>{});
  await assert.rejects(peer.control.read(f.request.requestId),/CROSS_OWNER/);
  await assert.rejects(peer.store.stop('missioncontrol-local',identity),/CROSS_OWNER/);
  await assert.rejects(peer.provider.readCustody(await factory.store.read('missioncontrol-local',f.request.requestId)),/CROSS_OWNER/);
 });
 await check('PostgreSQL restart preserves Result and prevents duplicate execution',async()=>{
  await db.restart();const resumed=await createLocalFactory(f,db.pool,async()=>{});
  assert.deepEqual(await resumed.control.result(f.request.requestId),result);await resumed.execute(identity);assert.equal(resumed.evidence.productiveExecutions,0);
 });
 await check('cleanup ambiguity stays UNKNOWN and recovery never executes work',async()=>{
  const u=await fixture(),first=await createLocalFactory(u,db.pool,async()=>{}),p=await first.control.prepare(u.request),i=first.identity(p);await first.control.dispatch(i);
  const destroy=first.provider.destroy;first.provider.destroy=async(...args)=>{await destroy(...args);throw Error('LOST_CLEANUP_ACK');};
  await first.execute(i);assert.equal((await first.control.read(u.request.requestId)).state,'UNKNOWN');assert.equal((await first.control.result(u.request.requestId)).result,null);
  await db.pool.query("UPDATE factory.execution_resources SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE run_id=$1",[p.runId]);
  await db.restart();const resumed=await createLocalFactory(u,db.pool,async()=>{});await resumed.reconcile();await resumed.execute(i);
  assert.equal(resumed.evidence.productiveExecutions,0);assert.equal(resumed.evidence.producerAllocations,0);
  const terminal=await resumed.control.result(u.request.requestId);assert.equal(terminal.state,'FAILED');verifyResult(terminal.result,options(u,p));
 });
 await check('cancel before allocation yields authenticated terminal cleanup without execution',async()=>{
  const u=await fixture(),c=await createLocalFactory(u,db.pool,async()=>{}),p=await c.control.prepare(u.request),i=c.identity(p);
  await c.store.stop('missioncontrol-local',i);await c.reconcile();const r=await c.control.result(u.request.requestId);
  assert.equal(r.state,'CANCELLED');verifyResult(r.result,options(u,p));assert.equal(c.evidence.producerAllocations,0);
 });
 await check('revoked authority refuses admission and paid operations remain unsupported',async()=>{
  const u=await fixture(),c=await createLocalFactory(u,db.pool,async()=>{throw Error('AUTHORITY_REVOKED');});await assert.rejects(c.control.prepare(u.request),/AUTHORITY_REVOKED/);
  const spend=await (await createLocalFactory(f,db.pool,async()=>{})).spend.read(f.request.workId);assert.equal(spend.operations.length,0);
 });
 const summary={checks,factoryVersion:f.version(),sourceDigest:f.sourceDigest,hostQualification:f.hostQualification,execution:factory.evidence,resultDigest:result.result.manifestDigest,candidate:verified.manifest.candidate,verification:verified.manifest.verification,localExecution:verified.manifest.localExecution,paidOperations:0};
 if(process.env.LOCAL_PROVIDER_EVIDENCE)await writeFile(process.env.LOCAL_PROVIDER_EVIDENCE,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
}finally{await db?.stop();for(const f of fixtures)await f.stop();}
