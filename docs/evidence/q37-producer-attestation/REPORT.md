# Q37 producer attestation qualification

**Producer gate: locally qualified with synthetic execution. Ready for MyEve Gate C consumer integration: YES. Live Factory: NOT_RUN.** This is not a claim that MyEve integration, independent MyEve verification, writer handoff, publication or Ready is qualified.

## Baseline and scope

Branch: `codex/q37-producer-attestation`. Isolated worktree: `/Users/jaywest/.codex/worktrees/q37-producer-attestation/MyFactory`. Baseline: fetched `origin/main` at `8c5de7794ffa377420ef5dcdbda44aa9fa2328b8`. The canonical checkout remained clean on `codex/local-factory` at `543906dc20fefed2def97e43953095ea0b7c60bc`; no local `main` branch exists. Current main already contains the required signing/producer implementation. The unmerged `origin/codex/local-factory` change `1015367` concerns preview caching and was not merged, cherry-picked or rebuilt. No open MyFactory PRs were returned. Two old prunable synthetic worktree registrations were left intact.

MyEve was not edited. Its Q37 checkout was observed advancing independently from the supplied context pin to `2ff67e17dcdabaa5d8b9b1c750d64a10d4646653`; that change was not imported or acted on. No cross-task messages, live provider calls, paid coding workloads, production signing-key changes, deployment, push, merge, or writer transfer occurred.

## Implementation

The existing receipt helper now supplies shared domain-separated Ed25519 signing and verification for both unchanged status receipts and `MYFACTORY_RESULT_V1`. The new strict result protocol signs a canonical manifest and validates the actual received bytes. It accepts no consumer authority or Ready fields.

When explicitly configured, the supervisor captures a content-derived FactoryVersion at actual Run admission. A SQLite transaction saves the Run and immutable `run.execution_snapshot` together. The snapshot measures runtime source and the effective model/executor/configuration, links request → WorkOrder → Run/attempt, and is used during execution. A model-setting change cannot relabel an in-flight attempt. A changed executor version blocks productive execution. Legacy attempts without snapshots cannot be retroactively attested.

Terminal results freeze actual commit/tree object bytes, base identity, the canonical patch, ordered check evidence and log bytes into `run.signed_result`. The result binds aggregate, evidence and artifact digests and a stable operation identity. Creation uses existing BEGIN IMMEDIATE transactions; same identity/different bytes conflicts instead of replacing history. A fresh process can read the exact saved receipt and artifacts. Authenticated repository-scoped clients can select one exact WorkOrder/Run through the new read endpoint and client method; this never starts work.

Timeouts and unresolved verifier outcomes remain UNKNOWN with the existing recovery hold. Cancellation is STOPPING until the producer records terminal cancellation. Completed, failed and cancelled results retain their original execution snapshot. Current signing use rejects unknown, revoked, retired or expired keys; retained historical public keys preserve cryptographic verification without current-use eligibility.

Existing-file changes are confined to supervisor admission/result wiring, local request identity, canonical Git patch flags, shared signing helpers/declarations, the client method, README and package scripts. Two new runtime sources contain the producer service and strict protocol. No database schema or migration changed. The [protocol document](../../producer-result-protocol.md) contains the old EXISTS/PARTIAL/MISSING crosswalk, exact wire semantics, key behavior and limitations.

## Validation

**72 tests PASS, zero failures/skips** across the affected supervisor, hosted-receipt and SQLite-storage suites, including **16 new producer tests**. [tests.log](tests.log) includes actual admission capture, F1 remaining F1 after a configuration change and newer F2 attempt, malformed/wrong version claims, wrong producer/request/WorkOrder/Run, byte/manifest substitution, duplicate/conflict, restart readback, baseline/worker/verifier unknown outcomes, cancellation, key rotation/history, revoked admission, scoped HTTP/client authentication and two competing SQLite writer processes. Legacy request signatures, status receipts, idempotency and authority-denial regressions also pass.

The golden fixture runs the real JobManager, storage and Git candidate creation in disposable local repositories. The worker and two checks are synthetic; no model or Docker result is represented as a real independent check. [golden.json](golden.json) contains only the public verification key, expectations captured before completion, and returned signed bytes. Private test keys are ephemeral and are not retained. [golden-verification.json](golden-verification.json) records verification in a separate process using that public material and returned bytes only.

Producer TypeScript validation and governance results are retained in [typecheck.log](typecheck.log) and [governance.log](governance.log). Governance covers exactly the two new runtime sources, **UNKNOWN=0**. No prior MyFactory inventory existed; existing sources are not retroactively reclassified. Source fingerprints and authority boundaries are in [source-inventory.json](source-inventory.json). [manifest.json](manifest.json) pins all changed source/evidence and the unchanged storage schema source.

Run from the worktree root after installing the repository's dependencies:

```sh
Q37_EVIDENCE_DIR="$PWD/docs/evidence/q37-producer-attestation" node --test apps/supervisor/test/*.test.mjs packages/hosted-routing/test/*.test.mjs packages/storage/test/*.test.mjs
npm run typecheck:producer
npm run check:producer-governance
```

The storage suite creates temporary SQLite databases, exercises existing migrations and restart/rollback/foreign-key behavior. No production database or migration was accessed. File-provider hydration initially slowed checkout and dependency loading. An earlier in-flight test run correctly rejected source changing during implementation; the recorded final regression run starts from stable final source and passes.

## Final matrix

PASS means the pinned local producer implementation and synthetic qualification, not a live deployment.

| Requirement | Result |
|---|---|
| EXECUTION VERSION CAPTURE | PASS |
| FACTORYVERSION IMMUTABILITY | PASS |
| RESULT MANIFEST | PASS |
| CANDIDATE BINDING | PASS |
| EVIDENCE MANIFEST | PASS |
| ARTIFACT MANIFEST | PASS |
| SIGNED RESULT RECEIPT | PASS |
| REQUEST CORRELATION | PASS |
| WORKORDER / ATTEMPT CORRELATION | PASS |
| REPLAY SAFETY | PASS — stable stored producer result; consumer admission remains separate |
| CONFLICT DETECTION | PASS |
| UNKNOWN / CANCELLATION SEMANTICS | PASS |
| KEY VERSION / HISTORICAL VERIFICATION | PASS |
| FACTORY-GRANTED CONSUMER AUTHORITY | 0 in exercised fixtures |
| README UPDATED | PASS |
| GOVERNANCE | PASS — new producer sources only, UNKNOWN=0 |
| LIVE FACTORY | NOT_RUN |
| READY FOR MYEVE GATE C CONSUMER INTEGRATION | YES |

## Exact next boundary

MyEve must consume this producer protocol using independently stored expected identities and key policy, durably dedupe receipts, recheck its own Work generation/authority, and independently verify the imported candidate. It must not derive expected FactoryVersion from the untrusted result. The local loopback endpoint is qualified; a hosted/cloud delivery path is not implemented here.

The candidate profile binds commit/root-tree object bytes and patch, not every recursive tree/blob needed for full reconstruction. Check evidence is Factory-reported. The verifier image is an existing configured image reference, not an invented immutable image digest. The supervisor installation, host and signing key remain trusted; this is not hardware attestation or protection against a compromised same-user coding host. These limits do not grant consumer readiness or execution rights.

Gate B writer/session custody, Gap #2B, Current Truth, MyEve migrations and Action Gateway remain untouched. Stop at producer handoff; no writer integration or live execution follows automatically.
