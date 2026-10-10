# External-alpha verifier: runner isolation and hidden-suite custody

Applies to the Alpha Tasks acceptance verifier (`apps/supervisor/src/alpha-task-verifier.ts`) as used by the external-alpha
Factory entry (`apps/cloud-control/src/external-alpha-verifier.mjs`). This repository is PUBLIC: nothing in this document or
in the tree contains hidden-suite material, private repository names, tester identities or secrets.

## 1. Required production runner isolation

Candidate code is untrusted model output. In production mode the verifier returns `PARTIAL` (never `PASS`) unless the HOST
supplies an `IsolationAttestation` for an allow-listed runner (`productionRunnerIds`, currently only
`vercel-sandbox-verifier-v1`). The local macOS/Node-permission-model runner is deliberately not allow-listed in production.

The host (the Factory control plane, not the runner and not the candidate) builds the attestation from what it allocated and
read back. Every field is mandatory and exact; any extra or missing field invalidates it:

| Field | Required value |
| --- | --- |
| `kind` | `SANDBOX_DENY_ALL_V1` |
| `runnerId` | equals the runner id and is in `productionRunnerIds` |
| `networkPolicy` | `deny-all` (read back from the allocated sandbox) |
| `filesystem` | `UNPRIVILEGED_UID_WORKSPACE_READ_SCRATCH_WRITE` |
| `environment` | `SCRUBBED` (no credential names or values) |
| `hiddenMaterialVisibleToCandidate` | `false` |
| `disposable` | `true` |
| `image` | digest-pinned reference `name@sha256:<64 hex>` |
| `sessionId` | the allocated sandbox id, `sbx_...` |
| `attestedBy` | `factory-host` |

Operational requirements the attestation stands for:

1. A fresh sandbox per verification, destroyed after the verdict, cleanup confirmed by the host.
2. Network deny-all for the whole life of the verifier sandbox. Only custody-validated exact candidate bytes enter it
   (no Git checkout, no hooks, no tokens).
3. Candidate code runs as an unprivileged uid; only the workspace is readable and one scratch directory is writable.
   Other processes' argv and environment are not visible. The hidden probe and scenarios never exist as a file or process
   argument the candidate can read.
4. Bounded wall clock, output size and process count; scrubbed environment.
5. The producer sandbox is already destroyed before the verifier is allocated.

The cloud adapter wires this as dependency injection (`runnerFor`, `attestationFor`, `loadHidden`). When any of them is
absent, throws, or the supervisor verdict is `PARTIAL`, the adapter throws `VERIFIER_PARTIAL`, the verification store records
UNKNOWN, and the Run is FAILED, never accepted. As shipped, the production composition supplies none of the three: the
real-sandbox runner is NOT implemented in this change, so production external-alpha verification is `PARTIAL` by construction
until the host supplies it. This is intentional and tested (`apps/supervisor/test/alpha-task-verifier.test.mjs`,
`apps/cloud-control/test/external-alpha-verifier.test.mjs`).

## 2. Hidden-suite custody

Location (outside the repository): `$FACTORY_VERIFIER_CUSTODY_DIR/alpha-tasks-v1/`, a control-plane-only directory or a private
blob materialized there. It is never inside the candidate sandbox filesystem and never committed.

Format: exactly two files.

* `probe.mjs`: the hidden probe source run by the host harness against the candidate.
* `suite.mjs`: an ES module exporting `scenarios`, `evaluators` and `uiEvaluators` (see the `HiddenSuite` type).

`loadHiddenSuite` reads each file once, recomputes the digest over those exact bytes, compares it to `HIDDEN_SUITE_SHA256`
(`alpha-task-verifier.ts`) and imports `suite.mjs` from the same bytes (no second read, so no swap window). Mismatch throws
`VERIFIER_CUSTODY_DIGEST_MISMATCH`; no directory throws `VERIFIER_CUSTODY_UNAVAILABLE`; both become `PARTIAL`.

### Recomputing `HIDDEN_SUITE_SHA256`

Run in the custody directory after any deliberate change to either file:

```sh
cd "$FACTORY_VERIFIER_CUSTODY_DIR/alpha-tasks-v1"
node -e "
const {createHash}=require('crypto'),fs=require('fs');
const s=b=>createHash('sha256').update(b).digest('hex');
console.log(s(JSON.stringify({probe:s(fs.readFileSync('probe.mjs')),suite:s(fs.readFileSync('suite.mjs'))})))"
```

The value is `sha256(JSON.stringify({probe: sha256(probe.mjs), suite: sha256(suite.mjs)}))` with that key order. Then:

1. Replace `HIDDEN_SUITE_SHA256` in `apps/supervisor/src/alpha-task-verifier.ts` (the constant is a digest, not secret).
2. The verification policy digest (`alphaTasksVerificationPolicySha256`) and therefore the FactoryVersion change. Recompute
   the installation's `factoryVersion` with `externalAlphaFactoryVersion` and redeploy the digest-pinned installation.
3. Authorities signed by MyEve carry the old `factoryVersion` and are refused (`AUTHORITY_FACTORY_VERSION`); MyEve must
   re-issue after the installation is redeployed.
4. Re-run the supervisor suite with `FACTORY_VERIFIER_CUSTODY_DIR` set; the custody-gated tests run only then.

Never print, log, attach or paste either file; the digest alone is the public commitment.
