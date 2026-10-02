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


## Canonical dispatch and lease storage

CONNECTED: **11 passed, 0 failed** across canonical ledger parity and dispatch tests ([combined log](postgres-combined-tests.log)). The cloud protocol names exact repository/commit/tree and server-granted commands/paths; it cannot accept an owner filesystem path. Cloud WorkOrder and Run retain their existing canonical states, replacing local source/workspace references with remote identities.

PostgreSQL stores canonical intake receipts, events and resource leases. A single transaction lock shared with spending protects duplicate dispatch, stop tombstones and the unresolved-resource limit. Cancellation fences spending atomically. Expired leases cannot be renewed; restart observes the same allocation intent and never allocates a replacement. A late allocation receipt after cancellation is retained for teardown and cannot grant productive authority. The PostgreSQL spend adapter now requires a RUNNING cloud resource with a live database-time lease by default; standalone accounting parity tests explicitly opt out of that resource requirement.

The first dispatch test run failed because the test-only schema rewrite also changed literal event names. The isolated schema rewrite was narrowed to table references and now asserts literal preservation. [Original failure](postgres-dispatch-first-run.log) is retained; no runtime authorization check was relaxed.

DETERMINISTIC: **206 passed, 0 failed, 7 gated skips** ([log](dispatch-regressions.log)). The two PostgreSQL gates were separately run above. Contract typecheck and producer governance PASS. Migration 004 is staging-only. This checkpoint has no public cloud dispatch route: hosted controller wiring, durable queue-to-Work integration, worker authority, teardown completion, signed custody and MyEve integration remain pending. In particular, resource storage tests do not constitute cloud allocation/recovery or Mac-off qualification.


## Hosted model boundary and owner-side isolation

The existing SpendGateway now exposes a Fetch adapter using the same validation, reservation, dispatch, accounting, UNKNOWN and no-retry code as its local HTTP adapter. Trusted server configuration may supply a deterministic upstream transport; the request cannot select it. Tests require durable dispatch before that transport runs and prove an uncertain result retains UNKNOWN without fallback. Hashed constant-time credential comparison also rejects multibyte bearer input without a length exception. Full Factory regression: **208 passed, 0 failed, 7 gated skips**, [log](gateway-fetch-regressions.log). No hosted model endpoint or real provider is enabled.

Sofie's ordinary preview inherited a shared database binding. Qualification therefore uses a new isolated owner-facing project `sofie-cloud-qualification` (`prj_XU7fJW735PtsnKoAYtGfzdnsotIB`) and a fresh free Neon resource `sofie-cloud-qualification-db` (`store_fOPC5aF0CPD0FfOW`, iad1), connected only to preview. MyEve's canonical schema through 0079 was applied to that initially empty database. Existing Sofie project/environment bindings were not changed. There is no deployed qualification web app yet. Factory execution/custody stays exclusively in `myfactory-cloud-staging`; the new client receives no Factory database, artifact or verifier credential.

See [project metadata](sofie-staging-project.json) and [database metadata](sofie-staging-database.json). No production data was copied. The MyEve V2 transport is separately tested and remains blocked at cloud runtime initialization until source and protected verification integration lands.


### Signed cloud configuration checkpoint

Execution snapshot V2 binds the exact source tree, immutable worker/verifier images, provider version, region, policy hashes, resource bounds, versioned skills and explicit DETERMINISTIC/LIVE evidence class. V1 parsing remains strict. Factory and MyEve verify the same public synthetic signed packet and reject changed trees, image pins and version downgrades. A deterministic configuration does not authorize live models.

Validation: 210 Factory tests passed, 0 failed, 7 environment-gated skips; producer typecheck and governance passed. MyEve: 2,003 passed, 94 gated skips, typecheck/governance passed. These are deterministic regression results, not cloud Work or Mac-off qualification.

The new project-slug corpus has three intentionally failing baseline checks. It is qualification input, separate from the passing repository regression suite. It replaces the infrastructure quantity-style objective for subsequent engineering Work. No worker has executed this corpus yet. Cloud admission remains disabled, paid model calls remain zero, and cloud harness/verifier/Mac-off/P0 remain NOT_RUN.


### Cloud custody checkpoint

Factory validates bounded source/candidate files, exact Git tree/commit identities, allowed paths and exact patch application before storage; no local Git process is needed in the controller. Patch parsing uses pinned jsdiff 8.0.4 with zero fuzz and no line-ending conversion ([upstream documentation](https://github.com/kpdecker/jsdiff)). MyEve's V2 custody path consumes a bounded file projection and retains the existing signed exact-tree candidate guard; the V1 local path and Attempt-8 publisher are unchanged. This is implementation evidence, not a hosted candidate lifecycle PASS.

Migration 005 was applied only to dedicated staging with verified TLS. Connected PostgreSQL tests: 7 passed, including delivery-before-send receipt, duplicate/rebound messages, cancel/collection races, immutable custody, wrong-resource cleanup, early ambiguous 404 and fenced restart. Queue messages cannot grant execution authority. The new source branch pins three intentionally incomplete project-slug files; see qualification-source.json.

Factory regression: 212 passed, 0 failed, 7 environment-gated skips; producer typecheck/governance passed. The first restricted-environment run failed to bind loopback sockets (EPERM); its log is retained separately and is not counted as PASS. MyEve: 2,005 passed, 94 skipped, typecheck/governance passed. Hosted canonical Work/controller integration, cloud harness, independent verifier, Mac-off and P0 remain NOT_RUN. Public cloud admission disabled; paid models/publication: zero.


### Hosted canonical controller implementation checkpoint

The staging-only V2 API now connects canonical preparation/spend binding to a private queue consumer, one durable execution claim, a separately queued recovery delivery, exact source materialization, a bounded deterministic worker, producer process quiescence, validated private candidate custody, sandbox teardown and signed Result retention. Recovery observes/fences the original resource; it never restarts productive execution. Late cancellation wins terminal classification; ambiguous allocation keeps the concurrency slot. Admission is restricted to the fixed staging client/source and eight total qualification Works. No real model provider is attached.

The result/signing key and application client token exist only as sensitive preview variables. Deployment protection remains enabled. The next hosted Sofie connection needs the explicit access approval documented in [sofie-access-approval.md](sofie-access-approval.md); automatic review rejected creation of a new persistent project-scoped bypass. No new bypass was created or existing bypass redistributed.

Validation: 222 deterministic regression tests passed, 0 failed, 7 gated skips; connected PostgreSQL suite separately passed 8 checks; producer/cloud TypeScript and 48-source governance passed. MyEve's previous checkpoint remains 2,005 passed and 94 skips. Build failures and TypeScript diagnostics were retained before repairing function-pattern precedence, output directory and shared monorepo compiler configuration. Deployment success is not hosted Work qualification. Canonical hosted Work/harness/verifier/Mac-off/P0 remain NOT_RUN. Paid models and publications remain zero.

Final preview: https://myfactory-cloud-staging-3afxwqiap-jaydubya818.vercel.app (`dpl_A8powfX1GhrGTw3uoDFeoUjmDa2j`), provider target null/preview, READY. Anonymous request remained protected (302). Build source identity: `4d5d746d9cb6b2d3ea8239c7bd94d3dabb4a9d449ef476cbca6571419cc46e19`. No authenticated cloud Work was submitted.
