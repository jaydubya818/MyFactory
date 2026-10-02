# Cloud canonical ledger migration — partial

The image and hosted infrastructure lifecycle passed Phase 2. Canonical cloud Work and the existing harness have not yet been connected. Cloud admission remains DISABLED and paid model operations remain 0.

The new PostgreSQL implementation uses the same `WORK_LEDGER_V2` admission, pricing, exact binding, completion-reserve, UNKNOWN and accounting functions as the existing SQLite ledger. SQLite retains its transaction mechanics; PostgreSQL uses a transaction-scoped advisory lock and database time. This small staging deployment intentionally serializes ledger transactions. The model gateway now awaits durable asynchronous reservation and dispatch before contacting any provider, and awaits settlement/UNKNOWN persistence before returning.

CONNECTED PostgreSQL qualification: **6 PASS, 0 FAIL** in a unique temporary fixture schema, removed afterward. Tests compare complete SQLite/PostgreSQL accounting through productive/checkpoint/repair/completion, race separate connections for the final slot, reject replay, preserve UNKNOWN across restart/new generation, deny stale writers and post-cancel dispatch, and retain exposure when pricing expires. Migration 002 was then applied to dedicated staging with verified TLS; a checksum ledger records applied source. No owner/account/chat data or existing Work was copied.

The first connection attempt timed out at five seconds before creating fixtures. The previously qualified read/lock probe subsequently passed. Connection timeout is now bounded at 15 seconds to accommodate database startup; SQL statements remain bounded at five seconds. The original failure is retained and is not relabeled PASS. This does not prove the provider-internal timeout cause.

These are storage/model-boundary qualifications. The remote Work contract, durable queue/leases, cloud harness, candidate custody, independent verifier, Result/Proof and Mac-off/P0 remain NOT_RUN. PostgreSQL tables do not themselves enable execution. The Attempt-8 publisher is unchanged.

Final deterministic suite: **199 PASS, 0 FAIL, 6 gated SKIPPED** (the five prior CLI/Docker checks plus the separately run PostgreSQL gate). Producer typecheck and governance PASS. Staging migration and checksum-protected idempotent rerun PASS.


## Hosted queue delivery

CONNECTED PASS: [one delayed receipt](queue-0ba15c16-89b0-44c0-862a-4df521ce5a05.json). The submitting process exited at 07:40:09 UTC; the private hosted consumer recorded delivery at 07:40:19 UTC. A later independent read and duplicate submission returned the identical receipt. Authenticated HTTP access to the consumer returned 404. This proves a provider wake-up after the requester exits, not canonical Work recovery or the Mac-off Golden Journey.

Exact SDK `@vercel/queue@0.7.0`, fixed iad1 topic, ten-second delay, 120-second retention, eight lifetime diagnostic intents. PostgreSQL owns admission and completion; queue messages hold no execution authority. Private trigger plus admitted nonce/deployment binding prevent arbitrary payload execution. Ambiguous sends remain UNKNOWN and are never resent by this diagnostic. A matching late delivery can resolve UNKNOWN. Migration 003 stores only these staging diagnostic receipts.

DETERMINISTIC: full suite **204 passed, 0 failed, 6 gated skips**, [log](queue-regressions.log). Added tests cover ambiguous send/replay, duplicate and forged delivery, receipt races, HTTP authorization/staging guards and empty streamed POST handling. Initial test fixture used a token shorter than the existing minimum and correctly received 401; the fixture was corrected, without relaxing authentication.

Provider references: [queue quickstart/private triggers](https://vercel.com/docs/queues/quickstart), [SDK delivery and retention contract](https://vercel.com/docs/queues/sdk). Deployment-associated delivery requires retaining the originating deployment while its admitted work is outstanding. General Work admission, cloud harness, verifier, browser-off and Mac-off/P0 remain NOT_RUN. Paid model operations and publication effects remain zero.
