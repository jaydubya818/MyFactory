# Phase 2 — dedicated staging foundations

Status: PARTIAL. Cloud Work and Mac-off Golden Journey remain NOT_RUN.

Dedicated staging approved by owner on 2026-10-02 UTC. Provisioned:

| Resource | Identity | Boundary |
| --- | --- | --- |
| Vercel project | `prj_IRXTY6HOzS2q9wRPdabsJnmddzl4` / `myfactory-cloud-staging` | Dedicated; no Sofie preview resources |
| Neon database | `store_Z5va0qHQwe9Ok4LH` / `myfactory-cloud-staging-db` | Free plan, iad1, preview connection only, empty before migration |
| Blob custody | `store_kZ9n2mzEmqmKX7bZ` / `myfactory-cloud-staging-custody` | Private, iad1, preview connection only |
| Worker registry | `repo_hA2FvWTkS9VauoNnaSAJnDh97lge` / `factory-worker` | Private, dedicated project |
| Hosted service | `dpl_DgB6DSiYnRhcgzPeQK8ZCABGwPZB` | Verified preview; authenticated dependency readiness |

[Staging deployment](https://myfactory-cloud-staging-p9gyz1hma-jaydubya818.vercel.app) is Vercel-auth protected. `/api/health` is liveness only. `/api/readiness` additionally requires the staging-only operator token and returns HTTP 503 while canonical cloud Work is unimplemented. No token or environment flag enables admission. A separately authenticated infrastructure-only endpoint now runs one fixed deterministic task. No canonical Work, model or publication endpoint is exposed.

Schema migration 001 creates only a Factory staging identity marker and infrastructure-attempt ledger, with one unresolved allocation slot. It does not migrate the SQLite execution ledger, duplicate MyEve owner records, or establish cloud queue qualification. Migration refuses non-Factory tables and requires certificate-verified TLS. Neon app-user Auth is disabled intentionally; PostgreSQL password authentication remains required.

## Evidence

- DETERMINISTIC: complete ordinary suite **187 PASS, 0 FAIL, 5 environment-gated SKIPPED**. Eight new tests cover immutable image/source/time bounds, credential-free allocation plans, authorization, scope denial, honest readiness, independent dependency failure/redaction and TLS enforcement.
- DETERMINISTIC: producer typecheck, source-governance check (26 reviewed changed runtime sources), workspace typecheck and build PASS.
- CONNECTED: migration and idempotent rerun PASS; TLS socket and certificate verified.
- CONNECTED: local and hosted readiness read the dedicated database marker, private Blob namespace and Sandbox API successfully. They report **ready=false / admission=DISABLED**.
- LIVE model: NOT_RUN, operations 0. No production owner data copied; no GitHub writes.
- Existing Attempt-8 publisher is unchanged. Existing five installed-CLI/Docker checks were qualified in Phase 1; this checkpoint's ordinary suite honestly retains their skips.

Vercel CLI 62.1.0 unexpectedly labeled the first deployment production despite `--target preview`. That deployment (`dpl_4iW9NNMuFw8nrUP7bD87849NaAYZ`) was confined to the new staging project, had no production-environment database/Blob connection, and was removed after creating the verified preview above. Existing production services were untouched. Do not infer deployment target from command intent; verify provider readback.

## Image qualification checkpoint

CONNECTED image qualification is PASS: the official managed Node 24 image resolves through the supported Sandbox API and is now pinned by immutable digest. The earlier direct OCI manifest lookup was not a valid test of Sandbox managed-image availability. See [resolution and preserved failures](image-blocker.md).

The pinned image runs Node 24.19.0 and Git 2.53.0 on linux/x64. A dedicated producer user has uid 1001 and cannot sudo. CA trust, blocked public/metadata egress, fresh filesystem isolation, command execution and deletion/absence readback passed. No application secrets or source were injected. All three diagnostic sandboxes have confirmed cleanup. This proves image mechanics only; canonical Work, custody, harness, verifier and Mac-off remain NOT_RUN.

Custom upload TLS failure remains unexplained, but is no longer on the required execution path. No further custom uploads are needed. Cloud admission remains DISABLED and paid model operations remain 0.

## Hosted infrastructure checkpoint

CONNECTED PASS: attempt `f47936ce-6fab-41b8-b3b9-2828e541a374` ran on preview `dpl_4eYNfnurMGEN4nnJSa7w6oaGGz31`, using the dedicated staging database, hosted OIDC Sandbox/Blob access and no injected worker credentials. [Hosted receipt, durable readback and duplicate submission](provider-diagnosis/infrastructure-f47936ce-6fab-41b8-b3b9-2828e541a374.json).

The control plane persisted intent before allocation, fetched public MyFactory commit `4753ba1bbbe2ee1cd81a3583e8a8f62f2233c3d9` into the dedicated unprivileged producer directory, checked tree `e190b3bf0fb6fbe4311ddb7dcc13d77cf33c99e2`, denied network access, ran six deterministic readiness tests, validated the worker artifact manifest, stored 784 bytes privately, verified hash readback, and stopped/deleted the exact sandbox. Repeated POST returned the same receipt without another execution. [Independent post-teardown custody readback](provider-diagnosis/custody-readback.json) confirms the same hash, worker absence and anonymous HTTP 403.

The operator endpoint accepts only a UUID, with fixed source/image/code and no request body. Its separate preview-only token cannot enable canonical Work, model calls or publication. PostgreSQL session locking serializes mutations; the unique unresolved-resource index retains ambiguity. An eight-attempt lifetime cap and one 120-second, 1-vCPU sandbox per attempt bound this qualification capability. Artifacts are capped at 256 KB each. Recovery only tears down the existing identity after the original deadline plus grace; it never replays allocation or execution. Cancellation/restart of canonical Work is still unqualified.

### Preserved failures and repairs

- The first deployment rejected overlapping function configuration order. Specific function patterns now precede the general pattern, as documented by Vercel. No worker allocated.
- Request `6191e7de-98d1-45db-9795-3b15bd9d8a76` rejected a hosted empty body stream. An empty-stream regression test preceded correction. No worker allocated.
- Attempt `a18096de-607b-4834-b954-d0847cfd9237` retained UNKNOWN and confirmed cleanup but lost command diagnostics at deletion. Evidence retention was repaired and tested before a bounded reproduction.
- Attempt `80ca1461-d832-4066-a400-9cb3edee2444` preserved the actual error: the image default working directory was not a Git checkout. Explicit unprivileged checkout and commit/tree verification replaced that assumption. Both failed resources were deleted; neither result was relabeled PASS.

The successful probe is infrastructure evidence, not a canonical Work/candidate/verifier Result. The Mac initiated an HTTPS operator request; no local worker, source checkout, database or artifact filesystem executed that probe. A closed-client/Mac-off product journey is still NOT_RUN and no zero-local-dependency product claim follows from this checkpoint.

Final infrastructure checkpoint validation: **197 PASS, 0 FAIL, 5 environment-gated SKIPPED**. Producer/workspace typechecks, build and governance (30 reviewed runtime sources) PASS. See [machine-readable report](infrastructure-qualification.json) and [regressions](infrastructure-regressions.log). The first restricted full-suite invocation hit loopback EPERM; the permission-corrected full run passed.

Superseded preview deployments `dpl_34VY6eVBiSkZy1LtUc3tkMRvVwVa`, `dpl_FrfsFUruZQdYEbTJQ2NHGejwLcEf`, `dpl_2jSm8csLqKLZsb4roDB35JrbnRbe` and the failed build `dpl_Eu19Y5ga6YnVx21dMTAwxtKNkFJZ` were removed after the successful preview was verified. Each removal first checked dedicated staging project identity and non-production target. Their evidence remains in this repository.
