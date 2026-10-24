import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {verifyLifecycleReceipt} from '../../../packages/capability-enforcement/src/lifecycle-wire.ts';
import {receiverInventory,aggregateLifecycle} from '../src/receiver-lifecycle.mjs';
import {FactoryRelayPolicyReceiver} from '../src/relay-policy-receiver.mjs';
import {PostgresCapabilityReceiver,receiverHead,receiverTables,scopeValues} from '../src/postgres-capability-receiver.mjs';
import {FactoryReceiverWitness} from '../src/capability-receiver-witness.mjs';
import {OrderedFactoryAdmission} from '../src/ordered-capability-admission.mjs';
import {PostgresDispatchStore} from '../src/postgres-dispatch.mjs';
import {PostgresVerificationStore} from '../src/postgres-verification.mjs';
import {PostgresSpendLedger} from '../src/postgres-spend.mjs';
import {CloudWorkControl} from '../src/cloud-work-control.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {signPolicyMessage,verifyPolicyMessage,policyMessageHash} from '../../../packages/capability-enforcement/src/ordering-wire.ts';
import {verifyFactoryPreparationTerminal} from '../../../packages/capability-enforcement/src/factory-preparation-terminal.ts';
import {validationConfiguration as configuration,validationSourceGrant as originalGrant} from '../src/production-validation-plan.mjs';
import {productionVerifierPolicy as verifierPolicy,productionVerifierPolicySha256 as verifierPolicySha256} from '../src/production-verifier-policy.mjs';
import {syntheticAdmissionSpendPlan} from './fixtures/admission-spend-plan.mjs';

