# Local Software Factory architecture

## Product boundary and delivery target

The factory turns selected issues, feedback, and errors into reviewable software changes: **collect → triage → plan → reproduce → implement → verify → review → publish → observe**. Orchestration, state, workspaces, and the browser UI run locally; hosted model inference is acceptable. Start with one user, one repository, one agent adapter, and one concurrent implementation attempt.

The **first milestone** is one reproducible defect becoming a supervisor-verified candidate commit, visible with its evidence in the UI, then one authorized draft PR. Service restart must preserve its history and reconcile an uncertain publication result. Merge, deployment, public replies, issue closure, recurring autonomy, and production promotion are separate later capabilities.

Phase 0 is **in progress**, not complete. A dependency-free defect fixture and failing regression test are documented in [phase-0-baseline.md](phase-0-baseline.md). No coding agent, Docker worker, target repository, or GitHub publication has been qualified for this project.

## Components and authority

| Component | Responsibility |
|---|---|
| React/TypeScript/Vite UI | Queue, evidence, exact blockers, decisions, settings, and later operational views |
| Node.js supervisor | Typed actions, policy, state transitions, dispatch, recovery, and local HTTP API |
| SQLite on local disk | Migrated durable records and short transactions; WAL supports readers but still has one writer |
| Local artifact store | Logs, diffs, screenshots, manifests, check reports, and backup alongside database metadata |
| Agent adapter | Capability/authentication check; start, stream, cancel, and report one headless coding agent initially |
| Worker adapter | Container, dedicated Mac, or interactive browser execution with explicit access and capacity |
| Verification runner | Execute configured checks independently against an exact candidate commit |
| GitHub adapter | Host-side issue access, push, draft PR creation, and remote reconciliation |
| Event stream | Persist events before sending them to the UI over server-sent events |
| Scheduler | Later, persist due work, deduplicate dispatch, and coalesce missed polling runs |

Serve the built UI and API from the same persistent loopback service; closing the browser must not stop work. Protect state-changing requests with authentication and origin checks. Keep operational data, protected evaluations, policy enforcement, credentials, and the Docker socket outside worker write access. Do not add Redis, Kubernetes, PostgreSQL, or remote workers until multiple machines justify them.

The nine Builder.io Factory skills are **versioned instructions**, not an enforcement engine. Pin their files, referenced documentation, hashes, and license. Keep the upstream `.agent-factory/config.yaml` convention distinct from an application-owned validated runtime schema (for example `.agent-factory/runtime.yaml`) for repositories, paths, commands, limits, credentials, schedules, and approval policy. Agent text can propose actions; only deterministic policy and authorized actors can permit them.

## Data and lifecycle

| Record | Required purpose |
|---|---|
| Repository | Local path, provider identity, remote, base branch, and configuration revision |
| Signal | Provider/source item identity, revision, original text/thread, evidence, provenance, coverage, and tested release when applicable |
| WorkOrder and plan revision | Requested outcome, type, acceptance criteria, allowed scope, assumptions, questions, and decisions |
| ClarificationRequest | Signal/thread, exact question, drafted/sent state, reply authorization, publication identity, last check, answer, and resulting triage |
| Run attempt and worker lease | Immutable inputs and versions, profile, ownership token, state, limits, timestamps, and artifacts |
| Check and artifact | Candidate commit/tree, command, environment, timing, exit status, pass/fail/skip/unavailable result, logs, and file references |
| Approval and external action | Actor, action, scope, policy revision, expiry, intended mutation, and reconciled remote result |
| Schedule and event | Due occurrence, missed-run policy, ordered audit/replay history, and service heartbeat |
| RecurringIssueCase | Source reports, prior WorkOrders/fixes, commits/deployments/versions, recurrence, causes, hypotheses, systemic proposal, and observations |
| Release and skill version | Source commit/artifact, beta/production versions, health, promotion/rollback decision; immutable skill version and rollback pointer |

A WorkOrder is the requested outcome; every retry is a new Run. Normal run states are **queued → planning → implementing → verifying → ready for review**. Explicit held/terminal states include `awaiting_clarification`, `awaiting_environment`, `awaiting_human_login`, `awaiting_approval`, failed, interrupted, and cancelled. Publication is a separate action and state; its failure must not erase a verified run. A deliberate pause, approval wait, cancellation, and crash must remain distinguishable.

For autonomous **defect** admission, require expected behavior, a reproducible failure or deterministic equivalent, permitted repository/area, feasible correction check, and no unresolved product decision. Store before-and-after evidence. Browser evidence can include the interaction, console/network failures, and screenshots. Insufficient evidence becomes **Needs clarification** or **Needs investigation** with the missing detail shown. Features and subjective UX feedback use a planning path, not a “verified defect” label.

The supervisor resolves the input commit and agent/model/skill/tool/configuration versions, obtains a task-owned workspace and lease, runs a bounded agent, validates the returned file tree, creates the candidate commit itself, and checks that exact commit. Validate additions, deletions, paths, symlinks, modes, submodules, and Git LFS behavior before import into a fresh candidate workspace. Agent claims about tests never create verified status. Any candidate, required check, head, or policy change invalidates dependent evidence and approvals.

## Shared actions and decisions

UI buttons, CLI/API calls, and later agent tools or MCP invoke the **same typed action registry**. Each action declares input/output schema, actor and capability, preconditions, approval requirement, idempotency key, audit events, expected result, and reconciliation method. Examples: `workorder.create`, `workorder.update_scope`, `run.start`, `run.cancel`, `verification.run`, `clarification.draft`, `publication.request`, and `release.request_promotion`. A natural-language command panel may translate requests into these actions; it does not bypass them. A configuration proposal cannot expand its own authority.

