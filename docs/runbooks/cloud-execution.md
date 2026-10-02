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

## Approved staging boundary

Dedicated MyFactory staging is approved and its separate project, Neon database and private Blob store have been created. See the ADR for exact resource identities. Only preview is connected; no production owner data is copied. Retain exact source SHAs, review the SDK version and image digest, verify nonsecret configuration, then implement the bounded deterministic provider probe. The proposal is one 1-vCPU/2-GB ephemeral sandbox, 120 seconds, no public port/model/publication, limited artifacts, automatic expiry and exact-resource cleanup. See the ADR for estimated costs. No production rollout, source write credential, recurring plan or real model canary is authorized by this probe.

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

## Staging foundation operations

Service source: `apps/cloud-control`. Exact resources and deployment evidence: [Phase 2](../cloud-execution/phase-2/README.md). Never pull Sofie environment values into this project. Database/Blob bindings are preview-only. The readiness token is a separate sensitive preview variable and has no dispatch/publication authority.

Migrations are explicit operator actions, never performed on a web request: run `apps/cloud-control/scripts/migrate.mjs` with only this dedicated staging database and matching project/environment. The script validates TLS, rejects non-Factory tables, takes a transaction advisory lock and verifies the database marker. Keep local environment files gitignored and mode 600.

Preview deployments use `vercel deploy --target preview`. Verify the returned target: the CLI can promote the first deployment of a new project despite that flag. No production-target deployment may receive staging credentials. The observed first-deploy exception was removed.

Historical evidence: this branch originally stopped at the [image blocker](../cloud-execution/phase-2/image-blocker.md). The separate Cloud Execution owner superseded it at `faf93359a4c54daaf3e0b713a601366db02ba8d6`. Follow that owner's current qualification; do not restart uploads from this old checkpoint or weaken TLS.


## Environment Fabric foundation

Run `node --test apps/supervisor/test/environment-*.test.mjs` for the descriptor, capability, routing and metadata-adapter boundary; run the complete `npm test` suite to protect local lifecycle semantics. The new CI workflow runs these through the normal suite and checks governance, types and build. Branch-protection enforcement is not established by a workflow file and remains a release gate.

No environment registration endpoint or CLI is shipped at this checkpoint. Do not construct production qualification records from worker assertions. Future registration must authenticate an operator, bind exact owner/business and identity, and audit registration/revocation. Qualification must pin the provider/runtime/FactoryVersion tuple and capability evidence independently of advertisement. The local device table remains authoritative for Sofie Local pairing and permission heartbeat; do not invent a second device identity database.

Routing diagnostics: an absent/stale/offline/revoked or unqualified environment returns Waiting; a Work authority mismatch returns Denied; protocol mismatch cannot be overridden by a client version. Existing bound attempts require canonical reconciliation, never another call to start from a BOUND readback. Do not remove the current loopback restriction before the authenticated remote lifecycle and custody are implemented.

Reconcile cloud implementation through the active Cloud Execution owner. Its image/infrastructure milestone is advanced; HEADLESS canonical Work/harness/verifier/Mac-off/P0 remain the critical path. Fabric must not replace or gate that implementation. Complete real qualification before requesting the first paid canary.

## Optional operator surfaces

ExecutionEnvironment → ExecutionProvider → existing harness → optional SessionSurfaceProvider. [Contract and architecture](../architecture/session-surfaces.md); [operator/security/qualification runbook](session-surfaces.md). No live adapter or Control Center action is enabled. HEADLESS requires neither cmux nor tmux. Attachment qualification cannot enable production cloud admission.

## Future cloud computer qualification

Follow the [harness-neutral capability boundary](../architecture/harness-neutral-environments.md). No browser/desktop runtime is provisioned by the new vocabulary. Keep the currently qualified harness and HEADLESS critical path. Later qualify each browser/desktop/screenshot/appInteraction capability independently with Work-scoped authority, tool/action restrictions, cross-owner isolation, revocation and teardown. Never route by specialist name, advertise all computer capabilities merely because an environment is CLOUD, or treat session.browser as browser execution authority.
