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

Managed image digest resolution returned 404. A private custom image is being prepared from official Node 24 linux/amd64 digest `sha256:5a750d3be5e5c80275f8c9a5367c3aed99c2875656590c8d0701c7ee687f5f0a`; allocation remains pending immutable VCR digest and readiness. Public canonical MyEve/MyFactory repositories permit initial exact source reads without private-alpha or personal GitHub credentials.

## Current external block

The custom worker image builds locally, but legacy Docker, compressed Buildx and independent host-side crane uploads fail at the VCR TLS boundary. Both documented managed-image alternatives return 404. Provider inventory confirms no published image or sandbox. See [exact failures and required external configuration](image-blocker.md). No further upload retries or sandbox allocation are running.