Record authority separately for implementation, push, PR creation, public reply, review approval, merge, deployment, closure, recovery, notification, and skill promotion. Initial policy: one run at a time, at most two attempts per WorkOrder, 30 minutes per attempt, implementation only for explicitly selected work, scoped human approval for push/draft PR, and public replies, closure, merge, deployment, and autonomous skill promotion disabled. A single deliberate human interaction may grant a described bundle, with each action recorded separately. Agents can request approval but cannot grant it or impersonate the human actor.

An approval binds action, repository, destination, candidate commit, evidence, policy revision, and expiry. Re-evaluate it if any binding changes and explain the stale input in the UI. External actions move through **prepared, dispatched, succeeded, failed, unknown**. Use stable WorkOrder identity, remote branch/ref checks, and provider inspection before replaying a push, reply, or PR mutation. Hold uncertain outcomes rather than duplicate them. Expired worker leases revoke publication capability. Back up database and artifact manifest together and qualify restoration.

## Worker profiles and trust boundaries

| Profile | Use | Boundary and checkpoint |
|---|---|---|
| Container worker | Portable backend, unit/build, and browser test work | Export only approved files; bound resources/network; keep host checkout, Git metadata, credentials, database, and Docker socket out |
| Dedicated Mac worker | Native macOS app or environment-specific work | Explicit local access scope, task ownership, visible session; weaker isolation displayed before start |
| Interactive browser session | Login-dependent journeys | Dedicated session and user sign-in handoff; resume the same task from a recorded checkpoint |

Select by required OS, application, browser/authentication, and available CPU, memory, disk, browser slots, and agent capacity. Start on the existing development machine; move to a dedicated Mac or other machine only when justified. For sign-in, pause, show the app/account context and required user action, let the user enter OTP/passkey directly, confirm the session, then resume. Keep authentication material out of prompts, logs, and general evidence screenshots. A native worker must not silently inherit container-level trust claims.

## Supervision, intake, and feedback

Separate implementer, independent reviewer, PR babysitter, delivery watchdog, and recovery service even if they run sequentially. The upstream `agent-watchdog` audits another agent's work; `factory-watchdog` finds stalled authorized delivery. The reviewer examines the original problem, diff, and primary evidence independently; another model agreeing with the implementer is insufficient. PR findings receive an explicit disposition: fixed and reverified, rejected with evidence, awaiting clarification, or deferred for a human decision. Human direction prevails over conflicting bot suggestions. Refresh live head, checks, findings, and permissions before publication or merge; an agent summary alone never marks a PR ready.

The **delivery watchdog** finds omitted authorized steps and proposes bounded interventions after checking live state and intentional waits. The **recovery service** reconciles interrupted processes and uncertain remote outcomes. Approval waits, pauses, cancellations, and missing credentials must not generate repeated watchdog nudges. Deduplicate unchanged reminders.

Connectors retain source identity, provenance, pagination/cursor, coverage, and errors. Begin with manual work and GitHub Issues; later add in-app feedback, Slack/support threads, interview/manual notes, error monitoring with release/source-map context, performance and availability telemetry, and scheduled tests. Repeated polling updates one signal. Similarity across sources proposes a grouping while preserving original records. Show **empty**, **partial**, and **unavailable** as distinct coverage states.

Clarification drafts the smallest focused question, publishes only under reply policy, records publication identity, checks the source thread for an answer, and re-triages the existing WorkOrder without duplicate replies/tasks. Automated use of a personal account supports visible attribution. Recurring symptoms create a linked investigation of prior fixes and actual deployment, related callers/shared components, remaining hypotheses, and a systemic correction. Compare relevant exposure, not raw error counts alone. Keep product improvement (software corrections) separate from factory improvement (skills/routing/policy evaluations).

## UI, releases, and progressive autonomy

The first UI provides a work queue, WorkOrder detail (overview, plan, activity, changes, verification, artifacts, decisions), and settings/preflight. State-specific actions explain the next step; **Pause new work** and **Cancel this run** are separate. Raw logs are available on demand, while the blocker and next action remain understandable without them. Later views add environment/sign-in, clarification, PR follow-through, watchdog, recurrence, schedules, human decisions, outcomes, releases, factory tuning, and the command panel. “Needs a person” is distinct from failure.

PR checks are focused gates for a change. Broader beta checks cover core browser journeys, performance, and bounded exploratory testing; a failure creates one traceable signal tied to the tested release and classified as product, test, or environment failure. Release flow is separately authorized **merge → beta deploy → checks/observation → readiness decision → identified artifact promotion → production verification**. Track artifact/commit identity, observation window, previous known-good version, rollback procedure, and database migration compatibility. Prefer promoting the tested artifact. A configurable release window never overrides failed readiness; failed beta health blocks production promotion.

Route routine bounded work to the lowest-cost qualified model, ambiguous/recurring diagnosis to a stronger investigator, and review to a separately configured reviewer. Qualify routing with representative evaluations and observed usage; do not treat illustrative vendor pricing as a guarantee. Enforce duration, attempt, and concurrency limits now; monetary limits require reliable metering. Autonomy advances by action: **observe → assist selected tasks → prepare eligible fixes/draft PRs → narrowly qualified merge/beta delivery → separately qualified production promotion**. Use policy preview, dry-run correction, a regression circuit breaker, decision-focused digest, and outcome metrics (accepted changes, recurrence, escaped regressions, human review time, cost per verified outcome). PR count alone is not success.
