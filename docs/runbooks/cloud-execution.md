# Cloud execution runbook

Status: **NOT_READY — cloud admission is not implemented or enabled.** This is an implementation runbook, not a claim of deployed operational controls.

## Current checkpoint

Use the [architecture/source inventory](../architecture/cloud-execution.md) and [local provider qualification](../cloud-execution/phase-1/README.md). The production entry still constructs `LocalExecutionProvider`; its resource evidence does not authorize a model operation or publication. Do not repoint the loopback connection to an internet hostname or run the existing SQLite supervisor in an ephemeral container.

Local verification, with Node 24 and dependencies installed:

```sh
npm test
npm run typecheck:producer
npm run check:producer-governance
npm run typecheck
npm run build
```

Ordinary tests use controlled model boundaries. Environment-gated installed-CLI/Docker tests remain SKIPPED unless their explicit prerequisites are configured. Never set a live flag to make a skipped test green.

## Next provisioning gate

Resolve the staging service/project and isolated PostgreSQL/private Blob scope. Recommended: dedicated MyFactory staging service, separate from production Sofie/Relay. Retain exact source SHAs, review the SDK version and image digest, verify nonsecret configuration, then implement the bounded deterministic provider probe. The proposal is one 1-vCPU/2-GB ephemeral sandbox, 120 seconds, no public port/model/publication, limited artifacts, automatic expiry and exact-resource cleanup. See the ADR for estimated costs. No production rollout, source write credential, recurring plan or real model canary is authorized by this probe.

## Controls that must exist before staging Work can be admitted

- A durable admission-disabled switch that does not terminate/reassign active workers implicitly.
- Read-only health/readiness for control plane, queue/database, provider, artifact store and verifier. Chat availability is separate.
- Authenticated inspect/reconcile/cancel actions bound to Work, attempt, generation, lease and provider identity.
- Provider readback with resume disabled; ambiguity retains authority/exposure until reconciled.
- Custody hashes and immutable verifier verdicts before Ready/publication eligibility.
- Bounded reaper that deletes only exact conclusively terminal/orphaned resources, records cleanup failures and confirms absence.

## Failure responses required by the implementation

| Incident | Safe response |
| --- | --- |
| Allocation timeout/outage | Retain intent and provider identity; reconcile; no second create or local fallback. |
| Missing heartbeat/worker | Read provider and lease; do not replace an ambiguous writer. Fence stale mutations. |
| Cancel/timeout | Stop new operation admission; cancel exact resource; fence; collect safe evidence; confirm termination/deletion. |
| Verifier outage | Keep private candidate, Waiting for verification, Ready false. |
| Artifact mismatch | Reject custody and publication; preserve sanitized failure evidence. |
| OIDC/model failure | Fail closed with canonical accounting/UNKNOWN; no static credential or alternate-model fallback. |
| Provider stop/delete unavailable | Mark cleanup unresolved; reaper retries only the exact authorized resource. |
| Queue backlog | Waiting for capacity, never false Working; enforce original deadline when claimed. |
| Control-plane restart/restore | Reconcile all nonterminal executions before admitting replacement effects. |
| Rollback | Disable new cloud admission; preserve existing version/authority/history and deliberately finish or cancel. |

Local candidate teardown is intentionally retained because current publication consumes the workspace. `destroyed: false` is not a cleanup PASS. Cloud lifecycle must remove this local dependency before qualification.

## Evidence and release

Separate DETERMINISTIC, CONNECTED and LIVE reports. Record first-run results, skips, source pins, exact image/FactoryVersion, resource identities, sanitized events, candidate/tree hashes, verification, Result/Proof, costs and unresolved cleanup. A paid live canary requires a separately approved envelope containing Work, objective/repository, provider/project/region/image, harness/model, original limits/deadline/cost and permitted effects; publication stays disabled by default.

No weekly cloud automation has been scheduled at this checkpoint: there is no qualified cloud command or deployment to run. Add the requested recurring qualification only after the deterministic suite exists, with bounded cost and quiet-on-unchanged reporting.
