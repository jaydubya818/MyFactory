// Synthetic accounting contract for disposable PostgreSQL tests. This does not
// renew a production price card; pricing-qualification.test.mjs covers expiry.
export function localSpendPlan(plan) {
  return { ...plan, pricingRevision: `synthetic-local-${plan.pricingRevision}`,
    validUntil: new Date(Date.now() + 600_000).toISOString() };
}
