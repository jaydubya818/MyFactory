# Local execution provider engineering checkpoint

Base: `fa48a820ba185eb9b891130c78166463b61cba74`. This branch is an isolated engineering candidate. It does not adopt a production compatibility pin, replace the external-alpha release, deploy a service, or enable paid inference.

The implementation plugs a Docker adapter into the existing PostgreSQL dispatch, Work spend ledger, candidate custody, independent verification, and signed `MYFACTORY_RESULT_V1` paths. It does not add a lifecycle, ledger, Registry, or Result protocol. Execution snapshot V3 explicitly identifies local Docker. V2 still requires Vercel Sandbox provenance and the existing validator. V3 verification requires an explicit local-provider expectation and exact owner/delegation binding; there is no fallback.

## Identity and authority

The snapshot binds source and configuration digests, provider implementation, runtime, image, host qualification, sandbox and verifier policies, deterministic harness, model/provider, owner, delegation, and exact source snapshot. FactoryVersion uses the existing source/configuration digest calculation. The local source set includes the canonical control assembly, authority callbacks, paid-operation denial, lifecycle, Result and ledger implementations. Snapshot configuration is copied at admission. Runtime and host qualification must match, and every required host check must pass. Host reports are authenticated Factory-host assertions, not hardware attestation.

The canonical local control requires caller-supplied authority, delivery and recovery adapters. The qualification supplies ephemeral authenticated loopback admission, durable PostgreSQL delivery/recovery records and explicit recovery readback. It does not qualify an autonomous recovery service. Missing authority, queue or recovery callbacks deny construction. Every paid reservation is rejected before a model request can occur.

## Observed isolation

The image is the public official Node image pinned at `public.ecr.aws/docker/library/node@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0`. The source fixture is the existing public commit `5cd13fa1f307a0c0f42f6317d966bb3179ad77c9`, tree `1084844b1454165358e51248afe8676f96daf17c`.

Actual probes establish UID 1000 producer execution, read-only root, no host mounts/socket/ports/credentials, network none, dropped capabilities, seccomp, no privilege escalation, private PID/IPC namespaces, cgroup limits (256 MiB, 64 PIDs, one CPU, no extra swap), separate Work filesystems, and whole-container process-tree cleanup. Allocation inspections bind labels, runtime and concrete container identity before operations or cleanup. Failure to inspect or confirm destruction remains UNKNOWN.

The Factory host, signing key, database and Docker daemon are trusted. Kernel/runtime escape resistance equivalent to a VM, malicious host administrators, remote hardware attestation, arbitrary repositories/harnesses/models and paid execution are unsupported. A different engine/kernel/image/architecture produces a different runtime identity and FactoryVersion and needs its own qualification. These guarantees do not claim Vercel Sandbox equivalence.

## Custody and verification

The producer exports bounded candidate bytes through a no-follow file descriptor. The host captures those bytes, pauses the producer, validates the Git commit/tree/base/patch and exact digest, writes private custody, then destroys the producer. Docker's archive API cannot reliably export tmpfs here; the captured byte array is independent of subsequent producer mutations. A lost capture is not reconstructed by executing work again.

Only validated candidate bytes enter a separate verifier allocation. Root materializes root-owned files and directories; unprivileged check users cannot chmod, overwrite, unlink or replace them. Each protected check runs as a distinct non-root UID. Expected values stay in the trusted control plane. An execution timeout or malformed response aborts verification and triggers whole-container destruction. Container resource/deadline limits bound descendants; per-process escape-proof termination before every successful check is not claimed. Final cleanup removes the complete allocation and is mandatory before terminal proof.

Completed Results require candidate, separate verifier identity, PASS, and both cleanup confirmations. Failed/cancelled Results may truthfully omit allocations/candidate/verifier that were never observed. Null allocation means no recorded identity, not proof that an ambiguous allocation never existed; canonical cleanup/reconciliation must still confirm absence. No proof is issued while cleanup remains unknown.

## Reproduction

Provision the pinned image and PostgreSQL 17, install locked dependencies without scripts, and fetch the existing source fixture commit into a local Git repository. Then run:

```sh
MYFACTORY_FIXTURE_GIT=/absolute/path/to/source.git node apps/cloud-control/scripts/qualify-local-provider.mjs
node --test packages/hosted-routing/test/*.test.mjs apps/cloud-control/test/cloud-snapshot.test.mjs apps/cloud-control/test/cloud-work-lifecycle.test.mjs apps/cloud-control/test/cloud-verification.test.mjs apps/cloud-control/test/candidate-custody.test.mjs
npm run typecheck:producer
```

The qualification uses disposable PostgreSQL with actual migrations and actual Docker execution. It tests duplicate admission/delivery, writer fencing, cross-owner access, immutable verifier files, substituted provenance/candidate, invalid host reports, paid denial, database restart, lost cleanup acknowledgment, UNKNOWN recovery without another execution, cancellation and terminal proof. The hosted workflow repeats these checks without production secrets. Final exact-source evidence is retained with the MissionControl qualification dossier.

## Adoption and rollback

Production adoption recommendation: **NO**. MissionControl's composed journey remains fixture-scoped, uses the existing enterprise fixture allowance projection and a canonical verification-engine SHADOW gate. Production shared accounting, policy-v2 currentness/adoption, durable service recovery, and independently approved compatibility migration remain separate gates. Existing production compatibility constants and the Vercel source-identity guard are unchanged. Consequently the cloud source-identity script intentionally rejects this unadopted source tree; do not regenerate that guard to deploy this branch.

Rollback is to keep the existing production pins and disable the engineering fixture flag. Preserve V3 signed evidence for historical verification; never reinterpret it as V2. In-flight UNKNOWN records retain exposure until the original resources are proven cleaned; rollback must not redispatch them.

Docker boundary references: [container run controls](https://docs.docker.com/reference/cli/docker/container/run/), [security model](https://docs.docker.com/engine/security/), and [default seccomp](https://docs.docker.com/engine/security/seccomp/).
