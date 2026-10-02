# Existing harness in CLOUD — implementation checkpoint

Status: **DETERMINISTIC local regressions PASS; hosted harness NOT_RUN**.
This checkpoint wires the existing `CodexAdapter` into dedicated staging. It
neither qualifies protected verification nor enables production or paid models.

The exact Linux package is Codex 0.157.0, pinned by npm SHA-512 integrity in
`cloud-harness-plan.mjs`. A root-owned installer accepts only that artifact and
binary version before source execution. Producer runs as `factoryproducer` with
no sudo, host credentials, public ports or external network after preparation.
The mandatory session surface is HEADLESS. The existing adapter retains process
group termination, timeout, cancellation, bounded logs, model pinning, isolated
configuration, zero provider retries and workspace-write/read-only sandbox modes.

Model requests use a Work-scoped loopback token and bounded files transported by
the existing sandbox SDK. The worker has no deployment-protection bypass,
upstream key/OIDC identity, database, Blob, publication or verifier credential.
The host fixes the destination, binding and phase; untrusted request files cannot
choose them. Requests still pass through the existing SpendGateway and canonical
PostgreSQL V2 ledger. The trusted deterministic upstream has no network fallback.
Its synthetic usage settles at zero; model-operation count remains explicit and
is not mislabeled as zero operations. The envelope reserves two productive slots
and one completion slot, at most three operations and zero paid calls.

After one productive response, the host closes and quiesces the CLI, runs
implementation-visible checks without root, validates exact source/tree/patch
and scope, and preserves a bounded checkpoint. Failed checks can consume only
the existing second productive slot. Completion has separate ledger admission,
read-only execution and no client tools; the host rechecks the candidate tree.
Private custody and teardown remain the canonical cloud lifecycle. Visible checks
remain producer evidence, never a protected-verifier verdict.

Validation: 119 PASS, zero FAIL, six explicit gated skips in the cloud, agents,
spend-gateway, spend-review and implementation-loop selection. Includes real
local Git checkpoint/custody tests for passing, failing, out-of-scope and mutated
candidates; mailbox auth/concurrency/bounds/no-replay; and the existing durable
ledger with productive yield and zero-cost completion. Producer typecheck and
source governance pass. Deployment packaging preserves the explicit TypeScript
closure and worker files. Local tests are not a hosted harness PASS.

Next: compose the authenticated canonical Sofie staging Work path and independent
Factory-owned verifier, deploy the exact pinned configuration, and preserve the
first bounded connected attempt. Factory's protection bypass remains only in
Sofie's backend; do not copy it into a runner to shortcut this composition.
Product remains WAITING_FOR_CANONICAL_STAGING_COMPOSITION. Mac-off, browser-off
and P0 are NOT_RUN. Attempt-8 publication code is unchanged and publication is
DISABLED. No alternative harness or terminal/computer adapter was introduced.
