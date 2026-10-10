# QE criterion-evidence source governance reconciliation

The unchanged producer inventory checker on canonical source
`18e59dbedbe04275858327ca47d2bd7ec01a407c` and fixture successor
`3642666c8ba6b8e702a1c9b595316b18b87f06dc` found the same three stale fingerprints.
The complete inventory contains 123 changed runtime sources and 123 records;
there are no missing or stale paths. The checker's first-error output originally
showed only `external-alpha-verifier.mjs`.

All three source changes came from canonical QE-002 commit
`005d1023535a74ec2c1119b38cf15026cf76256a`, which added signed per-criterion protected
verifier evidence. The runtime bytes are unchanged by this reconciliation. No
record is excluded, no classification is downgraded, and the checker is unchanged.

| Canonical source | Preserved classification | Reviewed SHA-256 |
|---|---|---|
| `apps/cloud-control/src/external-alpha-verifier.mjs` | INDEPENDENT_ACCEPTANCE_ADAPTER | `b69237ba935e9971e4e234e4b5ccdfec5c8b454c336ccda17e60cac81a303a96` |
| `apps/cloud-control/src/postgres-verification.mjs` | CLOUD_PROTECTED_VERIFICATION | `069add839624515d0b2bc3c02bace2e85e4273e169f8c7eae016a5db482b40b8` |
| `packages/hosted-routing/src/result.ts` | NOT_APPLICABLE | `9935c61e8c2684d2288ea5a483d804607e901985b71daa56612138720d32cf17` |

The adapter requires ten exact, unique criterion outcomes and a consistent
aggregate. Missing, duplicate, unknown, contradictory, unattested or unbound
reports remain PARTIAL. Host identity, policy/hidden-suite pins and pre/post
authority checks remain enforced. Every accepted criterion references the same
protected report digest without disclosing hidden assertions.

The PostgreSQL store validates the optional digest shape, requires one shared
digest when the pinned policy demands it, and rejects an inconsistent aggregate.
Exact run/lease/authority, cancellation, expiry, producer cleanup and verifier
cleanup remain separate gates. Result parsing preserves legacy checks without the
new optional digest; present digests must be valid SHA-256 values. Existing exact
shape, signature, candidate/policy, outcome, isolation and chronology checks remain
in force. Parsing creates no execution, acceptance or publication authority.

## Validation

- Unchanged `node scripts/check-producer-governance.mjs`: **123 sources PASS**.
- External-alpha verifier, production verifier policy, cloud verification and
  hosted-routing protocol tests: **27/27 PASS**, zero skips.
- Unchanged `postgres-alpha-criteria-local.test.mjs`: **8/8 PASS**, zero skips, on
  an isolated disposable PostgreSQL 17 fixture at localhost:55591; server stopped
  after qualification. Covers missing/substituted/contradictory report rejection,
  nine-PASS/one-FAIL retention, concurrency, scope, cancellation, expiry, ambiguous
  cleanup and protected FAIL preservation.

This inventory review is not a production FactoryVersion approval, UNKNOWN
accounting qualification, custody approval, release approval or authorization to
merge/deploy. Runtime source, pricing, migrations, source-identity pins and all
existing release/deployment controls remain unchanged. Exact successor hosted CI
and mandatory release gates still apply.
