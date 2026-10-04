import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {productionAuthority,productionRecoveryAllowanceMs} from '../src/production-authority.mjs';
import {PostgresVerificationStore} from '../src/postgres-verification.mjs';
import {PostgresSpendLedger} from '../src/postgres-spend.mjs';
import {handleProductionControl} from '../src/production-control.mjs';
import {productionRuntimeComponents} from '../src/production-runtime-components.mjs';
import {productionProjectId,productionCallerProjectId,productionCustodyStoreId,productionDatabaseResourceId} from '../src/production-installation.mjs';
import {validationConfiguration,validationContractSha256,validationCandidateSha256} from '../src/production-validation-plan.mjs';

const installation={version:1,environment:'production',factoryId:'myfactory-cloud-production',ownerScope:'real-owner',projectId:productionProjectId,teamId:'team_p8z8exJRTGfOPk1GC9vUOpv3',callerProjectId:productionCallerProjectId,custodyStoreId:productionCustodyStoreId,databaseResourceId:productionDatabaseResourceId};
function fixture(){
 const sourceDigest='a'.repeat(64),configurationDigest=digest(validationConfiguration),request={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,deadline:new Date(Date.now()+60000).toISOString()},clientId='sofie-production-validation';
 const manifest={version:1,request,clientId,ownerScope:installation.ownerScope,environment:'CLOUD_PRODUCTION',publication:false,sourceDigest,configurationDigest,factoryVersion:digest({sourceDigest,configurationDigest}),contractSha256:validationContractSha256,candidateSha256:validationCandidateSha256};
 const row={request_id:request.requestId,work_id:request.workId,client_id:clientId,state:'AUTHORIZED',manifest,manifest_sha256:digest(manifest),consumed_at:null};
 const check=productionAuthority({installation,sourceDigest,configuration:validationConfiguration,contractSha256:validationContractSha256,clientId,candidateSha256:validationCandidateSha256});
 const client={query:async sql=>{if(sql.startsWith('UPDATE'))row.consumed_at??=new Date();return{rows:[row]};}};
 return{row,manifest,request,check,client};
}
test('only exact authorized production envelope can be consumed; replay cannot widen it',async()=>{
 const f=fixture();await f.check(f.client,f.request,Date.now(),'prepare');const consumed=f.row.consumed_at;
 await f.check(f.client,f.request,Date.now(),'prepare');assert.equal(f.row.consumed_at,consumed);
 await f.check(f.client,f.request,Date.now(),'model');
 for(const key of ['requestId','workId','workGeneration','deadline'])await assert.rejects(f.check(f.client,{...f.request,[key]:key==='workGeneration'?2:randomUUID()},Date.now(),'prepare'),/NOT_AUTHORIZED/);
 f.row.state='REVOKED';await assert.rejects(f.check(f.client,f.request,Date.now(),'claim'),/NOT_AUTHORIZED/);
});
test('owner, source, candidate, configuration, effects and manifest digest cannot be substituted',async()=>{
 for(const field of ['ownerScope','clientId','environment','sourceDigest','configurationDigest','factoryVersion','contractSha256','candidateSha256','publication']){
  const f=fixture();f.manifest[field]=field==='publication'?true:'other';f.row.manifest_sha256=digest(f.manifest);
  await assert.rejects(f.check(f.client,f.request,Date.now(),'prepare'),/NOT_AUTHORIZED/,field);
 }
 const f=fixture();f.row.manifest_sha256='b'.repeat(64);await assert.rejects(f.check(f.client,f.request,Date.now(),'prepare'),/NOT_AUTHORIZED/);
});
test('unconsumed and expired manifests cannot authorize subsequent effects',async()=>{
 const f=fixture();await assert.rejects(f.check(f.client,f.request,Date.now(),'claim'),/NOT_ADMITTED/);
 await assert.rejects(f.check(f.client,f.request,Date.now()+120000,'prepare'),/NOT_AUTHORIZED/);
});
test('revocation before verifier admission or between probes fences execution but not cleanup',async()=>{
 let revoked=false,checks=0,cleaned=false;
 const dispatch={assertAuthority:async()=>{checks++;if(revoked)throw Error('PRODUCTION_WORK_NOT_AUTHORIZED');},record:async()=>({run_id:'run',request:{}}),
  transaction:async action=>action({query:async sql=>{
   if(sql.startsWith('SELECT request'))return{rows:[{request:{}}]};
   if(sql.includes('SELECT 1 FROM factory.verification_resources'))return{rows:[{}],rowCount:1};
   if(sql.startsWith('UPDATE')){cleaned=true;return{rows:[],rowCount:1};}
   if(sql.includes('lease_owner=$2'))return{rows:[{provider_session_id:'sbx_1',deadline:new Date().toISOString()}]};
   return{rows:[],rowCount:0};
  }},Date.now())};
 const store=new PostgresVerificationStore(dispatch);
 await store.assertActive('run','lease');assert.equal(checks,1);revoked=true;
 await assert.rejects(store.claim('owner','request'),/NOT_AUTHORIZED/);
 await assert.rejects(store.assertActive('run','lease'),/NOT_AUTHORIZED/);
 await store.cleanup('run','lease','sbx_1');assert.equal(cleaned,true);
});
test('validation denies every paid ledger crossing before lease/provider access',async()=>{
 let queried=0;
 const ledger=new PostgresSpendLedger({}, {assertPaidAuthority:async()=>{throw Error('VALIDATION_MODEL_EXECUTION_FORBIDDEN');}});
 await assert.rejects(ledger.assertExecutionLease({query:async()=>{queried++;}},{}),/VALIDATION_MODEL_EXECUTION_FORBIDDEN/);assert.equal(queried,0);
});
test('release validation URL is exact and Proof credential cannot execute it',async()=>{
 const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:installation.projectId,VERCEL_ORG_ID:installation.teamId,FACTORY_PRODUCTION_INSTALLATION:JSON.stringify(installation),FACTORY_PRODUCTION_APPLICATION_TOKEN:'a'.repeat(64),FACTORY_PROOF_TOKEN:'b'.repeat(64),FACTORY_PROOF_OWNER_SCOPE:installation.ownerScope,FACTORY_PROOF_EXPIRES_AT:new Date(Date.now()+60000).toISOString()};
 let entered=0;const runtime=async(_env,action,options)=>{entered++;assert.deepEqual(options,{validation:true,cleanupOnly:false});return action({control:{prepare:async()=>({prepared:true})}});};
 const request=(path,token=env.FACTORY_PRODUCTION_APPLICATION_TOKEN)=>new Request('https://factory.invalid'+path,{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'});
 for(const path of ['/api/connect/v2/dispatches?path=release-validation/dispatches','/wrong?path=release-validation/dispatches','/api/cloud?path=release-validation/dispatches&extra=1','/api/cloud?path=release-validation/dispatches&path=release-validation/dispatches'])assert.equal((await handleProductionControl(request(path),env,runtime)).status,403);
 assert.equal((await handleProductionControl(request('/api/connect/v2/release-validation/dispatches',env.FACTORY_PROOF_TOKEN),env,runtime)).status,401);assert.equal(entered,0);
 assert.equal((await handleProductionControl(request('/api/connect/v2/release-validation/dispatches'),env,runtime)).status,200);assert.equal(entered,1);
});
test('paid approval hash must match the exact durable manifest',async()=>{
 const f=fixture();
 const options={installation,sourceDigest:'a'.repeat(64),configuration:validationConfiguration,contractSha256:validationContractSha256,clientId:'sofie-production-validation',candidateSha256:validationCandidateSha256};
 await assert.rejects(productionAuthority({...options,authorizationSha256:'b'.repeat(64)})(f.client,f.request,Date.now(),'prepare'),/NOT_AUTHORIZED/);
 await productionAuthority({...options,authorizationSha256:f.row.manifest_sha256})(f.client,f.request,Date.now(),'prepare');
});
test('withdrawn approval retains cleanup-only composition, which denies every execution authority check',async()=>{
 const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:installation.projectId,VERCEL_ORG_ID:installation.teamId,VERCEL_DEPLOYMENT_ID:'dpl_test',FACTORY_PRODUCTION_INSTALLATION:JSON.stringify(installation)};
 const options={env,pool:{},queue:{},signing:{factoryId:installation.factoryId,key:{factoryId:installation.factoryId,keyId:'production-cloud-v1'}},sourceDigest:'a'.repeat(64)};
 for(const hash of [undefined,'invalid'])assert.throws(()=>productionRuntimeComponents({...options,env:{...env,FACTORY_PRODUCTION_CANARY_AUTHORIZATION_SHA256:hash}}),/NOT_AUTHORIZED/);
 const runtime=productionRuntimeComponents({...options,cleanupOnly:true});
 for(const phase of ['prepare','claim','heartbeat','model','verification'])await assert.rejects(runtime.store.assertAuthority({}, {},Date.now(),phase),/PRODUCTION_CLEANUP_ONLY/);
});
test('only paid observation, stop and evidence routes request cleanup-only runtime',async()=>{
 const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:installation.projectId,VERCEL_ORG_ID:installation.teamId,FACTORY_PRODUCTION_INSTALLATION:JSON.stringify(installation),FACTORY_PRODUCTION_APPLICATION_TOKEN:'a'.repeat(64),FACTORY_PROOF_TOKEN:'b'.repeat(64),FACTORY_PROOF_OWNER_SCOPE:installation.ownerScope,FACTORY_PROOF_EXPIRES_AT:new Date(Date.now()+60000).toISOString()};
 for(const [method,path,expected,proof] of [['GET','dispatches/'+randomUUID(),true,false],['POST','dispatches/'+randomUUID()+'/stop',true,false],['POST','evidence/read',true,true],['POST','dispatches',false,false],['POST','dispatches/'+randomUUID()+'/dispatch',false,false],['GET','actions',false,false]]){
  let options;
  await handleProductionControl(new Request('https://factory.invalid/api/connect/v2/production-canary/'+path,{method,headers:{authorization:'Bearer '+(proof?env.FACTORY_PROOF_TOKEN:env.FACTORY_PRODUCTION_APPLICATION_TOKEN)},...(method==='POST'?{body:'{}'}:{})}),env,async(_env,_action,value)=>{options=value;return new Response();});
  assert.deepEqual(options,{validation:false,cleanupOnly:expected});
 }
});
test('canonical effect authority requires Proof and signer horizon beyond the full recovery window',async()=>{
 const deadline=Date.now()+180000,bound=deadline+productionRecoveryAllowanceMs;
 for(const validation of [false,true])for(const offset of [-1,0,1])for(const short of ['proof','signer']){
  let queried=0;
  const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:installation.projectId,VERCEL_ORG_ID:installation.teamId,VERCEL_DEPLOYMENT_ID:'dpl_test',FACTORY_PRODUCTION_INSTALLATION:JSON.stringify(installation),FACTORY_PRODUCTION_CANARY_AUTHORIZATION_SHA256:'d'.repeat(64),FACTORY_PROOF_EXPIRES_AT:new Date(bound+(short==='proof'?offset:1000)).toISOString()};
  const runtime=productionRuntimeComponents({env,validation,pool:{},queue:{},sourceDigest:'a'.repeat(64),signing:{factoryId:installation.factoryId,key:{factoryId:installation.factoryId,keyId:'production-cloud-v1',notAfter:new Date(bound+(short==='signer'?offset:1000)).toISOString()}}});
  const client={query:async()=>{queried++;return{rows:[]};}};
  for(const phase of ['prepare','claim'])await assert.rejects(runtime.store.assertAuthority(client,{deadline:new Date(deadline).toISOString()},Date.now(),phase),offset<=0?/RECOVERY_HORIZON/:/NOT_AUTHORIZED/);
  assert.equal(queried,offset<=0?0:2,'expiry is checked before authority consumption or resource allocation');
 }
});
