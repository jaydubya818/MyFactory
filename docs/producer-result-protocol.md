# Producer result attestation, version 1

This opt-in protocol extends MyFactory's existing Ed25519 receipt mechanism. It proves what the trusted supervisor recorded and returned. It does not prove an uncompromised host, independently verify a software change, or grant consumer authority. MyEve integration, writer handoff, production delivery and live Q37 execution remain unqualified.

## Existing boundary and extension

| Field/boundary | Existing admission receipt | Result extension |
|---|---|---|
| Service/producer identity | PARTIAL: pinned public key | Factory identity bound to trusted key registry |
| Algorithm/protocol | EXISTS: Ed25519, `MYFACTORY_RECEIPT_V1` domain | Same primitive, distinct `MYFACTORY_RESULT_V1` domain |
| Key ID/version | MISSING | Signed immutable key ID; registry retains historical keys |
| Request ID | EXISTS: signed issue ID | Saved initiating request ID; local requests explicitly namespaced |
| WorkOrder | EXISTS | Exact WorkOrder ID |
| Run/attempt | MISSING | Exact Run UUID and attempt number |
| Factory/FactoryVersion | MISSING | Factory ID plus immutable content-derived version |
| State/time | PARTIAL: WorkOrder state and update time | Terminal producer result, captured/completed/issued timestamps |
| Payload digest | PARTIAL: signature covers encoded receipt bytes | Canonical aggregate manifest SHA-256 |
| Replay identity | PARTIAL: deterministic intake request | Stable result operation ID for one producer/request/WorkOrder/attempt |
| Candidate | MISSING | Actual Git commit/tree objects, base identity and patch SHA-256 |
| Evidence/artifacts | MISSING | Check metadata and exact bytes, separate canonical digests bound by the result |

The legacy hosted request and status receipt wire formats remain compatible. A result is not appended to Linear or sent to MyEve by this tranche. Its scoped local readback is available to existing registered backend clients. A cloud consumer still needs an authorized delivery path.

## Admission capture and trust

When result signing is enabled, the supervisor preflights its actual executor before creating a Run. In the same SQLite transaction as Run creation it records `run.execution_snapshot`. The immutable snapshot binds the initiating request, WorkOrder, Run, attempt, input commit, actual model, executor version, worker profile, verifier image, Node/platform/architecture, configured checks, allowed paths and timeout. The existing skill reference is recorded as a configured reference, not a claim that the worker read that skill.

`sourceDigest` hashes the supervisor and package runtime source files, package metadata and dependency lock. `configurationDigest` hashes the allowlisted effective execution configuration. `factoryVersion = SHA256(canonical({sourceDigest, configurationDigest}))`. It is an actual content identity, not a human-supplied version label or a Git revision guessed later. Runtime source changes after module load fail closed until restart. The installed code and executor host are trusted; this is not hardware remote attestation. The verifier image is the configured image reference, not an invented resolved image digest.

Execution uses the captured model, timeout, check configuration and image. Executor preflight must still match before productive execution. The WorkOrder input is copied at admission so mutation of the caller's object cannot change the running configuration. A1 retains F1 if model configuration changes; A2 may capture F2. The result builder only reads A1's saved snapshot. Legacy attempts without that record cannot be backfilled. Untrusted completion output has no FactoryVersion override.

Hosted request IDs come from the previously authenticated, persisted `hosted.intake_received` event. Local action requests use a stable actor/idempotency identity persisted at WorkOrder creation; older locally created WorkOrders use `local-workorder:<id>`. The snapshot also hashes the complete admitted Work plus request ID. This does not introduce MyEve Work-generation fields or replace consumer-side Work linkage checks.

## Wire shape and canonical bytes

`SignedResult` contains exactly `protocol`, `encoded`, `signature`, `manifestDigest`, and `artifacts`. `encoded` is base64url of canonical UTF-8 JSON. Canonical objects sort keys recursively; arrays retain their defined order; nonfinite numbers and non-JSON values are rejected. Ed25519 signs `MYFACTORY_RESULT_V1`, NUL, then the encoded payload, reusing the status receipt's signing primitive with domain separation. `manifestDigest` is SHA-256 of the canonical payload bytes.

The manifest contains protocol, key ID, producer, operation ID, the saved execution snapshot, producer terminal status, candidate, ordered evidence/artifact metadata and their canonical SHA-256 digests, and completed/issued times. Its strict schema accepts no Ready, approval, writer, publication, budget or scope-grant fields.

