import test from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {productionAuthority} from '../src/production-authority.mjs';
import assert from 'node:assert/strict';
import current from '../../../docs/capability-control/pricing-20261102/20261102-v5.json' with {type:'json'};
import predecessorPrice from '../../../docs/capability-control/pricing-20261022/20261022-v4.json' with {type:'json'};
import v3Price from '../../../docs/capability-control/pricing-20261020/20261020-v3.json' with {type:'json'};
import alphaPredecessorPrice from '../../../docs/external-alpha/pricing-backport-20261011/20261010-v2.json' with {type:'json'};
import recovery from '../../../docs/capability-control/source-identity-20261010/recovery-successor.json' with {type:'json'};
import historical from '../../../docs/capability-control/pricing-20261010/historical-v1.json' with {type:'json'};
import {validatePrice} from '../../supervisor/src/spend-gateway.ts';
import {productionModelPrice} from '../src/production-model-provider.mjs';
import {cloudHarnessPrice} from '../src/cloud-harness-plan.mjs';
import {productionExecutionContract,productionExecutionContractSha256,productionSpendPlan} from '../src/production-execution-plan.mjs';

function sha256File(relative){
  return createHash('sha256').update(readFileSync(fileURLToPath(new URL(relative,import.meta.url)))).digest('hex');
}

for (const kind of ['production','deterministic']) test(`${kind}: successor preserves exact model, rates, limits and conservative reserve`, () => {
  const before=historical.prices[kind],after=current.prices[kind];
  assert.deepEqual(kind==='production'?productionModelPrice:cloudHarnessPrice,after);
  for (const key of ['model','contextLimitTokens','outputLimitTokens','inputMicrousdPerMillion','outputMicrousdPerMillion']) {
    assert.equal(after[key],before[key],key);
    assert.equal(after[key],predecessorPrice.prices[kind][key],`v4 ${key}`);
  }
  assert.notEqual(after.revision,before.revision);
  assert.notEqual(after.revision,predecessorPrice.prices[kind].revision);
  const ceilMillion=value=>(value+999999n)/1000000n;
  const reserve=ceilMillion(BigInt(after.contextLimitTokens)*BigInt(after.inputMicrousdPerMillion))+ceilMillion(BigInt(after.outputLimitTokens)*BigInt(after.outputMicrousdPerMillion));
  assert.equal(reserve,BigInt(current.unchangedAccounting[kind+'PerOperationReserveMicrousd']));
  assert.equal(current.unchangedAccounting[kind+'PerOperationReserveMicrousd'],predecessorPrice.unchangedAccounting[kind+'PerOperationReserveMicrousd']);
});

test('historical v3 and v4 pricing records remain byte-identical', () => {
  assert.equal(sha256File('../../../docs/capability-control/pricing-20261022/20261022-v4.json'),'8a8ba064814a0fb56163924ab1cd1091be6d572e7dee84753e3ff8afec59d331');
  assert.equal(sha256File('../../../docs/capability-control/pricing-20261020/20261020-v3.json'),'ef9c94ed54e026b0ab1c7e0fd8b74ed12ad0cb924f3bdf5b4a341b5efb11def3');
  assert.equal(predecessorPrice.version,'openai-mini-20261022-v4');
  assert.equal(predecessorPrice.status,'OWNER_APPROVED_2026-10-22');
  assert.equal(predecessorPrice.reviewBy,'2026-10-29T00:00:00.000Z');
  assert.equal(v3Price.version,'openai-mini-20261020-v3');
  assert.equal(v3Price.reviewBy,'2026-10-28T00:00:00.000Z');
  for (const key of ['ceilingMicrousd','productionPerOperationReserveMicrousd','deterministicPerOperationReserveMicrousd','productiveOperations','completionOperations','maximumOperations']) {
    assert.equal(current.unchangedAccounting[key],predecessorPrice.unchangedAccounting[key],key);
    assert.equal(current.unchangedAccounting[key],v3Price.unchangedAccounting[key],key);
  }
});

