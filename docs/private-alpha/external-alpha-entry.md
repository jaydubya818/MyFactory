# External-alpha dispatch entry and MyEve conformance

## HTTP entry (separate from canary/production)

Function `apps/cloud-control/api/external-alpha.mjs`, routes under `/api/connect/v2/external-alpha/` (a dedicated Vercel
rewrite precedes the generic `/api/connect/v2/:path*` canary rewrite):

| Method and path | Effect |
| --- | --- |
| `POST dispatches` | body `{authority, prepare}` (max 40000 bytes): validate against the pinned installation, atomic consume, then CloudWorkControl prepare |
| `GET dispatches/{requestId}` | receipt-signed readback, owner Work only |
| `POST dispatches/{requestId}/dispatch` | body `{}`; dispatch the prepared Work |
| `POST dispatches/{requestId}/stop` | body `{}`; fence in PostgreSQL, then request termination |

Authorization is an exact per-slot tuple from the Factory-pinned installation: sha256 of the slot's bearer credential AND a
verified Vercel OIDC identity (issuer, audience, subject, team, project, production). Canary, staging and production
credentials or client ids never authenticate (they are rejected even if mis-pinned). A request for any Work outside the
caller's own slot is indistinguishable from an unknown request (404). Errors are fixed codes: no messages, stacks or secrets.

## Deploy-time inputs (never in the repository)

* `FACTORY_EXTERNAL_ALPHA_INSTALLATION` (one object or an array of 1..2 slots) and
  `FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256` (digest pin). Absent or inconsistent means every request is denied.
  Slots must share cohort, FactoryVersion, source digest and check commands, and differ in owner, project, client,
  repository, credential hash and OIDC subject.
* Private-source registry (private repository names, base commits, trees):
  `FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON` (secret variable) or `..._REGISTRY_FILE` (absolute, non-symlink,
  not group/world writable), plus `FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256` of the exact bytes. The registry
  entry must equal the repository, base commit and tree the installation pins. Format in
  `apps/cloud-control/src/external-alpha-registry.mjs`.
* `FACTORY_EXTERNAL_ALPHA_RECEIPT_SIGNING_KEY` (Ed25519 PEM) for signed receipts.

## MyEve conformance vectors

`apps/cloud-control/test/fixtures/myeve-conformance/vectors.json` is produced by RUNNING the MyEve issuer, controller and
policy code (`work-authority.ts`, `work-controller.ts`, `work-tuple.ts`, `policy.ts`) with a throwaway TEST-ONLY Ed25519
key whose seed string is public in the generator. It contains no real tester, repository, SHA or secret and is not pinned
anywhere real. It holds the MyEve-signed authority and request body, 194 one-field mutations, a competing authority, a
slot-2 authority, canonicalization vectors and readback-receipt cases judged by MyEve's own `verifyReadback`.

Regenerate from a throwaway COPY of MyEve (never a worktree someone is editing):

```sh
cp -R <myeve checkout> /private/tmp/myeve-copy      # needs node_modules
node --experimental-transform-types --disable-warning=ExperimentalWarning \
  apps/cloud-control/scripts/generate-myeve-conformance-vectors.mjs \
  --myeve /private/tmp/myeve-copy --myeve-commit <sha> \
  --out apps/cloud-control/test/fixtures/myeve-conformance/vectors.json
```

Output is deterministic for a MyEve commit (Ed25519 is deterministic), so a diff is a review signal. `--live` uses the
current clock; setting `MYEVE_CHECKOUT` makes the conformance suite also regenerate and compare live. Discrepancies go to
the shared `CONFORMANCE-DISCREPANCIES.md`, not into the MyEve tree.

## Checkpoint A: Result and recovery boundary

The external-alpha endpoint adds `GET /dispatches/{requestId}/result`. Authentication proves the exact slot's bearer and production OIDC tuple before any state lookup. Unknown, foreign and superseded Work generations return the same 404. A pending Result returns 202 with `pending:true`; a terminal response returns the existing `MYFACTORY_RESULT_V1` envelope. Producer completion alone cannot produce verified PASS. Independent verification, exact candidate custody and both cleanup receipts remain mandatory.

Every successful response includes `readbackAttestation` and `readbackSignature`. The attestation commits the admitted request digest/deadline, authority and receipt digests, WorkOrder/run/attempt, state, quiescence, verifier verdict, complete spend ledger and ledger digest. `x-external-alpha-challenge` accepts a fresh 16–64 character lowercase hex nonce, which is echoed inside the signature. The signature domain is `MYFACTORY_EXTERNAL_ALPHA_READBACK_V1`, followed by NUL and the canonical attestation digest. Issuance expires after 120 seconds. Clients must verify the signature, exact persisted prepare and receipt, fresh nonce, freshness and monotonic state before projecting Result or settling spend. Unsigned compatibility fields cannot close authority or release exposure.

`FACTORY_EXTERNAL_ALPHA_RESULT_SIGNING_JSON` uses the canonical Result signing configuration shape with `factoryId:myfactory-external-alpha` and `keyId:external-alpha-result-v1`. Its Ed25519 public key must differ from every configured production/staging Result key and the receipt/readback key. Reusing or merely relabeling an existing key fails closed. The external-alpha configuration digest commits this signing family, so a new external-alpha FactoryVersion must be derived and separately qualified before installation. Historical canary qualification remains attached to its original immutable source/configuration/version.

`GET /api/external-alpha-recovery` is a bounded cleanup-only durable scanner, configured as a one-minute Vercel cron. It requires a configured `CRON_SECRET` of at least 32 characters, the exact bearer header, and digest-pinned external-alpha installations. Absent installations leave it disabled. A session advisory lock serializes each original Run across concurrent scanners; process death releases the lock. Recovery never prepares or dispatches Work, mints authority, resets intake or allocates a replacement producer/verifier. It fences stale writers, reconciles original resources, retains UNKNOWN exposure, and saves the canonical signed Result after proven cleanup. A healthy producer-to-verifier handoff is excluded from the scan. Superseded generations remain eligible only for internal exact-owner cleanup, never for outward Result reads or productive writes.

Qualification for this increment covers real PostgreSQL expiry/restart/concurrency, stale-writer and stale-generation denial, pending/terminal Result reads, signed readback tampering, signer separation, cancellation and repeated cleanup. This is a foundation checkpoint, not full Gate 1 completion: productive external-alpha queue composition and the separate real verifier runner are still required. No tester installation, executable grant, invitation, paid provider operation or production deployment is authorized by this code checkpoint.


Live conformance now pins the reviewed MyEve checkpoint and runs its actual issuer, prepare builder and readback verifier. Synthetic vectors include a separate Result verification key, matching source/configuration/version and installation pins, a complete ledger and nonce-challenged attestation signed by the real Factory helper. Both committed and freshly generated cases must accept the exact signed fields, reject receipt-only/tampered responses, and ignore unsigned compatibility claims. Hosted CI runs this live check and the actual PostgreSQL authority-consumption suite. Public fixture keys are derived from public test seeds and must never be installed as real trust.

## Productive delivery checkpoint

Dedicated platform-private work and delayed-cleanup queue callbacks resolve the exact pinned installation from durable intake and authority rows. Queue payloads carry only the original run and nonce. Duplicate callbacks observe the sole canonical resource and retained signed Result. Unknown send acknowledgment fences the consumed authority and its budget; it cannot resend or allocate. Cancellation before allocation retains CANCELLED terminal truth without contacting a provider. Productive source and protected verifier qualification remain required before activation.