Candidate identity includes full commit and root tree object IDs, input/base commit and patch digest. Returned artifacts include the actual uncompressed Git commit and root tree object bytes, the exact producer patch, and one log per check. Verification recomputes Git object IDs using Git's object header, checks the commit's single parent/base and tree, and hashes every received artifact. The supervisor additionally compares the saved patch against `git show --format= --binary --no-ext-diff` for the actual candidate before signing. Files, URLs and display labels are never artifact identities.

Each artifact binds opaque ID, kind, producer, Run, candidate, SHA-256, byte count and recorded creation time. Each check binds check ID, producer, Run, candidate, command, outcome, exit code, start/finish and its exact log artifact. COMPLETED requires the captured ordered checks, each passing with exit 0. Check results remain **Factory-reported evidence**, not independent MyEve verification. Root tree bytes authenticate the tree ID; this profile is not a complete recursive tree/blob export for reconstruction. Consumers must separately obtain and independently verify the candidate before readiness.

Limits: 4 MiB per artifact, 8 MiB aggregate raw artifact bytes, 12 MiB serialized result; at most 100 checks plus three candidate artifacts. Oversized or incomplete evidence fails export rather than silently truncating it. The signed bytes and artifact copies are frozen together in `run.signed_result` using existing SQLite event storage. No database migration is introduced. A full result may be large; consumers must use the result endpoint rather than an event stream as artifact transport.

## Delivery, recovery and state

`GET /api/connect/v1/work-orders/<workOrderId>/runs/<runId>/result` requires the existing backend client token and repository scope. The client method selects the exact attempt, not “latest.” Terminal replies contain the frozen result. They never start work, publish, or transfer a writer. Result issuance is deterministic by stable operation identity and immutable stored bytes; issuance time/signature are reused after loss or restart. A result read can reconcile a terminal attempt whose initial freeze failed, but cannot backfill its execution snapshot.

RUNNING, STOPPING and UNKNOWN have `result: null`. A cancel request is STOPPING until the Run records cancellation. Interrupted/recovery-held and timed-out worker outcomes are UNKNOWN; no terminal failure or success receipt is fabricated. A late terminal result retains its original attempt/version. Distinct attempts have distinct operation IDs; the consumer decides whether an older attempt is historical. A result does not reacquire native authority.

Use `verifyResult` with independently stored expected Factory/version/request/WorkOrder/Run values. Do not derive the expectations from the same untrusted envelope. After verification, `compareResults` returns DUPLICATE for identical operation/digest and rejects a different manifest for the same operation. Storage serializes creation with BEGIN IMMEDIATE; competing writers cannot replace a frozen record. An ambiguous duplicate immutable event fails closed. Consumer-side concurrent admission/durable dedupe remains separate work.

## Keys

Opt in with an owner-managed `result-signing.json` in the supervisor data directory containing only `factoryId`, `currentKeyId`, and `keys`. Each key record contains `factoryId`, immutable `keyId`, PEM public key, `activeFrom`, `notAfter`, and optional `retiredAt`/`revokedAt`. The private key is read from the existing `hosted-receipt-key.pem`. The selected public/private pair must match and be Ed25519. No key is generated, replaced or rotated automatically; no production key was changed during qualification.

Rotation requires an owner-managed registry update/restart: select a new current key and retain the old public record, with its retirement boundary. Existing results stay signed by their original key. Unknown/ambiguous keys, wrong producer/version/protocol, invalid signatures and issuance outside the key window are rejected. Retired, revoked or expired keys cannot authorize current admission. Historical mode retains cryptographic verification and returns `keyValidForCurrentUse: false`; it is auditability, not permission or proof of pre-compromise issuance. A producer timestamp alone is not evidence that a consumer observed the receipt before revocation. Revocation does not delete historical bytes or keys.

The signing key is selected at result issuance, while execution provenance remains the admission snapshot. A trusted deployment must protect its key and installation from the coding worker. This protocol does not harden a compromised same-user host.

## Qualification

See [the producer dossier](evidence/q37-producer-attestation/REPORT.md) for exact source fingerprints, tests, golden returned bytes and limitations. Factory-granted consumer authority remains zero. MyEve independent verification and readiness are outside this producer gate. Gate B writer handoff is untouched.
