> Current connected evidence: [hosted deterministic attempt 4](../cloud-execution/phase-3/hosted-attempt-4.md) passes the existing cloud harness, private custody, independent verifier and cleanup. Fresh browser recovery passes; the local P0 first run failed on timeout. Mac-off/hosted-runner P0 remain NOT_RUN. Paid models 0; production/publication DISABLED.

# HarnessProvider and cloud qualification

Status: accepted design requirement, 2026-10-02. Runtime registry and additional
adapters are deferred. This document neither qualifies a harness nor grants Work
authority. The existing MyFactory orchestration with its pinned Codex CLI remains
the first cloud harness implementation to qualify.

## Boundaries

ExecutionProvider allocates, observes, fences and destroys the execution
resource. HarnessProvider drives a bounded productive/checkpoint/completion
session inside that admitted resource. Factory owns admission, operation
accounting, leases, exact source materialization, candidate custody, independent
verification and Result/Proof. Those responsibilities must not move into an
adapter or become separate Work state machines.

Reuse `packages/agents/src/index.ts`'s `CodexAdapter` behind the first provider:
`preflightCodex` supplies observed binary/version availability and `runCodex`
supplies bounded process execution, events and cancellation. Preserve the
existing host checkpoint/repair and metered completion lifecycle. Do not rename
Codex locally qualified behavior as cloud-qualified behavior. The current
`deterministic-qualification` static worker proves mechanics only; it is not a
qualified Codex harness.

The internal provider contract is:

```ts
interface HarnessProvider {
  readonly identity: {
    id: string;
    version: string;
    implementationSha256: string;
  };
  preflight(context: AdmittedHarnessContext): Promise<HarnessObservation>;
  run(context: AdmittedHarnessContext): Promise<HarnessObservation>;
  cancel(context: ExactHarnessAttempt): Promise<HarnessObservation>;
  observe(context: ExactHarnessAttempt): Promise<HarnessObservation>;
}
```

This is a design contract, not a newly deployed endpoint or exported runtime
interface. Concrete types must reuse canonical Work, Run, execution and lease
identities at the first cloud adapter integration; do not add parallel IDs or an
independent harness queue.

`AdmittedHarnessContext` binds the existing Work/generation, Run/attempt,
execution resource/lease generation, admitted FactoryVersion, immutable source,
phase, deadline, remaining operation limits, context/tool/skill policy and an
opaque Work-scoped model-broker capability. Provider-specific local paths and
process handles stay inside the adapter. Context contains no database, control
plane, deployment-bypass, publication, verifier or upstream model credentials.
The harness has no API for expanding that context or selecting another provider.

`HarnessObservation` reports correlated process/session state, productive yield,
checkpoint references, completion/artifact manifests and confirmed or unknown
quiescence. An observation is not authority, durable custody, a protected verifier
verdict or Ready. An adapter cannot turn an unknown process/provider response into
successful completion. Cancellation must terminate/reap the process; canonical
lease fencing and resource cleanup remain separately mandatory. `observe` cannot
restart a process or spend a model operation. Read-only completion can use the
existing canonical host adapter if a harness cannot enforce it directly.

## FactoryVersion and selection

Qualification pins the complete effective tuple:

**Environment × ExecutionProvider × Harness × Harness version × Model × Tools ×
Skills × Verification policy.**

| Pin | Required identity and current mapping |
| --- | --- |
| Environment | Exact qualified environment identity/revision, CLOUD class, staging scope and policy. Today the dedicated project/region/runtime constants are covered by source/configuration digests; bind the canonical Environment reference when the Fabric contract is integrated. |
| ExecutionProvider | Provider ID/version, region, immutable image digest, resource/network limits; existing V2 `configuration.cloud` fields. |
| Harness and version | Harness ID, adapter implementation digest, exact upstream binary/package version and integrity. Existing `executor`/`executorVersion` plus source digest are the compatibility fields, not permission to select a different adapter. |
| Model | Exact model and provider route, pricing/accounting policy; deterministic fixtures still traverse the production model boundary. |
| Tools | Explicit versions/integrity and capability policy; existing tool policy digest, commands and allowed paths. |
| Skills | Explicit name, version/content hash and capability requirements; existing V2 skill descriptors. Every loaded skill descriptor and content hash must appear in execution evidence, not only configuration. Dynamic discovery never expands authority. |
| Verification policy | Independently qualified policy/version/hash, verifier image and identity boundary; existing verification policy digest/image. A NOT_QUALIFIED policy cannot yield Ready. |

The tuple is frozen at preparation and bound through dispatch, broker operations,
checkpoints, custody, independent verification and the signed Result. A change to
any effective dimension requires a different FactoryVersion and exact-tuple
qualification. Add fields through a coordinated versioned snapshot change with
MyEve's strict validator; never reinterpret or rewrite historical signed V1/V2
receipts. A metadata descriptor or adapter preflight is not qualification.

A future server-owned registry may contain the existing MyFactory harness,
DeepAgent, Codex, Claude Code, OpenCode and future cloud-agent adapters. Names are
examples, not installed/qualified implementations. Distinguish the MyFactory
orchestration adapter from its upstream Codex binary when reporting versions.
V1 may pin one production harness. Later FactoryVersions may select only among
qualified tuples before admission. The LLM cannot choose or switch harnesses
mid-Work. Missing, unhealthy or unqualified selection fails closed into canonical
Waiting/Needs attention; there is no silent harness, model, environment or local
fallback. Retry/recovery preserves the admitted identity and UNKNOWN semantics.

