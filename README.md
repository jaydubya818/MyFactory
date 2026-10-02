# Local Software Factory

**Current staging status — 2026-10-02:** Exact Sofie preview → Factory preview Trusted Sources OIDC is enabled. Connected infrastructure/application access, different-project preview denial, and remove/restore revocation checks PASS. No static Factory bypass exists. Authorized productive Work, hosted harness, independent verifier and Mac-off/P0 remain NOT_RUN. [OIDC evidence and limits](docs/cloud-execution/phase-3/trusted-sources-oidc.md). Preserve the [credential-custody incident](docs/cloud-execution/phase-3/factory-bypass-custody-incident.md) and checkpoint `0df0c37`; historical status entries below do not supersede this status. Paid models: 0; production admission/publication: DISABLED.

The dedicated Sofie runtime/operator bypass is now explicitly approved and its hosted access matrix is **PASS**, including independent Factory auth and Work-scope denial. Build/client/HTML and observed log scans pass. The credential was then revoked and protection reverified; zero Sofie bypasses remain. [Access evidence and continuation](docs/cloud-execution/phase-3/sofie-runtime-access.md). Canonical cloud harness, verifier, Mac-off and P0 remain NOT_RUN; paid calls are zero.

[Cloud execution migration](docs/architecture/cloud-execution.md): the local execution-provider seam is implemented and regression-tested. Dedicated staging project, database, private custody storage and an admission-disabled readiness service are provisioned; see [Phase 2 evidence](docs/cloud-execution/phase-2/README.md). The provider-native Node 24 image is digest-pinned and has passed connected image qualification; hosted exact-source deterministic execution, private artifact custody and teardown also pass. The canonical PostgreSQL operation ledger passes connected parity/concurrency checks; the cloud Work lifecycle remains pending. Cloud execution is **NOT_READY**; no laptop-independence, cloud verifier or live canary is claimed. See the [checkpoint](docs/cloud-execution/phase-1/README.md) and [runbook](docs/runbooks/cloud-execution.md).

[Latest execution-capacity repair](docs/private-alpha/execution-capacity-2026-10-01/README.md): Attempt 4 is preserved as failed. The complete five-operation installed-CLI journey passes offline, including custody, protected verification, Result/Proof and final synthetic Sofie explanation. The repaired runtime is deployed; a fresh paused fifth Work requires explicit authorization. Publication remains disabled.

[Private-alpha OIDC provider](docs/private-alpha/README.md): project-scoped Gateway authentication, exact-model eligibility preflight and bounded execution are implemented. The substantive first Work remains owner-gated.

<!-- CANONICAL-CONSOLIDATION-STATUS -->
**Private-alpha canonical `main`: independent review and fresh-clone qualification PASS.** The [current status](docs/consolidation/CANONICAL-STATUS.md), [source manifest](docs/consolidation/PRIVATE-ALPHA-SOURCE-MANIFEST.md), and final canonical receipt identify exact source and qualification. MyEve supports explicit private, shared-business and Work-scoped context for two partners. Controlled verification is qualified; live providers and deployment remain separate gates. [Development/migration policy](docs/consolidation/DEVELOPMENT-POLICY.md).
<!-- /CANONICAL-CONSOLIDATION-STATUS -->

A supervised local workflow for turning a selected WorkOrder into a reviewable candidate commit. WorkOrders, attempts, checks, events, policies, publication decisions, signals, and releases are stored in SQLite. The web work desk and standalone Agent-Native console read those records through the same loopback supervisor.

This is an implementation in progress. The local path and Feedback Hub preview run; a real target repository and issue are still needed to qualify the first end-to-end GitHub draft PR.

The work desk now includes **Connections** and optional Linear issue creation. Approved sibling app backends can create WorkOrders, read evidence records, and add notes through scoped shared actions. These integrations are inactive until configured. See [app connections and Linear setup](docs/connections.md) for host settings, client registration, retry behavior, and current limits.

## Producer result attestation

The opt-in [result protocol](docs/producer-result-protocol.md) captures an immutable, content-derived FactoryVersion when an attempt is admitted. Terminal results bind the saved request/WorkOrder/attempt, actual Git candidate objects and patch, check evidence, and returned artifact bytes in one signed manifest. It reuses the existing Ed25519 receipt primitive with a versioned result domain and retained key identities. Exact-attempt readback supports replay and restart without redispatch; unknown or stopping attempts produce no terminal receipt.

This is **local synthetic producer qualification**, documented in the [Q37 evidence dossier](docs/evidence/q37-producer-attestation/REPORT.md). Receipts grant no consumer writer, publication, approval, budget or Ready authority. **MyEve Gate C consumer integration and Gate B writer handoff are not implemented here; live Q37 Factory execution is NOT_RUN.** No production keys are created or changed automatically.

## Run the work desk

