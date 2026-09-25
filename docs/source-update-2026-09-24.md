**Implementation Plan Update — Full Transcript, Improvements, and Additional Features**

This update extends the original Local Software Factory implementation plan. Retain its durable supervisor, database, isolated workspaces, verification evidence, action policies, recovery, and local UI. Incorporate the following requirements into the architecture and delivery backlog.

**1. Make reproduction a requirement for autonomous defect work**

The transcript repeatedly emphasizes that an agent must demonstrate the problem, implement a correction, and verify the result.

Move reproduction-first behavior from an optional improvement into the admission criteria for autonomous defect implementation.

Before automatically implementing a defect, require:

- A clear expected behavior.
- A reproducible failure or an equivalent deterministic check.
- A repository and affected area within the permitted scope.
- A feasible way to verify the correction.
- No unresolved product decision that changes the intended behavior.

Capture evidence before and after the change. For browser defects, this may include the failing interaction, console errors, network failures, screenshots, and the corrected interaction.

Feature requests and subjective UX feedback follow a separate planning path. They should not be classified as verified defects simply because an agent can propose code.

**Acceptance criterion:** An issue without sufficient reproduction evidence enters “Needs clarification” or “Needs investigation,” with the missing information clearly identified.

**2. Support the real local environment**

The previous Docker execution path needs an additional execution profile for work that requires macOS, native applications, or an authenticated browser.

Introduce capability-based worker selection:

| Execution profile | Appropriate work | Required behavior |
|---|---|---|
| Container worker | Backend changes, unit tests, builds, portable browser tests | Isolated task files, bounded resources, controlled credentials |
| Dedicated Mac worker | Native macOS applications and environment-specific verification | Explicit local access scope, task ownership, visible session |
| Interactive browser session | Login-dependent workflows and user-assisted verification | Dedicated session, sign-in handoff, explicit resume |

A native host worker has a different trust boundary from a container. Display the selected profile and granted access before execution.

Add these states:

- `awaiting_human_login`
- `awaiting_environment`
- `awaiting_clarification`
- `awaiting_approval`

When authentication is required:

1. Pause at a recorded checkpoint.
2. Show the application, account context, and required user action.
3. Let the user complete sign-in, OTP, or passkey interaction directly.
4. Confirm the required session is available.
5. Resume the same task from the checkpoint.

Keep authentication material out of prompts, logs, and screenshots retained as general evidence.

Start on the existing development machine. Support moving the worker to a dedicated Mac or other suitable machine when workload warrants it.

Add resource-aware dispatch for browser slots, CPU, memory, disk space, and agent availability. A machine with capacity for several code tasks may only have capacity for one browser-heavy task.

**Acceptance criterion:** A task can pause for sign-in, resume without losing its history, and complete verification using the required environment.

**3. Implement clarification as a complete workflow**

The original plan captures a missing-information question. Extend it to track the answer and return the work to triage.

Create a `ClarificationRequest` record containing:

- Original signal and source thread.
- Exact question.
- Whether it was drafted or sent.
- Applicable reply authorization.
- Publication identity.
- Last checked time.
- Answer and resulting triage decision.

Workflow:

1. Identify the smallest missing detail.
2. Draft one focused question.
3. Publish only when the reply policy permits it.
4. Check for answers during later collection runs.
5. Attach the answer to the original signal.
6. Reassess reproduction, scope, and eligibility.
7. Continue or retain the unresolved question.

Prevent repeated posting of the same question.

When automated messages use a personal account, provide configurable attribution such as “Automated Factory update.”

**Acceptance criterion:** A clarification answer updates the existing WorkOrder without creating a duplicate task or duplicate public reply.

**4. Separate implementation, supervision, and final review**

Use distinct responsibilities, even when the first version runs them sequentially.

| Role | Responsibility |
|---|---|
| Implementer | Reproduce the problem, make the change, produce artifacts |
| PR babysitter | Track CI and review findings; address authorized feedback |
| Independent reviewer | Inspect the problem, diff, and evidence; identify remaining gaps |
| Delivery watchdog | Find authorized work that stopped before its next required step |
| Recovery service | Reconcile interrupted execution and uncertain external outcomes |

