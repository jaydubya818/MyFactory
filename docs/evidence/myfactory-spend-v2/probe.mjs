// Requalifies the three V1 counterexamples against V2. All providers are loopback fixtures.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {SpendLedger} from '../../../packages/storage/src/spend.ts';
import {SpendGateway} from '../../../apps/supervisor/src/spend-gateway.ts';

const price={revision:'v2-probe',model:'fixture-model',validUntil:new Date(Date.now()+60000).toISOString(),
  contextLimitTokens:1000,outputLimitTokens:100,inputMicrousdPerMillion:1_000_000,outputMicrousdPerMillion:2_000_000};
async function scenario(name,ceiling,usage,exercise){
  const dir=mkdtempSync(join(tmpdir(),'myfactory-v2-probe-'));
  const path=join(dir,'factory.sqlite'),storage=openStorage(path);
  const order=storage.createWorkOrder({title:name,description:'Local synthetic probe',kind:'feature',repositoryPath:dir,
    baseRef:'a'.repeat(40),acceptanceCriteria:['Bounded'],reproductionCommand:null,expectedFailureText:null,
    checkCommands:[],allowedPaths:['quantity.mjs'],workerProfile:'mac'});
  const run=storage.createRun({workOrderId:order.id,workerProfile:'mac',inputCommit:'a'.repeat(40),workspacePath:dir});
  const ledger=new SpendLedger(path),binding={workId:name,workGeneration:1,dispatchIdentity:'probe-dispatch',
    requestId:'probe-request',workOrderId:order.id,factoryVersion:'probe-only',runId:run.id};
  const deadline=new Date(Date.now()+60000).toISOString();
  ledger.createBudget(binding,ceiling,deadline,{version:'WORK_LEDGER_V2',pricingRevision:price.revision,model:price.model,
    validUntil:price.validUntil,perOperationReserveMicrousd:1200,plannedProductiveOperations:2,
    plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:1200});
  ledger.bindAuthority(binding);
  let calls=0;
  const upstream=createServer((req,res)=>{calls++;req.resume();res.writeHead(200,{'content-type':'application/json',
    'x-request-id':name+'-'+calls});res.end(JSON.stringify({id:'response-'+calls,status:'completed',
      ...(usage?{usage}:{})}));});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const gateways=[];
  async function gateway(phase){
    const childToken='token-'+phase+'-'+name;
    const g=new SpendGateway({ledger,binding,price,phase,upstreamOrigin:'http://127.0.0.1:'+upstream.address().port,
      upstreamApiKey:'synthetic-only',childToken});
    gateways.push(g);
    const base=await g.listen();
    return async()=>{const r=await fetch(base+'/responses',{method:'POST',headers:{authorization:'Bearer '+childToken,
      'content-type':'application/json'},body:JSON.stringify({model:price.model,input:'probe'})});await r.text();return r.status;};
  }
  try{return await exercise({ledger,binding,gateway,calls:()=>calls});}
  finally{
    for(const g of gateways)await g.close();
    await new Promise(resolve=>upstream.close(resolve));
    ledger.close();storage.close();rmSync(dir,{recursive:true,force:true});
  }
}
const unknown=await scenario('unknown-with-headroom',4000,null,async f=>{
  const call=await f.gateway('productive');
  assert.equal(await call(),503);const before=f.calls();assert.equal(await call(),503);
  assert.equal(f.calls()-before,0);assert.equal(f.ledger.read(f.binding.workId).unknownExposureMicrousd,1200);
  return {postUnknownCalls:f.calls()-before,unknownExposureMicrousd:1200};
});
const completion=await scenario('completion-starvation',3600,{input_tokens:1000,output_tokens:100},async f=>{
  const productive=await f.gateway('productive');
  assert.equal(await productive(),200);assert.equal(await productive(),200);
  const before=f.calls();assert.equal(await productive(),503);assert.equal(f.calls()-before,0);
  assert.equal(f.ledger.read(f.binding.workId).completionReserveRemainingMicrousd,1200);
  f.ledger.beginCompletion(f.binding);
  const complete=await f.gateway('completion');assert.equal(await complete(),200);
  f.ledger.assertCompleted(f.binding);
  return {completionStarvation:0,completionReserveTheft:0,providerCalls:f.calls()};
});
const operationLimit=await scenario('operation-limit',3600,{input_tokens:10,output_tokens:10},async f=>{
  const productive=await f.gateway('productive');
  assert.equal(await productive(),200);assert.equal(await productive(),200);
  const before=f.calls();assert.equal(await productive(),503);assert.equal(f.calls()-before,0);
  f.ledger.beginCompletion(f.binding);
  const complete=await f.gateway('completion');assert.equal(await complete(),200);
  const total=f.calls();assert.equal(await complete(),503);assert.equal(f.calls(),total);
  assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,3);
  return {callsBeyondLimit:0,paidOperationsUsed:3,maxPaidOperations:3};
});
console.log(JSON.stringify({qualification:'PASS_LOCAL_SYNTHETIC',paidProviderCalls:0,
  postUnknownCalls:unknown.postUnknownCalls,completionStarvation:completion.completionStarvation,
  callsBeyondLimit:operationLimit.callsBeyondLimit,completionReserveTheft:completion.completionReserveTheft,
  unknown,completion,operationLimit},null,2));
