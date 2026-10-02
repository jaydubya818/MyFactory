# Cloud canonical ledger migration — partial

The image and hosted infrastructure lifecycle passed Phase 2. Canonical cloud Work and the existing harness have not yet been connected. Cloud admission remains DISABLED and paid model operations remain 0.

The new PostgreSQL implementation uses the same `WORK_LEDGER_V2` admission, pricing, exact binding, completion-reserve, UNKNOWN and accounting functions as the existing SQLite ledger. SQLite retains its transaction mechanics; PostgreSQL uses a transaction-scoped advisory lock and database time. This small staging deployment intentionally serializes ledger transactions. The model gateway now awaits durable asynchronous reservation and dispatch before contacting any provider, and awaits settlement/UNKNOWN persistence before returning.

CONNECTED PostgreSQL qualification: **6 PASS, 0 FAIL** in a unique temporary fixture schema, removed afterward. Tests compare complete SQLite/PostgreSQL accounting through productive/checkpoint/repair/completion, race separate connections for the final slot, reject replay, preserve UNKNOWN across restart/new generation, deny stale writers and post-cancel dispatch, and retain exposure when pricing expires. Migration 002 was then applied to dedicated staging with verified TLS; a checksum ledger records applied source. No owner/account/chat data or existing Work was copied.

The first connection attempt timed out at five seconds before creating fixtures. The previously qualified read/lock probe subsequently passed. Connection timeout is now bounded at 15 seconds to accommodate database startup; SQL statements remain bounded at five seconds. The original failure is retained and is not relabeled PASS. This does not prove the provider-internal timeout cause.

These are storage/model-boundary qualifications. The remote Work contract, durable queue/leases, cloud harness, candidate custody, independent verifier, Result/Proof and Mac-off/P0 remain NOT_RUN. PostgreSQL tables do not themselves enable execution. The Attempt-8 publisher is unchanged.

Final deterministic suite: **199 PASS, 0 FAIL, 6 gated SKIPPED** (the five prior CLI/Docker checks plus the separately run PostgreSQL gate). Producer typecheck and governance PASS. Staging migration and checksum-protected idempotent rerun PASS.