The repository distinguishes [`agent-watchdog`](https://github.com/BuilderIO/skills/blob/fd8f20a879b507cf09feba08663a1edf7a949353/skills/agent-watchdog/SKILL.md), which audits another agent’s work, from [`factory-watchdog`](https://github.com/BuilderIO/skills/blob/fd8f20a879b507cf09feba08663a1edf7a949353/skills/factory-watchdog/SKILL.md), which identifies stalled authorized delivery work. Preserve that distinction in the application.

An independent reviewer should form its own assessment from the original request and primary evidence. A second model agreeing with the first is not sufficient verification.

For PR feedback, record a disposition for every actionable finding:

- Fixed and reverified.
- Rejected with supporting evidence.
- Awaiting clarification.
- Deferred for a human decision.

Preserve human direction when bot suggestions conflict with the intended scope. Surface unresolved conflicts explicitly.

Before publication or merge, refresh the current head, required checks, unresolved findings, and applicable permissions.

**Acceptance criterion:** A PR cannot be marked ready merely because the implementation agent finished or posted a summary.

**5. Detect unfinished work without confusing it with a crash**

Add a delivery watchdog alongside recovery.

Example conditions:

- A verified change was never published despite publication being authorized.
- A PR has actionable CI failures that its owner stopped addressing.
- A review request was accepted but never completed.
- A task claims completion while required delivery evidence is missing.

For each candidate, the watchdog should:

1. Confirm the original request and current authorization.
2. Inspect live state.
3. Identify the specific unfinished step.
4. Check whether the task is deliberately waiting.
5. Record a proposed intervention.
6. Notify or hand the work back only when that action is authorized.

Use a bounded intervention count and deduplicate unchanged reminders.

Approval waits, explicit pauses, cancellations, and unavailable credentials must not trigger endless nudges.

**Acceptance criterion:** The watchdog catches an omitted authorized step while leaving intentional waits undisturbed.

**6. Make recurring-defect investigation a first-class capability**

The transcript describes two improvement loops that should be implemented separately:

| Loop | Trigger | Result |
|---|---|---|
| Product improvement | Repeated errors, feedback, performance problems, or failed fixes | A systemic software correction |
| Factory improvement | Poor triage, weak verification, inefficient runs, or repeated agent mistakes | An evaluated change to skills or operating instructions |

Create a `RecurringIssueCase` that links:

- Original reports and source evidence.
- Related WorkOrders and previous fixes.
- Commits, deployments, and affected versions.
- Recurrence after a claimed correction.
- Confirmed causes and remaining hypotheses.
- Proposed systemic changes.
- Post-release observation results.

Support configurable windows, including a recent period compared with a previous period.

When a symptom recurs, choose among:

- Deeper reproduction and investigation.
- Examination of related callers and shared components.
- A broader independent review.
- Clarification from the reporter.
- A human product or architecture decision.

Do not repeatedly reopen the same narrow patch without investigating why it failed.

Measure outcomes using relevant exposure. Fewer errors during a period with fewer users does not by itself establish an improvement.

**Acceptance criterion:** A repeated symptom after release creates a linked recurrence investigation that considers the previous fix and its actual deployment.

**7. Improve signal quality and continuous testing**

Expand the connector backlog beyond GitHub Issues:

| Source | Useful captured context |
|---|---|
| In-app feedback | Page, action, application version, reproduction details |
| Slack or support channels | Original thread, relevant replies, source identity |
| Customer interviews or manual notes | Observed problem, expected outcome, uncertainty |
| Error monitoring | Stack trace, release, environment, source-map correlation |
| Performance telemetry | Metric definition, percentile, time window, traffic volume |
| Availability monitoring | Affected endpoint, duration, failure evidence |
| Scheduled tests | Scenario, tested release, artifacts, failure classification |

Every signal should retain its provenance and coverage status.

Add two testing lanes:

- **PR checks:** focused tests required before the change can proceed.
- **Broader environment checks:** longer browser journeys, performance checks, and bounded exploratory agent testing against beta.

Longer tests can run after beta deployment or on a schedule and become production promotion gates.

A detected failure should create an evidence-backed signal and enter the same triage workflow. Deduplicate repeated failures and distinguish product defects from test or environment failures.

**Acceptance criterion:** A beta test failure produces one traceable signal tied to the tested release, with enough evidence for investigation.

**8. Add beta and production release stages**

Keep draft PR publication as the first delivery milestone. Add a separate release phase for the broader factory.

Recommended sequence:

1. Merge an eligible, verified change under the merge policy.
2. Deploy the resulting version to beta under a separate deployment policy.
3. Run core-flow, performance, and exploratory checks.
4. Observe relevant feedback and telemetry.
5. Evaluate production readiness.
6. Promote an identified release artifact.
7. Verify the production deployment and its health.

Track:

- Source commit and artifact identity.
- Beta and production versions.
- Deployment outcome.
- Required checks and observation window.
- Promotion decision.
- Previous known-good version.
- Rollback procedure.
- Database migration compatibility.

Prefer promoting the tested artifact where the delivery platform supports it.

The transcript’s daily production release is an example cadence. Make the release window configurable, and require readiness independently of the clock.

A rollback must account for data and schema changes; restoring an application artifact alone may not reverse a migration.

**Acceptance criterion:** Failed beta health prevents production promotion, and the previous qualified version remains identifiable.

**9. Give the UI and agents a shared action layer**

Define application behavior once in a typed action registry.

Examples:

- `workorder.create`
- `workorder.update_scope`
- `run.start`
- `run.cancel`
- `verification.run`
- `clarification.draft`
- `publication.request`
- `release.request_promotion`

Expose the same action implementations through the UI, CLI, API, and later agent tools or MCP.

Each action should declare:

- Input and output schema.
- Required capability and actor.
- Preconditions.
- Approval requirements.
- Idempotency behavior.
- Audit events.
- Expected result and reconciliation method.

Shared functionality does not mean identical authority. An agent can request an approval; it cannot impersonate the human who grants it.

Add a natural-language command panel that translates requests into these actions. Show consequential proposed actions for review when the policy requires it.

**Acceptance criterion:** A UI button and its corresponding agent tool use the same validation, policy checks, state transition, and audit trail.

**10. Expand the UI specification**

Retain the original queue and WorkOrder detail screens, then add:

| UI area | Required information and actions |
|---|---|
| Environment panel | Worker, OS, capabilities, session state, resource availability, sign-in handoff |
| Clarification queue | Missing information, drafted question, source answer, re-triage status |
| PR follow-through | Current head, CI, findings, dispositions, authorized next action |
| Watchdog activity | Stalled condition, supporting evidence, proposed intervention, previous reminders |
| Recurrence investigations | Related reports, previous fixes, release timeline, before-and-after evidence |
| Releases | Beta health, promotion readiness, production version, rollback target |
| Factory tuning | Dry-run decisions, human corrections, proposed configuration changes, evaluation results |
| Command panel | Natural-language requests backed by the shared action registry |

Separate “Needs a person” from “Failed.” A login request or product decision is useful progress, not a broken execution.

For each held action, show the exact missing requirement and how to resolve it.

**11. Add measured model routing and progressive autonomy**

Use task roles rather than hardcoding the transcript’s model preferences.

| Work category | Routing approach |
|---|---|
| Routine classification and bounded implementation | Lowest-cost qualified model |
| Ambiguous diagnosis or recurring failures | More capable investigation model |
| Independent review | Separately configured reviewer |
| Broad research or log analysis | Bounded parallel tasks with explicit ownership |

Choose models through representative evaluations and observed usage. Treat the speaker’s pricing, subscription, and performance comparisons as examples rather than implementation guarantees.

Progress autonomy by action:

1. **Observe:** Collect and propose work.
2. **Assist:** Implement explicitly selected tasks.
3. **Prepare:** Automatically fix eligible defects and create draft PRs when authorized.
4. **Deliver:** Permit narrowly qualified merge and beta deployment workflows.
5. **Promote:** Permit production promotion under a separately qualified release policy.

Add these further improvements:

- **Policy preview:** Show which historical signals a proposed rule would admit, hold, or reject.
- **Dry-run calibration:** Let the user correct triage decisions before enabling recurring execution.
- **Regression circuit breaker:** Pause the relevant autonomous workflow after repeated verified regressions or repeated failure of the same fix.
- **Resource-aware scheduling:** Reserve browser and memory capacity before dispatch.
- **Decision-focused digest:** Batch unresolved choices with evidence and a recommended next action.
- **Outcome metrics:** Measure accepted changes, recurring defects, escaped regressions, human review time, and cost per verified outcome.

Avoid optimizing for PR count alone.

**12. Revised implementation order**

| Phase | Scope | Completion evidence |
|---|---|---|
| 0 | Local skills, dry-run collection, triage calibration | Selected tasks and held tasks match intended policy |
| 1 | Durable supervisor, action registry, database, basic UI | State and history survive restart |
| 2 | Agent execution, worker profiles, environment handoff | One bounded task completes in its required environment |
| 3 | Reproduction, verification, draft PR publication | One defect becomes one verified, reviewable PR |
| 4 | Clarification, PR babysitting, independent review, watchdog | Feedback and unfinished work are handled without duplicate actions |
| 5 | Scheduled ingestion, recurrence analysis, resource scheduling | Repeated signals and interrupted operation preserve correct state |
| 6 | Beta testing, release observation, production promotion | Only a qualified release can advance |
| 7 | Evaluated skill improvements and broader autonomy | A versioned change can be compared, promoted, and rolled back |

The original three-to-five-week estimate applies to the core local application. Re-estimate the expanded scope after proving the required native environment, browser authentication, and deployment integrations.

**Additional qualification scenarios**

- A clarification answer resumes the original task without duplicate posting.
- A human instruction takes precedence over a conflicting bot suggestion.
- An intentional approval wait receives no watchdog nudges.
- A missing authorized delivery step is detected and explained.
- A browser login handoff resumes from the correct checkpoint.
- Resource saturation prevents another browser task from starting.
- A recurring report is linked to the correct prior fix and release.
- A failed beta check prevents production promotion.
- A UI action and agent action enforce the same policy.
- A configuration proposal cannot expand its own authority.
- A promoted skill version can be rolled back without rewriting historical runs.

The expanded target is a factory that can **collect, clarify, reproduce, implement, verify, review, deliver, observe, investigate recurrence, and improve its own operating instructions**, with a usable local UI and explicit human control at each required decision.