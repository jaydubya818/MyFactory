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
