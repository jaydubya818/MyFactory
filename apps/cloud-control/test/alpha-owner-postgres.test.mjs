import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures/alpha-owner.mjs';
import {alphaOwnerBinding,alphaRecordScope} from '../src/alpha-owner-roster.mjs';
import {productionAuthority} from '../src/production-authority.mjs';
import {PostgresDispatchStore} from '../src/postgres-dispatch.mjs';
import {PostgresSpendLedger} from '../src/postgres-spend.mjs';
import {CloudWorkControl} from '../src/cloud-work-control.mjs';
import {cloudEvidence,cloudEvidenceRead} from '../src/cloud-evidence.mjs';
import {productionConfiguration as configuration,productionSourceGrant,productionSpendPlan,productionExecutionContractSha256 as contractSha256} from '../src/production-execution-plan.mjs';
import {productionVerifierPolicy as policy,productionVerifierPolicySha256 as policySha256} from '../src/production-verifier-policy.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {capabilityPolicyFixture} from './fixtures/capability-policy.mjs';

test('CONNECTED three-owner exact grants, single intake, cross-owner custody/Proof denials and revocation',{skip:process.env.FACTORY_POSTGRES_TEST!=='1'},async t=>{
 const url=new URL(process.env.DATABASE_URL_UNPOOLED);assert(['localhost','127.0.0.1'].includes(url.hostname),'Disposable localhost only');
 const pool=new pg.Pool({connectionString:url.href,max:6}),schema='alpha_isolation_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);
 const rewrite=sql=>sql.replace(/\bfactory\.(production_work_authority|protect_production_authority|work_spend_budgets|work_spend_operations|intake_receipts|delivery_intents|verification_resources|execution_resources|candidate_custody|work_orders|runs|events)\b/g,schema+'.$1').replace(/IN SCHEMA factory\b/g,'IN SCHEMA '+schema);
 const query=(sql,args)=>pool.query(rewrite(sql),args),isolated={connect:async()=>{const c=await pool.connect();return {query:(sql,args)=>c.query(rewrite(sql),args),release:()=>c.release()}}};
 let capability;
 t.after(async()=>{await capability?.cleanup();await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end()});
 for(const version of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification','008-production-work-authority','009-paid-operation-release','010-three-owner-authority'])await query(await readFile(new URL('../migrations/'+version+'.sql',import.meta.url),'utf8'));
 const {env,roster}=fixture(),sourceDigest='a'.repeat(64),configurationDigest=digest(configuration),factoryVersion=digest({sourceDigest,configurationDigest}),owners=[];
 capability=await capabilityPolicyFixture(pool,schema,isolated,Object.fromEntries(roster.owners.map(owner=>[owner.clientId,owner.ownerScope])));
 for(const o of roster.owners){
  const binding=alphaOwnerBinding(env,o.clientId),grant={...productionSourceGrant,clientId:o.clientId,ownerScope:o.ownerScope};
  const request={protocol:'MYFACTORY_EXECUTION_V2',requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:grant.source.repository,source:grant.source,deadline:new Date(Date.now()+170000).toISOString(),maxSpendUsd:1,input:{title:'Disposable owner '+o.slot,description:'Local deterministic owner custody qualification',kind:'feature',acceptanceCriteria:['Owner-scoped custody'],allowedPaths:grant.allowedPaths,checkCommands:grant.commands}};
  const template={version:1,clientId:o.clientId,ownerScope:o.ownerScope,sourceDigest,configurationDigest,factoryVersion,contractSha256,candidateSha256:null,environment:'CLOUD_PRODUCTION',publication:false,request:{...request,requestId:null,deadline:null}};
  const envelope={version:1,expiresAt:new Date(Date.now()+300000).toISOString(),approval:{workVersion:1,configurationHash:'c'.repeat(64),ownerBinding:binding,manifestTemplate:template}};
  const approvalDigest=digest(envelope),manifest={...template,version:2,request,authorizationEnvelope:envelope,authorizationEnvelopeSha256:approvalDigest};
  await query("INSERT INTO factory.production_work_authority(request_id,work_id,client_id,manifest,manifest_sha256,state) VALUES($1,$2,$3,$4,$5,'AUTHORIZED')",[request.requestId,request.workId,o.clientId,manifest,digest(manifest)]);
  const assertAuthority=productionAuthority({installation:{ownerScope:o.ownerScope},sourceDigest,configuration,contractSha256,clientId:o.clientId,authorizationSha256:approvalDigest,ownerBinding:binding});
  const store=new PostgresDispatchStore(capability.pool,{capabilityBindings:capability.bindings,maxWorks:1,custodyPrefix:'factory/production',verificationPolicySha256:policySha256,assertAuthority,assertRecordScope:alphaRecordScope(binding)});
  const control=new CloudWorkControl({store,spend:new PostgresSpendLedger(isolated),grant,configuration,sourceDigest,signing:{factoryId:'myfactory-cloud-production'},executionSpendPlan:productionSpendPlan,verificationPolicy:{policy,policySha256}});
  const [a,b]=await Promise.all([control.prepare(request),control.prepare(request)]);assert.equal(a.runId,b.runId);
  owners.push({binding,grant,request,store,control,assertAuthority,prepared:a});
 }
 assert.equal((await query('SELECT count(*) FROM factory.intake_receipts')).rows[0].count,'3');
 for(const a of owners){
  for(const b of owners.filter(o=>o!==a)){
   await assert.rejects(a.store.read(a.binding.clientId,b.request.requestId),/NOT_FOUND|AUTHORITY_UNAVAILABLE/);
   await assert.rejects(a.store.findRun(a.binding.clientId,b.prepared.workOrderId,b.prepared.runId),/NOT_FOUND|AUTHORITY_UNAVAILABLE/);
   await assert.rejects(a.control.prepare(b.request),/APPROVAL|AUTHORIZED/);
  }
  await assert.rejects(a.control.prepare({...a.request,requestId:randomUUID(),workId:randomUUID()}),/AUTHORIZED/);
  // Only local fixture Result/custody bytes. No provider allocation or model.
  const row=await a.store.read(a.binding.clientId,a.request.requestId),bundle={commit:'b'.repeat(40),checks:[{command:productionSourceGrant.commands[0],exitCode:0}],patchBase64:Buffer.from('disposable diff '+a.binding.slot).toString('base64')};
  row.events.push({type:'run.signed_result',payload:{encoded:Buffer.from(JSON.stringify({status:'COMPLETED',candidate:{commit:bundle.commit},execution:{requestId:row.request_id,workOrderId:row.work_order_id,runId:row.run_id,factoryVersion:row.snapshot.factoryVersion}})).toString('base64url')}},{type:'factory.terminal',payload:{finishedAt:new Date().toISOString()}});
  let custodyReads=0;const provider={readCustody:async()=>{custodyReads++;return bundle}},store={findRun:(client,w,r)=>a.store.findRun(client,w,r),read:async(client,id)=>{await a.store.read(client,id);return row}};
  const refs=await cloudEvidence(row,provider,a.binding.ownerScope);assert.deepEqual(refs.map(r=>r.ref.kind),['TestEvidence','DiffEvidence']);
  for(const ref of refs){const input={...ref.scope,workOrderId:row.work_order_id,runId:row.run_id,candidateCommit:bundle.commit,factoryVersion:row.snapshot.factoryVersion,evidenceKind:ref.ref.kind,evidenceReference:ref.proofReference,expectedDigest:ref.ref.sha256};
   const own=await cloudEvidenceRead(input,{store,provider},a.binding.ownerScope,a.binding.clientId);assert.equal(createHash('sha256').update(Buffer.from(own.base64,'base64')).digest('hex'),input.expectedDigest);
   for(const b of owners.filter(o=>o!==a)){const before=custodyReads;await assert.rejects(cloudEvidenceRead({...input,ownerScope:b.binding.ownerScope},{store,provider},b.binding.ownerScope,b.binding.clientId),/NOT_FOUND|AUTHORITY_UNAVAILABLE/);assert.equal(custodyReads,before)}
  }
  for(const changed of [{...a.binding,ownerScope:'reassigned-owner'},{...a.binding,rosterSha256:'e'.repeat(64)}]){
   const reassigned=new PostgresDispatchStore(isolated,{assertRecordScope:alphaRecordScope(changed)});
   await assert.rejects(reassigned.read(a.binding.clientId,a.request.requestId),/AUTHORITY_UNAVAILABLE/);
   await assert.rejects(reassigned.findRun(a.binding.clientId,a.prepared.workOrderId,a.prepared.runId),/AUTHORITY_UNAVAILABLE/);
   await assert.rejects(reassigned.stop(a.binding.clientId,{requestId:a.request.requestId}),/AUTHORITY_UNAVAILABLE/);
   await assert.rejects(reassigned.recordDeliverySend(a.prepared.runId),/AUTHORITY_UNAVAILABLE/);
  }
  await query("UPDATE factory.production_work_authority SET state='REVOKED' WHERE request_id=$1",[a.request.requestId]);
  await assert.rejects(a.store.transaction(c=>a.assertAuthority(c,a.request,Date.now(),'model')),/AUTHORIZED/);
  assert.equal((await a.store.read(a.binding.clientId,a.request.requestId)).request_id,a.request.requestId); // Revocation never transfers ownership or blocks historical readback.
 }
 assert.equal((await query("SELECT count(*) FROM factory.production_work_authority WHERE state='AUTHORIZED'")).rows[0].count,'0');
 assert.equal((await query('SELECT count(*) FROM factory.work_spend_operations')).rows[0].count,'0');
 assert.equal((await query('SELECT count(*) FROM factory.execution_resources')).rows[0].count,'0');
});