## Optional session surfaces

Consume Environment Fabric's canonical `@factory/contracts/session-surface`,
imported unchanged from Fabric commit
`9983ccfcc6881b090e3d11bc575d1af1e710195e`. The cloud session policy now uses
that contract's `SessionSurfaceKind` and records **HEADLESS** in durable resource
evidence. This import does not bring in Fabric's routing implementation, merge
its branch, or enable a terminal adapter.

HEADLESS is the mandatory production default. No `SessionSurfaceProvider` needs
to exist or be called during productive execution, custody, independent
verification, Result retention or recovery. No `session.headless` capability
advertisement is a prerequisite for productive Work. TMUX and CMUX are optional
operator conveniences after the Mac-off milestone. They must not become process
supervisors, Work truth, execution leases, model brokers or recovery dependencies.

Any future integration uses only canonical `observe`, `attach`, `detach` and
`reconcile`, with exact Work/execution generations, environment and attempt.
Recheck operator scope, live authority, lease/fence, environment qualification,
capabilities, policy and revocation at effect time; the pure scope guard alone
is insufficient. An attachment ID is not a bearer grant. No verifier attachment,
caller-selected host/path/command, credential forwarding, sibling-Work access or
terminal-derived completion. A Sandbox SDK session ID identifies a resource,
not an operator attachment. Surface failure/detach/reconnect cannot start, stop,
restart or grant authority to productive execution. Keep optional observation
outside authoritative lifecycle transactions with bounded failure handling.

Deterministic contract tests cover cross-Work/owner/business, stale generations,
revocation, expiry, verifier denial and injected host/path/command/credential
fields. The cloud lifecycle regression completes custody and teardown without
consulting even an unavailable surface integration. This is local deterministic
evidence, not a connected crash/reconnect or Mac-off PASS.

## Critical path and evidence

1. Existing qualified harness in CLOUD using deterministic model responses;
   productive → checkpoint/test feedback → bounded repair → read-only completion.
2. Private candidate custody, independent cloud verifier, durable Result/Proof,
   Mac-off deterministic E2E, browser-off/reconnect/restart/cancellation and P0.
3. Separately authorized first bounded real CLOUD model canary.
4. DeepAgent qualification against the same Work/evaluation corpus.
5. Additional harnesses only when measured value justifies their qualification.

Do not delay steps 1–3 to build a registry or implement alternative adapters.
Do not proceed to step 3 merely because allocation or service access succeeds.
DeepAgent failure never displaces a currently qualified harness from cloud V1.

The qualification matrix must explicitly cover bounded operations, deterministic
client tools, cancellation, timeout, process cleanup, scoped context injection,
checkpoint/test feedback, read-only completion (or canonical adapter), artifact
production, exact model pins, no fallback, OIDC/broker boundary and complete
evidence correlation. Local success, fixture success, NOT_RUN, PARTIAL and gated
skips are distinct from cloud or live PASS. Retain failed attempts and their
cleanup evidence; no loop-until-green live retries.

For comparison, freeze the Work corpus revision, source, acceptance criteria,
visible and protected checks, model route, operation/cost limits, tool/skill
policies, environment/provider/image and verification policy. Report harness-only
changes separately from environment changes. Compare success, operation counts,
latency, test pass rate, repair effectiveness, cancellation, recovery, actual
cost/accounting completeness and evidence completeness. Record first-run and
retry outcomes. Subjective output quality alone cannot select the default.

Use these explicit metrics, with raw counts and eligibility rules retained:

| Metric | Comparison evidence |
| --- | --- |
| Success | Successful Work / admitted corpus Work; retain failures, UNKNOWN, skips and NOT_RUN separately. |
| Verification rate | Independently passing candidates / submitted candidates; missing/failed verifier evidence is not a pass. |
| Repair rate | Initially failing, repair-eligible cases corrected within the original budget / all repair-eligible failures; retain no-repair and budget-exhausted outcomes. |
| Operations | Productive, repair and completion counts, rejected requests, reservations and UNKNOWN exposure. |
| Latency | Admission-to-terminal and phase durations; show timeouts/failures and sample counts alongside percentiles. |
| Cost | Actual provider/accounted cost with completeness and unresolved exposure; distinguish zero paid fixture calls from estimated live cost. |
| Cleanup/recovery | Confirmed teardown / allocations, unresolved resources, cancellation/recovery outcomes and duplicate effects. |

Compare harness-only changes within the same environment/task/model stratum. If
a harness requires another image or tool policy, report that as a different
tuple and a separate comparison, not a harness-only improvement. Skill evidence
must identify what was actually loaded; record an explicit empty set if none
were loaded. A changed skill hash invalidates the prior tuple qualification.

Current hosted access matrix, cloud harness, independent verifier and Mac-off/P0
remain NOT_RUN. The approved Factory bypass is configured; the separately
protected Sofie operator ingress decision remains pending. This requirement does
not extend that credential approval, enable production admission, authorize a
paid model call, or authorize publication.
