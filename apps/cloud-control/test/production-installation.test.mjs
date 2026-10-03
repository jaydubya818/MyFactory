import test from 'node:test';import assert from 'node:assert/strict';
import {productionInstallation,assertProductionAdmissionDisabled,productionCallerProjectId,productionProjectId,productionCustodyStoreId,productionDatabaseResourceId}from'../src/production-installation.mjs';
import {handleProductionReadiness}from'../src/production-readiness.mjs';
import {handleCloud}from'../api/cloud.mjs';
const config={version:1,environment:'production',factoryId:'myfactory-cloud-production',ownerScope:'owner',projectId:productionProjectId,teamId:'team_p8z8exJRTGfOPk1GC9vUOpv3',callerProjectId:productionCallerProjectId,custodyStoreId:productionCustodyStoreId,databaseResourceId:productionDatabaseResourceId};
const env={FACTORY_PRODUCTION_INSTALLATION:JSON.stringify(config),VERCEL:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production',VERCEL_PROJECT_ID:config.projectId,VERCEL_ORG_ID:config.teamId};
test('production installation binds exact runtime and fresh resource identities without granting Work',()=>{assert.deepEqual(productionInstallation(env),config);assert.equal(assertProductionAdmissionDisabled(env),'DISABLED');});
test('production rejects preview, foreign identity and every qualification credential',()=>{for(const patch of [{VERCEL_ENV:'preview'},{VERCEL_TARGET_ENV:'preview'},{VERCEL_PROJECT_ID:'prj_other'},{VERCEL_ORG_ID:'team_other'},...['FACTORY_QUALIFICATION_TOKEN','FACTORY_SOFIE_STAGING_TOKEN','FACTORY_STAGING_PROTECTION_BYPASS','MYEVE_CLOUD_DETERMINISTIC_ENABLED'].map(key=>({[key]:'present'}))])assert.throws(()=>productionInstallation({...env,...patch}));});
test('production cannot reuse staging resources, owner or a different caller',()=>{for(const patch of [{projectId:'prj_IRXTY6HOzS2q9wRPdabsJnmddzl4'},{custodyStoreId:'store_kZ9n2mzEmqmKX7bZ'},{ownerScope:'cloud-qualification-owner'},{callerProjectId:'prj_other'},{extra:true}])assert.throws(()=>productionInstallation({...env,FACTORY_PRODUCTION_INSTALLATION:JSON.stringify({...config,...patch})}));});
test('an environment toggle cannot silently activate paid production Work',()=>assert.throws(()=>assertProductionAdmissionDisabled({...env,FACTORY_PRODUCTION_WORK_AUTHORIZATION:'true'})));
const configured={...env,FACTORY_PRODUCTION_APPLICATION_TOKEN:'a'.repeat(64),FACTORY_PROOF_TOKEN:'b'.repeat(64),FACTORY_PROOF_OWNER_SCOPE:'owner',FACTORY_PROOF_EXPIRES_AT:new Date(Date.now()+60000).toISOString()};
const request=(path,method='GET',token=configured.FACTORY_PRODUCTION_APPLICATION_TOKEN)=>new Request('https://factory.example'+path,{method,headers:{authorization:'Bearer '+token},...(method==='POST'?{body:'{}'}:{})});
test('all production execution routes deny before entering the qualification runtime',async()=>{
 let entered=0;const runtime=async()=>{entered++;throw Error('QUALIFICATION_RUNTIME_ENTERED');};
 for(const path of ['/api/connect/v2/dispatches','/api/connect/v2/dispatches/11111111-1111-4111-8111-111111111111/dispatch','/api/cloud?path=dispatches']){
  const response=await handleCloud(request(path,'POST'),configured,runtime);assert.equal(response.status,403);assert.equal((await response.json()).admission,'DISABLED');
 }
 assert.equal(entered,0);
 for(const token of ['wrong',configured.FACTORY_PROOF_TOKEN])assert.equal((await handleCloud(request('/api/connect/v2/dispatches','POST',token),configured,runtime)).status,401);
 assert.equal(entered,0);
});
test('production action discovery never advertises a qualified writer',async()=>{
 for(const path of ['/api/connect/v2/actions','/api/cloud?path=actions','/api/connect/v2/actions?path=actions']){
  const response=await handleCloud(request(path),configured);assert.equal(response.status,200);
  const body=await response.json();assert.deepEqual(body.controls,[]);assert.equal(body.execution.qualified,false);assert.equal(body.qualificationOnly,false);
 }
 for(const path of ['/api/cloud?path=actions&extra=true','/api/connect/v2/dispatches?path=actions','/api/cloud?path=actions&path=actions'])assert.equal((await handleCloud(request(path),configured)).status,403);
});
test('readiness authenticates first and distinguishes available infrastructure from execution',async()=>{
 let started=0;const checks=()=>{started++;return{database:async()=>{},artifacts:async()=>{},provider:async()=>{}};};
 assert.equal((await handleProductionReadiness(request('/api/readiness','GET','wrong'),configured,checks)).status,401);assert.equal(started,0);
 const response=await handleProductionReadiness(request('/api/readiness'),configured,checks);assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.platformReady,true);assert.equal(body.ready,false);assert.equal(body.executionAdmission,'DISABLED');
 const failed=await handleProductionReadiness(request('/api/readiness'),configured,()=>({...checks(),database:async()=>{throw Error('postgres://credential@host');}}));
 assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/credential|postgres:/);
});
test('credential equality, expired proof or wrong owner closes production readiness',async()=>{
 for(const patch of [{FACTORY_PROOF_TOKEN:configured.FACTORY_PRODUCTION_APPLICATION_TOKEN},{FACTORY_PROOF_OWNER_SCOPE:'another-owner'},{FACTORY_PROOF_EXPIRES_AT:'2000-01-01T00:00:00.000Z'}]){
  let called=false;assert.equal((await handleProductionReadiness(request('/api/readiness'),{...configured,...patch},()=>{called=true;})).status,503);assert.equal(called,false);
 }
});
