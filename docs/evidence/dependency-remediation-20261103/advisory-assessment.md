# Dependency remediation assessment

Baseline: main `57af52564908adf736e992a7220cfcbca9cfa3ae`; the same lockfile is present in original PR #30 `d24bd6f2735c4a43662d780de4e81d250e745480`.

The eight audit findings (six high, two moderate) are package rollups involving three vulnerable leaves. No advisory is suppressed. The audit threshold remains `low`. SDK versions, prices, expiry, Work authorization, no-replay, UNKNOWN accounting and deployment prevention remain intact.

| Audit finding | Affected dependency path | Reachability and smallest patch |
| --- | --- | --- |
| `@vercel/blob` 2.8.0, high | Blob → Undici 6.29.0; Blob → OIDC 3.8.4 → CLI-config 0.2.3 → Zod 4.1.11 | Blob uses npm Undici fetch. Malicious responses from a contacted endpoint can reach HTTP parsing. Keep Blob; patch Undici to 6.29.1 and Zod to 4.6.6. Audit's suggested Blob downgrade to 2.4.0 is inappropriate. |
| `@vercel/cli-config` 0.2.3 / 0.3.1, high | Supervisor/cloud OIDC → exact CLI-config versions → exact Zod 4.1.11 | Local credential/config fallback parses JSON. Malformed local configuration is the input boundary. Scope Zod 4.6.6 overrides to these two exact parents. The first fixed parent, 0.3.6, changes additional code. |
| `@vercel/connect` 0.8.0, high | Connect → OIDC 3.8.4 → CLI-config → Zod | Used for Linear token acquisition/cache invalidation. This rollup has no separate Connect vulnerability. Keep its API and patch the Zod leaf. Avoid the unnecessary major Connect upgrade suggested by audit. |
| `@vercel/oidc` 3.8.4 / 3.8.10, high | OIDC → CLI-config 0.2.3 / 0.3.1 → Zod | Local credential fallback can parse config; JWT verification uses jose. Keep OIDC contracts; exact parent overrides patch Zod. No fixed 3.x OIDC parent was identified; 4.0.6 changes more code. |
| `@vercel/queue` 0.7.0, moderate | Queue → minimatch 10.2.6 | Queue's local development route matcher calls `minimatch(sourceFile, pattern)` with default optimization level 1. The vulnerable preprocessing requires level ≥2, so that branch is not reached by this call. Still patch its leaf to 11.0.1. |
| `minimatch` 10.2.6, moderate | Queue → minimatch | 11.0.1 is the first fixed version. Even Queue 0.11.0 declares the affected `^10.2.4` range. Use an override scoped only to Queue 0.7.0, with route compatibility coverage. Its required new glob matcher is locked with integrity. |
| `undici` 6.29.0 / 7.30.0, high | Blob → Undici 6; Sandbox 3.5.1 → Undici 7 | HTTP/TLS transport is used. Patch to 6.29.1 / 7.30.1 within existing parent ranges. Sandbox uses global fetch plus npm Undici Agent: the Node bundled parser also needs patching. |
| `zod` 4.1.11 / 4.4.3, high | CLI-config + Sandbox → Zod; capability-enforcement → direct Zod | Provider response collections and restricted PostgreSQL policy/agent evidence reach Zod. No unauthenticated HTTP array path was identified. Restricted writers reduce exposure, but malformed stored evidence is conditionally reachable. Update direct Zod to 4.6.6 and scope exact transitive pins. |

## Advisory-specific Undici reachability

Excessive response content encodings are reachable through ordinary fetch. TLS renegotiation is conditionally reachable through a malicious contacted TLS 1.2 endpoint. Function-valued TLS callbacks, shared-cache redirect composition, EventSource, fetch integrity metadata, WebSocket PONG handling and decompress-interceptor/throwing-handler composition were not identified in current source. These absent feature paths do not remove the need to patch the used HTTP transport.

Primary sources: [Zod collection exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [minimatch amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), [Undici content encodings](https://github.com/advisories/GHSA-xjj6-f33q-929c), [TLS renegotiation](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm), [TLS callbacks](https://github.com/advisories/GHSA-2m5v-pch6-74hx), [cache composition](https://github.com/advisories/GHSA-4w7w-5xrc-9h26), [EventSource](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [integrity](https://github.com/advisories/GHSA-f72v-6w45-q472), [WebSocket](https://github.com/advisories/GHSA-9fm3-97px-rjf6), [decompress interceptor](https://github.com/advisories/GHSA-55wc-3pg8-jfw6).

## Runtime and qualification boundary

[Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1) is the minimum same-LTS release bundling Undici 7.30.1. Qualification uses its official checksum-verified temporary runtime, without replacing the host installation. CI pins it. npm engines and engine-strict support fail-closed transport prerequisites in the actual host bootstraps and worker installer. Negative tests prove rejection before storage/network initialization and worker registry fetch. The operator image qualifier now checks actual worker Node and Undici before network probes, retaining existing cleanup.

The local worker Dockerfile pins `node:24.22.1-bookworm@sha256:d862bb5d082c5ae0210ac07e8c0344cb8cf7bef6d78e9b8c50c179da923108ea`. This is a local build candidate, **not** a replacement identity for the existing Vercel sandbox image. Its old immutable pin and advertised 24.19.0 configuration remain accurate. That image fails the new installer prerequisite and requires separately authorized exact-image qualification before live execution. No allocation or provider image qualification was performed here.

The record-only dependency source successor grants no execution authority. Historical approvals fail against the new source/FactoryVersion; production configuration and execution-contract digests remain unchanged. No tester installation, allowlist, MyEve source, receiver branch, pricing activation or custody tuple is repinned.

PR #30's eight test-only fixture changes are reused as prerequisites so the dependency candidate can run all integration gates independently. They use synthetic prices/controlled historical test clocks and separate restricted PostgreSQL roles. Production expiry and role checks remain enforced. PR #30's UI work remains a separate stacked PR, with fresh combined-source qualification after this prerequisite.

Regression coverage includes Queue routes, both CLI-config parent versions, oversized constrained Zod collections in a 64 MB subprocess, all three fetch parsers, unsafe host/worker rejection, exact source authorization, no-replay and existing lifecycle tests. Full-suite, gated integration, UI, build and hosted results are recorded alongside this assessment.
