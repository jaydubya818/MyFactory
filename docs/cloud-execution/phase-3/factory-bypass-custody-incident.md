# Factory deployment-protection custody incident and remediation

Date: 2026-10-02. Status: **revocation CONNECTED PASS; replacement and custody requalification BLOCKED on protection-mechanism decision**.

Preserved checkpoints: Factory `7f25bf9dae3d98efa18adb912b19de93babc12fc`, MyEve `95222926c230029509828e72be33974084052c5d`. Earlier access evidence remains historical; it cannot establish continuing credential custody after this incident.

## Incident

The local packaging diagnostic invoked `vercel curl` against Factory staging. The CLI retrieved project metadata containing automation bypass credentials and selected an automation bypass for its local curl process arguments. This exceeded the approved Sofie-backend-only Factory credential custody boundary even though the credential was not printed in assistant output. Output redaction is not custody isolation.

Two Factory bypasses existed: an older unnamed provider/system-environment entry and `Sofie isolated staging contract qualification`. The CLI selects the first matching automation entry; the evidence does not establish that it selected the named entry. Both were treated as tainted and removed. We do not claim historical process memory, process-list access, or OS telemetry was absent.

## Completed remediation

- Removed both Factory automation bypasses through Vercel's masked administrative UI, without revealing or copying values. The final list was empty; Vercel Authentication stayed enabled.
- Confirmed revocation using the already deployed Sofie backend, which alone retained its old Factory credential. The local runner used only the separately approved Sofie operator bypass and application identity. All five backend Factory requests returned deployment-protection redirects (302), including old bypass + valid Factory identity. See [connected revocation receipt](factory-bypass-revocation.json). Its nested active-credential matrix is intentionally false: revocation is the expected result, not a successful access matrix.
- Provisioned a distinct Sofie runtime/operator credential under its existing approval, with nonsecret [configuration receipt](remediation-sofie-operator-configuration.json). It was not reused as a Factory credential.
- Replaced the local Factory packaging/provisioning diagnostic scripts with unconditional denial; retained only source hashes in [cleanup receipt](factory-bypass-local-cleanup.json).
- Retired the checked-in direct Factory infrastructure/queue operator clients. Regression tests exercise their valid-input paths and require failure before any provider command executes. Previous implementations and receipts remain in Git history.

No new Factory bypass was generated, no Work was dispatched, no producer/verifier was allocated, and no model/publication was invoked during remediation. The old value remains invalid in immutable Sofie deployment configuration until that deployment is replaced; it is not a usable credential and must not be reused.

## Mandatory regression boundary

**Factory deployment bypass must never enter local qualification-runner custody.**

The allowed path is runner → protected/authenticated Sofie staging → Sofie backend → protected/authenticated Factory staging. Never use local `vercel curl` against Factory. Never generate, retrieve, decrypt, or forward a Factory bypass in a local script, process environment, command argument, test runner, browser, or agent context. Do not assume `vercel deploy`, project metadata reads, or environment commands are safe: provider clients can read the `protectionBypass` map even if stdout is filtered. Inspect custody before using any administrative client after a replacement exists. Redaction is insufficient.

Static revocation must use the masked dedicated-project UI or an explicitly approved backend-only provisioner. Do not use a local API `revoke.secret` body under this boundary. Do not fetch the revoked value to scan or re-test it. Verify revocation from the backend that already holds it and return status-only evidence.

## Outstanding security decision

The static-bypass creation API returns plaintext credential material to its caller. No approved backend-only provisioner currently exists. Creating one by copying a Vercel management token into Sofie would add infrastructure authority and is not authorized by the existing service-to-service approval. Creating the secret locally or in the browser would repeat the custody violation.

Recommended alternative, **not enabled**: Vercel Trusted Sources with exactly one cross-project rule:

| Property | Proposed value |
| --- | --- |
| Granting project | `myfactory-cloud-staging` / `prj_IRXTY6HOzS2q9wRPdabsJnmddzl4` |
| Trusted source | `sofie-cloud-qualification` / `prj_XU7fJW735PtsnKoAYtGfzdnsotIB` |
| Source environment | `preview` only |
| Target environment | `preview` only |
| Credential | Short-lived Sofie server workload OIDC token; no static Factory bypass |
| Header | `x-vercel-trusted-oidc-idp-token`, set only in the server-side Factory transport |
| Application authority | None; existing Factory app identity and Work scope still required |
| Revocation | Remove this exact cross-project Trusted Source rule; re-test from Sofie |

No wildcard projects, development access, production target/source, external runner trust, public exceptions, or shared bypass. Preserve the separately approved Sofie operator ingress credential. Do not forward the Sofie OIDC token to workers, verifier, browser, logs, artifacts or model context. A trust rule applies to the selected environment's deployments, not a single URL/path; the fixed destination transport and Factory application authorization still restrict actual actions.

Implementation after approval: use the existing server transport and `@vercel/oidc` helper with explicit Sofie project/preview guards; remove static-bypass configuration; fail closed when identity is missing; do not silently fall back to static secrets. Re-run protection-only, invalid app identity, valid identity without Work authority, and valid composed authority cases through Sofie. Add token containment and revocation checks before productive execution. Continue the existing deterministic harness/verifier/Golden Journey sequence.

Alternative: retain static bypass and provision a reviewed backend-only secret-management boundary. Its provider privileges, credential custodian and revocation path need an explicit decision; this adds an infrastructure component solely to manage the static credential.

Sources: [Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources), [automation bypass API](https://vercel.com/docs/rest-api/projects/update-protection-bypass-for-automation).

## Qualification truth

| Gate | Current result |
| --- | --- |
| Old backend-held Factory bypass rejected | CONNECTED PASS |
| Both prior Factory entries removed | Administrative UI confirmed |
| Factory secret loaded by remediation runner | 0 |
| Replacement Factory bypass | NOT_CREATED |
| Replacement browser/client/model/worker/verifier/log containment | NOT_RUN, not PASS |
| Replacement composed access matrix | NOT_RUN |
| Existing cloud harness / independent verifier | NOT_RUN |
| Mac-off / browser-off / P0 Playwright | NOT_RUN |
| Paid model calls | 0 |
| Production admission / publication | DISABLED |

The new regression checks prevent the retired entry points from repeating the known incident. They are not proof that arbitrary future operator commands cannot retrieve credentials. That broader assurance depends on the selected protection/custody mechanism.

Validation for remediation: 2 deterministic custody regression tests PASS, 0 failed, 0 skipped. The existing deployment-packaging test also passes against the pending packaging repair (reported separately from the remediation checkpoint). No paid or live-model test ran.
