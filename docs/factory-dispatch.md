# MyEve authenticated dispatch lifecycle

This extends the qualified Gate C producer at `fcd8afd6fbaa2b9045b9e9700608d546edf011a9` on the owned `codex/digital-worker-factory` branch. The commit containing this document is the producer candidate. Gate C result signatures, artifacts, keys and immutable execution snapshots keep their existing protocol. The prior Gate C evidence remains historical and is not rewritten.

`POST /api/connect/v1/dispatches` persists request intent using the existing SQLite intake key before preparing one real WorkOrder/Run and execution snapshot. No coding agent executes during preparation. The consumer must retain the complete returned attempt binding, acquire its canonical writer, and then call `POST /dispatches/:requestId/dispatch` with that exact writer identity. The SQLite claim precedes execution. Duplicate dispatch returns the same attempt. A lost response is reconciled by `GET /dispatches/:requestId`, never by creating another attempt.

`POST /dispatches/:requestId/stop` persists a stop tombstone before cancellation. PREPARED attempts can become NOT_DISPATCHED immediately; running attempts remain STOPPING until the execution call settles, its process groups are absent and any labeled verifier containers are absent. Terminal observations are retained in immutable events. Restart retains prepared attempts without executing them and keeps uncertain attempts UNKNOWN. An absent/unrecorded process identity after a crash is not terminal proof; that exceptional case stays fenced and requires resource reconciliation. Elapsed time is never terminal proof. A producer deadline aborts the active call even without consumer polling.

Connection grants explicitly include `factory.prepare`, `factory.dispatch`, `factory.observe`, and `factory.stop`, plus the exact repository path. Tokens and result signing private keys remain backend-only. The existing result endpoint retrieves the signed exact attempt and bounded artifacts. Candidate receipts do not authorize execution. No new writer, candidate or receipt store was added.

## Qualification limits

Local tests use real HTTP authentication, SQLite, task Git worktrees, candidate commits and signed results; coding and producer verification are explicit synthetic dependencies. MyEve separately qualifies the connected path against real PostgreSQL and its protected Docker verifier. The standalone producer also tests actual subprocess cleanup and offline verifier behavior. No paid model invocation occurred.

`createSupervisor({localFactoryFixture:true, jobDependencies:{runCodex,verifyCandidate,...}})` is an explicit backend-only test injection. HTTP cannot enable it. Default execution availability is DISABLED; a valid token, fabricated qualification, or valid binding cannot bypass that default. The CLI currently offers no qualified dollar-ceiling enforcement, so a live authorization envelope is not ready.

## Work spend boundary (historical V1)

This section describes the accepted V1 candidate at `8f5e377`. V1 budgets remain readable but cannot authorize paid calls after the V2 upgrade below.

Schema version 7 adds one immutable USD micro-dollar ceiling per MyEve Work and a durable operation ledger. A new Work generation may bind a new exact request and deadline without resetting the ceiling. An old generation cannot reserve or start a paid operation after that handoff. Cancellation prevents new reservations and starts. All attempts and providers for the Work share one SQLite `BEGIN IMMEDIATE` reservation calculation across supervisor processes.

The paid boundary is each Responses request, not `codex exec` launch. For a pinned model and price revision, the gateway reserves the cost of the **full model context** plus the explicit maximum output tokens before sending the request. It rejects unsupported routes, multimodal and hosted-tool charges, unqualified service tiers, stale prices, unknown models and server-side conversation chaining. The installed Codex CLI is launched with a custom loopback provider and an isolated environment containing only a gateway child token; the upstream provider credential stays in the host gateway. Gateway receipts store provider request ID and authoritative usage. Lost responses, missing usage, process death or uncertain settlement retain the entire reservation as UNKNOWN. Retained exposure is never refunded automatically.

`GET /api/connect/v1/dispatches/:requestId` returns authenticated `spend` readback: currency `USD`, unit `microUSD`, exact Work/generation/request/WorkOrder, ceiling, settled and retained exposure, available amount, cancellation flag and operation records. A consumer must treat UNKNOWN as exposure and cannot infer a refunded budget from a timeout. A signed Gate C result remains separate from spend readback; neither grants publication or writer authority.

The only executable metered mode is a backend-injected **loopback synthetic provider fixture**. The default production mode is DISABLED, and the default host Codex path now fails before any paid call. A local test drove the installed CLI into the gateway using a fake provider that returned 503; the reservation remained UNKNOWN. That proves routing and fail-closed recovery, while real provider completion, current commercial pricing, and a production credential boundary remain unqualified. No paid call was made. See [evidence](evidence/myfactory-spend/REPORT.md) and the [exact consumer handoff](my-eve-spend-handoff.md).

Run `npm test`, `npm run typecheck:producer`, `npm run check:producer-governance`, and `npm run build`. The control tests include preparation/restart, exact duplicate dispatch, malformed identities, foreign version, authentication, pre-dispatch cancellation, STOPPING until settlement, default paid denial and deadline cancellation. MyEve evidence is in `docs/verification/2026-09-27-myfactory-beta/` of the paired consumer candidate.

## V2 spend and completion contract

This new reconstruction begins at durable producer `8f5e377`. Lost producer commit `efe9e856` is not recoverable and supplies no qualification credit. SQLite migration 8 adds immutable pricing/plan columns, bounded paid-operation slots, current writer identity and productive/completion phase to the existing Work ledger. It preserves migration 7 and V1 budgets; a V1 budget cannot authorize a paid model call.

PREPARE accepts an exact `spendContract` with revision, planned productive and completion operation counts, `maxPaidOperations` equal to their sum, and a protected completion reserve. The producer derives a conservative full-context/full-output reservation from its pinned price card and rejects a plan that cannot fund all operations before first execution. The card expiry and pricing revision are durable. A generation or attempt cannot reset the Work ceiling or slots.

At the loopback Responses boundary, `BEGIN IMMEDIATE` serializes exact writer/generation/request/FactoryVersion binding, cancellation, deadline, price expiry, UNKNOWN exposure, phase, operation limit, Work ceiling and protected completion allowance. The gateway repeats decisive checks immediately before provider dispatch. Missing or uncertain usage retains the whole reservation as UNKNOWN and blocks every new paid call for that Work. Restart turns unresolved reserved/dispatched rows into UNKNOWN. Exact replay cannot redispatch.

After productive coding, the host closes that gateway, switches the durable ledger to completion, issues a new child token, and launches a read-only completion run. Candidate custody requires a settled completion operation and complete accounting. Resource reconciliation includes both worker processes. The host fences paid authority before terminal readback. Factory results remain partial unless their separate review and publication gates actually pass.

The installed CLI's `tool_search` with `execution:"client"` is allowed as local discovery metadata within a metered model request. Hosted, unspecified, and unknown tool definitions remain denied. Client discovery itself uses no paid slot; the next model request does.

The [private-alpha provider loader](../apps/supervisor/src/real-provider.ts) pins the OpenAI Responses endpoint, exact model and Keychain reference, and fails closed on missing/expired configuration. It is not wired into default supervisor startup; paid execution stays disabled. Current pricing must be independently approved before any live use. Qualification and limitations are recorded in the [fresh dossier](evidence/myfactory-private-alpha-reconstruction/REPORT.md).
