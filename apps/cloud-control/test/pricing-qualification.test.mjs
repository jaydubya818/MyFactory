import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {productionAuthority} from '../src/production-authority.mjs';
import assert from 'node:assert/strict';
import current from '../../../docs/capability-control/pricing-20261020/20261020-v3.json' with {type:'json'};
import predecessorPrice from '../../../docs/capability-control/pricing-20261010/20261010-v2.json' with {type:'json'};
import recovery from '../../../docs/capability-control/source-identity-20261010/recovery-successor.json' with {type:'json'};
import historical from '../../../docs/capability-control/pricing-20261010/historical-v1.json' with {type:'json'};
import {validatePrice} from '../../supervisor/src/spend-gateway.ts';
import {productionModelPrice} from '../src/production-model-provider.mjs';
import {cloudHarnessPrice} from '../src/cloud-harness-plan.mjs';
import {productionExecutionContract,productionExecutionContractSha256} from '../src/production-execution-plan.mjs';

for (const kind of ['production','deterministic']) test(`${kind}: successor preserves exact model, rates, limits and conservative reserve`, () => {
  const before=historical.prices[kind],after=current.prices[kind];
  assert.deepEqual(kind==='production'?productionModelPrice:cloudHarnessPrice,after);
  for (const key of ['model','contextLimitTokens','outputLimitTokens','inputMicrousdPerMillion','outputMicrousdPerMillion']) assert.equal(after[key],before[key],key);
  assert.notEqual(after.revision,before.revision);
  const ceilMillion=value=>(value+999999n)/1000000n;
  const reserve=ceilMillion(BigInt(after.contextLimitTokens)*BigInt(after.inputMicrousdPerMillion))+ceilMillion(BigInt(after.outputLimitTokens)*BigInt(after.outputMicrousdPerMillion));
  assert.equal(reserve,BigInt(current.unchangedAccounting[kind+'PerOperationReserveMicrousd']));
});

test('both historical prices remain expired; successor also fails closed at its review deadline', t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse(current.effectiveFrom)});
  for (const kind of ['production','deterministic']) {
    assert.throws(()=>validatePrice(historical.prices[kind]),/Current pinned model pricing/);
    assert.throws(()=>validatePrice(predecessorPrice.prices[kind]),/Current pinned model pricing/);
    assert.notEqual(current.prices[kind].revision,predecessorPrice.prices[kind].revision);
    assert.doesNotThrow(()=>validatePrice(current.prices[kind]));
  }
  t.mock.timers.setTime(Date.parse(current.reviewBy));
  for (const price of Object.values(current.prices)) assert.throws(()=>validatePrice(price),/Current pinned model pricing/);
});

test('successor changes approval contract identity without widening the approved spending envelope', () => {
  assert.notEqual(productionExecutionContractSha256,historical.productionContract.executionContractSha256);
  assert.notEqual(productionExecutionContractSha256,recovery.executionContractSha256);
  assert.equal(productionExecutionContract.maxSpendMicrousd,historical.productionContract.ceiling);
  for (const key of ['perOperationReserveMicrousd','plannedProductiveOperations','plannedCompletionOperations','maxPaidOperations','completionReserveMicrousd']) {
    assert.equal(productionExecutionContract.spendPlan[key],historical.productionContract.spendPlan[key],key);
  }
  assert.equal(productionExecutionContract.publication,false);
  assert.equal(productionExecutionContract.merge,false);
});


test('an exact old approval cannot authorize the successor execution contract', async () => {
  const now=Date.now(),configuration={synthetic:'pricing-boundary'},sourceDigest='a'.repeat(64),ownerScope='synthetic-owner',clientId='sofie-production';
  const configurationDigest=digest(configuration),factoryVersion=digest({sourceDigest,configurationDigest});
  const request={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,deadline:new Date(now+60000).toISOString()};
  const template={version:1,clientId,ownerScope,environment:'CLOUD_PRODUCTION',publication:false,sourceDigest,configurationDigest,factoryVersion,
    contractSha256:historical.productionContract.executionContractSha256,candidateSha256:null,request:{...request,requestId:null,deadline:null}};
  const envelope={version:1,approval:{workVersion:1,manifestTemplate:template},expiresAt:new Date(now+120000).toISOString()};
  const authorizationSha256=digest(envelope),manifest={...template,version:2,request,authorizationEnvelope:envelope,authorizationEnvelopeSha256:authorizationSha256};
  const row={state:'AUTHORIZED',client_id:clientId,work_id:request.workId,manifest,manifest_sha256:digest(manifest),consumed_at:null};
  let consumed=0;
  const client={query:async sql=>{if(sql.startsWith('UPDATE'))consumed++;return {rows:[row]};}};
  const options={installation:{ownerScope},sourceDigest,configuration,clientId,authorizationSha256};
  await productionAuthority({...options,contractSha256:template.contractSha256})(client,request,now,'prepare');
  assert.equal(consumed,1);
  await assert.rejects(productionAuthority({...options,contractSha256:productionExecutionContractSha256})(client,request,now,'prepare'),/PRODUCTION_WORK_NOT_AUTHORIZED/);
  assert.equal(consumed,1);
});
