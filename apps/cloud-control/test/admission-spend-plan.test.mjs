import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticAdmissionSpendPlan} from './fixtures/admission-spend-plan.mjs';
import {productionSpendPlan} from '../src/production-execution-plan.mjs';
import {validateBudget} from '../../../packages/storage/src/spend-policy.ts';

test('synthetic admission fixture preserves ceilings and cannot qualify production pricing',()=>{
 const original=JSON.stringify(productionSpendPlan),now=Date.now(),deadline=new Date(now+60000).toISOString();
 const plan=syntheticAdmissionSpendPlan(deadline);
 assert.equal(plan.validUntil,deadline);
 assert.notEqual(plan.model,productionSpendPlan.model);
 assert.notEqual(plan.pricingRevision,productionSpendPlan.pricingRevision);
 for(const field of ['version','perOperationReserveMicrousd','plannedProductiveOperations','plannedCompletionOperations','maxPaidOperations','completionReserveMicrousd'])
  assert.equal(plan[field],productionSpendPlan[field],field);
 const binding={workId:'fixture-work',workGeneration:1,requestId:'fixture-request',workOrderId:'fixture-order'};
 validateBudget(binding,1000000,deadline,plan,now);
 assert.throws(()=>validateBudget(binding,1000000,new Date(now+120000).toISOString(),plan,Date.parse(deadline)),/Qualified pricing has expired/);
 assert.equal(JSON.stringify(productionSpendPlan),original);
 assert(Object.isFrozen(plan));
});