Requires Node 24. Coding attempts use a logged-in Codex CLI on the Mac host and Docker Desktop with the cached `node:22-bookworm` image for offline verification.

```sh
npm ci
npm run preview:prepare
npm run build
npm start --workspace @factory/supervisor
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). Set `FACTORY_PORT` for another loopback port or `FACTORY_DATA_DIR` for another local data directory. The default is `~/.local/share/sellerfi-factory`. The supervisor continues a run if the browser closes.

The [standalone Agent-Native console](factory-console/README.md) has a contextual factory view and agent actions. Start it separately with `FACTORY_SUPERVISOR_URL` pointed at the running supervisor. It uses the same WorkOrder and evidence records; its own database holds app and chat state. A model provider must be configured before natural-language chat can answer.

## Build a Feedback Hub

Open **App builder**, choose the versioned Feedback Hub starter, and enter a product brief. The factory saves a linked WorkOrder and a file manifest with source hashes. `npm run preview:prepare` fetches the pinned starter dependencies once during host setup; it disables package scripts. Open the WorkOrder and choose **Start local preview**. The supervisor checks the unchanged scaffold, installs those cached dependencies offline with scripts disabled, runs typecheck and build, and starts a loopback preview of the app and its action API. Preview status and bounded logs remain in the WorkOrder. **Stop preview** ends the child process. This is a template preview, not independent verification of a modified candidate.

## Run and review a coding WorkOrder

1. Create a WorkOrder with a local Git repository path, base branch, acceptance criteria, permitted file paths, and check commands. A defect also needs a reproduction command and the expected substring in the failing baseline log.
2. Start a bounded Mac coding attempt when an approved spend gateway is available. The supervisor makes a task worktree, checks the baseline failure in offline Docker, runs Codex, validates the changed paths and modes, then commits the candidate with an isolated Git index. It verifies the exact candidate commit in offline Docker. One attempt runs at a time; each WorkOrder is limited to two attempts. Default host Codex execution currently stops before the model call because paid execution is disabled.
3. Review the candidate diff, check logs and digests, and policy revision. A publication request is a local proposal. The device owner must confirm approval of the exact request. A changed candidate, diff, check log, policy, or expired approval blocks a new draft PR.
4. After approval, the host-side GitHub adapter checks the destination branch and existing PR, pushes the exact candidate only to an absent stable WorkOrder branch, and creates a draft PR. It records the external outcome. If the response is uncertain, retries are read-only reconciliation; the factory does not repeat an unconfirmed push or PR creation.

Human-only actions use macOS device-owner confirmation because the loopback browser token is available to local processes. The agent can create a WorkOrder, add a note, pause dispatch, prepare a local preview, and propose publication through shared typed actions. It cannot resume dispatch, start or cancel a coding run, approve publication, or publish a draft on its own.

The Mac coding agent may inherit host credentials and network access under its Codex sandbox. The supervisor checks the resulting candidate, but this is not a complete sandbox for the host coding step. Docker verification receives an exported commit tree without `.git`, the Docker socket, or model credentials. Keep work within trusted local repositories and review the exact candidate before publication.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm run smoke:docker
```

The [Phase 0 baseline](docs/phase-0-baseline.md) and [integrated smoke evidence](docs/evidence/integration-smoke/README.md) show the fixture, reproduction, candidate, and independent check. The [architecture](docs/architecture.md) and [backlog](docs/backlog.md) separate this first delivery path from scheduled intake, merge, deployment, and release promotion. Reviewed Builder.io Factory instructions are pinned under [skills/vendor/builderio](skills/vendor/builderio/README.md).

## MyEve Factory dispatch qualification

The Q37 consumer uses authenticated two-stage preparation and dispatch on the existing connection API. See [dispatch lifecycle and local qualification](docs/factory-dispatch.md). The producer captures the real WorkOrder, attempt and FactoryVersion before execution; replay never creates a second consequential dispatch. Stop remains nonterminal until resource reconciliation proves quiescence.

**Private-alpha OIDC runtime:** the canonical provider adapter reuses MyEve's project-scoped Vercel OIDC mechanism and pins `openai/gpt-5.4-mini` through OpenAI only. Every model operation still crosses the V2 Work ledger with UNKNOWN retention, protected completion reserve, operation limits and exact writer fencing. The Keychain path is unused. See the [provider lifecycle, qualification and limitations](docs/private-alpha/README.md), [V2 protocol](docs/factory-dispatch.md#v2-spend-and-completion-contract), and [MyEve handoff](docs/my-eve-spend-v2-handoff.md). Authentication/model eligibility does not authorize the first real Work or publication.

Private-alpha Attempt 5 completion repair and complete zero-model qualification: [evidence](docs/private-alpha/completion-transition-2026-10-01/README.md). Live retry remains unapproved.


