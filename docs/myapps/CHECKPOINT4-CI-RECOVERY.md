# MyApps Checkpoint 4 — deterministic CI recovery

The accepted preparation checkpoint `025a06e58200333f2df32a3910b235e7ffaff0b7`
is preserved as ancestry. Original PR #13 remains untouched. PR #15 is DRAFT / HOLD.

The three historical pricing regressions copy the exact test files from canonical
`18e59dbedbe04275858327ca47d2bd7ec01a407c`. Date-only fixture clocks preserve
the historical rates and expiry, including an explicit expiry-denial assertion.

PostgreSQL admission/isolation tests use real database time and a test-only
synthetic plan with a distinct non-provider model/revision, request-bound expiry,
and unchanged numerical reservation/operation limits. They qualify authority,
revocation and isolation, not current production pricing. Expired synthetic plans
are rejected without persisting a budget. Existing accounting assertions remain.

Before publication: historical pricing 19/19 PASS; PostgreSQL/fixture regression
22/22 PASS, zero skips; independent read-only fixture review PASS. Full final CI
and composition evidence is tracked in the PR description.

Canonical pricing-owner coordination is separate from adoption. No production
price refresh, expiry extension, source-identity repin or UNKNOWN implementation
is included. External Alpha owns the reproduced partition-fencing dependency.
No merge, deployment, installed migration, paid execution, production grant,
external-alpha installation or credential changes are authorized.
