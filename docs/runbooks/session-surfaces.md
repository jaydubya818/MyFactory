# Session surface qualification runbook

Current state: **contract only; no enabled operator attachment command or Control Center action**. Do not install cmux/tmux into the cloud worker as a prerequisite. Do not use terminal persistence to claim Mac-off execution. See [architecture and API review](../architecture/session-surfaces.md).

## Before adapter implementation

Cloud Execution owns the provider/controller and HEADLESS milestone. Consume its explicit checkpoint and exact FactoryVersion/runtime/evidence; never replace its implementation or copy credentials out of staging. The reviewed `faf9335` checkpoint supersedes the old image blocker but does not yet prove the full Golden Journey. Preserve canonical Attempt-8 publication.

Use the Fabric contract package, map existing Work/run/attempt/generations exactly, and resolve authorization with existing server-side scope. There is no replacement ledger or lease. Record adapter version, native tool version/SHA, environment identity and policy in qualification before advertising session capabilities. An installation/version probe alone is NOT_QUALIFIED.

## Future operator workflow

Select Work in Control Center. When the exact environment is online, eligible, policy-permitted and qualified, its bounded cmux/tmux action resolves the target automatically. If unavailable, show session unavailable while preserving the canonical Work outcome. Never silently choose another environment or offer a raw host/path prompt. HEADLESS Work remains observable through ordinary Current Truth/Result/Proof.

Authenticate and reauthorize on every attach, reconnect and detach. Use exact Work/execution/environment/attempt/generations. Native names, workspace titles and socket possession do not confer Work access. Keep the raw cmux socket and tmux server inaccessible to producers and unrelated owners. Do not use cmux's whole-server SSH mirror against a shared server. Do not forward SSH agents or store secrets in shell history/workspace environment.

Closing the operator client must only close that client. Reconnect reuses eligible exact identities. If metadata is missing or stale, reconcile read-only and return unavailable; do not start another worker. Surface notifications are deduplicated Current Truth transitions: Needs attention, verification failed, execution completed, input required. Completion notification is not independent verification or Ready for review.

## Required integration evidence after HEADLESS milestone

| Campaign | Required observation |
| --- | --- |
| No cmux/tmux installed | Complete Sofie → CLOUD → qualified harness → custody → independent verifier → Result/Proof, Mac/browser off |
| cmux close and forced crash | Same authoritative cloud execution continues; collection/verifier/Result unchanged |
| tmux detach and operator disconnect | Same Work/attempt continues; no productive stop or duplicate start |
| Reconnect and controller restart | Exact existing execution/surface mapping or safe unavailable; duplicate authoritative executions = 0 |
| Native session/server replacement | Incarnation mismatch denied; no attach to a reused ID |
| Scope attacks | Unauthenticated, cross-owner/business/Work/environment/attempt and stale generation denied without disclosure |
| Capability/policy attacks | Advertisement-only, incompatible version, stale/revoked qualification and verifier attach denied |
| Secret/holdout canaries | No disclosure through logs, terminal history, environment, saved cmux config, sibling enumeration or browser |
| Input and cleanup | Read-only cannot inject keys/commands; observer cleanup never stops productive resources |
| UI | Exact action eligibility, unavailable state, keyboard/390px behavior, canonical Result/Proof retained |

Retain exact identity, initial/final state, command/event counts, custody hash/verifier result and cleanup readback for every real campaign. A fake provider callback or detached `sleep` is not cloud continuity evidence. Do not report unrun counters as release-wide zero.

Paid model calls remain prohibited for surface qualification. Qualification does not enable production admission. Adapters can be disabled independently while ordinary HEADLESS Work continues; remove only observer metadata/resources, never canonical Work, candidates or proof.