const nativeUrl=process.env.FACTORY_RECEIVER_TEST_DATABASE_URL,witnessUrl=process.env.FACTORY_RECEIVER_TEST_WITNESS_URL;
async function key(id){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {keyId:id,jwk:await crypto.subtle.exportKey('jwk',pair.privateKey)};}
test('LOCAL remote receiver uses independent witness and native authority; restore and replay fail closed',{skip:!nativeUrl||!witnessUrl},async t=>{
 for(const value of [nativeUrl,witnessUrl])assert(['127.0.0.1','localhost'].includes(new URL(value).hostname));
 const admin=new pg.Pool({connectionString:nativeUrl}),wadmin=new pg.Pool({connectionString:witnessUrl});
 const own=[];
 t.after(async()=>{for(const x of own.reverse()){if(x.close)await x.close();else await x.end();}await admin.query('DROP SCHEMA IF EXISTS factory CASCADE; DROP ROLE IF EXISTS receiver_runtime');await wadmin.query('DROP SCHEMA IF EXISTS capability_witness CASCADE; DROP ROLE IF EXISTS witness_runtime');await admin.end();await wadmin.end();});
 await admin.query('CREATE SCHEMA factory');
 for(const name of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification','008-production-work-authority','013-capability-control-receipts','014-receiver-lookup-qualification'])await admin.query(await readFile(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
 await wadmin.query(await readFile(new URL('../../../docs/capability-control/receiver-witness.sql',import.meta.url),'utf8'));
 await admin.query("CREATE ROLE receiver_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD 'local-receiver-only'; GRANT USAGE ON SCHEMA factory TO receiver_runtime; GRANT USAGE ON ALL SEQUENCES IN SCHEMA factory TO receiver_runtime");
 const nativeTables=['work_orders','runs','events','intake_receipts','delivery_intents','execution_resources','verification_resources','candidate_custody','work_spend_budgets','work_spend_operations','production_work_authority'];
 await admin.query('GRANT SELECT,INSERT,UPDATE ON '+nativeTables.map(x=>'factory.'+x).join(',')+' TO receiver_runtime');
 await admin.query('GRANT SELECT,INSERT ON '+receiverTables.map(x=>'factory.'+x).join(',')+' TO receiver_runtime');
 await admin.query('GRANT EXECUTE ON FUNCTION factory.receiver_requires_ordering(text,text) TO receiver_runtime');
 await admin.query('GRANT EXECUTE ON FUNCTION factory.receiver_role_enrolled(text,text,text,text,text,integer) TO receiver_runtime');
 await wadmin.query("CREATE ROLE witness_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD 'local-witness-only'; GRANT USAGE ON SCHEMA capability_witness TO witness_runtime; GRANT EXECUTE ON FUNCTION capability_witness.read_head(text,text,text,text,text,text,text),capability_witness.advance_head(text,text,text,text,text,text,text,bigint,text,bigint,text) TO witness_runtime");
 const scopedUrl=new URL(nativeUrl);scopedUrl.username='receiver_runtime';scopedUrl.password='local-receiver-only';
 const wurl=new URL(witnessUrl);wurl.username='witness_runtime';wurl.password='local-witness-only';
 const pool=new pg.Pool({connectionString:scopedUrl.href,max:4}),direct=new pg.Pool({connectionString:scopedUrl.href,max:2});own.push(pool,direct);
 const scope={ownerId:'fixture-owner',organizationId:'fixture-org',installationId:'fixture-install',backendId:'fixture-factory',incarnation:'fixture-incarnation',enrollmentVersion:1};
 const enrollmentDigest=digest({scope,role:'receiver_runtime',fixture:true}),epoch='fixture-receiver-epoch';
 const collections=Object.fromEntries(receiverTables.filter(x=>!['capability_receiver_heads','capability_receiver_plans'].includes(x)).map(x=>[x,[]]));
 const genesis=receiverHead(scope,enrollmentDigest,1,collections,[]),genesisPayload={head:genesis,previousDigest:null,runtimeRole:'receiver_runtime'};
 await admin.query('INSERT INTO factory.capability_receiver_heads VALUES($1,$2,$3,$4,$5,$6,1,\'1\',$7,$8)',[...Object.values(scope),genesisPayload,digest(genesisPayload)]);
 await wadmin.query("INSERT INTO capability_witness.enrollments VALUES('receiver-enrollment',$1,$2,$3,$4,'witness_runtime',$5,$5,clock_timestamp()+interval '1 hour')",[scope.organizationId,scope.installationId,scope.ownerId,epoch,enrollmentDigest]);
 await wadmin.query("INSERT INTO capability_witness.heads VALUES('receiver-enrollment',$1,$2,$3,1,$4)",[scope.organizationId,scope.installationId,scope.ownerId,genesis.digest]);
 const receiver=new PostgresCapabilityReceiver(pool,scope,enrollmentDigest),witness=new FactoryReceiverWitness({databaseUrl:wurl.href,epoch,enrollmentId:'receiver-enrollment',qualificationDigest:enrollmentDigest,installationDigest:enrollmentDigest,
  resources:{directEndpointVerified:true,factoryMarker:'disposable-factory',witnessMarker:'disposable-witness',factoryResourceId:'owned-local-native-container',witnessResourceId:'owned-local-witness-container',myeveResourceId:'owned-local-myeve-container'}});own.push(witness);
 const keys={myeve:await key('source-myeve'),relay:await key('source-relay')},signer=await key('receiver'),agentId='fixture-agent';
 const grant={...originalGrant,clientId:originalGrant.clientId,ownerScope:scope.ownerId};
 const binding={ownerId:scope.ownerId,organizationId:scope.organizationId,installationId:scope.installationId,agentId,environment:'qualification'};
 const store=new PostgresDispatchStore(pool,{capabilityBindings:{[grant.clientId]:binding},verificationPolicySha256:verifierPolicySha256,assertRecordScope:async(client,row)=>{const original=(await client.query('SELECT * FROM factory.production_work_authority WHERE request_id=$1',[row.request_id])).rows[0];if(!original||original.client_id!==grant.clientId||original.manifest.ownerId!==scope.ownerId||original.manifest.organizationId!==scope.organizationId||original.manifest.installationId!==scope.installationId||original.manifest.agentId!==agentId||digest(original.manifest.request)!==row.input_digest)throw Error('ORIGINAL_SCOPE_UNAVAILABLE');},assertAuthority:async(client,input,_now,action)=>{
  const row=(await client.query('SELECT * FROM factory.production_work_authority WHERE request_id=$1',[input.requestId])).rows[0];
  if(!row||row.client_id!==grant.clientId||row.work_id!==input.workId||row.manifest_sha256!==digest(row.manifest)||row.state!=='AUTHORIZED')throw Error('WORK_EXECUTION_AUTHORITY_DENIED');
  if(action==='prepare'&&!row.consumed_at)await client.query("UPDATE factory.production_work_authority SET consumed_at=clock_timestamp() WHERE request_id=$1",[input.requestId]);
 }});
 const spend=new PostgresSpendLedger(pool),sourceDigest='a'.repeat(64);
 const executionSpendPlan=syntheticAdmissionSpendPlan(new Date(Date.now()+180000).toISOString());
 const control=new CloudWorkControl({store,spend,grant,ownerScope:scope.ownerId,configuration,sourceDigest,signing:{factoryId:'fixture-factory'},executionSpendPlan,verificationPolicy:{policy:verifierPolicy,policySha256:verifierPolicySha256}});
 const secondGrant={...grant,clientId:'sofie-production'};
 const secondStore=new PostgresDispatchStore(pool,{capabilityBindings:{[secondGrant.clientId]:binding},verificationPolicySha256:verifierPolicySha256,
  assertRecordScope:async(client,row)=>{const original=(await client.query('SELECT * FROM factory.production_work_authority WHERE request_id=$1',[row.request_id])).rows[0];if(!original||original.client_id!==secondGrant.clientId||original.work_id!==row.work_id||original.manifest.ownerId!==scope.ownerId||original.manifest.organizationId!==scope.organizationId||original.manifest.installationId!==scope.installationId||original.manifest.agentId!==agentId||digest(original.manifest.request)!==row.input_digest)throw Error('ORIGINAL_SCOPE_UNAVAILABLE');},
  assertAuthority:async(client,input,_now,action)=>{const row=(await client.query('SELECT * FROM factory.production_work_authority WHERE request_id=$1',[input.requestId])).rows[0];if(!row||row.client_id!==secondGrant.clientId||row.work_id!==input.workId||row.manifest_sha256!==digest(row.manifest)||row.state!=='AUTHORIZED')throw Error('WORK_EXECUTION_AUTHORITY_DENIED');if(action==='prepare'&&!row.consumed_at)await client.query('UPDATE factory.production_work_authority SET consumed_at=clock_timestamp() WHERE request_id=$1',[input.requestId]);}});
 const secondControl=new CloudWorkControl({store:secondStore,spend,grant:secondGrant,ownerScope:scope.ownerId,configuration,sourceDigest,signing:{factoryId:'fixture-factory'},executionSpendPlan,verificationPolicy:{policy:verifierPolicy,policySha256:verifierPolicySha256}});
 const originalControls=new Map([[grant.clientId,control],[secondGrant.clientId,secondControl]]);
 const ordered=new OrderedFactoryAdmission({receiver,witness,directPool:direct,control,signer,clientControls:originalControls,isRetainedAuthorityFenced:async(client,id)=>(await client.query('SELECT state FROM factory.production_work_authority WHERE request_id=$1 AND client_id=$2 AND work_id=$3',[id.requestId,id.clientId,id.workId])).rows[0]?.state==='REVOKED',invalidateRetainedAuthority:async(client,id)=>{await client.query("UPDATE factory.production_work_authority SET state='REVOKED' WHERE request_id=$1 AND client_id=$2 AND work_id=$3",[id.requestId,id.clientId,id.workId]);},assertRetainedAuthority:async(client,identity,outcome)=>{const row=(await client.query('SELECT * FROM factory.production_work_authority WHERE request_id=$1',[identity.requestId])).rows[0];if(!row||row.client_id!==identity.clientId||row.work_id!==identity.workId||row.manifest_sha256!==digest(row.manifest)||digest(row.manifest.request)!==identity.nativeRequestDigest||(outcome==='ADMITTED'&&!row.consumed_at))throw Error('FACTORY_NATIVE_LINEAGE_MISSING');},enrollment:{scope,agentId,registryVersion:'fixture-registry',environment:'qualification',directEndpointVerified:true,sourceKeys:keys,clientBindings:[{clientId:grant.clientId,...binding},{clientId:secondGrant.clientId,...binding}]}});
 const fence=async(authority,version,operation='enable')=>signPolicyMessage({...scope,authority,version,policyId:authority+'-policy-'+version,kind:'FENCE',capabilityId:'myfactory',operation},keys[authority]);
 const make=()=>({protocol:'MYFACTORY_EXECUTION_V2',requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:grant.source.repository,source:grant.source,deadline:new Date(Date.now()+160000).toISOString(),maxSpendUsd:1,input:{title:'Synthetic receiver qualification',description:'No provider execution',kind:'feature',acceptanceCriteria:['Exact admission'],checkCommands:grant.commands,allowedPaths:grant.allowedPaths}});
 const authorize=async (request,clientId=grant.clientId)=>{const manifest={request,ownerId:scope.ownerId,organizationId:scope.organizationId,installationId:scope.installationId,agentId};await admin.query("INSERT INTO factory.production_work_authority(request_id,work_id,client_id,manifest,manifest_sha256,state) VALUES($1,$2,$3,$4,$5,'AUTHORIZED')",[request.requestId,request.workId,clientId,manifest,digest(manifest)]);};
 const permits=async (request,instance=ordered,agentRevision=0,ttl=30000)=>{
  const c=await verifyPolicyMessage(await instance.challenge(request,'fixture-mission'),signer);
  const {kind,...fields}=c;fields.expiresAt=fields.issuedAt+ttl;
  const myeve=await signPolicyMessage({...fields,kind:'PERMIT',requiredCapabilities:['work','myfactory'],agentRevision,sourcePermitHash:'SELF'},keys.myeve);
  const state=await instance.snapshot(),r=ordered.latestFence(state,'relay').message;
  const relay=await signPolicyMessage({...fields,...Object.fromEntries(['authority','version','policyId'].map(k=>[k,r[k]])),referenceId:'lse_'+randomUUID(),kind:'PERMIT',requiredCapabilities:['work','myfactory'],agentRevision,sourcePermitHash:await policyMessageHash(JSON.parse(myeve.message))},keys.relay);
  return {myeve,relay};
 };
 await t.test('isolated receiver qualification uses the TEST-ONLY admission fixture; expired fixture pricing is still refused',async()=>{
  assert.equal(executionSpendPlan.model,'fixture/authority-only');
  assert.equal(executionSpendPlan.pricingRevision,'fixture-authority-only-v1');
  const expiredWork=randomUUID();
  await assert.rejects(new PostgresSpendLedger(pool,{requireExecutionLease:false}).createBudget(
   {workId:expiredWork,workGeneration:1,requestId:randomUUID(),workOrderId:randomUUID()},
   1000000,new Date(Date.now()+160000).toISOString(),syntheticAdmissionSpendPlan(new Date(0).toISOString())),/Qualified pricing has expired/);
  assert.equal((await admin.query('SELECT count(*) FROM factory.work_spend_budgets WHERE work_id=$1',[expiredWork])).rows[0].count,'0');
 });
 await t.test('restricted witness role sees its own session and enforces the reviewed server timeouts without monitor privileges',async()=>{
  const role=(await wadmin.query("SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='witness_runtime'")).rows[0];
  assert(Object.values(role).every(value=>value===false));
  assert.equal((await wadmin.query("SELECT count(*) FROM pg_auth_members WHERE member='witness_runtime'::regrole")).rows[0].count,'0');
  const session=await witness.operation(client=>witness.assertPriorTermination(client));
  assert(Number.isSafeInteger(session.pid));assert(Number.isFinite(Date.parse(session.started)));
 });
 await t.test('a live same-role transaction blocks termination proof until canonical rollback',async()=>{
  const other=new pg.Client({connectionString:wurl.href});await other.connect();
  try{
   await other.query('BEGIN');
   await assert.rejects(witness.read(genesis),/FACTORY_WITNESS_CAS_PENDING/);
   await other.query('ROLLBACK');await witness.assert(genesis);
  }finally{await other.end();}
 });
 await t.test('signed monotonic fences, conflicting/stale/foreign delivery and immutable RLS history',async()=>{
  for(const a of ['myeve','relay']){const f=await fence(a,1);assert.equal((await verifyPolicyMessage(await ordered.receiveFence(f),signer)).kind,'FENCE_ACK');assert.deepEqual(await ordered.receiveFence(f),await ordered.receiveFence(f));}
  await assert.rejects(ordered.receiveFence(await signPolicyMessage({...scope,ownerId:'foreign',authority:'myeve',version:2,policyId:'foreign',kind:'FENCE',capabilityId:'myfactory',operation:'enable'},keys.myeve)),/SCOPE/);
  await assert.rejects(ordered.receiveFence(await fence('myeve',1,'disable')),/CONFLICT/);
  await assert.rejects(pool.query('UPDATE factory.capability_fences SET record_key=record_key'),/permission denied/);
  assert.equal((await pool.query('SELECT * FROM factory.capability_fences')).rows.length,0);
 });
 await t.test('blocked witness CAS times out on the server and cannot survive restart to overwrite a later head',async()=>{
  const lock=await wadmin.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE capability_witness.heads IN ACCESS EXCLUSIVE MODE');
  const original=(await ordered.snapshot()).head,started=performance.now();
  try{await assert.rejects(witness.advance(original,{...original,revision:original.revision+1,digest:'f'.repeat(64)}),/timeout|AMBIGUOUS|canceling statement/);}
  finally{await lock.query('ROLLBACK');lock.release();}
  assert(performance.now()-started<2500);
  const restarted=new FactoryReceiverWitness({databaseUrl:wurl.href,...witness.config,resources:witness.resources});
  try{await restarted.assert(original);}finally{await restarted.close();}
 });
 let admitted,uncertain,unknownBinding,unknownOperation,relay,relaySigningPair;
 await t.test('positive native intake, authority and budget are atomic; duplicate readback preserves existing Work',async()=>{
  const request=make();await authorize(request);const pair=await permits(request);
  let release,entered;const barrier=new Promise(resolve=>{entered=resolve;}),hold=new Promise(resolve=>{release=resolve;});
  const advance=witness.advance.bind(witness);let first=true;
  witness.advance=async(...args)=>{if(first){first=false;entered();await hold;}return advance(...args);};
  const admission=ordered.prepare(request,'fixture-mission',pair);await barrier;
  await assert.rejects(ordered.prepare(request,'fixture-mission',pair),/BUSY/);
  await assert.rejects(ordered.receiveFence(await fence('myeve',2,'disable')),/BUSY/);
  release();admitted={request,pair,result:await admission};witness.advance=advance;
  assert(admitted.result.snapshot);assert.equal(admitted.result.spend.workId,request.workId);
  assert((await admin.query('SELECT consumed_at FROM factory.production_work_authority WHERE request_id=$1',[request.requestId])).rows[0].consumed_at);
  assert.equal((await admin.query('SELECT count(*) FROM factory.intake_receipts')).rows[0].count,'1');
  assert.deepEqual(await ordered.prepare(request,'fixture-mission',pair),admitted.result);
  await assert.rejects(control.prepare(request),/ORDERED_ADMISSION_REQUIRED/);
  const restarted=new PostgresDispatchStore(pool,{capabilityBindings:store.capabilityBindings,assertAuthority:store.assertAuthority});
  await assert.rejects(restarted.prepare(grant,request,(...args)=>control.snapshot(...args)),/ORDERED_ADMISSION_REQUIRED/);
  const definition=(await admin.query("SELECT pg_get_functiondef('factory.receiver_requires_ordering(text,text)'::regprocedure) AS body")).rows[0].body;
  await admin.query('DROP FUNCTION factory.receiver_requires_ordering(text,text)');
  try{await assert.rejects(restarted.prepare(grant,request,(...args)=>control.snapshot(...args)),/ORDERING_UNAVAILABLE/);}
  finally{await admin.query(definition);await admin.query('REVOKE ALL ON FUNCTION factory.receiver_requires_ordering(text,text) FROM PUBLIC;GRANT EXECUTE ON FUNCTION factory.receiver_requires_ordering(text,text) TO receiver_runtime');}
  await assert.rejects(ordered.prepare({...request,maxSpendUsd:.9},'fixture-mission',pair),/TERMINAL_BINDING/);
 });
 await t.test('non-bypass lookup owners fail closed after restart and before recursive RLS',async()=>{
  const owner=(await admin.query('SELECT current_user AS role')).rows[0].role,quoted='"'+owner.replaceAll('"','""')+'"';
  await admin.query('CREATE ROLE receiver_lookup_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT; GRANT USAGE,CREATE ON SCHEMA factory TO receiver_lookup_owner; GRANT SELECT ON factory.capability_receiver_heads TO receiver_lookup_owner');
  const restarted=new PostgresDispatchStore(pool,{capabilityBindings:store.capabilityBindings,assertAuthority:store.assertAuthority});
  try{
   await admin.query('ALTER FUNCTION factory.receiver_requires_ordering(text,text) OWNER TO receiver_lookup_owner');
   await assert.rejects(pool.query('SELECT factory.receiver_requires_ordering($1,$2)',[scope.ownerId,scope.installationId]),/LOOKUP_OWNER_UNQUALIFIED/);
   await assert.rejects(restarted.prepare(grant,admitted.request,(...args)=>control.snapshot(...args)),/LOOKUP_OWNER_UNQUALIFIED/);
   await admin.query('ALTER FUNCTION factory.receiver_requires_ordering(text,text) OWNER TO '+quoted);
   await admin.query('ALTER FUNCTION factory.receiver_role_enrolled(text,text,text,text,text,integer) OWNER TO receiver_lookup_owner');
   await assert.rejects(ordered.snapshot(),/LOOKUP_OWNER_UNQUALIFIED/);
   await assert.rejects(restarted.prepare(grant,admitted.request,(...args)=>control.snapshot(...args)),/LOOKUP_OWNER_UNQUALIFIED/);
   assert.equal((await admin.query('SELECT count(*) FROM factory.intake_receipts')).rows[0].count,'1');
   await admin.query('ALTER FUNCTION factory.receiver_role_enrolled(text,text,text,text,text,integer) OWNER TO '+quoted);
   await admin.query('ALTER FUNCTION factory.receiver_requires_ordering(text,text) SECURITY INVOKER');
   await assert.rejects(restarted.prepare(grant,admitted.request,(...args)=>control.snapshot(...args)),/LOOKUP_OWNER_UNQUALIFIED/);
  }finally{
   await admin.query('ALTER FUNCTION factory.receiver_requires_ordering(text,text) SECURITY DEFINER');
   await admin.query('ALTER FUNCTION factory.receiver_requires_ordering(text,text) OWNER TO '+quoted+'; ALTER FUNCTION factory.receiver_role_enrolled(text,text,text,text,text,integer) OWNER TO '+quoted+'; DROP OWNED BY receiver_lookup_owner; DROP ROLE receiver_lookup_owner');
  }
 });
 await t.test('a fresh fence can recover a pending admission without the original caller',async()=>{
  const request=make();await authorize(request);const pair=await permits(request),advance=witness.advance.bind(witness);
  witness.advance=async()=>{throw Error('SIMULATED_BEFORE_CAS');};
  try{await assert.rejects(ordered.prepare(request,'fixture-mission',pair),/SIMULATED_BEFORE_CAS/);}finally{witness.advance=advance;}
  const pending=(await ordered.snapshot()).pending[0];
  await ordered.receiveFence(await fence('relay',2));
  assert.equal((await ordered.snapshot()).pending.length,0);
  const receipt=JSON.parse((await ordered.terminal(request,'fixture-mission')).message);
  assert.equal(receipt.planId,pending.record_key);assert.equal(receipt.outcome,'DEFINITELY_NOT_ADMITTED');
  assert.equal((await admin.query('SELECT count(*) FROM factory.intake_receipts WHERE request_id=$1',[request.requestId])).rows[0].count,'0');
 });
 await t.test('readback-first recovers expired pre-CAS admission without rebuilding or native effects',async()=>{
  const request=make();await authorize(request);const pair=await permits(request,ordered,0,1200),advance=witness.advance.bind(witness);let once=true;
  witness.advance=async(...args)=>{if(once){once=false;throw Error('SIMULATED_BEFORE_CAS');}return advance(...args);};
  await assert.rejects(ordered.prepare(request,'fixture-mission',pair),/SIMULATED_BEFORE_CAS/);witness.advance=advance;
  const pending=(await ordered.snapshot()).pending[0],ids=pending.payload.identity.nativeIds;
  await new Promise(resolve=>setTimeout(resolve,1300));
  assert(Date.now()>JSON.parse(pair.myeve.message).expiresAt);
  const result=await ordered.terminal(request,'fixture-mission'),receipt=JSON.parse(result.message);
  assert.equal(receipt.outcome,'DEFINITELY_NOT_ADMITTED');assert.equal(receipt.planId,pending.record_key);
  assert.deepEqual((await ordered.snapshot()).data.capability_receiver_plans.find(r=>r.record_key===pending.record_key&&r.record_kind==='PLAN').payload.identity.nativeIds,ids);
  assert.equal((await admin.query('SELECT count(*) FROM factory.intake_receipts WHERE request_id=$1',[request.requestId])).rows[0].count,'0');
  assert.equal((await admin.query('SELECT count(*) FROM factory.work_spend_budgets WHERE work_id=$1',[request.workId])).rows[0].count,'0');
  const replay=JSON.parse((await ordered.prepare(request,'fixture-mission',pair)).message);
  assert.equal(replay.planId,receipt.planId);assert.equal(replay.nativeOutcomeDigest,receipt.nativeOutcomeDigest);assert.equal(replay.outcome,receipt.outcome);
  assert.equal((await admin.query('SELECT count(*) FROM factory.intake_receipts WHERE request_id=$1',[request.requestId])).rows[0].count,'0');
 });
 await t.test('witness-ahead restart never replays native admission; an unrelated current Work still admits',async()=>{
  const request=make();await authorize(request);const pair=await permits(request),advance=witness.advance.bind(witness);let once=true;
  witness.advance=async(...args)=>{const result=await advance(...args);if(once){once=false;throw Error('SIMULATED_AFTER_CAS');}return result;};
  await assert.rejects(ordered.prepare(request,'fixture-mission',pair),/SIMULATED_AFTER_CAS/);witness.advance=advance;
  const result=await ordered.prepare(request,'fixture-mission',pair);assert.equal(JSON.parse(result.message).outcome,'ADMISSION_UNCERTAIN');
  assert.equal((await admin.query('SELECT count(*) FROM factory.intake_receipts WHERE request_id=$1',[request.requestId])).rows[0].count,'0');
  uncertain={request,result};
  const unrelated=make();await authorize(unrelated);const positive=await ordered.prepare(unrelated,'fixture-mission',await permits(unrelated));assert(positive.runId);
 });
 await t.test('native revalidation after CAS rolls back authority/budget and certifies only the decline',async()=>{
  const request=make();await authorize(request);const pair=await permits(request),advance=witness.advance.bind(witness);let once=true;
  witness.advance=async(...args)=>{const result=await advance(...args);if(once){once=false;await admin.query("UPDATE factory.production_work_authority SET state='REVOKED' WHERE request_id=$1",[request.requestId]);}return result;};
  const result=await ordered.prepare(request,'fixture-mission',pair);witness.advance=advance;
  assert.equal(JSON.parse(result.message).outcome,'DEFINITELY_NOT_ADMITTED');
  assert.equal((await admin.query('SELECT count(*) FROM factory.work_spend_budgets WHERE work_id=$1',[request.workId])).rows[0].count,'0');
  assert.equal((await admin.query('SELECT consumed_at FROM factory.production_work_authority WHERE request_id=$1',[request.requestId])).rows[0].consumed_at,null);
 });
 await t.test('native global lock is never retained during witness I/O',async()=>{
  const advance=witness.advance.bind(witness);let checked=0;
  witness.advance=async(...args)=>{const c=await admin.connect();try{await c.query('BEGIN');assert.equal((await c.query('SELECT pg_try_advisory_xact_lock(81427603) AS free')).rows[0].free,true);checked++;}finally{await c.query('ROLLBACK');c.release();}return advance(...args);};
  await ordered.receiveFence(await fence('relay',3));witness.advance=advance;assert.equal(checked,1);
 });
 await t.test('admitted readback rejects restored owner/admission history and authority even with intact intake/head',async()=>{
  const row=(await admin.query('SELECT * FROM factory.production_work_authority WHERE request_id=$1',[admitted.request.requestId])).rows[0];
  await admin.query("ALTER TABLE factory.production_work_authority DISABLE TRIGGER ALL; DELETE FROM factory.production_work_authority WHERE request_id='"+admitted.request.requestId+"'; ALTER TABLE factory.production_work_authority ENABLE TRIGGER ALL");
  await assert.rejects(ordered.terminal(admitted.request,'fixture-mission'),/NATIVE_LINEAGE_MISSING/);
  await admin.query('INSERT INTO factory.production_work_authority(request_id,work_id,client_id,manifest,manifest_sha256,state,consumed_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',Object.values(row));
  const event=(await admin.query("DELETE FROM factory.events WHERE run_id=$1 AND type='factory.capability_admitted' RETURNING *",[admitted.result.runId])).rows[0];
  await assert.rejects(ordered.terminal(admitted.request,'fixture-mission'),/NATIVE_LINEAGE_MISSING/);
  await admin.query('INSERT INTO factory.events(id,work_order_id,run_id,type,payload,created_at) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,$5,$6)',[event.id,event.work_order_id,event.run_id,event.type,event.payload,event.created_at]);
  assert.equal((await ordered.terminal(admitted.request,'fixture-mission')).runId,admitted.result.runId);
 });
 await t.test('partial restore of an applied outcome is unavailable lineage, never never-seen',async()=>{
  const state=await ordered.snapshot(),plan=state.data.capability_receiver_plans.find(r=>r.record_kind==='PLAN'&&r.payload.identity.requestId===admitted.request.requestId);
  await admin.query('ALTER TABLE factory.capability_receiver_plans DISABLE TRIGGER protect_history');
  let row;
  try{
   row=(await admin.query("DELETE FROM factory.capability_receiver_plans WHERE record_key=$1 AND record_kind='OUTCOME' RETURNING *",[plan.record_key])).rows[0];
   await assert.rejects(ordered.terminal(admitted.request,'fixture-mission'),/NATIVE_LINEAGE_MISSING/);
  }finally{
   if(row){const cols=Object.keys(row);await admin.query('INSERT INTO factory.capability_receiver_plans('+cols.join(',')+') VALUES('+cols.map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(row));}
   await admin.query('ALTER TABLE factory.capability_receiver_plans ENABLE TRIGGER protect_history');
  }
  assert.equal((await ordered.terminal(admitted.request,'fixture-mission')).runId,admitted.result.runId);
 });
 await t.test('new disable rejects stale fresh admission and preserves existing intake and UNKNOWN reserves',async()=>{
  const pending=make();await authorize(pending);const old=await permits(pending);
  unknownBinding={workId:admitted.request.workId,workGeneration:1,requestId:admitted.request.requestId,workOrderId:admitted.result.workOrderId,
   dispatchIdentity:randomUUID(),factoryVersion:admitted.result.snapshot.factoryVersion,runId:admitted.result.runId};
  const ledger=new PostgresSpendLedger(pool,{requireExecutionLease:false}); // No provider call; canonical accounting only.
  await ledger.bindAuthority(unknownBinding);unknownOperation=randomUUID();
  await ledger.reserve({...unknownBinding,operationId:unknownOperation,model:executionSpendPlan.model,pricingRevision:executionSpendPlan.pricingRevision,reservedMicrousd:executionSpendPlan.perOperationReserveMicrousd,phase:'productive'});
  await ledger.markUnknown(unknownOperation);
  await ordered.receiveFence(await fence('myeve',2,'disable'));
  await assert.rejects(ordered.prepare(pending,'fixture-mission',old),/STALE_OR_FOREIGN/);
  assert.equal((await admin.query('SELECT count(*) FROM factory.intake_receipts')).rows[0].count,'2');
  assert.equal((await ordered.prepare(admitted.request,'fixture-mission',admitted.pair)).runId,admitted.result.runId);
  assert.equal((await spend.getOperation(unknownOperation)).state,'unknown');
  assert.equal((await spend.read(admitted.request.workId)).unknownExposureMicrousd,executionSpendPlan.perOperationReserveMicrousd);
  await assert.rejects(new PostgresSpendLedger(pool,{requireExecutionLease:false}).reserve({...unknownBinding,operationId:randomUUID(),model:executionSpendPlan.model,pricingRevision:executionSpendPlan.pricingRevision,reservedMicrousd:executionSpendPlan.perOperationReserveMicrousd,phase:'productive'}),/authority|UNKNOWN|Unresolved/);
 });
 await t.test('Relay native revocation fences original authority, denies older agent permits, and never certifies absent resources',async()=>{
  const pair=generateKeyPairSync('ed25519'),keyId='original-fixture-evidence';relaySigningPair=pair;
  const ackKey=generateKeyPairSync('ed25519'),backendKeyId='original-fixture-backend';
  const binding={...scope,accountId:'fixture-account',agentId,sourceKeyId:keyId,sourcePublicKeyPem:pair.publicKey.export({type:'spki',format:'pem'}).toString(),backendKeyId};
  relay=new FactoryRelayPolicyReceiver({ordered,binding,ackSigner:{keyId:backendKeyId,sign:async hash=>sign(null,Buffer.from(hash),ackKey.privateKey).toString('base64url')}});
  const payload={schema:'relay.policy-change.v1',eventId:'fixture-revocation',accountId:binding.accountId,aggregateId:agentId,kind:'AGENT_REVOKED',revision:1,
   source:{passportId:'fixture-passport',passportVersion:1,revokedLeaseIds:[]},issuedAt:new Date().toISOString(),accounting:'PRESERVE_UNKNOWN'};
  const payloadHash='sha256:'+digest(payload),envelope={payload,payloadHash,keyId,signature:sign(null,Buffer.from(payloadHash),pair.privateKey).toString('base64url')};
  const run=admitted.result.runId,lease=randomUUID(),verifyLease=randomUUID(),deadline=new Date(Date.now()+60000).toISOString();
  await admin.query("INSERT INTO factory.execution_resources(run_id,provider_name,provider_session_id,state,lease_owner,lease_expires_at,deadline,evidence) VALUES($1,'fixture-producer','sbx_fixture_producer','RUNNING',$2,$3,$3,'{\"cleanup\":\"UNKNOWN\"}')",[run,lease,deadline]);
  await admin.query("INSERT INTO factory.verification_resources(run_id,lease_owner,lease_expires_at,deadline,provider_name,provider_session_id,candidate_commit,candidate_tree,custody_sha256,policy_sha256,image,state,failure) VALUES($1,$2,$3,$3,'fixture-verifier','sbx_fixture_verifier',$4,$4,$5,$6,'fixture-image','FINISHED','VERIFIER_CLEANUP_UNKNOWN')",[run,verifyLease,deadline,'a'.repeat(40),'b'.repeat(64),verifierPolicySha256]);
  await store.transaction(async client=>{const row=await store.record(client,grant.clientId,admitted.request.requestId);await store.event(client,row,'verifier.claimed',{leaseOwner:verifyLease,providerName:'fixture-verifier',runId:run,workId:admitted.request.workId,workGeneration:1});});
  const advance=witness.advance.bind(witness);let once=true;
  witness.advance=async(...args)=>{if(once){once=false;throw Error('SIMULATED_REVOCATION_BEFORE_CAS');}return advance(...args);};
  try{await assert.rejects(relay.receive(envelope),/SIMULATED_REVOCATION_BEFORE_CAS/);}finally{witness.advance=advance;}
  const beforeRecovery=(await ordered.snapshot()).head,originalReceiver=ordered.relayPolicyReceiver;
  ordered.relayPolicyReceiver=null;
  try{await assert.rejects(ordered.challenge(make(),'fixture-mission'),/RELAY_POLICY_ENROLLMENT_UNAVAILABLE/);await witness.assert(beforeRecovery);assert.equal((await ordered.snapshot()).pending.length,1);}finally{ordered.relayPolicyReceiver=originalReceiver;}
  await ordered.challenge(make(),'fixture-mission'); // unrelated entry repairs the original stored revocation
  assert((await admin.query('SELECT cancelled_at FROM factory.execution_resources WHERE run_id=$1',[run])).rows[0].cancelled_at);
  assert(new Date((await admin.query('SELECT lease_expires_at FROM factory.verification_resources WHERE run_id=$1',[run])).rows[0].lease_expires_at).getTime()<=Date.now());
  const ack=await relay.receive(envelope);assert.equal(ack.receipt.admissionFence,'APPLIED');assert.equal(ack.receipt.cleanup,'PENDING_BACKEND');
  assert.equal(ack.receipt.accounting,'PRESERVE_UNKNOWN');assert.deepEqual(await relay.receive(envelope),ack);
  assert.equal((await admin.query('SELECT state FROM factory.production_work_authority WHERE request_id=$1',[admitted.request.requestId])).rows[0].state,'REVOKED');
  assert.equal((await admin.query('SELECT authority_state FROM factory.work_spend_budgets WHERE work_id=$1',[admitted.request.workId])).rows[0].authority_state,'fenced');
  await assert.rejects(relay.receive({...envelope,payload:{...payload,accountId:'foreign'}}),/INVALID/);
  const before=(await ordered.snapshot()).head;
  assert.deepEqual((await ordered.snapshot()).head,before);
  const inventory=await ordered.receiver.transaction(async client=>receiverInventory(ordered,client,await ordered.receiver.state(client),()=>true));
  assert.equal(inventory.inventoryComplete,false);assert.notEqual(aggregateLifecycle(inventory,'revoke'),'CLEANUP_CONFIRMED');
 });
 await t.test('positive canonical cleanup journals resolve physical uncertainty while financial UNKNOWN remains held',async()=>{
  const run=admitted.result.runId,lease=(await admin.query('SELECT lease_owner FROM factory.execution_resources WHERE run_id=$1',[run])).rows[0].lease_owner,verifyLease=(await admin.query('SELECT lease_owner FROM factory.verification_resources WHERE run_id=$1',[run])).rows[0].lease_owner;
  await assert.rejects(store.confirmCleanup(run,randomUUID(),1,'sbx_fixture_producer'),/MISMATCH/);
  await store.confirmCleanup(run,lease,1,'sbx_fixture_producer');
  const verification=new PostgresVerificationStore(store,{policy:verifierPolicy,policySha256:verifierPolicySha256});
  await assert.rejects(verification.cleanup(run,verifyLease,'sbx_foreign'),/UNPROVEN/);
  await verification.cleanup(run,verifyLease,'sbx_fixture_verifier');
  const inventory=()=>ordered.receiver.transaction(async client=>receiverInventory(ordered,client,await ordered.receiver.state(client),()=>true));
  const current=await inventory(),ownRun=current.runs.find(r=>r.identity.runId===run);assert(ownRun.positiveCleanup);assert.equal(ownRun.unknown,false);
  assert.equal((await spend.getOperation(unknownOperation)).state,'unknown');assert.equal((await spend.read(admitted.request.workId)).unknownExposureMicrousd,executionSpendPlan.perOperationReserveMicrousd);
  const journal=(await admin.query("DELETE FROM factory.events WHERE run_id=$1 AND type='verifier.cleanup_confirmed' RETURNING *",[run])).rows[0];
  assert.equal((await inventory()).runs.find(r=>r.identity.runId===run).positiveCleanup,false);
  await admin.query('INSERT INTO factory.events(id,work_order_id,run_id,type,payload,created_at) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,$5,$6)',[journal.id,journal.work_order_id,journal.run_id,journal.type,journal.payload,journal.created_at]);
  assert.equal((await inventory()).runs.find(r=>r.identity.runId===run).positiveCleanup,true);
  // A restore can remove a native intake while leaving its consumed references.
  // Its separately witnessed uncertain outcome must not become a definite decline.
  const orphan=(await ordered.snapshot()).data.capability_admission_references.find(r=>r.payload.requestId===uncertain.request.requestId&&r.payload.authority==='myeve');assert(orphan);
  assert((await inventory()).unqualified.some(r=>r.requestId===uncertain.request.requestId&&r.reason==='CONSUMED_REFERENCE_WITHOUT_NATIVE_INTAKE'));
 });
 await t.test('every original client is independently bound; new agent epoch never revives older admitted Work',async()=>{
  await ordered.receiveFence(await fence('myeve',3,'enable'));
  const secondOrdered=new OrderedFactoryAdmission({receiver,witness,directPool:direct,enrollment:ordered.enrollment,control:secondControl,signer,clientControls:originalControls,
   assertRetainedAuthority:ordered.assertRetainedAuthority,invalidateRetainedAuthority:ordered.invalidateRetainedAuthority,isRetainedAuthorityFenced:ordered.isRetainedAuthorityFenced});
  const request=make();await authorize(request,secondGrant.clientId);
  const stale=await permits(request,secondOrdered,0);
  await assert.rejects(secondOrdered.prepare(request,'fixture-mission',stale),/AGENT_REVOKED/);
  const current=await permits(request,secondOrdered,1),result=await secondOrdered.prepare(request,'fixture-mission',current);assert(result.runId);
  assert.equal((await secondOrdered.prepare(request,'fixture-mission',current)).runId,result.runId);
  const inventory=await receiver.transaction(async client=>receiverInventory(ordered,client,await receiver.state(client),()=>true));
  assert(inventory.runs.some(r=>r.identity.clientId===secondGrant.clientId&&r.identity.runId===result.runId&&r.identity.agentRevision===1));
  assert(!inventory.unqualified.some(r=>r.requestId===request.requestId&&/ORIGINAL_AUTHORITY|SCOPE|ADMISSION/.test(r.reason)));
  assert.equal((await admin.query('SELECT state FROM factory.production_work_authority WHERE request_id=$1',[admitted.request.requestId])).rows[0].state,'REVOKED');
  const activeLease=randomUUID(),activeVerifierLease=randomUUID(),activeDeadline=new Date(Date.now()+60000).toISOString();
  await admin.query("INSERT INTO factory.execution_resources(run_id,provider_name,provider_session_id,state,lease_owner,lease_expires_at,deadline,evidence) VALUES($1,'fixture-second-producer','sbx_second','RUNNING',$2,$3,$3,'{\"cleanup\":\"UNKNOWN\"}')",[result.runId,activeLease,activeDeadline]);
  await admin.query("INSERT INTO factory.verification_resources(run_id,lease_owner,lease_expires_at,deadline,provider_name,provider_session_id,candidate_commit,candidate_tree,custody_sha256,policy_sha256,image,state,failure) VALUES($1,$2,$3,$3,'fixture-second-verifier','sbx_second_verifier',$4,$4,$5,$6,'fixture-image','FINISHED','VERIFIER_CLEANUP_UNKNOWN')",[result.runId,activeVerifierLease,activeDeadline,'a'.repeat(40),'b'.repeat(64),verifierPolicySha256]);
  const revoke={schema:'relay.policy-change.v1',kind:'AGENT_REVOKED',eventId:randomUUID(),accountId:'fixture-account',aggregateId:agentId,revision:2,issuedAt:new Date().toISOString(),source:{passportId:'fixture-passport',passportVersion:2,revokedLeaseIds:[]},accounting:'PRESERVE_UNKNOWN'};
  const revokeHash='sha256:'+digest(revoke),revocation={payload:revoke,payloadHash:revokeHash,keyId:'original-fixture-evidence',signature:sign(null,Buffer.from(revokeHash),relaySigningPair.privateKey).toString('base64url')};
  const advanceRelay=witness.advance.bind(witness);let firstRelay=true;
  witness.advance=async(...args)=>{const value=await advanceRelay(...args);if(firstRelay){firstRelay=false;throw Error('SIMULATED_REVOCATION_AFTER_CAS');}return value;};
  try{await assert.rejects(relay.receive(revocation),/SIMULATED_REVOCATION_AFTER_CAS/);}finally{witness.advance=advanceRelay;}
  await ordered.receiveFence(await fence('relay',4)); // unrelated entry with witness ahead
  assert.equal((await admin.query('SELECT state FROM factory.production_work_authority WHERE request_id=$1',[request.requestId])).rows[0].state,'REVOKED');
  assert.equal((await admin.query('SELECT authority_state FROM factory.work_spend_budgets WHERE work_id=$1',[request.workId])).rows[0].authority_state,'fenced');
  assert((await admin.query('SELECT cancelled_at FROM factory.execution_resources WHERE run_id=$1',[result.runId])).rows[0].cancelled_at);
  assert(new Date((await admin.query('SELECT lease_expires_at FROM factory.verification_resources WHERE run_id=$1',[result.runId])).rows[0].lease_expires_at).getTime()<=Date.now());
  assert.equal((await relay.receive(revocation)).receipt.admissionFence,'APPLIED');
  const pause=await fence('myeve',4,'pause'),advance=witness.advance.bind(witness);
  witness.advance=async()=>{throw Error('SIMULATED_FENCE_BEFORE_CAS');};
  try{await assert.rejects(ordered.receiveFence(pause),/SIMULATED_FENCE_BEFORE_CAS/);}finally{witness.advance=advance;}
  await ordered.receiveFence(pause);
  const acknowledgment=await verifyLifecycleReceipt(await ordered.observeControl(pause),signer);
  assert.notEqual(acknowledgment.state,'PAUSE_CONFIRMED');assert.notEqual(acknowledgment.state,'CLEANUP_CONFIRMED');
  assert.equal((await admin.query("SELECT count(*) FROM factory.events WHERE run_id=$1 AND type='factory.capability_pause_requested'",[result.runId])).rows[0].count,'1');
  assert.equal((await spend.getOperation(unknownOperation)).state,'unknown');
 });
 await t.test('maximum legal retained history reconstructs under native bounds; oversize and restored rows cannot certify',async()=>{
  const historicalScope={...scope,ownerId:'fixture-history-owner',installationId:'fixture-history-install'},historyDigest=digest({historicalScope,fixture:true});
  const data=Object.fromEntries(receiverTables.map(table=>[table,[]])),collections=Object.fromEntries(Object.keys(collectionsAtZero()).map(t=>[t,[]])),plans=[];
  function collectionsAtZero(){return Object.fromEntries(receiverTables.filter(t=>!['capability_receiver_heads','capability_receiver_plans'].includes(t)).map(t=>[t,[]]));}
  let head=receiverHead(historicalScope,historyDigest,1,collections,[]);
  const row=(key,sequence,payload,kind)=>({key,sequence,payload,hash:digest(payload),kind});
  data.capability_receiver_heads.push(row('1',1,{head,previousDigest:null,runtimeRole:'receiver_runtime'}));
  for(let version=1;version<=2047;version++){
   const message={...historicalScope,authority:'relay',version,policyId:'fixture-history-policy-'+version,kind:'FENCE',capabilityId:'work',operation:'enable'};
   const hash=await policyMessageHash(message),payload={message,envelope:await signPolicyMessage(message,keys.relay),hash,
    ack:await signPolicyMessage({...historicalScope,authority:'relay',version,policyId:message.policyId,kind:'FENCE_ACK',fenceHash:hash},signer)};
   const sequence=version+1,key='relay:'+version,table=version<=128?'capability_control_observations':'capability_fences';
   const stored=version<=128?{domain:'fixture-large-observation',originalFence:payload,bytes:'x'.repeat(8192)}:payload,change={table,key,payload:stored};
   const material={domain:'factory-capability-receiver-plan/v1',scope:historicalScope,identity:{kind:'FENCE',hash},previous:head,rows:[change],createdAt:Date.now()},id=digest(material),plan={...material,id};
   const planHash=digest(plan),previousDigest=head.digest;
   data.capability_receiver_plans.push(row(id,sequence,plan,'PLAN'));plans.push({id,digest:planHash});
   data[table].push(row(key,sequence,stored));collections[table].push({key,sequence,payload:stored});
   head=receiverHead(historicalScope,historyDigest,sequence,collections,plans);
   data.capability_receiver_heads.push(row(String(sequence),sequence,{head,previousDigest}));
  }
  const columns='owner_id,organization_id,installation_id,backend_id,incarnation,enrollment_version,receiver_sequence,record_key,payload,payload_digest';
  for(const table of ['capability_fences','capability_control_observations','capability_receiver_plans','capability_receiver_heads'])for(let at=0;at<data[table].length;at+=64){
   const values=[],batch=data[table].slice(at,at+64),width=table==='capability_receiver_plans'?11:10;
   const placeholders=batch.map((record,index)=>{values.push(...scopeValues(historicalScope),record.sequence,record.key,record.payload,record.hash,...(record.kind?[record.kind]:[]));return '('+Array.from({length:width},(_,j)=>'$'+(index*width+j+1)).join(',')+')';});
   await admin.query('INSERT INTO factory.'+table+'('+columns+(table==='capability_receiver_plans'?',record_kind':'')+') VALUES '+placeholders.join(','),values);
  }
  await wadmin.query("INSERT INTO capability_witness.enrollments VALUES('history-enrollment',$1,$2,$3,$4,'witness_runtime',$5,$5,clock_timestamp()+interval '1 hour')",[historicalScope.organizationId,historicalScope.installationId,historicalScope.ownerId,epoch,historyDigest]);
  await wadmin.query("INSERT INTO capability_witness.heads VALUES('history-enrollment',$1,$2,$3,$4,$5)",[historicalScope.organizationId,historicalScope.installationId,historicalScope.ownerId,head.revision,head.digest]);
  const historical=new PostgresCapabilityReceiver(pool,historicalScope,historyDigest),historyWitness=new FactoryReceiverWitness({databaseUrl:wurl.href,...witness.config,enrollmentId:'history-enrollment',qualificationDigest:historyDigest,installationDigest:historyDigest,resources:witness.resources});
  try{
   const started=performance.now(),state=await historical.transaction(client=>historical.state(client));assert.equal(state.head.revision,2048);assert.deepEqual(state.head,head);await historyWitness.assert(state.head);
   t.diagnostic(JSON.stringify({qualification:'MAXIMUM_LEGAL_RETAINED_HISTORY',nonHeadRows:4094,heads:2048,largeObservations:128,observationPayloadBytes:8192,readAndWitnessMs:performance.now()-started}));
   assert(performance.now()-started<2000,'bounded read and witness phase');
   await assert.rejects(historical.transaction(client=>historical.append(client,'capability_control_observations','oversize',2048,{bytes:'x'.repeat(65537)})),/BOUND/);
   await assert.rejects(historical.transaction((client,now)=>historical.makePlan(client,state,{kind:'FENCE'},[{table:'capability_fences',key:'overflow',payload:{fixture:true}}],now)),/BOUND/);
   assert.deepEqual((await historical.transaction(client=>historical.state(client))).head,head);
   await admin.query("ALTER TABLE factory.capability_fences DISABLE TRIGGER ALL; DELETE FROM factory.capability_fences WHERE owner_id='fixture-history-owner' AND record_key='relay:1024'; ALTER TABLE factory.capability_fences ENABLE TRIGGER ALL");
   await assert.rejects(historical.transaction(client=>historical.state(client)),/RESTORED/);
  }finally{await historyWitness.close();}
 });
 await t.test('partial restored reference history cannot certify or admit',async()=>{
  await admin.query("ALTER TABLE factory.capability_admission_references DISABLE TRIGGER ALL; DELETE FROM factory.capability_admission_references WHERE payload->>'authority'='relay'; ALTER TABLE factory.capability_admission_references ENABLE TRIGGER ALL");
  await assert.rejects(ordered.snapshot(),/RESTORED/);
  await assert.rejects(ordered.prepare(make(),'fixture-mission',admitted.pair),/RESTORED/);
 });
});
