# MYFACTORY PR #14 READINESS

Decision: **Merge readiness NO. Deployment readiness NO.** Existing holds remain.

## Source and scope

- Main and PR base: `030b1a51017f3159436b93817ed2d5bf6ae18288`.
- Audited implementation head: `195b1d1271546a59c6657b6349ef4a6d898bec06`.
- Main is already an ancestor: two implementation commits ahead, zero behind. No rebase or merge performed.
- This qualification repair changes tests, their CI coverage, and this report only. Runtime source, pricing, provider configuration, lockfile, stored identity and budget ceilings remain byte-identical to the audited implementation head.
- Canonical enforcement source remains MyEve `76e0d9f3ff18157128138ef75a9f7d69369386c6`; registry/resolver remains MissionControl `04770b83844b036080e59c9e6ea8ebb565383534`. Source-lock verification passes. These pins do not establish approval of later companion dependencies.
- Q37 `454a49064d52a6f3cf7a92a418cd70dda035bf1c` and PR #13 were not modified.

## Completed compatibility repair

The broader PostgreSQL regression fixtures did not supply the new trusted capability bindings or canonical policy tables. Consequently, they failed at `CAPABILITY_INSTALLATION_UNQUALIFIED` before exercising existing accounting and owner-isolation assertions.

The fixtures now provision synthetic policy in isolated schemas and execute admission under a restricted database role. A separate regression verifies concurrent exact replay, cross-owner admission/read denial, protected evidence writes, RLS isolation and zero model operations. The alpha-owner fixture rewrites only database object names, preserving literal `factory.owner_scope_bound` event types during replay.

The capability workflow now runs the startup, paid-ambiguity, owner-isolation and successor suites against disposable PostgreSQL. No assertions, accounting gates, pricing-expiry checks or runtime enrollment requirements were removed. The additional coverage intentionally exposes the unresolved pricing failures rather than reporting a misleading green scoped check.

Hosted qualification at repair `5fd82ca2a43209fee106736c64c55d979fe5f122` reproduced the same 15 passing / seven pricing-failing PostgreSQL checks. The full workflow also exposed a JobManager test's approximately one-second polling limit under concurrent CI load. A temporary 1.5-second candidate-write delay reproduced that failure; a bounded ten-second elapsed-time deadline passed the same delayed fixture with every original assertion. The temporary delay was then removed and all nine JobManager/local-admission tests passed. The correction changes only test waiting and adds the last observed state to timeout diagnostics.

Historical runs: [expanded capability qualification](https://github.com/jaydubya818/MyFactory/actions/runs/38073292975), [full workflow](https://github.com/jaydubya818/MyFactory/actions/runs/38073296540). Both remain failed evidence. Subsequent exact-head results belong in the PR description.

## Validation

Local Node 24.18.1 qualification used existing dependencies with the same package lock, including workspace-local compiler versions. It is **not** a clean dependency-install qualification.

| Check | Result and boundary |
| --- | --- |
| Capability policy | 59 passed, zero skipped |
| Supervisor admission and focused cloud contracts | 51 passed, zero skipped |
| Canonical disposable PostgreSQL capability qualifier | Six checks passed, including disable/replay, backend rollback, revoked agent and UNKNOWN-preserving revoke |
| Accounting regressions | 35 passed, one explicit skip; expiry, cancellation, operation limits, reservations and UNKNOWN assertions retained |
| Expanded disposable PostgreSQL regressions | 15 passed, seven reported failures, zero skips. Startup, policy/RLS fixture and all injected paid-ambiguity cases pass. Owner and successor cases reach expired pricing; five successor subtests plus their parent and the owner suite fail. No paid provider operations occur. |
| Full workspace suite on original implementation head | 576 passed, 17 failed, 27 skipped. Sixteen cloud failures are pinned-pricing expiry/unavailability; one local-preview test fails to reach running. This remains failed evidence. |
| Producer and workspace typecheck; web build | Passed using the complete existing locked dependency layout |
| Capability source-lock and producer governance | Passed; 110 inventoried changed runtime sources |
| Source identity | Failed with `SOURCE_IDENTITY_CHANGED_REVIEW_AND_REPIN`; no repin performed |
| Extra production-authority PostgreSQL probe | Not qualified: initial disposable URL lacked the authentication/TLS contract required by those tests. Do not count this probe as a runtime defect or a passing authorization check. |
| Independent review | Historical isolated review covers `195b1d1`; it did not rerun services. This qualification repair and final combined head require independent review. |

The stored cloud source digest is `1c69113378ed82428d13a2f89452708204e171ac9cb952b0a725acff83844548`; the audited runtime/configuration computes `a2e618470e1c26e85047d430182516e9395b131130d03cb4d9c6a2ad000fcbf2`. Test-only changes do not affect that calculation. A successor identity must not be silently installed or substituted.

## Pricing qualification

The pinned deterministic record `cloud-codex-deterministic-v1` expired at `2026-10-09T00:00:00Z`. The production record `production-openai-mini-20261003-v1` expired at `2026-10-10T00:00:00Z`. Both retain exact model `openai/gpt-5.4-mini`.

The existing canonical pricing owner is coordinating a versioned qualification. No successor pricing record has been adopted by this qualification repair. Refreshing a production record can change execution-contract/FactoryVersion bindings and needs an explicit reviewed change-impact and adoption decision under the current identity-preservation instruction. Historical evidence, rates, limits, ceilings, expiry rejection and UNKNOWN exposure remain unchanged.

## Merge blockers

1. Canonical pricing owner must finish independent qualification and an identity-impact package; obtain explicit authorization before adopting a production-pricing or identity successor.
2. Rerun complete hosted CI on the final exact head, including the newly exposed PostgreSQL owner/successor paths. A focused historical pass cannot substitute for these failures.
3. Resolve or reproduce the local-preview failure in an allowed clean dependency environment; do not waive it. Preserve the storage hold until its documented recovery/release condition is met.
4. Complete fresh-clone dependency qualification. A source-only clone completed before discovery of the existing 60 GB free-space hold; no local dependency install followed. Approximately 32 GB was available during this audit. Hosted clean installs are separate evidence.
5. Independently review the final main-bound diff and reconcile source identity/compatibility with the existing cross-system holds. No dependency merges or runtime identity changes are authorized by this report.

## Deployment blockers and merge effects

Cloud runtime constructors still lack real-owner capability bindings and would deny new preparation. Canonical policy and Factory admission are qualified only in the same PostgreSQL transaction; no production schema copy or cross-database authority transport is authorized.

Checkpoint E stays PARTIAL: independently retained restore witness/reconciliation, positive delegated execution, safe pause and authoritative cleanup, targeted Relay active-Work revocation, legacy lineage, live qualification projection and canonical real-owner binding remain unqualified. Existing FactoryVersion/execution-provider pins remain preserved, including the source-identity mismatch above.

The inspected GitHub workflows contain checks, not deployment commands. `apps/cloud-control/vercel.json` has `git.deploymentEnabled: false`. External hosting automation has not been independently verified. Main has no enforced branch protection/rules; this does not waive the documented checks or owner approval.

No merge, deployment, paid execution, production grant, external-alpha installation change or credential mutation occurred. The final PR description records the published repair SHA and exact hosted run results separately from this local evidence.
