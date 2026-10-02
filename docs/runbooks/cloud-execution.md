# Cloud execution runbook

**Current staging status — 2026-10-02:** Exact Sofie preview → Factory preview Trusted Sources OIDC is enabled. Connected infrastructure/application access, different-project preview denial, and remove/restore revocation checks PASS. No static Factory bypass exists. Authorized productive Work, hosted harness, independent verifier and Mac-off/P0 remain NOT_RUN. [OIDC evidence and limits](../cloud-execution/phase-3/trusted-sources-oidc.md). Preserve the [credential-custody incident](../cloud-execution/phase-3/factory-bypass-custody-incident.md) and checkpoint `0df0c37`; historical status entries below do not supersede this status. Paid models: 0; production admission/publication: DISABLED.

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

Image acquisition is [resolved](../cloud-execution/phase-2/image-blocker.md). Use the exact qualified managed digest in `apps/cloud-control/src/infrastructure-plan.mjs`; never substitute its mutable discovery tag. `scripts/qualify-image.mjs` creates two sequential bounded diagnostic sandboxes and requires confirmed deletion. Diagnostic credentials stay in the local OS credential helper; hosted lifecycle code must use staging deployment OIDC. Custom VCR uploads remain unqualified and unnecessary. Continue with hosted durable allocation, exact source materialization, collection and cleanup before advancing qualification.


### Hosted infrastructure qualification

Current preview: `https://myfactory-cloud-staging-jhhd74zgx-jaydubya818.vercel.app` (`dpl_4eYNfnurMGEN4nnJSa7w6oaGGz31`, provider target null/preview).

`/api/infrastructure?id=<UUIDv4>` uses the separate `FACTORY_INFRASTRUCTURE_TOKEN`; the readiness token is denied. POST executes the fixed probe only when the UUID is new; GET reads durable state. DELETE is delayed recovery/cleanup after deadline plus 30 seconds, not a canonical Work cancellation API. All responses are private/no-store. Do not include a body, image, repository, command or model override. `scripts/hosted-infrastructure-probe.mjs <verified-preview-url>` sends the token over stdin to authenticated `vercel curl`, records each request and checks readback/replay. It performs no worker execution locally.

Never retry a failed/UNKNOWN attempt as fresh Work automatically. Read its retained stage/command error, confirm exact-resource cleanup, add a deterministic regression, repair and preserve the next numbered/UUID attempt. A lost allocation receipt holds the sole slot until delayed reconciliation. A successful artifact receipt is not a protected verifier verdict. Keep Work admission disabled.

The direct PostgreSQL credential is used only in the Factory controller for session advisory locks. Producer receives no OIDC, database or Blob credential. Host OIDC authorizes private Blob writes and readback against the fixed staging store ID. Bound artifact reads to 256 KB; retain content-addressed private evidence after teardown. The initial lifetime ceiling is eight infrastructure allocations and must not be raised to hide repeated failures.

### Canonical PostgreSQL ledger

Migration 002 adds Factory WorkOrder/Run execution records and canonical V2 budgets/operations. The migration runner records SHA-256 checksums and rejects changed applied migrations. The environment marker remains boundary version 1; `factory.schema_migrations` tracks actual migration revisions. Never copy local/private-alpha data into these tables. PostgreSQL integration tests require explicit `FACTORY_POSTGRES_TEST=1`, use unique temporary schemas and remove fixtures. A skipped connected test is not PASS. `recoverUnknown()` is an explicit recovery operation, never a routine healthy-worker restart action.


Hosted staging queue delivery is now CONNECTED PASS ([evidence](../cloud-execution/phase-3/README.md)). A delayed private consumer recorded PostgreSQL completion after the submitting process exited; duplicate submission returned the same receipt. Queue messages are wake-ups, while PostgreSQL remains authoritative. This bounded infrastructure check does not enable Work admission or qualify canonical recovery, the cloud harness, independent verifier, or Mac-off/P0. Keep the deployment hosting any outstanding message until reconciliation completes; never interpret an expired message as proof that an execution did not occur.


