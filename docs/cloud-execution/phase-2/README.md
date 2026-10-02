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

[Staging deployment](https://myfactory-cloud-staging-p9gyz1hma-jaydubya818.vercel.app) is Vercel-auth protected. `/api/health` is liveness only. `/api/readiness` additionally requires the staging-only operator token and returns HTTP 503 while canonical cloud Work is unimplemented. No token or environment flag enables admission. No worker allocation, model or publication endpoint is exposed.

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
