# Factory lifecycle successor — isolated engineering qualification

This successor completes canonical co-located capability control observations. It does not enroll a remote backend, install source, grant execution, or activate a provider. MissionControl retains delegated Mission/Attempt ownership through its existing authenticated Factory/Fabric boundary.

## Behavior

- New admissions record the exact owner, organization, installation and agent alongside the canonical Work and policy decision. Replays cannot substitute these bindings. Historical rows lacking the additional binding are not silently backfilled or treated as qualified for successor controls: they appear as explicit per-Run `PENDING_BACKEND` records, the inventory remains incomplete, and exactly bound current Runs are still fenced.
- Pause and revoke use the same transaction lock as admission, dispatch and spend. A control targets only Work admitted at or before its policy revision. A repeated old control cannot affect Work authorized after re-enable. A control newer than the visible source policy fails closed rather than accepting a regressed owner-state snapshot.
- Pause before resource allocation durably blocks claim and delivery and reports `PAUSE_CONFIRMED`. Existing active resources stay `PAUSE_REQUESTED` / `PENDING_BACKEND` unless canonical cleanup is already confirmed. Pause does not claim resumable active-resource suspension and never invalidates spend to simulate it.
- Revoke fences productive writers and budgets, expires producer/verifier leases, and records stop intent. `reconcileFactoryCapabilityControl` invokes the existing cloud recovery/provider contract; it never allocates or runs a replacement worker. Stop/delete requires the provider's authenticated absence readback. Verifier cleanup timeouts retain an exact-lease audit and a cleanup uncertainty marker without overwriting earlier verification failures; producer absence alone cannot hide verifier UNKNOWN. Timeouts and missing allocation receipts remain `STOP_UNKNOWN` or `STOP_PENDING` until reconciliation succeeds.
- A per-Run receipt reaches `STOP_CONFIRMED` and cleanup `CONFIRMED` only after both producer and independent verifier resource records confirm cleanup. `NOT_ALLOCATED` is a separate state. These observations never settle or release UNKNOWN spend. Pending verifier cleanup prevents terminal Work publication even after producer cleanup.
- Receipts are durable, idempotent canonical Factory events with exact native Work/WorkOrder/Run/FactoryVersion identity. The TypeScript observation contract is `packages/contracts/src/capability-lifecycle.ts`. Plain JSON is not portable authority: MissionControl must authenticate the existing enrolled transport or signed terminal execution Result and validate its own exact Mission/WorkOrder/Attempt mapping. Factory resource cleanup is not proof that unrelated connection credentials have been revoked.

## Identity preservation

`source-identity-20261010/successor.json` remains byte-for-byte the qualified `fed1724f60a7783a2dc5155928bd7f4df5a34970d9de3be53cdacc4dd0a9c30b` predecessor. `lifecycle-successor.json` records the new inventoried source, deterministic FactoryVersion and exact predecessor. Pricing records, configuration digest and execution-contract digest are unchanged. No existing grant, approval, historical source record, Work or UNKNOWN exposure is migrated. An exact predecessor approval fails before successor authority consumption.

## Local validation

- Full workspace: 603 passed, 0 failed, 28 skipped (environment-specific connected/cloud tests retain their gates).
- Disposable PostgreSQL admission/accounting/UNKNOWN/owner/successor and independent verifier suite: 30 passed. The added verifier checkpoint test rejects allocation after producer cleanup when pause is pending.
- Disposable PostgreSQL capability lifecycle qualifier: 9 named groups passed, including concurrent duplicate revoke, timeout/lost acknowledgment recovery, historical control replay exclusion, revision regression, safe queued pause, mismatched agent and cross-owner rejection.
- Producer and workspace typechecking, production web build, source scanner, provenance lock and producer-governance gate passed.
- Lifecycle unit regressions verify producer destruction cannot bypass independent verifier cleanup.

The PostgreSQL lifecycle qualifier supplies a synthetic provider to fault-inject acknowledgment outcomes. It proves durable database semantics, not live provider termination. Actual remote positive admission/resource stop remains blocked until an approved nonproduction installation, authenticated receiver and exact successor source approval are supplied through canonical records. Complete database rollback requires a separately held current incarnation/enrollment fence; local revision comparison alone is not a full restore-proof authority anchor. No restoration procedure may reactivate this database without that integration gate.

Final independent review and exact-SHA hosted CI are required before merge. Production deployment and external-alpha changes remain prohibited.
