# MyEve authenticated dispatch lifecycle

This extends the qualified Gate C producer at `fcd8afd6fbaa2b9045b9e9700608d546edf011a9` on the owned `codex/digital-worker-factory` branch. The commit containing this document is the producer candidate. Gate C result signatures, artifacts, keys and immutable execution snapshots keep their existing protocol. The prior Gate C evidence remains historical and is not rewritten.

`POST /api/connect/v1/dispatches` persists request intent using the existing SQLite intake key before preparing one real WorkOrder/Run and execution snapshot. No coding agent executes during preparation. The consumer must retain the complete returned attempt binding, acquire its canonical writer, and then call `POST /dispatches/:requestId/dispatch` with that exact writer identity. The SQLite claim precedes execution. Duplicate dispatch returns the same attempt. A lost response is reconciled by `GET /dispatches/:requestId`, never by creating another attempt.

`POST /dispatches/:requestId/stop` persists a stop tombstone before cancellation. PREPARED attempts can become NOT_DISPATCHED immediately; running attempts remain STOPPING until the execution call settles, its process groups are absent and any labeled verifier containers are absent. Terminal observations are retained in immutable events. Restart retains prepared attempts without executing them and keeps uncertain attempts UNKNOWN. An absent/unrecorded process identity after a crash is not terminal proof; that exceptional case stays fenced and requires resource reconciliation. Elapsed time is never terminal proof. A producer deadline aborts the active call even without consumer polling.

Connection grants explicitly include `factory.prepare`, `factory.dispatch`, `factory.observe`, and `factory.stop`, plus the exact repository path. Tokens and result signing private keys remain backend-only. The existing result endpoint retrieves the signed exact attempt and bounded artifacts. Candidate receipts do not authorize execution. No new writer, candidate or receipt store was added.

## Qualification limits

Local tests use real HTTP authentication, SQLite, task Git worktrees, candidate commits and signed results; coding and producer verification are explicit synthetic dependencies. MyEve separately qualifies the connected path against real PostgreSQL and its protected Docker verifier. The standalone producer also tests actual subprocess cleanup and offline verifier behavior. No paid model invocation occurred.

`createSupervisor({localFactoryFixture:true, jobDependencies:{runCodex,verifyCandidate,...}})` is an explicit backend-only test injection. HTTP cannot enable it. Default execution availability is DISABLED; a valid token, fabricated qualification, or valid binding cannot bypass that default. The CLI currently offers no qualified dollar-ceiling enforcement, so a live authorization envelope is not ready.

Run `npm test`, `npm run typecheck:producer`, `npm run check:producer-governance`, and `npm run build`. The control tests include preparation/restart, exact duplicate dispatch, malformed identities, foreign version, authentication, pre-dispatch cancellation, STOPPING until settlement, default paid denial and deadline cancellation. MyEve evidence is in `docs/verification/2026-09-27-myfactory-beta/` of the paired consumer candidate.
