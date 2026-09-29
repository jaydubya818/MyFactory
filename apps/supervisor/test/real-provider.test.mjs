import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {SpendLedger} from '../../../packages/storage/src/spend.ts';
import {SpendGateway} from '../src/spend-gateway.ts';
import {loadRealProvider,PRIVATE_ALPHA_ENDPOINT,PRIVATE_ALPHA_MODEL,PRIVATE_ALPHA_SECRET_REF} from '../src/real-provider.ts';
const secret='sk-synthetic-private-alpha-credential-123456';
const price={revision:'explicit-fixture-revision',model:PRIVATE_ALPHA_MODEL,
 validUntil:new Date(Date.now()+60000).toISOString(),contextLimitTokens:1000,outputLimitTokens:100,
 inputMicrousdPerMillion:750000,outputMicrousdPerMillion:4500000};
const config={mode:'OPENAI_RESPONSES_PRIVATE_ALPHA',endpoint:PRIVATE_ALPHA_ENDPOINT,
 model:PRIVATE_ALPHA_MODEL,secretRef:PRIVATE_ALPHA_SECRET_REF,price};
test('explicit pinned config loads only a synthetic injected secret',()=>{
 const loaded=loadRealProvider(config,()=>secret);
 assert.equal(loaded.upstreamOrigin,'https://api.openai.com');
 assert.equal(loaded.upstreamApiKey,secret);
 assert.deepEqual(loaded.price,price);
});
test('missing, inaccessible and malformed Keychain values fail closed without disclosure',()=>{
 for(const read of [()=>'',()=>{throw Error(secret)},()=> 'wrong-secret']){
  assert.throws(()=>loadRealProvider(config,read),error=>!String(error).includes(secret)&&/credential unavailable/.test(String(error)));
 }
});
test('endpoint, model, secret ref, expiry and mode cannot silently fall back',()=>{
 const changes=[{endpoint:'http://127.0.0.1:9999/v1/responses'},
  {endpoint:'https://api.openai.com/v1/chat/completions'},
  {model:'gpt-5.4-mini'}, {secretRef:'keychain://other/service'}, {mode:'LOOPBACK'},
  {price:{...price,model:'other'}},{price:{...price,validUntil:'2000-01-01T00:00:00Z'}}];
 for(const change of changes)assert.throws(()=>loadRealProvider({...config,...change},()=>secret));
});

test('explicit real-provider config reaches only the synthetic metered boundary',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'real-provider-fixture-'));
 const path=join(dir,'factory.sqlite'),storage=openStorage(path);
 const order=storage.createWorkOrder({title:'Provider fixture',description:'No real provider',kind:'feature',
  repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['safe'],reproductionCommand:null,
  expectedFailureText:null,checkCommands:[],allowedPaths:['test.txt'],workerProfile:'mac'});
 const run=storage.createRun({workOrderId:order.id,workerProfile:'mac',inputCommit:'a'.repeat(40),workspacePath:dir});
 const ledger=new SpendLedger(path);
 const binding={workId:'private-alpha-fixture',workGeneration:1,dispatchIdentity:'dispatch-fixture',
  requestId:'request-fixture',workOrderId:order.id,factoryVersion:'factory-fixture',runId:run.id};
 const loaded=loadRealProvider(config,()=>secret);
 const perCall=1200;
 ledger.createBudget(binding,4000,new Date(Date.now()+60000).toISOString(),{version:'WORK_LEDGER_V2',
  pricingRevision:price.revision,model:price.model,validUntil:price.validUntil,
  perOperationReserveMicrousd:perCall,plannedProductiveOperations:1,plannedCompletionOperations:1,
  maxPaidOperations:2,completionReserveMicrousd:perCall});
 ledger.bindAuthority(binding);
 const gateway=new SpendGateway({ledger,binding,phase:'productive',...loaded,childToken:'f'.repeat(64)});
 const local=await gateway.listen();
 const originalFetch=globalThis.fetch;
 let upstreamCalls=0;
 globalThis.fetch=async (url,options)=>{
  assert.equal(String(url),PRIVATE_ALPHA_ENDPOINT);
  assert.equal(options.headers.authorization,'Bearer '+secret);
  upstreamCalls++;
  return new Response(JSON.stringify({id:'synthetic-response',status:'completed',usage:{input_tokens:10,output_tokens:10}}),
   {status:200,headers:{'content-type':'application/json','x-request-id':'synthetic-provider-request'}});
 };
 t.after(async()=>{globalThis.fetch=originalFetch;await gateway.close();ledger.close();storage.close();rmSync(dir,{recursive:true,force:true});});
 const response=await originalFetch(local+'/responses',{method:'POST',headers:{authorization:'Bearer '+ 'f'.repeat(64),
  'content-type':'application/json'},body:JSON.stringify({model:PRIVATE_ALPHA_MODEL,input:'synthetic only'})});
 assert.equal(response.status,200);
 assert.equal(upstreamCalls,1);
 assert.equal(ledger.read(binding.workId).settledMicrousd,53);
});