test('expired v1/v2/v3/v4 records stay rejected; proposed v5 validates until its review deadline', t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse(current.effectiveFrom)});
  for (const kind of ['production','deterministic']) {
    assert.throws(()=>validatePrice(historical.prices[kind]),/Current pinned model pricing/);
    assert.throws(()=>validatePrice(alphaPredecessorPrice.prices[kind]),/Current pinned model pricing/);
    assert.throws(()=>validatePrice(v3Price.prices[kind]),/Current pinned model pricing/);
    assert.throws(()=>validatePrice(predecessorPrice.prices[kind]),/Current pinned model pricing/);
    assert.notEqual(current.prices[kind].revision,predecessorPrice.prices[kind].revision);
    assert.ok(Date.parse(predecessorPrice.prices[kind].validUntil)<Date.parse(current.prices[kind].validUntil));
    assert.equal(current.supersedes,'../pricing-20261022/20261022-v4.json');
    assert.doesNotThrow(()=>validatePrice(current.prices[kind]));
  }
  t.mock.timers.setTime(Date.parse(current.reviewBy));
  for (const price of Object.values(current.prices)) assert.throws(()=>validatePrice(price),/Current pinned model pricing/);
});

test('successor changes approval contract identity without widening the approved spending envelope', () => {
  assert.notEqual(productionExecutionContractSha256,historical.productionContract.executionContractSha256);
  assert.notEqual(productionExecutionContractSha256,recovery.executionContractSha256);
  for (const old of ['d7a24ed69b7d8267d4817961bd0ee22c76b6313650177b31322783dcc9d2d9a3','377cf5e6412003394805b3f1169d24cd7468c683c8f758999b32c3b5b5d20cf3','e0100d72075c2c0faec51de54527b0c0d00ce036691a358b647c35e9b0c30cd6']) {
    assert.notEqual(productionExecutionContractSha256,old);
  }
  assert.equal(productionExecutionContract.maxSpendMicrousd,historical.productionContract.ceiling);
  for (const key of ['perOperationReserveMicrousd','plannedProductiveOperations','plannedCompletionOperations','maxPaidOperations','completionReserveMicrousd']) {
    assert.equal(productionExecutionContract.spendPlan[key],historical.productionContract.spendPlan[key],key);
  }
  assert.equal(productionSpendPlan.perOperationReserveMicrousd,84864);
  assert.equal(productionExecutionContract.publication,false);
  assert.equal(productionExecutionContract.merge,false);
});

