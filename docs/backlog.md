# Delivery backlog

This backlog follows [the architecture](architecture.md). Finish **P0 / Phases 0–3** before expanding integrations or autonomy. The first milestone is one selected defect becoming a verified, reviewable **draft PR** through a restart-safe local UI. Phases 4–7 are the later operation, release, and autonomy program. A completed implementation task is not a passed phase gate until its evidence is recorded.

| Priority | Phase | Exit evidence |
|---|---|---|
| P0 | 0. Baseline and calibration | Pinned skills/configuration; a known defect fixed and verified in a copied local repo; dry-run selected and held tasks match policy |
| P0 | 1. Durable foundation | Typed UI/API actions and WorkOrder history survive supervisor restart |
| P0 | 2. Bounded execution | One attempt completes in its required worker profile with ownership, cancellation, and captured artifacts |
| P0 | 3. Reproduce, verify, publish | One defect has before/after evidence, an exact verified commit, UI review, and one authorized draft PR; uncertain publication reconciles |
| P1 | 4. Follow-through and decisions | Clarification, independent review, PR feedback, and watchdog preserve human direction without duplicate actions |
| P1 | 5. Repeated operation | Scheduled signals, recurrence, resource dispatch, and interrupted operation preserve correct state |
| P2 | 6. Qualified release | Failed beta health blocks production promotion; previous qualified version and rollback path remain known |
| P3 | 7. Evaluated improvement | A versioned factory change is evaluated, promoted, and rolled back without rewriting historical runs |

## P0 — first draft PR milestone

### Phase 0 — baseline and triage calibration (in progress)

- [x] Create a disposable, dependency-free defect fixture with a failing regression test, acceptance criteria, and copy-to-temp-Git instructions. `npm test` currently fails as intended (2 pass, 1 fail); see [baseline evidence](phase-0-baseline.md).
- [x] Inventory local Git, Node, Docker CLI, Codex CLI, Claude Code, GitHub CLI, and installed Factory skills. This is a tool inventory, not proof of agent, Docker, or GitHub operation.
- [ ] Product owner selects the target repository/base branch, a reproducible defect, permitted area, and required project checks. Capture the expected behavior and any unresolved product choice. Do not treat the synthetic fixture as target-repository qualification.
- [x] Pin the reviewed Factory skills and referenced documentation with hashes, license, and version; distinguish upstream agent-readable config from application runtime policy. Record the exact agent invocation and source commit.
- [ ] Run `/factory` preflight and read-only `/factory-collect` against the selected repository. Dry-run triage examples and correct which are selected, held for clarification/investigation, or rejected before enabling recurring work.
- [x] Fix the known defect in a copied, task-owned local Git repository; record reproduction, agent/model/skill versions, commands, results, duration, resulting diff, and independent local verification. Validate the chosen agent's authentication and execution in the Mac worker boundary. Container coding remains a separate unqualified profile.

**Gate:** The local fixture was reproduced, fixed by host Codex, and independently verified in Docker. The integrated supervisor also passed a fixture smoke with a simulated coding step and real Docker checks. Target-repository triage and project checks remain unqualified, so Phase 0 has **not** passed.

### Phase 1 — durable supervisor and shared actions

- [x] Establish a small TypeScript application: persistent Node supervisor, migrated SQLite database on local disk, filesystem artifacts, real API, server-sent events, and thin React/Vite queue/detail UI. Closing the browser does not stop a run.
- [ ] Implement the first typed action registry (`workorder.create`, `workorder.update_scope`, `run.start`, `run.cancel`, `verification.run`, `publication.request`) with schemas, actor/capability, preconditions, approval, idempotency, audit, and reconciliation metadata. UI and API must call the same implementation.
- [ ] Persist Repository, Signal, WorkOrder, plan revision, Run, Check/artifact, Approval, ExternalAction, and ordered Event records. Preserve source provenance, immutable run inputs, and explicit waiting/failure/cancellation states. Keep operational state outside target repositories.
- [ ] Validate application runtime policy separately from upstream skill configuration. Start with one selected run, two attempts maximum, 30 minutes per attempt, and separately recorded action permissions. Bind the HTTP service to loopback with state-change protection.
- [ ] Build queue, detail, and settings/preflight views against persisted state. Show current blocker and next action, empty/partial/unavailable coverage, and raw logs on demand. Keep “Pause new work” distinct from “Cancel this run.”
- [ ] Restart the service during a held WorkOrder and verify the same history, decisions, and artifacts remain visible. Define database/artifact backup metadata.

