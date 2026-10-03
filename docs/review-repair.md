# Bounded independent review → repair → reverify

Independent review can discover a defect after earlier checks pass. A reviewed candidate must remain inspectable forever; a correction is a different candidate with its own Work, limits and evidence. Attempt 8 is the reference: candidate `1253fcbd5a4e11d72f8ee43c7025b0729d9fa298` passed its original visible checks, protected checks and CI, then failed independent numeric-range review. The owner subsequently clarified the safe-integer public contract. This extension does not change that candidate, its PR, Proof or verdicts.

## Canonical path

Candidate A → authenticated independent review → immutable structured findings → repair proposal → explicit owner approval → new Factory WorkOrder → ordinary canonical PREPARE/START and writer admission → Candidate B → new checks/completion/custody/protected verification → CI if published → independent review → owner decision.

The host records this path with additive `review.*` and `repair.*` events in the existing transactional WorkOrder store. `repair.linked` binds the new WorkOrder to A's exact run/commit/tree, review identity, original objective, approved public contract, scope, policy and round. B's signed result names its new WorkOrder and exact preparation digest, which includes `repairWorkOrderId`. This gives A → findings → Work → B provenance without changing A. No replacement publication, automatic PR closure, merge, deployment or owner acceptance is performed.

## Trust and evidence

`ReviewRepair.observe` and `recordReview` are trusted-host ingestion entrypoints, not HTTP/model actions. The host must authenticate and validate the actual consumer custody/protected-verifier, CI and independent-review readbacks before invoking them. Explicit host-only observer identity allowlists are required; defaults reject all ingestion. An observer identity string supplied by a model or HTTP request is not authentication. There is no public action to submit a review verdict.

Every record binds WorkOrder, run, commit and tree. Local evidence must independently show a passed implementation checkpoint for that tree, productive closure, completed read-only completion, exact-tree commit, passed candidate checks and signed result. External custody and protected observations are separately recorded in order. Published candidates require exact-candidate CI before review. Failed/UNKNOWN evidence cannot be replaced with PASS. A parent evidence digest cannot verify the child. The stage artifact digest must identify a candidate-bound observation envelope, not an individual static artifact shared by several semantic checks. Existing content-addressed Proof references, including the repeated Attempt-8 protected-evidence hash, remain unchanged.

Findings contain category, severity, affected path and public evidence summary/digest; the containing immutable review supplies reviewer, review identity and candidate identity. Only explicitly PUBLIC findings enter the repair prompt. Restricted findings retain an opaque digest and empty summary; no protected input, output, verifier code or holdout is accepted in that field. A restricted-only failure needs an owner/host to establish a public reproduction before repair. The host is responsible for classification; the software cannot infer whether arbitrary prose secretly contains a holdout. Source and findings remain untrusted task data and grant no authority.

A private review PASS cannot be reused after publication. Readback shows AWAITING_CI, then AWAITING_REVIEW until a new review is appended after CI. Earlier reviews remain immutable. An independent-review FAIL requires a new candidate; it cannot be relabeled PASS.

## Owner policy and bounded allocation

`repair.propose` is available to an explicitly scoped caller and does not authorize execution. `repair.approve` requires the existing macOS device-owner confirmation and an exact proposal hash. Approval atomically creates one new WorkOrder in `awaiting_approval`; replays return the same WorkOrder, including after restart. It does not start a model call. A trusted coordinating backend must create/bind a fresh consumer Work and pass the existing canonical writer/dispatch gates.

The immutable policy specifies:

- `maxRounds`, `maxOperations`, `maxBudgetMicrousd`, `maxDurationSeconds` for the entire repair chain;
- exact `allowedPaths`, approved `publicContract`, and the unchanged original objective;
- per-round productive operations (1 or 2), one read-only completion, budget and duration;
- `mode: OWNER_APPROVAL`. Automatic repair is deliberately not enabled.

Operations are Factory provider operations initiated by this lifecycle. It does not launch paid reviewers or Sofie calls; those cannot borrow this authorization. A host adding such operations must separately admit them within a coordinating Work's total envelope. Each approved round permanently allocates its full maximum operation count and budget against the chain. Unused capacity is not recycled. The chain's absolute deadline starts at the first approval; each dispatch deadline must fit both it and the per-round duration. Exhaustion, expiry, UNKNOWN, scope mismatch or a failed/no-candidate execution goes to Needs You without another Work or retry.

Post-publication repair uses the same explicit owner gate and a new candidate identity. Existing branch/PR records remain untouched. B needs its own exact-candidate publication approval. Successful CI/review grants neither merge/deploy authority nor owner acceptance.

## Execution integration

The canonical Factory prepare request may contain `repairWorkOrderId` alongside a V2 spend contract. Admission reuses only that already-approved WorkOrder and checks its exact objective, source commit, scope, check commands, operation plan, ceiling and deadline. It rejects a second preparation/attempt and reuses the existing idempotent request on replay. Unmanaged `run.start` is denied for repair or reviewed WorkOrders. No direct dispatch path is added.

The repaired executor gets A's source from its exact base plus `REVIEW_REPAIR_CONTEXT`: original objective, owner-approved public contract, permitted findings and scope. The existing host-owned productive protocol, checkpoints and optional bounded implementation feedback remain in force. Completion remains read-only. The full signed custody and protected-verification pipeline must run for B. A new publication request is denied until fresh custody/protected verification is recorded. A failed independent review blocks publication.

`WorkOrderDetail.reviewRepair` exposes the chain tip, rounds, allocated limits, current review state and explicit NOT_RUN acceptance/merge/deployment status. No production observer configuration, database record, old candidate, active Work, runtime deployment or provider credential is changed by this source extension.

## Deterministic qualification

- `node --test apps/supervisor/test/review-repair.test.mjs`: provenance, replay/restart, owner-only approval, immutable A and review, B freshness, restricted finding exclusion, scope/objective/budget/operation/deadline enforcement, bounded second round, UNKNOWN, publication and post-CI review.
- `FACTORY_INSTALLED_CLI=1 node --test apps/supervisor/test/productive-context.test.mjs`: includes linked repair through the installed CLI with synthetic loopback responses and independent offline Docker boundaries. Its historical A records and final reviewer are fixtures, not new historical claims.
- Existing numeric precision/output, protected consumer, completion, checkpoint/feedback, no-edit, custody and connected Gate B/C regressions remain required.

No paid provider call or production repair execution is part of these tests. Future deployment must explicitly configure authenticated observer adapters; a loopback fixture PASS is not live qualification.

## Source qualification, 2026-10-02

The deterministic lifecycle suite passes 18/18. The full Factory suite passes 193 tests (17 opt-in skips, separately exercised); installed-CLI checkpoint suites pass 17/17 including linked repair, no-edit fencing, numeric boundaries, correct-first and bounded feedback. The connected MyEve fixture passes 26/26 with Gate B/C, exact-tree signed custody, independent Docker verification, accounting, UNKNOWN and cancellation/recovery. MyEve application regression passes 1,995 tests (94 optional environment-dependent skips), root tests pass 145 (2 optional skips). Typechecks, both governance checks and builds pass. No live model operations or production evidence mutations were performed.