test('proposal does not activate paid Work and does not claim owner approval', () => {
  assert.equal(current.status,'PROPOSED_AWAITING_OWNER_APPROVAL');
  assert.equal(current.approval.approvedBy,null);
  assert.equal(current.authority,'PRICING_ONLY_NO_EXECUTION_GRANT');
  assert.equal(productionExecutionContract.status,'AWAITING_COMPOSED_QUALIFICATION');
  assert.equal(productionExecutionContract.publication,false);
  assert.equal(productionExecutionContract.merge,false);
  assert.equal(productionExecutionContract.deployGeneratedCandidate,false);
  assert.equal(productionExecutionContract.maxSpendMicrousd,1000000);
  assert.equal(productionSpendPlan.maxPaidOperations,3);
  assert.equal(productionSpendPlan.plannedProductiveOperations,2);
  assert.equal(productionSpendPlan.plannedCompletionOperations,1);
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

import impact from '../../../docs/external-alpha/pricing-backport-20261011/identity-impact.json' with {type:'json'};
import sourceIdentity from '../src/source-identity.json' with {type:'json'};
import runtimeSuccessor from '../../../docs/capability-control/source-identity-20261023/qa-remediation-runtime-source-successor.json' with {type:'json'};
import predecessorSuccessor from '../../../docs/capability-control/source-identity-20261023/qa-remediation-undici-advisory-successor.json' with {type:'json'};
import currentSuccessor from '../../../docs/capability-control/source-identity-20261025/sofie-integration-successor.json' with {type:'json'};
import {externalAlphaFactoryVersion,externalAlphaConfiguration,externalAlphaRuntimeComponents} from '../src/external-alpha-runtime.mjs';
import {loadVectors,installationOf} from './fixtures/myeve-conformance/support.mjs';

import developerBetaSuccessor from '../../../docs/capability-control/source-identity-20261029/developer-beta-candidate.json' with {type:'json'};
import candidateSuccessor from '../../../docs/capability-control/source-identity-20261102/pricing-v5-proposal-successor.json' with {type:'json'};

test('separate successor identity preserves configuration; an old installation cannot authorize it', () => {
 assert.equal(sourceIdentity.sourceDigest,candidateSuccessor.sourceDigest);
 assert.equal(candidateSuccessor.predecessorSourceDigest,developerBetaSuccessor.sourceDigest);
 assert.equal(developerBetaSuccessor.predecessorSourceDigest,currentSuccessor.sourceDigest);
 assert.equal(candidateSuccessor.configurationDigest,developerBetaSuccessor.configurationDigest);
 assert.equal(developerBetaSuccessor.configurationDigest,currentSuccessor.configurationDigest);
 assert.equal(candidateSuccessor.independentSourceQualification,'PENDING');
 assert.equal(candidateSuccessor.releaseQualified,false);
 assert.equal(candidateSuccessor.paidExecution,'NOT_AUTHORIZED');
 assert.equal(developerBetaSuccessor.paidExecution,'NOT_AUTHORIZED');
 assert.equal(predecessorSuccessor.predecessorSourceDigest,'c239cad91c6811a738dcd9baac34b7e884df79ce051ab683cf6005b86a6c890c');
 assert.equal(predecessorSuccessor.predecessorSourceDigest,runtimeSuccessor.sourceDigest);
 assert.equal(currentSuccessor.predecessorSourceDigest,'8b5f65861455f3290820cb111ad81e9f3729781e4ef00188521b7fe020776600');
 assert.equal(currentSuccessor.predecessorSourceDigest,predecessorSuccessor.sourceDigest);
 assert.equal(currentSuccessor.configurationDigest,predecessorSuccessor.configurationDigest);
 assert.notEqual(sourceIdentity.sourceDigest,currentSuccessor.predecessorSourceDigest);
 assert.notEqual(sourceIdentity.sourceDigest,developerBetaSuccessor.sourceDigest);
 assert.equal(impact.newSourceDigest,'fb92947fa4822c225ea5d1924eec21a148fe185a91d37fc72d04a763fbde4982');
 assert.notEqual(sourceIdentity.sourceDigest,impact.newSourceDigest);
 const old=structuredClone(installationOf(loadVectors()));
 old.source={...old.source,sourceDigest:impact.oldSourceDigest};
 old.factoryVersion=externalAlphaFactoryVersion(old,impact.oldSourceDigest);
 const successor={...old,source:{...old.source,sourceDigest:sourceIdentity.sourceDigest}};
 assert.deepEqual(externalAlphaConfiguration(successor),externalAlphaConfiguration(old));
 const version=externalAlphaFactoryVersion(successor,sourceIdentity.sourceDigest);
 assert.notEqual(version,old.factoryVersion);
 let effects=0;
 const deps={pool:{query:()=>{effects++;throw Error('UNREACHABLE');}},queue:{send:()=>{effects++;throw Error('UNREACHABLE');}},signReceipt:()=>{effects++;throw Error('UNREACHABLE');},signReadback:()=>{effects++;throw Error('UNREACHABLE');},sourceDigest:sourceIdentity.sourceDigest};
 assert.throws(()=>externalAlphaRuntimeComponents({...deps,installation:old}),e=>e.code==='AUTHORITY_INSTALLATION_MISMATCH');
 assert.throws(()=>externalAlphaRuntimeComponents({...deps,installation:successor}),e=>e.code==='AUTHORITY_INSTALLATION_MISMATCH');
 assert.equal(effects,0);
});
