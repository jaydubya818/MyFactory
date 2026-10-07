# MyFactory

MyFactory turns an explicitly authorized Work request into a bounded, reviewable software candidate with independently checked evidence. It owns execution admission, operation accounting, writer fencing, candidate custody, protected verification and signed Results. It does not grant itself new Work authority or treat a generated patch as permission to publish.

The repository contains both the original local Factory work desk and the hosted CLOUD execution/control plane. They share production contracts where qualified, but have different resource, storage and credential boundaries. The package's historical `sellerfi-local-factory` name does not describe the entire current system.

## Contents

- [Current status](#current-status)
- [Responsibilities across the system](#responsibilities-across-the-system)
- [The execution contract](#the-execution-contract)
- [Preparation, lifecycle and grants](#preparation-lifecycle-and-grants)
- [Accounting and UNKNOWN behavior](#accounting-and-unknown-behavior)
- [Candidate custody and independent verification](#candidate-custody-and-independent-verification)
- [EvidenceProvider, Results and Proof](#evidenceprovider-results-and-proof)
- [Environment and runtime architecture](#environment-and-runtime-architecture)
- [Local work desk and Feedback Hub](#local-work-desk-and-feedback-hub)
- [Publication and repair are separate](#publication-and-repair-are-separate)
- [Connections and integration](#connections-and-integration)
- [Qualification commands](#qualification-commands)
- [Installation, revocation and recovery](#installation-revocation-and-recovery)
- [Repository and historical evidence map](#repository-and-historical-evidence-map)

## Current status

**Documentation reconciled: October 6, 2026 (Pacific).** Canonical source baseline: [`1739204`](https://github.com/jaydubya818/MyFactory/commit/1739204f9d29240b47b12fcba8e9542af4add451). This identifies the source reviewed for this guide; an actual deployment must independently prove its source/configuration identity.

| Area | Current result | Scope and limits |
| --- | --- | --- |
| Model-free production CLOUD validation | PASS: immutable preparation, separate lifecycle, grant/intake, exact candidate, custody, 11-check verifier, TestEvidence/DiffEvidence, Proof and cleanup | One bounded deterministic validation, not paid execution authority |
| Owner A real-model production journey | Accepted PASS with the MyEve owner experience completed from durable state | Exact authorized source/task; one candidate/writer; separate protected verification; no publication |
| Factory model transport | Qualified bounded path uses OpenAI `gpt-5.4-mini` through Vercel AI Gateway | Source, model, provider, pricing, budgets and authority are pinned; no ambiguous fallback |
| EvidenceProvider → MyEve Proof | Live TestEvidence and DiffEvidence custody/transport/readback qualified for the accepted journey | Screenshot, BrowserJourney and dynamic candidate preview are not inherited passes |
| Synthetic-owner installation/routing | Exact application/source binding and specific-route-before-catch-all repair qualified | Infrastructure trust does not confer Work authority |
| Successor intake authority | Exact separately authorized successor Work can receive one intake without erasing prior failed intake history | Not a general intake-limit increase or reusable permission |
| Two external testers | Dedicated workspace preparation underway in the companion MyEve mission | Ordinary external-owner Work policy, private source materialization and supported-task verifier remain incomplete |
| General Work and generated effects | No blanket production admission | Publication, PR creation, merge, generated deployment and automatic repair remain disabled for the proposed external alpha |

The accepted execution path has **zero local runtime dependencies**. Physical Mac power state was not independently observed. A successful journey can still produce a canonical **PARTIAL Result** when publication, external CI or owner acceptance are outside the evidence. Verification PASS applies to the checked candidate and policy, not to all possible product claims.

Full production Result/Proof, exact owner/Work/resource identities and lifecycle/accounting receipts remain in private evidence. Historical failed attempts remain preserved. Older dated documents below retain their original status; their prior `NOT_RUN` entries are not the current aggregate status.

## Responsibilities across the system

| Component | Owns |
| --- | --- |
| **[MyEve / Sofie](https://github.com/jaydubya818/MyEveBot)** | Natural owner interaction, private context, canonical Work, owner decisions and durable Proof consumption |
| **[Relay](https://github.com/jaydubya818/relay)** | Separate Agent identity/Passport, capability grants, peer policies, communication and governed integrations |
| **MyFactory** | Admitted production execution, custody, independent verification, signed Result and evidence delivery |

```mermaid
flowchart LR
  Work[Canonical authorized Work] --> Prepare[Immutable preparation]
  Prepare --> Grant[Exact bounded grant and lifecycle]
  Grant --> Producer[Qualified CLOUD producer]
  Producer --> Custody[Immutable candidate custody]
  Custody --> Teardown[Producer teardown and fencing]
  Teardown --> Verifier[Separate protected verifier]
  Verifier --> Result[Signed Result and evidence]
  Result --> Proof[MyEve durable Proof]
  Proof --> Owner[Owner readback and separate acceptance]
```

The owner/application identity, installation host-owner scope, Work execution authority, model credential and publication authority are distinct. A trusted deployment can pass infrastructure access while correctly being denied by Factory application or Work authentication.

## The execution contract

A production execution contract binds the complete tuple rather than selecting a model and hoping the rest is safe:

- owner, originating application, canonical Work/version/generation and exact request;
- repository, source commit/tree, allowed files, objective and checks;
- Environment/CLOUD binding, ExecutionProvider and resource limits;
- HarnessProvider/version, installed tools, skills and their identities;
- FactoryVersion and source/configuration digest;
- model/provider, fallback policy, price revision and conservative accounting;
- operation classes, call ceilings, productive deadline and completion reserve;
- candidate attempts, authoritative writer and custody policy;
- separate protected verifier, policy and evidence classes;
- Result/Proof binding, cancellation, recovery and UNKNOWN behavior;
- explicitly allowed effects, with publication disabled unless separately authorized.

FactoryVersion is a content-derived production identity, not a marketing version string. Changing a relevant source, harness, policy, tool, skill, environment or model binding requires requalification and corresponding identity changes. A price card can expire independently of source; revalidate it before activation.

The current bounded production harness is the existing MyFactory/Codex path. DeepAgent, Claude Code, OpenCode and other harnesses are not automatically qualified. CLOUD_COMPUTER, TMUX/CMUX and optional operator session surfaces remain separate capabilities; they must not become hidden dependencies for headless execution.

## Preparation, lifecycle and grants

Immutable preparation records retain the approved source, request and execution identity. Mutable lifecycle state handles claims, progress, terminal outcomes and cleanup without rewriting preparation. Historical failed/revoked attempts remain evidence and cannot be reset to manufacture unused authority.

The paid approval protocol separates the immutable reviewed envelope from its concrete grant:

1. Review an envelope with exact constraints and no fabricated activation request/deadline.
2. Validate current Work, source/configuration and authorization digest before activation.
3. Create one immutable request/deadline and its lifecycle under the canonical uniqueness/fencing rules.
4. Stop at the grant boundary until the matching concrete authority is durably installed and read back.
5. Atomically bind the concrete grant digest to that lifecycle before Factory intake.
6. Consume only that Work/attempt's authority; stale generation, duplicate intake, expiry or revocation deny execution.

Owner-approved SHA-256 identities must be exact 64-character hexadecimal digests. A malformed digest is rejected, never silently corrected into authority. Runtime cannot turn a missing grant into a request to use a previous one.

See [paid-canary authority protocol](docs/paid-canary-authority-protocol.md), [dispatch lifecycle](docs/factory-dispatch.md) and [production execution contract](docs/cloud-execution/production/execution-contract.md). Their dated qualification notes remain historical.

## Accounting and UNKNOWN behavior

The V2 spend ledger records operation identity, reservation, dispatch exposure and settlement durably. The host owns phase identity; the producer cannot label a paid retry as a fresh free operation. Completion reserves are protected separately from productive work.

- Exposure is committed before provider I/O.
- One unresolved operation fences later paid dispatch.
- A reservation is releasable only when durable state proves it was not dispatched; operation history remains.
- A transport error or lost response without qualified no-generation evidence becomes UNKNOWN.
- UNKNOWN blocks retry, model fallback, a second candidate and silent budget recycling.
- Later accounting reconciliation does not reopen productive authority.
- Custody/completion cannot assert success while required execution accounting remains unresolved.

Factory uses host-side workload identity for its qualified Gateway transport. Model authentication material stays outside producer/verifier environments, model prompts, candidate artifacts, browser state and public evidence. Qualification-only transports and synthetic settings cannot be copied into production as implicit configuration.

Per-Work ceilings are set by the exact contract. The companion external-alpha proposal targets at most five aggregate Sofie/Factory operations, $1.30 and 180 productive seconds per Work, with one candidate/writer; it is **not active Factory authority**. The ordinary-work integration and global/per-owner accounting composition must pass before that proposal can be offered to testers.

## Candidate custody and independent verification

The producer operates only within the admitted source/file scope and writer fence. Its output must be bound to the exact request, candidate commit/tree and artifact digest/bytes. Factory validates candidate packaging, saves it to private custody and independently reads back its integrity.

The producer is torn down or conclusively fenced before a separate verifier evaluates the retained candidate. Protected tests and answers must not be supplied to the producer. The verifier has its own resource/lifecycle identity and cannot publish a candidate or borrow productive model authority.

The accepted production fixture has **11 protected checks**. That policy qualifies the specified line-ending behavior; it does not establish arbitrary repository or arbitrary task correctness. A dedicated external workspace requires an appropriate protected policy and truthful reporting of structural checks versus task acceptance.

A preview is also not verification. A visible local app or screenshot may help an owner inspect a candidate but cannot substitute for exact-source, independent check evidence.

## EvidenceProvider, Results and Proof

| Evidence/result surface | Meaning | Current production qualification |
| --- | --- | --- |
| TestEvidence | Checks tied to exact candidate and verification identity | Accepted bounded end-to-end path |
| DiffEvidence | Exact source/candidate change evidence | Accepted bounded end-to-end path |
| Factory custody receipt | Durable private artifact identity and integrity | Accepted bounded end-to-end path |
| Authenticated evidence transport | Exact owner/Work/Run/candidate/version-scoped retrieval | Accepted bounded end-to-end path |
| MyEve durable Proof | Consumer-side custody plus independent binding/digest/byte verification | Accepted bounded end-to-end path |
| Screenshot / BrowserJourney evidence | Optional capture contracts and implementation | Not established by Test/Diff qualification |
| Dynamic CandidatePreview | Candidate-specific app preview capability | Deferred; no general production PASS claim |
| Publication / external CI / owner acceptance | Separate downstream effects and decisions | Not implied by a verified candidate |

Signed Results bind request/WorkOrder/attempt, FactoryVersion, exact Git candidate and check/artifact evidence. Receipts are read back for the same attempt after reconnect; observation must not redispatch. Raw producer assertions do not become canonical Proof merely because a signature is present—the consumer still checks all required bindings and retained bytes.

See [producer result protocol](docs/producer-result-protocol.md) and [EvidenceProvider extension](docs/evidence-provider-extension.md).

## Environment and runtime architecture

### Hosted CLOUD path

`apps/cloud-control` contains production/qualification control routes, private queue consumers, PostgreSQL authority/lifecycle/accounting, provider adapters, custody and Result/evidence endpoints. Queue messages are wake-ups; PostgreSQL state and fencing remain authoritative. Browser or submitting-process lifetime does not own productive execution.

Production deployment protection, exact source workload identity, Factory application authentication and exact Work authority are all required. Route ordering matters: specific qualified routes must be selected before a generic catch-all. Broadening trust or bypassing application authentication is not an acceptable routing repair.

The producer uses bounded sandbox resources and source materialization. Credentials are not a shortcut to private repository access: real tester workspaces require separately qualified private-source custody/materialization. Existing public canary source cannot become their normal workspace.

### Local Factory path

The local supervisor and web work desk manage WorkOrders, attempts, checks, events, policies, signals, publication proposals and releases through local SQLite-backed state. The supervisor is loopback-oriented and can continue an admitted run when the browser closes.

Local host execution has a different threat model: an approved Codex process can inherit host credentials/network access under its sandbox. This is not equivalent to a credential-isolated CLOUD producer. Independent Docker verification receives an exported candidate tree without the repository's `.git`, Docker socket or model credentials. Use trusted local repositories and explicit host authority.

### Environment Fabric

Environment descriptors and routing distinguish CLOUD, explicit owner-computer access and deliberate local development. Environment capability, qualification, scope and authority must agree. Adding an environment cannot migrate an already-bound Work or grant it new permissions.

Owner Computer is excluded from the initial external-alpha target. Alternative environments and session adapters need their own live qualification; architectural contracts alone do not establish readiness. See [harness-neutral environments](docs/architecture/harness-neutral-environments.md) and [HarnessProvider contract](docs/architecture/harness-provider.md).

## Local work desk and Feedback Hub

Requirements: Node.js `>=24.15 <25`, npm, Git, and Docker for independent local verification. An explicitly authorized local coding path may additionally require the configured Codex CLI. Installing dependencies or starting the desk does not authorize a model call.

```bash
npm ci
npm run preview:prepare
npm run build
npm start --workspace @factory/supervisor
```

Open `http://127.0.0.1:8787`. `FACTORY_PORT` selects another local port and `FACTORY_DATA_DIR` selects a local data directory. Keep the loopback service private. The [standalone console](factory-console/README.md) uses the supervisor's Work/evidence state; its own model-backed chat requires separate configuration and spending authority.

The Feedback Hub App Builder uses a versioned starter and source-hashed manifest. `preview:prepare` fetches pinned starter dependencies during deliberate setup with package scripts disabled. A local preview checks the unchanged scaffold, installs cached dependencies offline, builds it and exposes bounded status/logs. Stop preview terminates that child process. A template preview is not independent verification of a generated change.

For a coding WorkOrder, supply repository/base, objective, acceptance criteria, permitted paths and check commands. A defect also needs a baseline reproduction and expected failure. The resulting attempt records candidate changes and protected verification. Local two-attempt policies, where configured, do not override a one-attempt production contract.

## Publication and repair are separate

The retained local publication workflow can propose a draft PR for an exact candidate. Owner approval binds candidate/diff/checks/policy and expires; changed evidence invalidates approval. The host GitHub adapter checks the destination and reconciles uncertain outcomes instead of blindly repeating a push or PR creation.

This does not enable generated publication in the production alpha. A successful Result does not approve a push, PR, merge, release or deployment. Operator deployment of reviewed platform code is distinct from a generated Work effect.

Review → repair → reverify uses a separately approved Work and fresh verification while preserving the original candidate/history. Automatic repair remains disabled. See [review/repair](docs/review-repair.md).

## Connections and integration

Approved sibling backends can use scoped connection actions to prepare/dispatch Work and retrieve exact results. Linear/legacy hosted intake remains an independent admission path, not proof of productive execution. Source, application credentials, evidence credentials and Work grants must match the intended environment.

See [connections](docs/connections.md), [hosted routing](docs/hosted-routing.md), [dispatch API](docs/factory-dispatch.md) and [MyEve V2 spend handoff](docs/my-eve-spend-v2-handoff.md). A received request or signed intake receipt is not a finished candidate.

## Qualification commands

```bash
npm test
npm run typecheck
npm run typecheck:producer
npm run check:producer-governance
npm run build
# Opt-in local Docker qualification; inspect prerequisites first.
npm run smoke:docker
```

Cloud-control tests are available through `npm test --workspace @factory/cloud-control`. Database suites require explicitly configured disposable test databases; read their prerequisites before running them. Provider tests and smoke tools can allocate resources or execute configured paths and must not be pointed at production casually. Skipped live cases are not passing evidence.

Use the actual CI/source checkpoint for test totals. Old campaign counts in dated documents are not guarantees for later commits. Documentation-only checks should validate claims, scripts, links and disclosure; they should not rerun paid production Work.

## Installation, revocation and recovery

- Apply canonical schema migrations only through the qualified explicit operator runner with locking, checksums and transactional ledger records.
- Do not run migrations on every build/request, alter historical bytes, renumber applied history or delete lifecycle/accounting evidence.
- Verify deployment source/configuration, resource binding, credentials, signer, source/HarnessProvider/FactoryVersion and deny paths before enabling any exact authority.
- Infrastructure/readiness success is not execution readiness.
- On expiry, UNKNOWN, cancellation or lost authority, stop productive dispatch and preserve exposure.
- Cleanup-only recovery may reconcile the same retained resource, finalize already-produced evidence, revoke authority and tear down resources; it cannot allocate a replacement productive attempt or call another model.
- Final readback must prove no reusable grant, no producer/verifier resources and no residual scoped execution configuration. Restore any temporarily changed operator access control and independently read it back.
- The database console's Read-Only setting is a console control, not a claim that the database rejects all runtime writes.
- Credential renewal needed solely for bounded cleanup cannot change Work/source/effects or revive a revoked grant.

See the [CLOUD runbook](docs/runbooks/cloud-execution.md), [production installation](docs/consolidation/2026-10-03/production-installation.md) and [canonical development policy](docs/consolidation/DEVELOPMENT-POLICY.md).

## Repository and historical evidence map

| Path | Responsibility |
| --- | --- |
| [`apps/cloud-control`](apps/cloud-control) | Hosted lifecycle, queue, provider, custody, authority and Result/evidence control |
| [`apps/supervisor`](apps/supervisor) | Local supervisor, execution, connections and publication adapter |
| [`apps/web`](apps/web) | Local work desk |
| [`factory-console`](factory-console) | Standalone Agent-Native console |
| [`packages/storage`](packages/storage) | Durable local records |
| [`packages/verification`](packages/verification) | Independent verification support |
| [`packages/app-builder`](packages/app-builder) | Template/preview workflow |
| [`packages/client`](packages/client) | Shared client contracts |
| [`fixtures`](fixtures) | Controlled qualification sources; not tester workspaces |
| [`docs/cloud-execution`](docs/cloud-execution) | Dated cloud implementation and qualification history |
| [`docs/private-alpha`](docs/private-alpha) | Preserved local/private-alpha attempts and handoffs |
| [`docs/consolidation`](docs/consolidation) | Canonical source, migration and installation records |

The current external-alpha release remains gated on ordinary owner-specific Work authority, dedicated private workspaces, suitable protected verification, per-owner/global spend enforcement and final installation/isolation qualification. No invitation, new paid attempt or generated effect is authorized by this README.