Canonical cloud admission/storage now has connected PostgreSQL evidence for exact source grants, duplicate dispatch, cancellation, late allocation receipts and lease expiry. Model reservation/dispatch requires a live running cloud lease by default. These controls are not yet wired to public Work admission. See the Phase 3 evidence for tests and remaining gates.


The canonical model gateway now supports hosted Fetch requests with deterministic upstream injection behind its existing accounting boundary. Sofie cloud qualification has a separate empty owner-side database and isolated web project, avoiding the existing preview's shared database binding. Factory state/custody remains in dedicated MyFactory staging. These are implementation checkpoints; cloud admission, harness, verifier and Mac-off/P0 remain unqualified.


Signed execution snapshot V2 now binds cloud image/source/policy/resource/skill pins and the evidence class, with a shared cross-repository signed test vector. Legacy V1 stays strict. See Phase 3 evidence; this does not enable cloud admission or establish Mac-off qualification.


Cloud custody now has pure-data source/tree/patch validation and durable PostgreSQL delivery, collection and cleanup fencing. MyEve can consume a signed cloud candidate without local Git while preserving the existing publisher guard. See Phase 3 evidence; hosted Work/harness/verifier/Mac-off integration is still pending.


The qualification-only hosted Work controller now implements private queue dispatch, exact source/worker execution, custody validation, cancellation/recovery and signed Result retention. Hosted Work qualification remains NOT_RUN. The dedicated staging-project deployment-protection bypass is now explicitly approved and configured only in Sofie sensitive preview backend configuration; Factory environment injection is disabled. Hosted application-boundary qualification is pending; see the Phase 3 access approval document. Public cloud admission stays disabled and paid model calls remain zero.

The current access-qualification controller preview is https://myfactory-cloud-staging-ao0tx133g-jaydubya818.vercel.app (`dpl_AWaRtExXPgKucMn2jHHudZe3ckDS`, source digest `a4c87222bebc47b621b95cd53e44952a57e6257521855d737a71410d3df255ab`). Application grants are independent of the deployment bypass. The [approved scope and revocation procedure](../cloud-execution/phase-3/sofie-access-approval.md) apply. Hosted boundary checks remain pending; no real model or publication is authorized.

The dedicated Sofie runtime/operator bypass is now explicitly approved and its hosted access matrix is **PASS**, including independent Factory auth and Work-scope denial. Build/client/HTML and observed log scans pass. The credential was then revoked and protection reverified; zero Sofie bypasses remain. [Access evidence and continuation](../cloud-execution/phase-3/sofie-runtime-access.md). Canonical cloud harness, verifier, Mac-off and P0 remain NOT_RUN; paid calls are zero.

## Harness qualification order

Follow the [HarnessProvider contract](../architecture/harness-provider.md). First
qualify the existing MyFactory/Codex harness in CLOUD with deterministic responses
and independent verification, then Mac-off/P0, then request the bounded real
canary. DeepAgent and other adapters follow afterward. Pin the full effective
eight-dimensional tuple in FactoryVersion; qualification does not transfer
between local/cloud environments or harness versions. Use the same versioned
Work corpus and controlled environment for later harness comparisons. Never
switch an admitted Work to a fallback harness. The registry remains deferred.

The [harness addendum](../architecture/harness-provider.md) now consumes Fabric's canonical optional
SessionSurface contract. HEADLESS remains mandatory; TMUX/CMUX are deferred
operator conveniences, with no role in productive lifetime or recovery.
Qualification evidence must include loaded skill hashes. Differential reports
use the same corpus/environment/model and report success, independent
verification rate, repair rate, operations, latency, cost and cleanup/recovery.
These contract changes do not qualify the hosted harness or Mac-off journey.


The existing Codex adapter is now wired into the dedicated cloud worker through the canonical SpendGateway/PostgreSQL ledger, with integrity-pinned installation, bounded SDK transport, host checkpoints, read-only completion and exact-tree custody. [Implementation and evidence limits](../cloud-execution/phase-3/cloud-harness-implementation.md): 119 local tests PASS, six gated skips; hosted harness and independent verifier remain NOT_RUN. This does not enable production, paid models or publication.
