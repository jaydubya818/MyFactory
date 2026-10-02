# Trusted Sources OIDC qualification

Connected infrastructure boundary qualified on 2026-10-02. This is not productive Work or Golden Journey qualification.

The only new rule trusts `sofie-cloud-qualification` (`prj_XU7fJW735PtsnKoAYtGfzdnsotIB`) preview tokens at `myfactory-cloud-staging` (`prj_IRXTY6HOzS2q9wRPdabsJnmddzl4`) preview deployments. Provider-managed project identity binds the source project/team and environment. Existing Factory self-access was not broadened. Vercel Authentication remains enabled. The Factory static bypass list is empty; the separate Sofie operator/runtime bypass remains in its approved boundary.

MyEve implementation checkpoint: `add56b97cc2f15623a7a5e3516125976ae556c50`. Preview `dpl_FzuueRbJuLx3ijnLovwgaZXYXCHD` runs request-scoped `@vercel/oidc` 3.8.10 transport. Tokens are acquired only on the backend, never stored in a connection profile. It validates exact project/team/preview/expiry before attaching `x-vercel-trusted-oidc-idp-token`; Vercel verifies authenticity. Application bearer authentication remains separate. There is no static bypass fallback.

| Check | Evidence | Outcome |
| --- | --- | --- |
| Runner → Sofie ingress/application cases; Sofie → Factory without OIDC, OIDC only, invalid application identity, unauthorized source, authorized action discovery | [Initial](sofie-oidc-access-attempt-1.json), [restored](sofie-oidc-access-restored.json) | CONNECTED PASS |
| Remove source trust; repeat identical backend diagnostic | [Revocation](factory-oidc-revocation.json): all five Factory requests blocked with 302 | CONNECTED PASS |
| Restore exact preview rule; repeat same diagnostic | [Restored](sofie-oidc-access-restored.json) | CONNECTED PASS |
| Local unauthenticated runner → Factory | [Runner denial](oidc-runner-denial.json) | CONNECTED PASS |
| Different Vercel project's actual preview OIDC → Factory, while Sofie trust enabled | [Negative preview](oidc-different-preview-denial.json) | CONNECTED PASS, 302 |
| Authorized productive Work | No Work dispatched by access diagnostics | NOT_RUN |
| Hosted producer/verifier credential containment | Requires their actual lifecycle qualification | NOT_RUN |

Build scan: 77 browser files, 934 HTML/hydration files and two public files checked against four server credentials, including the build OIDC token and base64 encodings; PASS. [Observed runtime log scan](sofie-oidc-log-scan.json): 21 entries/10,339 bytes; credential and OIDC JWT pattern matches zero. These are bounded observations, not a claim about future logs or token variants. Diagnostic responses retain only status/name/pass and counts; no OIDC values, claims dump, Factory static credentials or Work artifacts enter the runner. Browser/model/worker containment remains mandatory for subsequent runtime changes.

Local validation: 27 OIDC/access/transport tests, 178 canonical Result/writer/custody/spend regressions and four client-scan tests PASS; TypeScript no-emit PASS. Attempt-8 publication code is unchanged.

## Negative preview attempt history

Isolated project `myfactory-oidc-negative-qualification` has no application/owner database credentials, model calls or Work execution. The probe reads only its own preview workload identity inside the remote build, submits one OIDC-only request, and emits a status-only receipt.

Attempt 1, `dpl_DoSBBMnMBLBPQXQ1vHaFLjjjL8Vx`: Vercel classified the first deployment as production despite explicit CLI `--target preview`. The environment guard failed before reading OIDC or requesting Factory; build ERROR. This provider target classification is retained as a failure, not relabeled preview success. No existing production service changed. CLI linking also downloaded this new project's development OIDC into a local ignored file; that file was removed without inspecting its value or using it. It was not a trusted Sofie/Factory identity.

A proposed REST `staging` target was rejected by automatic approval review as outside the exact preview scope and did not execute. After the first deployment record existed, explicit CLI preview attempt 2 (`dpl_Hbai2nhauBDiF8ThWMbEN7sENgzC`) was independently verified as target `null`/preview, READY. Its actual preview workload identity was denied by Factory protection. No static Factory credential was created or used.

## Revocation

In the dedicated Factory project's Deployment Protection → Trusted Sources, remove only the `sofie-cloud-qualification` source. Run the same authenticated Sofie backend diagnostic; Factory calls must return the Vercel protection redirect, not application data. This remove/test/restore sequence passed. Restore only the approved exact preview→preview rule when authorized; never add a static fallback. Keep the runner's separate Sofie protection credential and application identity separate from Factory infrastructure identity.

Preserve [custody incident](factory-bypass-custody-incident.md) and checkpoint `0df0c3704ff5331c53225aabcf446fe5983fcc8c`. Historical local-process custody cannot be retroactively certified absent. Production cloud admission and publication stay DISABLED; paid model operations stay zero. Continue canonical Work composition, independent verifier, durable Result/Proof, Mac-off, browser reconnect and P0 before requesting a bounded real-model canary.

References: [Trusted Sources](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/trusted-sources), [OIDC claims](https://vercel.com/docs/oidc/reference).
