import test from 'node:test';
// Historical qualified rate-card fixture. Runtime expiry remains enforced.
test.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T23:00:00.000Z')});
import assert from 'node:assert/strict';
import {productionModelProvider,productionModelPrice} from '../src/production-model-provider.mjs';
const installation={version:1,factoryId:'myfactory-cloud-production',environment:'production',projectId:'prj_4hfceCN8l6wN1gUyYOzZLQ7aJapK',callerProjectId:'prj_L6faw25wnFGUZtrLKBIccg8gIDLR',teamId:'team_p8z8exJRTGfOPk1GC9vUOpv3',ownerScope:'owner-private-a',custodyStoreId:'store_qBuivS8MmRxnBNnU',databaseResourceId:'dry-morning-22844424'};
const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:installation.projectId,VERCEL_ORG_ID:installation.teamId,FACTORY_PRODUCTION_INSTALLATION:JSON.stringify(installation)};
const claims={project_id:installation.projectId,owner_id:installation.teamId,environment:'production',iss:'https://oidc.vercel.com/jaydubya818',aud:'https://vercel.com/jaydubya818',exp:Math.floor(Date.now()/1000)+600};
const token='synthetic.claims.signature';
test('production adapter rechecks Work authority and verifies fresh exact Factory production identity on every operation',async()=>{
 const events=[];
 const provider=productionModelProvider({env,assertWorkAuthorized:async()=>{events.push('authority');}},
  {getToken:async(...args)=>{assert.deepEqual(args,[]);events.push('acquire');return token;},verifyToken:async(value,options)=>{
   assert.equal(value,token);assert.deepEqual(options,{projectId:installation.projectId,ownerId:installation.teamId,issuer:claims.iss,audience:claims.aud,environment:'production',algorithms:['RS256']});events.push('verify');return{payload:claims};}});
 assert.equal(await provider.authorize(),token);assert.equal(await provider.authorize(),token);
 assert.deepEqual(events,['authority','acquire','verify','authority','acquire','verify']);
 assert.equal(provider.upstreamApiKey,undefined);assert.equal(provider.upstreamOrigin,'https://ai-gateway.vercel.sh');
 assert.deepEqual(provider.price,productionModelPrice);
});
test('denied Work never acquires identity and never exposes the underlying error',async()=>{
 let acquired=false;
 const provider=productionModelProvider({env,assertWorkAuthorized:async()=>{throw Error('private-owner-material');}},
  {getToken:async()=>{acquired=true;return token;},verifyToken:async()=>({payload:claims})});
 await assert.rejects(provider.authorize(),/^Error: PRODUCTION_MODEL_AUTHORITY_UNAVAILABLE$/);assert.equal(acquired,false);
});
for(const patch of [{environment:'preview'},{environment:'development'},{project_id:installation.callerProjectId},{owner_id:'team_other'},{iss:'https://untrusted.invalid'},{aud:'other'},{exp:0},{exp:Math.floor(Date.now()/1000)+30},{exp:'9999999999'}])test('rejects incompatible verified production claim '+JSON.stringify(patch),async()=>{
 const provider=productionModelProvider({env,assertWorkAuthorized:async()=>{}},{getToken:async()=>token,verifyToken:async()=>({payload:{...claims,...patch}})});
 await assert.rejects(provider.authorize(),/^Error: PRODUCTION_MODEL_AUTHORITY_UNAVAILABLE$/);
});
test('signature failures and absent tokens cannot fall back to ambient static credentials',async()=>{
 for(const value of [undefined,'static-token',token]){
  const provider=productionModelProvider({env:{...env,AI_GATEWAY_API_KEY:'unusable-static-key'},assertWorkAuthorized:async()=>{}},
   {getToken:async()=>value,verifyToken:async()=>{throw Error('credential-bearing upstream error');}});
  await assert.rejects(provider.authorize(),/^Error: PRODUCTION_MODEL_AUTHORITY_UNAVAILABLE$/);
 }
});
test('production provider overwrites caller routing, retention, BYOK and service tier',()=>{
 const provider=productionModelProvider({env,assertWorkAuthorized:async()=>{}});
 assert.deepEqual(provider.prepareRequest({model:productionModelPrice.model,store:true,service_tier:'priority',providerOptions:{gateway:{only:['azure'],byok:{credential:'forbidden'}}}}),
  {model:productionModelPrice.model,store:false,service_tier:'default',providerOptions:{gateway:{only:['openai']}}});
 assert.throws(()=>provider.prepareRequest({model:'openai/unqualified'}),/PRODUCTION_MODEL_NOT_QUALIFIED/);
});
test('installation alone is insufficient; qualification and wrong runtime configuration remain denied',()=>{
 assert.throws(()=>productionModelProvider({env}),/PRODUCTION_MODEL_AUTHORITY_REQUIRED/);
 for(const patch of [{VERCEL_ENV:'preview'},{VERCEL_PROJECT_ID:installation.callerProjectId},{FACTORY_QUALIFICATION_TOKEN:'forbidden'}])
  assert.throws(()=>productionModelProvider({env:{...env,...patch},assertWorkAuthorized:async()=>{}}));
});

test('the unchanged rate card fails closed at its expiration',()=>{
 test.mock.timers.setTime(Date.parse(productionModelPrice.validUntil));
 try {assert.throws(()=>productionModelProvider({env,assertWorkAuthorized:async()=>{}}),/Current pinned model pricing/);}
 finally{test.mock.timers.setTime(Date.parse('2026-10-08T23:00:00.000Z'));}
});
