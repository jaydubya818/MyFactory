import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {externalAlphaModelProvider,productionModelProvider,productionModelPrice} from '../src/production-model-provider.mjs';
import {externalAlphaRuntimeComponents,externalAlphaFactoryVersion} from '../src/external-alpha-runtime.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {makeInstallation,runtimePrivateSource} from './fixtures/external-alpha-authority.mjs';

function fixture(){
 const base=makeInstallation(),config={...base.config,factoryVersion:externalAlphaFactoryVersion(base.installation,base.config.source.sourceDigest)};
 const {installation}=makeInstallation(base.keys,config);
 const host={version:1,factoryId:'myfactory-external-alpha',environment:'production',ownerScope:'external-alpha:'+installation.cohortId,projectId:'prj_DedicatedFixture',teamId:'team_DedicatedFixture',custodyStoreId:'store_DedicatedFixture',databaseResourceId:'dedicated-fixture-db'};
 const raw=JSON.stringify(host),env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production',VERCEL_PROJECT_ID:host.projectId,VERCEL_ORG_ID:host.teamId,
  FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_JSON:raw,FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_SHA256:createHash('sha256').update(raw).digest('hex'),
  FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify([config]),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:digest([installation.sha256])};
 const claims={project_id:host.projectId,owner_id:host.teamId,environment:'production',iss:'https://oidc.vercel.com/jaydubya818',aud:'https://vercel.com/jaydubya818',exp:Math.floor(Date.now()/1000)+600};
 return {installation,host,env,claims};
}
const token='synthetic.claims.signature';
test('dedicated adapter verifies exact live host and every Work before credential acquisition without canary configuration',async()=>{
 const f=fixture(),events=[];
 const provider=externalAlphaModelProvider({...f,assertWorkAuthorized:async()=>events.push('authority')},{getToken:async(...args)=>{assert.deepEqual(args,[]);events.push('oidc');return token;},verifyToken:async(t,options)=>{
  assert.equal(t,token);assert.deepEqual(options,{projectId:f.host.projectId,ownerId:f.host.teamId,issuer:f.claims.iss,audience:f.claims.aud,environment:'production',algorithms:['RS256']});events.push('verify');return{payload:f.claims};}});
 assert.equal(await provider.authorize(),token);assert.equal(await provider.authorize(),token);
 assert.deepEqual(events,['authority','oidc','verify','authority','oidc','verify']);
 assert.deepEqual(provider.price,productionModelPrice);assert.equal(provider.upstreamOrigin,'https://ai-gateway.vercel.sh');assert.equal(provider.upstreamApiKey,undefined);
 assert.deepEqual(provider.prepareRequest({model:productionModelPrice.model,store:true,service_tier:'priority',providerOptions:{gateway:{only:['azure'],byok:{credential:'forbidden'}}}}),{model:productionModelPrice.model,store:false,service_tier:'default',providerOptions:{gateway:{only:['openai']}}});
 assert.throws(()=>productionModelProvider({...f,assertWorkAuthorized:async()=>{}}),/PRODUCTION_INSTALLATION_REQUIRED/);
});
test('missing, revoked and changed-host authority never acquire identity or fall back to static keys',async()=>{
 const f=fixture();let acquired=0;
 const deps={getToken:async()=>{acquired++;return token;},verifyToken:async()=>({payload:f.claims})};
 assert.throws(()=>externalAlphaModelProvider(f,deps),/PRODUCTION_MODEL_AUTHORITY_REQUIRED/);
 const denied=externalAlphaModelProvider({...f,env:{...f.env,AI_GATEWAY_API_KEY:'unusable-fixture'},assertWorkAuthorized:async()=>{throw Error('private-detail');}},deps);
 await assert.rejects(denied.authorize(),/^Error: PRODUCTION_MODEL_AUTHORITY_UNAVAILABLE$/);
 const changing=externalAlphaModelProvider({...f,assertWorkAuthorized:async()=>{}},deps);f.env.VERCEL_PROJECT_ID='prj_Foreign';
 await assert.rejects(changing.authorize(),/^Error: PRODUCTION_MODEL_AUTHORITY_UNAVAILABLE$/);assert.equal(acquired,0);
});
test('dedicated adapter rejects cross-host, canary, synthetic and preview installation before OIDC',()=>{
 const f=fixture();let acquired=0;const deps={getToken:async()=>{acquired++;},verifyToken:async()=>{throw Error();}};
 for(const patch of [{VERCEL_PROJECT_ID:f.installation.application.projectId},{VERCEL_ORG_ID:'team_Foreign'},{VERCEL_ENV:'preview'},{VERCEL_TARGET_ENV:'preview'},
  {FACTORY_PRODUCTION_INSTALLATION:'forbidden'},{FACTORY_PROOF_TOKEN:'forbidden'},{FACTORY_QUALIFICATION_TOKEN:'forbidden'},{MYEVE_CLOUD_DETERMINISTIC_ENABLED:'1'},{FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_SHA256:'0'.repeat(64)}])
  assert.throws(()=>externalAlphaModelProvider({...f,env:{...f.env,...patch},assertWorkAuthorized:async()=>{}},deps),/EXTERNAL_ALPHA_HOST_INSTALLATION_REQUIRED/);
 assert.equal(acquired,0);
});
test('dedicated adapter rejects every incompatible verified claim and absent/signature-invalid tokens',async()=>{
 const f=fixture();
 for(const patch of [{project_id:f.installation.application.projectId},{owner_id:'team_Foreign'},{environment:'preview'},{iss:'https://oidc.vercel.com/foreign'},{aud:'https://vercel.com/foreign'},{exp:0},{exp:Math.floor(Date.now()/1000)+30},{exp:'9999999999'}]){
  const p=externalAlphaModelProvider({...f,assertWorkAuthorized:async()=>{}},{getToken:async()=>token,verifyToken:async()=>({payload:{...f.claims,...patch}})});
  await assert.rejects(p.authorize(),/^Error: PRODUCTION_MODEL_AUTHORITY_UNAVAILABLE$/);
 }
 for(const value of [undefined,'static-token',token]){
  const p=externalAlphaModelProvider({...f,env:{...f.env,AI_GATEWAY_API_KEY:'unusable-fixture'},assertWorkAuthorized:async()=>{}},{getToken:async()=>value,verifyToken:async()=>{throw Error('private-signature-detail');}});
  await assert.rejects(p.authorize(),/^Error: PRODUCTION_MODEL_AUTHORITY_UNAVAILABLE$/);
 }
});
test('actual runtime default producer constructs dedicated adapter and denies wrong host before touching sandbox or paid transport',async()=>{
 const f=fixture();let touched=0;
 const deps={...runtimePrivateSource(f.installation),env:f.env,pool:{},queue:{},installation:f.installation,sourceDigest:f.installation.source.sourceDigest,
  signing:{factoryId:'myfactory-external-alpha',key:{factoryId:'myfactory-external-alpha',keyId:'external-alpha-result-v1'}},signReceipt:()=>'s',signReadback:()=>'s',hostInstallation:f.host,deploymentId:'dpl_Fixture'};
 // No provider/model-provider injection: execute uses the canonical runtime closure.
 const runtime=externalAlphaRuntimeComponents(deps),sandbox={asUser(){touched++;throw Error('OFFLINE_SANDBOX_BOUNDARY');}},row={identity:{},request:{deadline:new Date(Date.now()+120000).toISOString()}};
 await assert.rejects(runtime.provider.execute(sandbox,async()=>{},row,async()=>{}),/OFFLINE_SANDBOX_BOUNDARY/);assert.equal(touched,1);
 f.env.VERCEL_PROJECT_ID='prj_Foreign';
 await assert.rejects(runtime.provider.execute(sandbox,async()=>{},row,async()=>{}),/EXTERNAL_ALPHA_HOST_INSTALLATION_REQUIRED/);assert.equal(touched,1);
});