Hosted staging queue delivery is now CONNECTED PASS ([evidence](docs/cloud-execution/phase-3/README.md)). A delayed private consumer recorded PostgreSQL completion after the submitting process exited; duplicate submission returned the same receipt. Queue messages are wake-ups, while PostgreSQL remains authoritative. This bounded infrastructure check does not enable Work admission or qualify canonical recovery, the cloud harness, independent verifier, or Mac-off/P0. Keep the deployment hosting any outstanding message until reconciliation completes; never interpret an expired message as proof that an execution did not occur.


Canonical cloud admission/storage now has connected PostgreSQL evidence for exact source grants, duplicate dispatch, cancellation, late allocation receipts and lease expiry. Model reservation/dispatch requires a live running cloud lease by default. These controls are not yet wired to public Work admission. See the Phase 3 evidence for tests and remaining gates.


The canonical model gateway now supports hosted Fetch requests with deterministic upstream injection behind its existing accounting boundary. Sofie cloud qualification has a separate empty owner-side database and isolated web project, avoiding the existing preview's shared database binding. Factory state/custody remains in dedicated MyFactory staging. These are implementation checkpoints; cloud admission, harness, verifier and Mac-off/P0 remain unqualified.


Signed execution snapshot V2 now binds cloud image/source/policy/resource/skill pins and the evidence class, with a shared cross-repository signed test vector. Legacy V1 stays strict. See Phase 3 evidence; this does not enable cloud admission or establish Mac-off qualification.


Cloud custody now has pure-data source/tree/patch validation and durable PostgreSQL delivery, collection and cleanup fencing. MyEve can consume a signed cloud candidate without local Git while preserving the existing publisher guard. See Phase 3 evidence; hosted Work/harness/verifier/Mac-off integration is still pending.


The qualification-only hosted Work controller now implements private queue dispatch, exact source/worker execution, custody validation, cancellation/recovery and signed Result retention. Hosted Work qualification remains NOT_RUN. The dedicated staging-project deployment-protection bypass is now explicitly approved and configured only in Sofie sensitive preview backend configuration; Factory environment injection is disabled. Hosted application-boundary qualification is pending; see the Phase 3 access approval document. Public cloud admission stays disabled and paid model calls remain zero.

The approved Factory bypass is configured, but Sofie operator ingress is separately protected and has no bypass. Hosted access matrix is **NOT_RUN** pending that distinct security decision; [scope and evidence](docs/cloud-execution/phase-3/sofie-access-approval.md). Factory deterministic regressions: 224 PASS, 0 FAIL, 7 gated skips. No Work was dispatched and no paid model or publication was invoked.

Cloud execution remains [harness-neutral](docs/architecture/harness-provider.md).
The current MyFactory/Codex harness is first: deterministic cloud execution →
independent verifier → Mac-off/P0 → separately approved real cloud canary.
DeepAgent, Claude Code, OpenCode and other adapters are deferred until their turn
in qualification; none is implied qualified. FactoryVersion pins the complete
environment/provider/harness/version/model/tools/skills/verification tuple.

The [harness addendum](docs/architecture/harness-provider.md) now consumes Fabric's canonical optional
SessionSurface contract. HEADLESS remains mandatory; TMUX/CMUX are deferred
operator conveniences, with no role in productive lifetime or recovery.
Qualification evidence must include loaded skill hashes. Differential reports
use the same corpus/environment/model and report success, independent
verification rate, repair rate, operations, latency, cost and cleanup/recovery.
These contract changes do not qualify the hosted harness or Mac-off journey.


The existing Codex adapter is now wired into the dedicated cloud worker through the canonical SpendGateway/PostgreSQL ledger, with integrity-pinned installation, bounded SDK transport, host checkpoints, read-only completion and exact-tree custody. [Implementation and evidence limits](docs/cloud-execution/phase-3/cloud-harness-implementation.md): 119 local tests PASS, six gated skips; hosted harness and independent verifier remain NOT_RUN. This does not enable production, paid models or publication.

Independent cloud verification is now implemented behind the qualification boundary, including Factory-owned leases/custody, separate sandbox identity, cancellation/cleanup fencing and signed canonical Result evidence. [Implementation and validation limits](docs/cloud-execution/phase-3/independent-verifier.md). Hosted verification and the full Golden Journey remain NOT_RUN.

Cloud staging: canonical hosted admission and producer allocation reached; [attempt 2](docs/cloud-execution/phase-3/hosted-attempt-2.md) failed on the pinned harness archive layout, with cleanup confirmed and zero model operations. Installer repair is under deterministic regression; Golden Journey remains NOT_RUN.

[Hosted attempt 3](docs/cloud-execution/phase-3/hosted-attempt-3.md): existing harness productive/checkpoint/read-only completion observed in CLOUD, two deterministic operations and zero paid calls. Private custody readback failed; sandbox destroyed. Independent verifier and Golden Journey remain NOT_RUN.