**Gate:** UI and API actions have the same validation/policy/audit behavior, and state survives restart. An agent request cannot grant its own approval.

### Phase 2 — agent execution and required environments

- [x] Implement one agent adapter with capability/auth checks, structured start, normalized event stream, process-tree cancellation, completion status, artifacts, and usage availability. Keep the adapter independent of worker/isolation selection.
- [ ] Implement task-owned workspace export/import with file/hash/mode manifest; exclude secrets, host Git metadata, supervisor state, credentials, and Docker socket. Validate paths, symlinks, modes, additions/deletions, submodules, and Git LFS handling before importing changes into a fresh candidate workspace.
- [ ] Provide capability-based worker profiles: container for portable code/tests; dedicated Mac for native app or macOS work; interactive browser session for login-dependent checks. Display selected profile and granted access before execution. Start on the current machine; do not assume Mac access has container isolation.
- [ ] Add `awaiting_environment` and `awaiting_human_login` checkpoints. Show app/account context, let the user complete sign-in/OTP/passkey directly, confirm the session, and resume the same task without storing authentication material in prompts or general evidence.
- [ ] Add durable lease/ownership token, duration/attempt limits, cancellation, and initial resource reservation for agent/browser/CPU/memory/disk. An expired or cancelled worker cannot publish. Distinguish crashes from intentional waits.
- [ ] Demonstrate one bounded attempt in its required profile, including artifacts and a resumed sign-in task when that profile is needed.

**Gate:** A task can run and stop safely in the required environment; a sign-in task can pause and resume with intact history. Container authentication/daemon support must be proven rather than inferred from an installed CLI.

### Phase 3 — reproduction, exact verification, draft publication

- [ ] Gate autonomous defect implementation on expected behavior, reproducible failure/deterministic check, permitted area, feasible verification, and no unresolved product decision. Send insufficient issues to “Needs clarification” or “Needs investigation.” Keep features and subjective UX feedback on a separate planning path.
- [ ] Capture before/after evidence; for browser defects include the interaction and relevant console, network, and screenshot evidence. Record the base commit and all tool, model, skill, and policy versions.
- [ ] Let the supervisor validate changes and construct a candidate commit. Run configured checks independently against that exact commit; record command, environment, times, result, logs, and artifact identity. Expose changed tests for review. Mark checks/approvals stale when commit, head, requirements, or policy change.
- [ ] Show request, plan, diff, check results, missing evidence, decision history, and proposed external action in the UI. Hold publication on failed or unavailable required checks. A model summary is not verification.
- [ ] Request scoped human approval bound to action, repository, destination, candidate SHA, evidence, policy revision, and expiry. Keep implementation, push, PR creation, replies, merge, deployment, and closure as distinct permissions.
- [ ] Persist publication states (`prepared`, `dispatched`, `succeeded`, `failed`, `unknown`). Push/create one draft PR through the host-side GitHub adapter only after approval. Reconcile remote branch and PR by stable task identity before retrying an uncertain request; do not duplicate external actions.
- [ ] Qualify failed check, changed candidate, stale policy, cancellation, service/agent interruption, lost GitHub response, and database/artifact restore. Preserve the verified local result when publication fails.

**Gate / first milestone:** One selected defect yields one reviewed candidate and one authorized draft PR through the UI; restart and unknown-result reconciliation preserve the full trace. No merge, deployment, public reply, or closure is implied.

## P1 — dependable daily operation

### Phase 4 — clarification, review, PR follow-through, watchdog

- [ ] Implement `ClarificationRequest`: original signal/thread, focused question, draft/sent status, reply authorization and attribution, publication identity, last check, answer, and re-triage. Poll for answers and update the existing WorkOrder without duplicate tasks or replies.
- [ ] Add independent review from original request and primary evidence. Track every actionable finding as fixed/reverified, rejected with evidence, awaiting clarification, or deferred to a person. Preserve human direction when bot suggestions conflict; refresh current head/checks/findings/permissions before marking a PR ready.
- [ ] Add PR babysitting for authorized CI/review findings, with bounded repairs and re-verification. Keep implementation, independent review, PR babysitting, delivery watchdog, and crash recovery as separate roles.
- [ ] Add a delivery watchdog that identifies a specific omitted authorized step, checks live state and deliberate waits, proposes a bounded intervention, and deduplicates unchanged reminders. Approval waits, pauses, cancellations, and missing credentials stay quiet.
- [ ] Complete the operational UI: clarification and human-decision queues, environment/sign-in panel, PR follow-through, watchdog activity, state-specific held-action guidance, and a command panel backed only by the action registry. Provide a decision-focused digest.

