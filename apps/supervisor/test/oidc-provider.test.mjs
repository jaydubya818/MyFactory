import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {oidcProvider,GATEWAY_MODEL,GATEWAY_ENDPOINT,PRIVATE_ALPHA_IDENTITY} from '../src/oidc-provider.ts';
import {loadRealProvider,validateRealProvider} from '../src/real-provider.ts';
import {providerAuthorization} from '../src/provider-connection.ts';
import {SpendGateway} from '../src/spend-gateway.ts';
import {SpendLedger} from '../../../packages/storage/src/spend.ts';
import {openStorage} from '../../../packages/storage/src/index.ts';

const token='synthetic-oidc-credential-never-persist';
const config=()=>({mode:'VERCEL_OIDC_GATEWAY_PRIVATE_ALPHA',endpoint:GATEWAY_ENDPOINT,model:GATEWAY_MODEL,
 identity:{...PRIVATE_ALPHA_IDENTITY},price:{revision:'oidc-fixture',model:GATEWAY_MODEL,
 validUntil:new Date(Date.now()+600000).toISOString(),contextLimitTokens:1000,outputLimitTokens:100,
 inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:2000000}});
function identity(options={}){
 let now=Date.now(),calls=0,verifications=0;
 const payload=()=>({project_id:PRIVATE_ALPHA_IDENTITY.projectId,owner_id:PRIVATE_ALPHA_IDENTITY.teamId,
  iss:PRIVATE_ALPHA_IDENTITY.issuer,aud:PRIVATE_ALPHA_IDENTITY.audience,environment:'development',exp:Math.floor(now/1000)+3600,...options.claims});
 const deps={now:()=>now,getToken:async request=>{
  calls++;assert.deepEqual(request,{project:PRIVATE_ALPHA_IDENTITY.projectId,team:PRIVATE_ALPHA_IDENTITY.teamId,expirationBufferMs:120000});
  if(options.missing)throw Error(token);return token;
 },verifyToken:async(value,request)=>{
  verifications++;assert.equal(value,token);
  assert.deepEqual(request,{projectId:PRIVATE_ALPHA_IDENTITY.projectId,ownerId:PRIVATE_ALPHA_IDENTITY.teamId,
   issuer:PRIVATE_ALPHA_IDENTITY.issuer,audience:PRIVATE_ALPHA_IDENTITY.audience,environment:'development',algorithms:['RS256']});
  if(options.signatureFailure)throw Error(token);return {payload:payload()};
 }};
 return {deps,advance:ms=>{now+=ms},get calls(){return calls},get verifications(){return verifications}};
}
test('OIDC pins configuration and never falls back to the Keychain reader',()=>{
 const c=config();assert.doesNotThrow(()=>validateRealProvider(c));
 let reads=0;const loaded=loadRealProvider(c,()=>{reads++;throw Error('Keychain must remain unused');});
 assert.equal(reads,0);assert.equal(loaded.upstreamApiKey,undefined);assert.equal(typeof loaded.authorize,'function');
 for(const mutation of [{mode:'unknown'},{endpoint:'https://other.invalid/v1/responses'},{model:'openai/other'},
  {identity:{...c.identity,projectId:'other'}},{identity:{...c.identity,audience:'*'}},{apiKey:token},{secretRef:'keychain://other/item'}])
  assert.throws(()=>validateRealProvider({...c,...mutation}),/unqualified/);
});
test('scoped SDK identity is acquired once, verified, refreshed before expiry, and reacquired on restart',async()=>{
 const f=identity(),provider=oidcProvider(config(),f.deps);
 assert.equal(await providerAuthorization(provider),token);
 await Promise.all([providerAuthorization(provider),providerAuthorization(provider)]);
 assert.equal(f.calls,1);assert.equal(f.verifications,1);
 f.advance(3500000);await providerAuthorization(provider);assert.equal(f.calls,2);
 await providerAuthorization(oidcProvider(config(),f.deps));assert.equal(f.calls,3);
 assert(!JSON.stringify(provider).includes(token));
});
test('wrong project, owner, audience, issuer, environment, expiry or signature fail closed without token disclosure',async()=>{
 for(const change of [{claims:{project_id:'other'}},{claims:{owner_id:'other'}},{claims:{aud:'other'}},
  {claims:{iss:'https://other.invalid'}},{claims:{environment:'production'}},{claims:{exp:1}},
  {claims:{exp:undefined}},{signatureFailure:true},{missing:true}]){
  const f=identity(change),provider=oidcProvider(config(),f.deps);
  await assert.rejects(providerAuthorization(provider),e=>String(e)==='Error: Provider identity unavailable'&&!String(e).includes(token));
  assert.equal(f.calls,1);
 }
});

