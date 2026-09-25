**Local Software Factory — Implementation Plan**

**1. Objective and initial scope**

Build a local software factory that turns selected issues, feedback, and errors into verified changes that you can review through a browser interface.

The complete workflow should be:

**Collect signals → create a WorkOrder → plan → implement in isolation → verify → review → publish a draft PR → measure the outcome.**

Start with:

- One user and one repository.
- Manual tasks and GitHub Issues.
- One agent adapter: whichever of Codex CLI or Claude Code you already use successfully.
- One concurrent implementation attempt.
- A local browser UI and persistent local service.
- Human-directed publication of draft PRs.
- Separate decisions for merge, deployment, replies, and issue closure.

“Local” means that orchestration, workspaces, state, and the UI run on your machine. Model inference can initially use your existing hosted provider. Fully local model inference is a later adapter option.

The first milestone is:

> Select one reproducible defect, generate a bounded fix, independently verify the resulting commit, inspect its evidence in the UI, and publish one draft PR. Restarting the service must preserve the history.

**2. What to reuse from Builder.io**

The reviewed repository contains nine Factory skills:

| Skill | Purpose |
|---|---|
| `factory` | Configure sources, workflows, policies, and host capabilities |
| `factory-collect` | Collect and triage current signals |
| `factory-lookback` | Investigate recurring problems across a bounded history |
| `factory-human-digest` | Gather work that needs human judgment |
| `factory-review-prs` | Review a filtered PR queue |
| `factory-babysit-pr` | Follow one authorized PR through checks and feedback |
| `factory-ship` | Carry out authorized delivery actions |
| `factory-watchdog` | Identify stalled work with a concrete next action |
| `factory-recover` | Resume eligible interrupted work |

Reuse these as versioned instructions. Preserve their separation between implementation, publication, approval, merge, deployment, communication, and closure.

The upstream `.agent-factory/config.yaml` is an agent-readable convention. It is not an executable schema, connector installation, scheduler, or enforcement engine.

The custom application described below must implement those capabilities.