**Gate:** A clarification answer resumes the original work without duplicate posting; an intentional wait gets no watchdog nudge; an omitted authorized step is detected; a PR is not “ready” solely because its implementer finished.

### Phase 5 — scheduled signals, recurrence, resource scheduling

- [ ] Add connector pagination, full details/discussion, durable cursor, connection/scope validation, provenance, and coverage/error reporting. Start with GitHub Issues selected manually or by label; then add in-app feedback, Slack/support, interviews/manual notes, error monitoring, performance telemetry, availability monitoring, and scheduled tests as needed.
- [ ] Deduplicate by provider/source item ID; repeated polling updates one Signal. Keep cross-source grouping reversible and original records intact. Classify scheduled/beta failures as product, test, or environment failures and tie them to the tested release.
- [ ] Persist due schedule occurrences in UTC, show local timezone and service heartbeat, coalesce missed polls after sleep, and deduplicate overlapping triggers. Reserve browser slots, CPU, memory, disk, and agent capacity before dispatch. Use a local service manager when qualified; sleeping machines do not run jobs.
- [ ] Create `RecurringIssueCase` linking repeated reports, previous WorkOrders/fixes, commits, releases, exposure, causes/hypotheses, and post-release observation. Investigate why a prior patch failed before proposing another narrow patch; compare recent and prior periods using traffic/exposure.
- [ ] Extend recovery for interrupted schedules, external actions, and worker replacement. Back up database plus artifact manifest and prove restoration. Add usage visibility that distinguishes reported, estimated, and unavailable values.

**Gate:** Repeated signals and interrupted operation preserve one correct history; recurrence after release links the actual previous fix and deployment; resource saturation prevents another browser-heavy run.

## P2 — separately authorized release system

### Phase 6 — beta checks and production promotion

- [ ] Keep focused PR checks separate from longer beta core-flow, browser, performance, and bounded exploratory checks. A failed beta scenario creates one evidence-backed signal tied to the tested version.
- [ ] Implement separate merge, beta deployment, and production promotion policies. Track source commit, release artifact, beta/production versions, deployment outcomes, required checks, observation window, readiness, previous known-good version, and rollback path.
- [ ] Prefer promotion of the artifact tested in beta. Require beta health and relevant telemetry/feedback observation before production; a configurable release window never overrides failed readiness.
- [ ] Verify production health after promotion. Qualify rollback and database migration compatibility; an application rollback alone may not reverse a schema/data change.

**Gate:** Failed beta health blocks production, and the previous qualified version and migration-aware recovery path are identifiable.

## P3 — evaluated factory improvement and broader autonomy

### Phase 7 — learning, routing, and authority expansion

- [ ] Keep product improvement cases separate from factory improvement proposals. Collect human corrections and factory failures; propose a versioned skill, prompt, routing, or configuration change without allowing it to grant itself authority.
- [ ] Compare candidates with pinned baseline on development cases, then protected holdouts. Review correctness, regressions, cost, and human effort; promote an immutable version with rollback pointer and pin future runs to it. Historical runs retain their original version.
- [ ] Add policy preview and dry-run calibration showing which historical signals would be admitted, held, or rejected. Add a regression circuit breaker for repeated verified regressions or repeated failed fixes.
- [ ] Route by role using representative evaluations: lowest-cost qualified model for bounded work, stronger investigation for ambiguity/recurrence, separately configured independent reviewer, and bounded parallel research with explicit ownership. Enforce monetary budgets only when reliably metered; otherwise bound time, attempts, and concurrency.
- [ ] Advance autonomy one action at a time: observe, assist explicitly selected work, prepare eligible fixes/draft PRs, qualified merge/beta delivery, then separately qualified production promotion. Measure accepted changes, recurrence, escaped regressions, human review time, and cost per verified outcome rather than PR count.

**Gate:** A versioned factory change can be evaluated, promoted, and rolled back; policy cannot self-expand; broader authority is enabled only after its own qualification evidence.

## Planning note

The original three-to-five-week estimate covered the core local application. Re-estimate the expanded program after proving native Mac/browser authentication and deployment integrations. Do not let later-release work displace the Phase 3 draft PR milestone.
