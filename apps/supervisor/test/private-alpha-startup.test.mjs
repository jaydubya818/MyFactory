import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSupervisor} from '../src/server.ts';
import {FactoryDispatchControl} from '../src/dispatch-control.ts';
import {validateRealProvider,PRIVATE_ALPHA_MODEL,PRIVATE_ALPHA_ENDPOINT,PRIVATE_ALPHA_SECRET_REF} from '../src/real-provider.ts';
const config={mode:'OPENAI_RESPONSES_PRIVATE_ALPHA',model:PRIVATE_ALPHA_MODEL,endpoint:PRIVATE_ALPHA_ENDPOINT,
 secretRef:PRIVATE_ALPHA_SECRET_REF,price:{revision:'startup-test',model:PRIVATE_ALPHA_MODEL,
 validUntil:new Date(Date.now()+600000).toISOString(),contextLimitTokens:400000,outputLimitTokens:8192,
 inputMicrousdPerMillion:750000,outputMicrousdPerMillion:4500000}};
test('real startup cannot borrow synthetic workers, fixtures, or authority overrides',()=>{
 for(const option of [{localFactoryFixture:true},{localSpendFixture:{}},{jobDependencies:{}},{startRun:()=>{}},{confirmHumanPresence:()=>true}]){
  assert.throws(()=>createSupervisor({realProvider:config,...option}),/cannot use fixture/);
 }
});
test('real startup requires provisioned signing before attempting credential access',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-startup-'));
 try{assert.throws(()=>createSupervisor({dataDir:dir,realProvider:config}),/signing must be provisioned/);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('provider configuration rejects inline secrets and oversized model bounds',()=>{
 assert.throws(()=>validateRealProvider({...config,apiKey:'never-load-an-inline-secret'}),/unqualified/);
 for(const price of [{...config.price,contextLimitTokens:400001},{...config.price,outputLimitTokens:8193}])
  assert.throws(()=>validateRealProvider({...config,price}),/limits exceed/);
});
test('live preparation rejects expanded Work authority before touching persistence or provider',async()=>{
 const control=new FactoryDispatchControl(null,null,null,null,false,undefined,true);
 assert.equal(control.executionAvailability().mode,'LIVE');
 const client={actions:['factory.prepare']};
 const input={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/golden',deadline:new Date(Date.now()+300000).toISOString(),maxSpendUsd:1.35,input:{},
 spendContract:{version:'WORK_LEDGER_V2',pricingRevision:'startup-test',maxPaidOperations:4,plannedProductiveOperations:3,plannedCompletionOperations:1,completionReserveMicrousd:336864}};
 for(const changed of [{maxSpendUsd:1.36},{deadline:new Date(Date.now()+700000).toISOString()},
  {spendContract:undefined},{spendContract:{...input.spendContract,maxPaidOperations:5}},
  {spendContract:{...input.spendContract,plannedProductiveOperations:4}},
  {spendContract:{...input.spendContract,plannedCompletionOperations:2}}])
  await assert.rejects(control.prepare(client,{...input,...changed}),/Private-alpha Work/);
});