Sources: [Factory guide](https://github.com/BuilderIO/skills/blob/fd8f20a879b507cf09feba08663a1edf7a949353/docs/factory/README.md) and [configuration reference](https://github.com/BuilderIO/skills/blob/fd8f20a879b507cf09feba08663a1edf7a949353/docs/factory/configuration.md).

**3. Establish a working local baseline first**

Before building the application, prove that the underlying workflow works in your local agent environment.

**Prerequisites**

- Git and a disposable test repository.
- Node.js compatible with the selected installer and application dependencies.
- Your chosen coding agent installed and authenticated.
- GitHub access configured in that local environment.
- Docker for the isolated execution phase.
- Known project commands for tests, lint, type checking, and builds.

Use a small repository with a reproducible defect and a reasonably fast test suite.

**Install the upstream skills**

From the target project:

```bash
npx @agent-native/skills@latest add
```

Select the **Factory** group, your agent client, and project installation scope. Review which skills and instruction files the installer creates.

Keep a reference checkout of the version reviewed for this plan:

```bash
git clone https://github.com/BuilderIO/skills.git builder-skills-reference
git -C builder-skills-reference checkout --detach fd8f20a879b507cf09feba08663a1edf7a949353
```

The installer and reference checkout are separate: the `latest` installer can change. For repeatable application runs, vendor or otherwise pin the reviewed skill files and their referenced documentation, record their hashes, and preserve the upstream license.

**Create the initial configuration**

Save the following as `.agent-factory/config.yaml`, replacing the repository identifier and base branch:

```yaml
version: 1
timezone: America/Los_Angeles

repositories:
  - id: app
    provider: github
    remote: YOUR_OWNER/YOUR_REPO
    worktree:
      mode: fresh-per-run
      base: origin/main

sources:
  - id: repo-issues
    provider: github
    type: issue
    scope: YOUR_OWNER/YOUR_REPO

workflows:
  collect:
    enabled: true
    sources: [repo-issues]
    implement:
      mode: manual
    reply:
      mode: never
    close:
      mode: never

  human-digest:
    enabled: true
    repositories: [app]
    sources: [repo-issues]
    include: [pull-requests, issues]
    window: last 7 days
    granularity: balanced

  lookback:
    enabled: false

  pull-requests:
    enabled: false
    approve:
      mode: never
    merge:
      mode: never

  pr-babysitting:
    enabled: false

  ship-watchdog:
    enabled: false

  recovery:
    enabled: false
```

There is deliberately no schedule yet.

Run `/factory` in the local agent host to confirm the configuration and actual available connections. Then run `/factory-collect` for read-only triage.

For the first implementation exercise, explicitly select one defect and request:

> Reproduce this defect in a fresh task-owned workspace. Implement the smallest correction, add a regression test, run the project’s required checks, and report the resulting diff and evidence. Keep the change local.

Record the agent version, skill hashes, input commit, commands, results, duration, and remaining manual steps. This becomes the reference workflow for the application.

**4. Recommended application architecture**

Use a small TypeScript monorepo with a persistent supervisor and an independent browser UI.

| Component | Proposed implementation | Responsibility |
|---|---|---|
| Web UI | React, TypeScript, Vite | Queue, work details, evidence, decisions, settings |
| Local supervisor | Node.js with a small HTTP server | Own state transitions, policy decisions, jobs, and recovery |
| Database | SQLite with migrations | WorkOrders, attempts, events, decisions, schedules |
| Agent adapter | One headless CLI adapter initially | Start, observe, cancel, and collect agent output |
| Sandbox adapter | Docker | Bound the worker’s filesystem, processes, and network access |
| Verification runner | Supervisor-controlled commands in an isolated environment | Produce trustworthy check results |
| GitHub adapter | Host-side integration | Read issues, push branches, create draft PRs, reconcile outcomes |
| Artifact store | Local filesystem with database metadata | Logs, diffs, screenshots, reports, manifests |
| Progress transport | Server-sent events | Stream persisted events to the UI |
| Scheduler | Persistent jobs managed by the supervisor | Poll sources and dispatch due work |

Serve the built UI and API from the same local service. Closing the browser must not stop execution.

SQLite WAL is suitable for a local application with concurrent readers, but it still permits only one writer at a time. Use short transactions and keep the database on local disk.

Avoid adding Redis, Kubernetes, or a distributed workflow engine to the first version. Introduce PostgreSQL and remote workers when the product actually needs multiple machines.

**Proposed source layout**

| Path | Contents |
|---|---|
| `apps/web/` | Browser interface |
| `apps/supervisor/` | API, dispatcher, scheduler, recovery |
| `packages/contracts/` | Schemas, state definitions, shared types |
| `packages/policy/` | Deterministic authorization decisions |
| `packages/agents/` | Agent adapters |
| `packages/sandbox/` | Execution isolation |
| `packages/connectors/` | GitHub and later source adapters |
| `packages/verification/` | Check execution and evidence collection |
| `packages/storage/` | Database migrations and repositories |
| `skills/vendor/` | Pinned upstream skills and documentation |
| `evals/` | Development fixtures and evaluation definitions |

Keep operational data outside the target repository and outside worker write access.

**5. Implement a durable execution lifecycle**

Represent the requested outcome as a **WorkOrder**. Represent every implementation attempt as a separate **Run**.

A normal run moves through:

**Queued → Planning → Implementing → Verifying → Ready for review.**

Use explicit states for:

- Awaiting a decision.
- Blocked by missing information.
- Failed.
- Interrupted.
- Cancelled.

Record publication separately. A failed GitHub request must not erase successful implementation or verification.

**Execution sequence**

1. **Capture the request.** Preserve the original source, acceptance criteria, repository, and allowed scope.
2. **Resolve inputs.** Record the base commit and the versions of skills, tools, agent, model, and configuration.
3. **Prepare a plan.** Identify the reproduction, likely changes, verification approach, and uncertainty.
4. **Evaluate authorization.** Start automatically only when the configured action and scope permit it.
5. **Acquire ownership.** Assign a durable worker lease and create a task-owned workspace.
6. **Execute the agent.** Stream events, enforce limits, and capture proposed changes.
7. **Construct the candidate.** Validate the returned files and create a candidate commit under supervisor control.
8. **Verify the candidate.** Execute configured checks against that exact commit.
9. **Request the next decision.** Present the diff, evidence, remaining uncertainty, and proposed external action.
10. **Publish and reconcile.** Push and create a draft PR only under the applicable authorization; record the verified remote result.

Retries create new attempts. Preserve earlier failures, evidence, and feedback.

**Agent adapter contract**

Each adapter should implement:

- Capability and authentication checks.
- Start with structured inputs and a task workspace.
- Stream normalized events.
- Report completion or failure.
- Cancel the process and its descendants.
- Return artifacts and available usage information.

Keep the agent adapter separate from the sandbox adapter. Changing the coding agent should not require rewriting isolation, scheduling, storage, or the UI.

**6. Make policies enforceable**

Preserve the upstream configuration, but introduce a separate application-owned schema, such as `.agent-factory/runtime.yaml`.

Document this as a new format implemented by the local application.

The runtime schema should define:

- Permitted actions.
- Repository and branch destinations.
- Allowed and restricted paths.
- Required verification commands.
- Execution and retry limits.
- Approval requirements.
- Credential references.
- Schedule and recovery behavior.

Free-text policy remains useful context. Convert approved decisions into explicit machine-readable scopes. An LLM interpretation alone must not grant an action.

Recommended initial settings:

| Setting | Initial value |
|---|---|
| Concurrent implementation runs | 1 |
| Total attempts per WorkOrder | 2 |
| Maximum duration per attempt | 30 minutes |
| Implementation | Explicitly selected WorkOrders |
| Push and draft PR creation | Scoped user approval |
| Public replies and issue closure | Disabled |
| PR approval and merge | Disabled |
| Deployment | Disabled |
| Skill promotion | Explicit review after evaluation |

An approval should identify the action, repository, destination, candidate commit, evidence, policy revision, and expiry.

If those inputs change, re-evaluate the decision. The UI should explain exactly what became stale.

Support separately recorded permissions for implementation, push, PR creation, replies, review approval, merge, deployment, closure, recovery, and notifications. One user interaction can authorize a clearly described bundle of actions; it must record each action explicitly.

**7. Preserve isolation and trustworthy evidence**

A Git worktree separates code changes. Execution isolation requires an additional boundary.

Use a host-owned task workspace and export only the approved project content into the worker environment. Keep the main checkout, supervisor database, credentials, and Docker socket outside the worker.

Docker bind mounts can expose host files with write access, so mount only the directories needed for the attempt.

Implement these concrete controls:

- Record a manifest of input paths, file modes, and hashes.
- Exclude secrets, operational state, and host Git metadata.
- Validate additions, deletions, symlinks, modes, and paths before importing results.
- Import into a fresh candidate workspace, never over the developer’s working checkout.
- Define explicit handling for submodules and Git LFS.
- Run repository scripts and tests inside the execution boundary.
- Keep GitHub publication credentials in the host-side publisher.
- Validate the chosen agent’s supported authentication mechanism inside the sandbox.
- Bind the local API to loopback and protect state-changing requests with authentication and origin checks.

For every check, store:

- Candidate commit and source-tree identity.
- Command and working directory.
- Start time, finish time, and exit status.
- Environment and relevant configuration versions.
- Logs and artifact references.
- Whether the check was passed, failed, skipped, or unavailable.

The supervisor creates verification records from actual execution results. Agent statements such as “tests passed” do not create verified status.

Preserve independent project checks and protected evaluation cases. A change that modifies its own tests should remain visible in the review.

**8. Build recovery and publication together**

Use durable database records for:

| Record | Purpose |
|---|---|
| Repository | Local path, remote, base branch, configuration |
| Signal | Source identity, source revision, evidence, coverage |
| WorkOrder | Requested outcome, scope, acceptance criteria |
| Plan revision | Proposed approach and decision history |
| Run attempt | Ownership, inputs, status, limits, timestamps |
| Check and artifact | Evidence for an exact candidate |
| Approval | Permission for a specific action and revision |
| External action | Intended operation and reconciled result |
| Schedule | Cadence, next occurrence, missed-run policy |
| Event | Ordered history for audit and UI replay |

Use leases and ownership tokens so an expired worker cannot later publish.

External actions need states such as **prepared, dispatched, succeeded, failed, and unknown**.

If GitHub accepted a request but the local service lost the response:

- Find an existing PR using the task’s stable identity.
- Check the remote ref before retrying a push.
- Inspect the actual provider state before replaying any mutation.
- Hold the action if the result remains uncertain.

Design for retries plus reconciliation. Do not assume the local database and GitHub can commit a transaction together.

Recovery must distinguish a crash from a deliberate pause, cancellation, or wait for approval. Preserve artifacts and revoke the old attempt’s publication capability before starting a replacement.

Back up the database and artifact manifest together, and verify restoration during qualification.

**9. UI specification**

Use the interactive concept as the starting direction: a compact work queue, clear next actions, and evidence close to the code change.

**Initial navigation**

| Screen | What it shows | Main actions |
|---|---|---|
| Work queue | WorkOrders by state, repository, age, latest event | Add task, start work, pause dispatch |
| WorkOrder detail | Request, plan, attempts, changes, evidence, decisions | Review, cancel, retry, accept, publish draft |
| Settings | Repository, agent, skills, commands, limits, policies | Run preflight, test connection, save configuration |

**WorkOrder detail**

Provide these tabs:

- **Overview:** request, original source, acceptance criteria, current blocker.
- **Plan:** proposed changes, scope, assumptions, verification approach.
- **Activity:** ordered run events and command progress.
- **Changes:** file list and diff.
- **Verification:** exact tested commit, checks, results, missing evidence.
- **Artifacts:** screenshots, reports, logs.
- **Decisions:** approvals, rejections, policy changes, invalidation reasons.

The primary action should match the current state:

- “Start implementation.”
- “Review missing information.”
- “Retry with feedback.”
- “Run verification.”
- “Approve draft PR publication.”
- “Open existing PR.”

Keep **Pause new work** and **Cancel this run** separate.

Show raw logs on demand, while making the failure and next action understandable without reading them.

**Additional UI screens after the core works**

| Screen | Purpose |
|---|---|
| Signal inbox | Review imported issues, feedback, errors, duplicates, and source coverage |
| Human decisions | Gather work awaiting scope, product, publication, or recovery decisions |
| PR follow-through | Track checks, review findings, current head, and authorized next steps |
| Schedules | Show next run, last run, missed runs, and service heartbeat |
| Run comparison | Compare attempts, diffs, evidence, duration, and available usage |
| Learning review | Evaluate proposed skill changes and promote or roll back versions |
| Outcomes | Track accepted changes, regressions, recurrence, cost, and human effort |

Do not show “no issues” when a connector failed. Display **empty**, **partial**, and **unavailable** distinctly.

**10. Add feedback ingestion and scheduling**

Implement source connectors behind a common interface:

- Validate connection and scope.
- Enumerate records with pagination.
- Fetch complete details and relevant discussion.
- Store a durable cursor.
- Report coverage and errors.
- Normalize source records.

Start with GitHub Issues selected manually or through a configured label. Add Sentry or another telemetry source only after ingestion and deduplication work.

Use the provider and source-item ID for ingestion identity. Repeated polling updates the existing signal rather than creating another WorkOrder.

Treat cross-source similarity as a proposed grouping. Keep the original records and allow the user to split an incorrect cluster.

For scheduling:

- Persist due occurrences before dispatch.
- Deduplicate overlapping triggers.
- Store timestamps in UTC and display them in the configured timezone.
- Define behavior for missed runs.
- Coalesce missed polling runs after wake instead of replaying a large backlog.
- Show the service heartbeat and actual execution history.

Run the supervisor through an appropriate local service manager, such as `launchd` on macOS.

A sleeping or powered-off laptop will not execute work. If continuous operation becomes necessary, move the same supervisor and worker contract to an always-on machine.

**11. Additional improvements and features**

**Priority 0 — Reliability and review**

1. **Preflight checks:** verify repository access, base branch, agent authentication, sandbox support, disk space, and check commands.
2. **Evidence invalidation:** make stale tests and approvals immediately visible.
3. **Bounded retries:** stop repeated failures with a useful decision request.
4. **Durable cancellation:** stop execution and revoke outstanding publication capability.
5. **Source-to-change traceability:** link the original report to its plan, attempts, evidence, and PR.
6. **Publication reconciliation:** recover uncertain outcomes without duplicate external actions.

**Priority 1 — Better daily operation**

1. **Reproduction-first workflow:** demonstrate the reported failure before implementation where practical.
2. **Duplicate-aware intake:** strengthen an existing investigation with repeated reports.
3. **PR babysitting:** address authorized findings and rerun affected checks.
4. **Human digest:** surface concrete decisions and blocked work.
5. **Run replay:** reuse captured inputs and versions for investigation; do not promise identical model output.
6. **Usage visibility:** distinguish reported usage, estimates, and unavailable information.
7. **Post-merge observation:** relate new telemetry to the relevant release and exposure.

Enforce monetary budgets only when the adapter or inference broker can reliably meter and bound spending. Otherwise enforce the limits you actually control: duration, attempts, and concurrency.

**Priority 2 — Measured factory improvement**

Create a separate improvement loop:

1. Collect failure patterns and human corrections.
2. Propose a change to a skill, prompt, or routing rule.
3. Compare it with the pinned baseline on development evaluations.
4. Evaluate selected candidates on protected holdout cases.
5. Review correctness, regressions, cost, and human effort.
6. Promote an immutable version with a rollback pointer.
7. Pin subsequent runs to that promoted version.

This improves the factory’s operating instructions. It does not require training a model.

Keep policy enforcement, approval records, and protected evaluation data outside ordinary agent edit scope. Refresh final holdouts periodically and limit repeated candidate submissions.

Later options include local model adapters, specialized reviewers, multi-repository routing, and remote workers. Add them when measured results justify the extra complexity.

**12. Implementation phases and estimates**

These are planning estimates for one experienced engineer using coding assistance, with agent and GitHub access already available.

| Phase | Deliverable | Exit criterion | Estimate |
|---|---|---|---|
| 0. Baseline | Pinned skills, configuration, manual reproduction | One known defect fixed and verified locally | 0.5–1 day |
| 1. Durable foundation | Database, contracts, events, API, thin queue UI | Work and history survive service restart | 2–3 days |
| 2. Execution | Agent adapter, sandbox, ownership, cancellation | One bounded attempt completes with captured artifacts | 3–5 days |
| 3. Verification and publication | Candidate commits, checks, approvals, GitHub reconciliation | Exact verified candidate produces one draft PR | 3–5 days |
| 4. Core UI | Complete queue, detail, evidence, settings flows | Routine work can be operated from the browser | 2–4 days |
| 5. Feedback and recovery | GitHub intake, deduplication, scheduling, crash recovery | Repeated ingestion and interruptions preserve correct state | 3–5 days |
| 6. Learning | Evaluation comparisons and skill promotion | A candidate can be evaluated, promoted, and rolled back | 3–5 additional days |

Expect roughly **three to five weeks for the dependable local application**, depending on repository setup and adapter behavior. The upstream skill-only trial can be much faster.

Build a thin UI alongside the service from Phase 1; Phase 4 completes the experience.

Commit verified increments to the implementation repository, keeping each phase independently reviewable.

**13. Qualification and definition of done**

Prepare a small fixture repository with known cases:

- A reproducible defect.
- A task requiring clarification.
- An out-of-scope change.
- A duplicate report.
- A failing project check.
- Source text that attempts to redirect the agent outside the task.

Qualify the complete path and the failure boundaries:

| Scenario | Required result |
|---|---|
| Valid defect | Verified candidate with traceable evidence |
| Missing information | Clear question and blocked state |
| Failed check | Publication held |
| Candidate changed after verification | Evidence becomes stale |
| Policy changed after approval | Authorization re-evaluated |
| Agent or service crashes | Honest interrupted state with preserved history |
| User cancels | Worker stopped; publication capability revoked |
| Source polled twice | No duplicate WorkOrder |
| GitHub succeeds but response is lost | Existing remote result reconciled |
| Laptop sleeps through a schedule | Configured missed-run behavior applied |
| Source access fails | Unavailable coverage shown |
| Database restored | Work history and artifact references recover |

The MVP is complete when you can configure a repository, select a defect, run an isolated attempt, inspect the diff and actual check results, publish one authorized draft PR, and recover from interruption through the same UI.

**14. Instructions for the local coding agent**

Use this plan as the implementation brief.

Begin with Phase 0 and document the exact working agent invocation and project checks. Then build one complete execution path through the durable service before expanding integrations.

Implement the browser UI against the service’s real persisted state. Keep sample data explicitly labeled during development.

Keep agent execution, policy enforcement, verification, publication, and storage as separate modules. Pin dependencies and upstream skills, preserve source attribution, and record the versions used by each run.

For every phase, provide:

- Working code.
- Local startup instructions.
- Configuration and migration instructions.
- Evidence that the phase’s exit criterion passed.
- Remaining gaps and the next implementation step.

The first delivery target is **one issue becoming one verified, reviewable draft PR through a recoverable local workflow**.