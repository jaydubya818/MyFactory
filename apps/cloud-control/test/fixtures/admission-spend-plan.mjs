import {productionSpendPlan} from '../../src/production-execution-plan.mjs';

// Authority/owner-isolation fixtures use real PostgreSQL time and never call
// a model. This is NOT a provider price qualification or production successor.
// Keep the exact bounded reservation/operation contract, with a distinct
// synthetic identity and validity limited to the disposable request deadline.
export function syntheticAdmissionSpendPlan(deadline) {
 return Object.freeze({...productionSpendPlan,
  model:'fixture/authority-only',pricingRevision:'fixture-authority-only-v1',
  validUntil:deadline,
 });
}
