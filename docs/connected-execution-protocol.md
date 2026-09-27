# Connected execution control, version 1

This local, backend-only protocol gives a separately authorized MyEve connection control over **one** bounded MyFactory Run. It uses the existing WorkOrder, JobManager, SQLite Run/event storage, FactoryVersion snapshot, and signed result protocol. It creates no publication, approval, merge, deployment, or MyEve writer authority.

## Capabilities and routes

Each capability must appear separately in the registered connection's `actions` list. `workorder.create` does not include them. All routes require the existing loopback bearer token and exact repository scope; browser `Origin` requests are denied. A different or revoked connection cannot read or control a saved dispatch.

| Capability | Route | Effect |
| --- | --- | --- |
| `factory.execution.prepare` | `GET /api/connect/v1/work-orders/:id/execution-version` | Read the current source/configuration FactoryVersion and bounded Work digest |
| `factory.execution.prepare` | `POST /api/connect/v1/executions` | Persist one dispatch identity; no Run starts |
| `factory.execution.start` | `POST /api/connect/v1/executions/:dispatchOperationId/start` | Claim the one logical start and use the existing JobManager |
| `factory.execution.read` | `GET /api/connect/v1/executions/:dispatchOperationId` | Read exact state, Run/attempt, terminal evidence and result URL |
| `factory.execution.stop` | `POST /api/connect/v1/executions/:dispatchOperationId/stop` | Durably fence future starts, then request active worker stop |

`POST /api/connect/v1/actions` deliberately refuses these four capabilities. The existing human `run.start` and `run.cancel` actions remain human-only. This protocol is unavailable unless result signing and an authenticated, versioned executor are configured.

## Prepare and binding

Call `GET .../execution-version` for the selected WorkOrder. The response contains `factoryId`, `factoryVersion`, `workDigest`, `policyRevision`, and the effective model/executor version. Verify that Factory/FactoryVersion against MyEve's independent policy before preparing. The version is a digest of loaded MyFactory source and the allowlisted execution configuration, not a caller label.

`POST /executions` takes a caller-generated UUID `dispatchOperationId`, MyEve `requestId` UUID, MyFactory-created `workOrderId` UUID, exact `factoryId`/`factoryVersion`, and an ISO deadline within 30 minutes. The connection identity comes from the bearer token. SQLite binds that identity, Work digest, policy revision, effective model/executor version and deadline to one immutable dispatch row. A replay with the same fields returns that row; conflicting reuse fails. Only one open connected dispatch per WorkOrder is allowed. PREPARE does not allocate a Run or call the coding worker.

The connected row is the Stage-1 producer identity. MyEve must persist its own writer/request/dispatch authority before calling START. MyFactory does not manufacture a MyEve WorkOrder or grant MyEve authority.

## Start, Stage 2 and result

START checks the prepared deadline, Work digest, policy revision, current WorkOrder state, dispatch pause, attempt limit and versioned executor. It commits `STARTING` before entering JobManager. Duplicate or concurrent START requests observe the same dispatch; they never allocate another logical Run. Run creation, immutable producer execution snapshot, and binding of `runId`/`attemptNumber` to the dispatch occur in **one SQLite transaction**. The execution snapshot uses the prepared MyEve `requestId` and exact FactoryVersion; a changed source/model/executor version aborts Run creation. Stage 2 consists of the returned MyFactory `workOrderId`, `runId`, and `attemptNumber` bound to this dispatch. MyEve must bind those values immutably before Gate C result admission.

Successful terminal readback includes `quiescent: true`, `resultManifestDigest`, and the exact result route. The existing signed result manifest binds Factory, FactoryVersion, request, WorkOrder, Run, attempt, candidate, evidence and artifact bytes. Retrieve it at `GET /api/connect/v1/work-orders/:workOrderId/runs/:runId/result`; do not infer the attempt from the latest Run. An untrusted response body is not MyEve's admission or protected verification.

## Stop, expiry and recovery

STOP before START atomically records `FENCED` with no Run. A delayed START for that dispatch then receives `terminal_fence`, including after restart. STOP during STARTING/RUNNING records a permanent `stopRequestedAt` first, aborts the active JobManager attempt, and returns STOPPING/UNKNOWN until the worker exits. Repeated STOP is idempotent. START after the deadline also fences without allocating a Run. An active connected run receives an abort at its prepared absolute deadline, which is no longer than the 30-minute producer timeout ceiling.

`quiescent: true` is returned only for a dispatch with no Run that was durably fenced, or for its exact terminal Run after JobManager is inactive and the existing producer has frozen a signed terminal result. A stop request, absent heartbeat, timeout, or SQLite `interrupted` state does **not** prove quiescence. If process loss leaves worker or verifier effects uncertain, readback stays UNKNOWN and delayed START remains denied. Operator recovery must establish the prior worker's absence through the existing recovery-hold procedure; this protocol does not automatically convert UNKNOWN to terminal on elapsed time. MyEve must retain its Factory writer fence while UNKNOWN/STOPPING.

Only one local supervisor should own a data directory. The SQLite transaction and unique keys protect dispatch replay and attempt binding; this protocol does not turn a shared local filesystem into a multi-host execution cluster. Connected execution never authorizes GitHub publication.

## Consumer sequence

1. Create/reuse the scoped WorkOrder with a stable intake key and `syncToLinear: false` unless separately authorized.
2. Read and independently accept FactoryVersion; persist MyEve Stage-1 request and writer fence.
3. PREPARE with a fresh durable dispatch UUID and MyEve request ID.
4. START once. If the response is lost, **READ the same dispatch ID**; do not submit another dispatch.
5. Bind returned WorkOrder/Run/attempt as MyEve Stage 2. Read the signed result through its exact route and use existing Gate C authentication/admission.
6. READ until terminal/quiescent. Only then may MyEve release its Factory writer and take candidate custody. STOP on cancellation/takeover; retain the writer fence while STOPPING/UNKNOWN.

The producer protocol is locally qualified with synthetic worker/check fixtures. MyEve's two-stage Gate C and Gate B live adapter are separate qualifications. No live MyFactory attempt is authorized by this document.