async function fixture(t,behavior='complete'){
 const dir=mkdtempSync(join(tmpdir(),'oidc-gateway-')),file=join(dir,'factory.sqlite');
 const storage=openStorage(file);let ledger=new SpendLedger(file);
 const order=storage.createWorkOrder({title:'OIDC fixture',description:'Synthetic only',kind:'feature',repositoryPath:dir,
  baseRef:'a'.repeat(40),acceptanceCriteria:['bounded'],reproductionCommand:null,expectedFailureText:null,
  checkCommands:[],allowedPaths:['test.txt'],workerProfile:'mac'});
 const run=storage.createRun({workOrderId:order.id,workerProfile:'mac',inputCommit:'a'.repeat(40),workspacePath:dir});
 const binding={workId:'oidc-work',workGeneration:1,dispatchIdentity:'oidc-dispatch',requestId:'oidc-request',workOrderId:order.id,factoryVersion:'oidc-factory',runId:run.id};
 const c=config(),f=identity(),provider=oidcProvider(c,f.deps);
 ledger.createBudget(binding,3600,new Date(Date.now()+60000).toISOString(),{version:'WORK_LEDGER_V2',pricingRevision:c.price.revision,
  model:c.price.model,validUntil:c.price.validUntil,perOperationReserveMicrousd:1200,plannedProductiveOperations:2,
  plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:1200});
 ledger.bindAuthority(binding);
 let gateway=new SpendGateway({...provider,ledger,binding,phase:'productive',childToken:'a'.repeat(64)});
 let origin=await gateway.listen(),upstreamCalls=0;
 const nativeFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),GATEWAY_ENDPOINT);assert.equal(options.headers.authorization,'Bearer '+token);
  assert.equal(options.redirect,'error');
  const payload=JSON.parse(options.body);assert.equal(payload.model,GATEWAY_MODEL);
  assert.deepEqual(payload.providerOptions,{gateway:{only:['openai']}});assert.equal(payload.store,false);
  assert.equal(ledger.read(binding.workId).operations.at(-1).state,'dispatched');
  upstreamCalls++;
  if(behavior==='throw')throw Error(token);
  if(behavior==='denied')return new Response(JSON.stringify({error:token}),{status:403});
  if(behavior==='unknown')return new Response(JSON.stringify({status:'completed'}));
  return new Response(JSON.stringify({id:behavior==='echo'?token:'oidc-response-'+upstreamCalls,status:'completed',usage:{input_tokens:10,output_tokens:10}}),{status:200,headers:{'content-type':'application/json'}});
 };
 const call=(extra={})=>nativeFetch(origin+'/responses',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64),'content-type':'application/json'},body:JSON.stringify({model:GATEWAY_MODEL,input:'synthetic',...extra})});
 t.after(async()=>{globalThis.fetch=nativeFetch;await gateway.close();ledger.close();storage.close();
  assert(!readFileSync(file).includes(Buffer.from(token)));rmSync(dir,{recursive:true,force:true});});
 return {call,binding,provider,f,get ledger(){return ledger},get calls(){return upstreamCalls},
  async completion(){await gateway.close();ledger.beginCompletion(binding);gateway=new SpendGateway({...provider,ledger,binding,phase:'completion',childToken:'a'.repeat(64)});origin=await gateway.listen();},
  async restart(){await gateway.close();ledger.close();ledger=new SpendLedger(file);ledger.recoverUnknown();
   gateway=new SpendGateway({...oidcProvider(c,f.deps),ledger,binding,phase:'productive',childToken:'a'.repeat(64)});origin=await gateway.listen();}
 };
}
test('OIDC requests remain admitted, limited and completion-reserved; local tool search does not create extra operations',async t=>{
 const f=await fixture(t);
 for(const extra of [{model:'other'},{providerOptions:{gateway:{models:['other']}}},{tools:[{type:'tool_search'}]},{tools:[{type:'web_search'}]}])
  assert.equal((await f.call(extra)).status,400);
 assert.equal(f.calls,0);assert.equal(f.f.calls,0);
 const search={type:'tool_search',execution:'client',description:'Local discovery',parameters:{type:'object'}};
 assert.equal((await f.call({tools:[search]})).status,200);
 assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,1);
 assert.equal((await f.call({input:[{type:'tool_search_output',execution:'client',call_id:'search',status:'completed',tools:[]}],tools:[search]})).status,200);
 assert.equal((await f.call()).status,503);assert.equal(f.calls,2);
 await f.completion();assert.equal((await f.call()).status,200);
 assert.equal((await f.call()).status,503);assert.equal(f.calls,3);
 f.ledger.assertCompleted(f.binding);
});
test('gateway denial, transport loss, missing usage and credential echoes retain UNKNOWN without retries or disclosure',async t=>{
 for(const behavior of ['denied','throw','unknown','echo'])await t.test(behavior,async t=>{
  const f=await fixture(t,behavior),response=await f.call();assert.equal(response.status,503);
  assert(!(await response.text()).includes(token));assert.equal(f.calls,1);
  assert.equal(f.ledger.read(f.binding.workId).status,'UNKNOWN');
  assert.equal(f.ledger.read(f.binding.workId).retainedMicrousd,1200);
  assert.equal((await f.call()).status,503);assert.equal(f.calls,1);
  await f.restart();assert.equal((await f.call()).status,503);assert.equal(f.calls,1);
 });
});
test('cancellation denies OIDC model dispatch without a paid operation',async t=>{
 const f=await fixture(t);f.ledger.cancel(f.binding.workId);
 assert.equal((await f.call()).status,503);assert.equal(f.calls,0);
 assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,0);
});
