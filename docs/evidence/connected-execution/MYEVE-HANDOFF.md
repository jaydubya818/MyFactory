# MyEve Gate B consumer handoff

**Producer branch:** `codex/connected-execution-control` at `56521fd1f0965e198a0f1000c16916d7c9075466`.
**Producer status:** locally qualified with synthetic workers; no live execution. The MyEve `codex/digital-worker-integration` worktree had active uncommitted adapter, migration and test changes during this handoff, so this document makes no edit or qualification claim for that consumer.

## Exact wire contract

Grant each of `factory.execution.prepare`, `factory.execution.start`, `factory.execution.read`, and `factory.execution.stop` explicitly to the repository-scoped connected client. `workorder.create` alone grants none of them. Send its bearer token only to loopback `127.0.0.1`. Connected execution routes are deliberately separate from generic `/api/connect/v1/actions`.

1. Create/reuse the MyFactory WorkOrder with the existing connected `workorder.create` capability and a stable intake key. The MyEve Work ID is **not** the MyFactory WorkOrder UUID.
2. `GET /api/connect/v1/work-orders/{workOrderId}/execution-version` returns current `factoryId`, `factoryVersion`, `workDigest`, `policyRevision`, `model`, and `executorVersion`. Compare the returned FactoryVersion with MyEve's independently approved pin.
3. Persist MyEve's Stage-1 writer/request fence and a fresh UUID `dispatchOperationId`. `POST /api/connect/v1/executions` with `{dispatchOperationId, requestId, workOrderId, factoryId, factoryVersion, deadline}`. `requestId` is MyEve's UUID and must remain the Gate C correlation identity. The ISO deadline must be within 30 minutes. A repeat of this exact PREPARE returns the same dispatch; a conflicting repeat fails.
4. `POST /api/connect/v1/executions/{dispatchOperationId}/start` with an empty JSON object. Never allocate a new dispatch after an uncertain response. `GET /api/connect/v1/executions/{dispatchOperationId}` retrieves the exact state and, once allocated, immutable `runId` and `attemptNumber`.
5. Persist Stage-2 `{dispatchOperationId, requestId, workOrderId, runId, attemptNumber, factoryVersion}` with a compare-and-swap against the same current MyEve Work generation/writer. Fetch the signed result from the returned `resultUrl` only for this exact run, and use existing Gate C admission; the producer response alone grants no candidate custody.
6. `POST /api/connect/v1/executions/{dispatchOperationId}/stop` with an empty JSON object is idempotent. STOP fences later START before requesting worker abort. Continue READ until `quiescent: true`; `STOPPING` and `UNKNOWN` retain the Factory writer fence. A signed terminal result with the exact run and inactive JobManager, or a fenced dispatch with no run, is the only local quiescence proof.

The readback record has upper-case states `PREPARED`, `STARTING`, `RUNNING`, `STOPPING`, `UNKNOWN`, `COMPLETED`, `FAILED`, `CANCELLED`, and `FENCED`, plus `quiescent`, exact identity, timestamps, blocker/error fields where present, `resultManifestDigest`, and `resultUrl` when a signed result exists. An expired unstarted dispatch becomes `FENCED`. UNKNOWN cannot be cleared by elapsed time; reconcile the previous worker through MyFactory's recovery hold.

## Known consumer mismatch requiring coordination

At inspection, the uncommitted MyEve `factory-live-adapter.ts` called `/api/connect/v1/dispatches` and expected `factory.prepare`, `factory.dispatch`, `factory.observe`, and `factory.stop` plus `PREPARING`/`DISPATCHING`/`NOT_DISPATCHED` states. Those routes, capability names and states do **not** exist in this qualified producer. Its readback schema also expected a `snapshot`, `identity`, `spend`, and `evidenceRef` envelope that MyFactory does not return. The consumer owner should adapt that work to this contract or coordinate a narrowly reviewed producer revision. It must not loosen parsing and call the mismatch a passing integration test.

MyEve's current consumer schema must persist the dispatch UUID separately from its request UUID and exact MyFactory Run/attempt; do not infer a run from latest WorkOrder state. Reconcile Gate C's two-stage request/execution binding and MyEve's 0056/0057 migration ownership before changing them. A signed result and `quiescent: true` are both required before MyEve takes candidate custody; protected verification remains independent, and final Result stays PARTIAL absent later gates.

## Required consumer qualification

Use the live producer HTTP fixture, not a synthetic alternative endpoint, for create → version read → PREPARE → START → exact READ → signed Gate C admission → quiescence → candidate custody → protected verification. Repeat with lost START response, duplicate START, STOP before START, STOP during work, delayed START after STOP, changed FactoryVersion, revoked client, client/repository mismatch, process restart, UNKNOWN, and late signed result. Verify one MyEve writer per Work generation, zero duplicate Factory dispatches, zero false quiescence, and no native reacquisition while Factory is unresolved. Run Gate C, Gate B, 0056/0057, router, Current Truth, and protected-verifier regression gates before claiming live readiness.

No live MyFactory execution, writer grant, publication, or approval follows from this handoff.
