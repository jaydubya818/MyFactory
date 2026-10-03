# User-supplied cloud mission attachments

Archived verbatim by attachment, in supplied order. This is requested scope, not implementation evidence. Numbering gaps and cut-off sections are retained rather than invented. The accompanying chat additionally supplies requirements 87–90, 125–142 and 684–702; see the source manifest for that distinction.


## Attachment 1: 8629684a-e950-45d5-9a12-bbb1e438563a

MYFACTORY CLOUD EXECUTION — LAPTOP-INDEPENDENT DIGITAL WORKER

DESIGN + IMPLEMENTATION + QUALIFICATION MISSION

Build the production cloud-execution architecture that allows Sofie/MyEve to continue substantial Work when Jay’s Mac is disconnected, asleep, closed, or powered off.

This is a launch-critical private-alpha capability.

The end state is:

Jay asks Sofie for an outcome → Sofie creates/routs Work → MyFactory executes it in an isolated cloud environment → DeepAgent or another qualified harness performs the work → candidate is independently verified → Result/Proof returns to Sofie → owner approves any external effect.

Jay’s laptop must NOT be required for ordinary autonomous MyFactory Work.

The Mac remains an optional Computer/execution target only for Work that genuinely requires:

* local files;
* local applications;
* local-only credentials;
* desktop interaction;
* owner-local resources.

⸻

1. PRODUCT REQUIREMENT

The defining acceptance criterion is:

Start Work through Sofie, disconnect/stop Jay’s Mac and all local MyFactory processes, and the Work continues to completion in the cloud.

This must include:

Sofie

→ Work

→ MyFactory

→ cloud sandbox

→ production harness

→ model/tools

→ implementation

→ tests

→ candidate

→ signed custody

→ protected independent verification

→ Result

→ Proof of Work

→ Sofie

→ Needs You when an external effect requires approval.

⸻

2. SOURCE AUTHORITY

Start from current canonical remote main for:

* MyEve;
* Relay;
* MyFactory.

Fetch before implementation and record exact SHAs.

Do NOT develop from historical Q37, Beta Integration, Product Expansion, local-access, or private-alpha branches.

Current canonical source is authoritative.

A separate workstream may continue Attempt-8 publication qualification concurrently.

Preserve and reconcile any canonical changes it lands.

Never reset or force-push canonical main.

⸻

3. ARCHITECTURAL PRINCIPLE

Separate these concepts:

MyFactory

owns governed Work execution lifecycle.

Execution Environment

determines where Work runs.

Harness

determines how an agent/model performs Work inside that environment.

Model Provider

determines which qualified model performs inference.

These must not be conflated.

Conceptually:

Work

→ MyFactory

→ ExecutionProvider

→ Sandbox

→ Harness

→ ModelProvider

→ Candidate

→ Verifier.

⸻

4. EXECUTION PROVIDER INTERFACE

Establish a canonical execution-provider abstraction.

Conceptually:

ExecutionProvider

must support operations equivalent to:

* prepare;
* start;
* status/read;
* cancel;
* collect artifacts;
* health;
* teardown;
* recover/reconcile.

Implementations should include:

CloudExecutionProvider

Default autonomous/background execution.

LocalExecutionProvider

Existing local path retained for qualification/development and Work that intentionally runs locally.

Do not make the rest of MyFactory care whether execution is local or cloud.

⸻

5. EXECUTION ROUTING

Add deterministic execution-environment selection.

Example classifications:

CLOUD

Default for:

* GitHub repositories;
* software implementation;
* research;
* artifact generation;
* evaluation;
* jobs using cloud-accessible services.

LOCAL_COMPUTER

Required only for:

* Mac filesystem resources not replicated to cloud;
* desktop applications;
* local browser/session;
* local-only credentials;
* explicit owner-local resources.

HUMAN

Requires owner action.

Model recommendation may inform routing.

Model output grants zero execution authority.

Trusted MyEve/MyFactory policy selects/admit the environment.

⸻

6. CLOUD SANDBOX

Each cloud Work/candidate attempt must execute in an isolated ephemeral sandbox.

Require:

* unique sandbox identity;
* Work binding;
* candidate-attempt binding;
* resource limits;
* filesystem isolation;
* process isolation;
* network policy;
* timeout/deadline;
* teardown;
* artifact extraction;
* zero implicit cross-Work state.

Prefer an existing infrastructure/provider already supported by the repository if present.

Do not introduce infrastructure merely because it is fashionable.

First inventory existing cloud/runtime capabilities.

⸻

7. SANDBOX LIFECYCLE

Canonical lifecycle:

ALLOCATING

→ PREPARING

→ READY

→ RUNNING

→ QUIESCING

→ COLLECTING

→ TERMINAL

→ DESTROYED.

Support terminal:

* SUCCESS;
* FAILED;
* CANCELLED;
* UNKNOWN.

Preserve canonical MyFactory Work/route/writer state rather than creating conflicting lifecycle authorities.

⸻

8. REPOSITORY MATERIALIZATION

For repository Work:

cloud sandbox must materialize the exact authorized repository/base revision.

Require:

repository identity

* base ref
* expected base SHA
* Work ID
* attempt ID.

Verify the checkout SHA before execution.

Do not silently execute against a moved base.

⸻

9. CANDIDATE ISOLATION

Changes remain inside the sandbox until candidate finalization.

No automatic:

* push;
* PR;
* merge;
* deployment;
* external publication.

Candidate production is not publication.

⸻

10. HARNESS ABSTRACTION

Establish:

HarnessProvider

or canonical equivalent.

It should support:

* start/resume;
* model interaction;
* client tools;
* checkpoint;
* completion;
* cancellation;
* evidence;
* health.

Do not hard-wire MyFactory’s lifecycle to one agent framework.

⸻

11. DEEPAGENT

Inventory the existing DeepAgent implementation and historical experiments.

Determine:

* actual current source;
* supported model interfaces;
* tool model;
* filesystem support;
* checkpointing;
* cancellation;
* streaming/events;
* context handling;
* recovery;
* security assumptions.

Implement:

DeepAgentHarness

behind the canonical Harness interface if qualification supports it.

Do not call DeepAgent production-ready merely because it executes a prompt.

⸻

12. EXISTING HARNESS

Preserve the currently qualified MyFactory harness as another implementation where practical.

This gives:

HarnessProvider

→ Existing qualified harness

→ DeepAgent.

MyFactory may qualify multiple harnesses.

No Work should silently switch harness mid-run.

⸻

13. FACTORY VERSION

Execution must pin:

* ExecutionProvider;
* sandbox/runtime image;
* HarnessProvider;
* harness version;
* model provider;
* exact model;
* tool set;
* skill set;
* context policy;
* verification policy;
* resource envelope.

Record these in immutable FactoryVersion/evidence.

⸻

14. MODEL PROVIDER

Preserve the qualified:

project-scoped Vercel OIDC

→ AI Gateway

→ provider/model

path.

No static OpenAI credential should need to move into the cloud sandbox if the canonical OIDC architecture can provide scoped inference access.

No silent model fallback.

⸻

15. CLOUD IDENTITY

Cloud Work receives a bounded runtime identity.

It must not inherit Jay’s full MyEve authority.

Identity should be scoped to:

* Work;
* FactoryVersion;
* attempt;
* permitted repositories;
* permitted tools/services;
* deadline.

Work identity expires/revokes after termination.

⸻

16. RELAY INTEGRATION

Use Relay as the governed capability fabric where appropriate.

Cloud workers may request authorized capabilities through Relay.

Do not distribute broad owner credentials into sandboxes.

Capability grants must be:

* explicit;
* scoped;
* expiring;
* auditable;
* revocable.

⸻

17. SECRET MODEL

Cloud sandbox must not receive unrestricted secrets by default.

Prefer:

identity/OIDC

→ capability broker

→ scoped access.

Where a secret is unavoidable:

* inject only at runtime;
* scope to Work;
* never persist into candidate;
* redact logs/evidence;
* revoke after Work.

⸻

18. NETWORK POLICY

Default cloud sandbox network policy should be bounded.

Allow only required destinations such as:

* model gateway;
* authorized source-control read endpoints;
* Relay/capability endpoints;
* explicitly authorized task destinations.

External writes remain separately governed.

⸻

19. CLIENT TOOLS

Cloud harness must support deterministic local/client tools for:

* filesystem;
* shell;
* tests;
* repository inspection;
* patching/editing;
* build commands.

Local client-tool execution does not automatically consume a model-operation slot.

Preserve the semantics qualified during Attempts 1–8.

⸻

20. PRODUCTIVE FEEDBACK LOOP

Preserve the now-qualified Factory loop:

Productive 1

→ implementation

→ host checkpoint/tests

→ bounded failure feedback if needed

→ Productive 2

→ host tests

→ completion eligibility.

Cloud execution must not regress this behavior.

⸻

21. COMPLETION

Preserve:

productive execution

→ executor stopped

→ scoped tree validation

→ immutable checked tree

→ protected read-only completion

→ exact-tree candidate commit.

Completion cannot mutate candidate source.

⸻

22. CANDIDATE CUSTODY

Candidate must leave sandbox through a controlled custody boundary.

Record:

* Work;
* attempt;
* repository;
* base SHA;
* candidate commit;
* tree SHA;
* changed files;
* producer;
* FactoryVersion;
* signatures/provenance.

Do not trust the sandbox’s statement that it produced a candidate.

Verify artifacts host-side.

⸻

23. PROTECTED VERIFICATION

Verification must execute independently from the producer harness.

Prefer a separate fresh sandbox.

Producer sandbox must not receive:

* protected tests;
* verifier prompts;
* holdout answers;
* acceptance results before candidate finalization.

Require:

candidate tree

→ independent verifier sandbox

→ Gate C

→ protected verification

→ Gate B/final acceptance semantics.

⸻

24. CLOUD VERIFIER

Implement/qualify cloud verifier execution independently of Jay’s laptop.

This is essential.

It is not sufficient for production to run in cloud while protected verification still depends on the Mac.

⸻

25. DURABLE EVENT LOG

Every cloud execution transition must be durably recorded.

Events should support reconstruction of:

* allocation;
* preparation;
* harness start;
* model operations;
* tool/checkpoint activity;
* candidate state;
* verification;
* cancellation;
* teardown.

A browser disconnect must not affect execution.

⸻

26. LEASE / HEARTBEAT

Cloud execution must use durable leases/heartbeats.

If worker disappears:

MyFactory must determine:

* still running;
* expired;
* recoverable;
* UNKNOWN;
* terminal.

No second worker may begin consequential execution while the first lease remains authoritative.

⸻

27. PROCESS LOSS

Test worker/process death during:

* PREPARE;
* productive operation;
* checkpoint;
* completion;
* artifact collection;
* verification.

Require safe reconciliation.

⸻

28. CONTROL-PLANE RESTART

Kill/restart MyFactory control plane while cloud execution continues.

On restart:

→ read durable state

→ reconcile provider

→ recover Current Truth

→ no duplicate Work

→ no duplicate writer

→ no duplicate model operation where canonical guarantees apply.

⸻

29. LAPTOP DISCONNECT TEST

This is P0.

Start real Work through Sofie.

After cloud execution is admitted:

stop the local MyFactory process

and

disconnect/stop Sofie Local / Mac companion.

Work must continue.

Require:

* productive execution continues;
* candidate produced;
* protected verification runs;
* Result reaches cloud MyEve;
* Proof available;
* owner can later reconnect and see Current Truth.

Local-process dependency count:

0

for this journey.

⸻

30. MAC OFFLINE FROM START

Second P0 test:

Start with Mac companion and all local Factory workers OFF.

From cloud/web Sofie:

request cloud-eligible Work.

Require successful cloud routing and completion.

⸻

31. LOCAL-ONLY WORK

Conversely prove:

Work requiring the Mac does NOT silently run in cloud.

Example:

“Read a file that exists only on my Mac.”

If Mac offline:

→ Needs You / Waiting for Computer

rather than cloud hallucination or unauthorized replication.

⸻

32. ROUTING UX

Owner should normally not choose:

local vs cloud.

Sofie/MyEve should communicate:

Working in cloud

or

Waiting for your Mac

when useful.

Advanced Proof can expose:

execution environment

harness

sandbox

FactoryVersion.

⸻

33. BACKGROUND WORK UX

Add/qualify owner-visible states:

Working

Waiting

Needs You

Verifying

Ready for review

Owner can close browser.

Reopening later reconstructs Current Truth from durable state.

⸻

34. NOTIFICATIONS

When cloud Work reaches:

* Needs You;
* Ready for review;
* Failed/Needs attention;

use configured MyEve proactive notification channels.

Do not require an open browser tab.

⸻

35. CANCELLATION

Owner can cancel background Work from MyEve.

Require:

MyEve cancellation

→ MyFactory

→ cloud provider

→ harness/process termination

→ authority fenced

→ sandbox teardown

→ Current Truth updated.

⸻

36. CLOUD RESOURCE ENVELOPE

Preserve bounded resources:

* model operations;
* candidate attempts;
* duration;
* CPU;
* memory;
* disk;
* network;
* model/resource ceiling.

Cloud availability must not mean unlimited execution.

⸻

37. COST ACCOUNTING

Extend Proof accounting to include:

* Sofie model spend;
* Factory model spend;
* cloud execution resource spend where measurable;
* verifier resource spend where measurable;
* total attributable journey cost.

Keep unknown/unavailable costs explicitly labeled rather than inventing zero.

⸻

38. UNKNOWN

Preserve canonical UNKNOWN semantics.

Ambiguous:

* provider execution;
* model operation;
* sandbox termination;
* artifact collection;
* external effect

must not be silently released/retried.

⸻

39. EXACTLY-ONCE CONSEQUENCES

Require:

duplicate cloud sandboxes may never produce duplicate authoritative candidates.

duplicate events must not produce duplicate:

* model operations where protected;
* candidate publication;
* PRs;
* external writes.

⸻

40. CLOUD PROVIDER ABSTRACTION

Do not unnecessarily lock MyFactory to one cloud runtime.

The initial provider may be one implementation.

Maintain an interface capable of future:

* managed sandbox provider;
* Kubernetes;
* container runner;
* VM runner;
* other qualified environments.

Do not implement all of these now.

⸻

41. INITIAL CLOUD PROVIDER SELECTION

Inventory the repository and current deployment infrastructure.

Select the simplest provider capable of:

* isolated execution;
* durable job identity;
* bounded runtime;
* logs/events;
* cancellation;
* artifact extraction


## Attachment 2: c357fe14-d0cd-4b26-bad4-186824513c5f

42. INITIAL CLOUD PROVIDER ACCEPTANCE CRITERIA

The initial CloudExecutionProvider must support:

* programmatic sandbox creation;
* unique sandbox/job identity;
* pinned runtime image/version;
* repository checkout/materialization;
* environment injection without secret disclosure;
* bounded CPU;
* bounded memory;
* bounded disk;
* execution deadline;
* process execution;
* stdout/stderr capture;
* durable status/readback;
* cancellation;
* artifact extraction;
* teardown;
* health/readiness;
* network restrictions where supported.

It must also be callable from the deployed MyFactory control plane without Jay’s Mac.

Prefer the smallest operational dependency that satisfies these requirements.

⸻

43. CLOUD RUNTIME IMAGE

Build a versioned MyFactory worker image.

It should contain only the runtime dependencies required for qualified Work, including where appropriate:

* Git;
* Node;
* package managers;
* Python;
* shell;
* MyFactory worker;
* qualified harnesses;
* client tools;
* test tooling.

Do not turn the image into an unbounded developer workstation.

Record image digest in FactoryVersion.

Never rely only on a mutable tag such as latest.

⸻

44. RUNTIME VERSIONING

Every execution must be reproducible from:

FactoryVersion

* ExecutionProvider
* runtime image digest
* Harness version
* repository/base SHA
* model route
* tool/skill versions
* context policy
* resource envelope.

Proof of Work must retain these identities.

⸻

45. WORKER BOOT PROTOCOL

Define a deterministic worker boot sequence:

1. acquire Work identity;
2. verify Work/attempt;
3. verify FactoryVersion;
4. establish bounded capability grants;
5. materialize repository;
6. verify base SHA;
7. initialize harness;
8. report READY;
9. wait for/start admitted execution.

Worker must not begin model execution merely because the container started.

⸻

46. WORKER CONTROL CHANNEL

MyFactory needs a durable authenticated control path to the cloud worker.

Support canonical commands equivalent to:

* PREPARE;
* START;
* STATUS/READ;
* CANCEL;
* QUIESCE;
* COLLECT;
* TERMINATE.

Commands must include:

* Work ID;
* attempt;
* generation;
* writer/lease identity;
* FactoryVersion;
* idempotency identity.

Stale commands must fail.

⸻

47. WORKER EVENT CHANNEL

Worker emits structured events rather than requiring log scraping.

Examples:

* worker_ready;
* harness_started;
* model_operation_reserved;
* model_operation_settled;
* tool_started;
* tool_finished;
* checkpoint_started;
* checkpoint_finished;
* productive_finished;
* completion_started;
* completion_finished;
* candidate_ready;
* worker_failed;
* worker_cancelled;
* worker_quiescent.

Events must be correlated to Work/attempt/generation.

⸻

48. EVENT IDEMPOTENCY

Every event must have a stable event ID.

Duplicate delivery must not duplicate state transitions.

Out-of-order events must not move Current Truth backward.

Test:

* duplicate event;
* delayed event;
* stale generation;
* replay after restart.

⸻

49. WORK QUEUE

Introduce or reuse a durable queue between admitted MyFactory Work and cloud execution.

Requirements:

* durable;
* Work/attempt scoped;
* idempotent delivery;
* lease-aware;
* cancellation-aware;
* observable.

Do not use an in-memory queue as production authority.

⸻

50. SCHEDULER

MyFactory cloud scheduler selects eligible admitted Work and available execution capacity.

Scheduler must not decide whether Work is authorized.

Authorization occurs before scheduling.

Scheduler handles:

* capacity;
* queue ordering;
* concurrency;
* worker allocation;
* retry/reconciliation policy where canonical.

⸻

51. CONCURRENCY

Define initial private-alpha concurrency explicitly.

Start conservatively.

Example:

* owner-level concurrent Factory Work limit;
* deployment-wide cloud worker limit;
* per-repository writer limit.

Do not optimize for massive scale during private alpha.

Make limits configurable and observable.

⸻

52. BACKPRESSURE

When cloud capacity is exhausted:

Work should become:

Waiting for execution capacity

rather than fail or silently start locally.

Owner UI should show the truthful state.

⸻

53. NO SILENT LOCAL FALLBACK

This is critical.

If Work is admitted for CLOUD and cloud execution is unavailable:

do NOT silently run it on Jay’s laptop.

Require explicit rerouting/re-admission if execution environment changes.

Likewise LOCAL_COMPUTER Work must not silently move to cloud.

⸻

54. ENVIRONMENT FAILOVER

Future architecture may support rerouting from one qualified cloud provider to another.

Do not implement automatic provider failover in V1 unless already supported safely.

For private alpha:

provider unavailable

→ Waiting/Needs attention

rather than ambiguous duplicate execution.

⸻

55. CLOUD WORKSPACE STORAGE

Treat worker filesystem as ephemeral.

Durable state belongs outside the worker.

Persist only required artifacts:

* candidate bundle;
* patches/diffs;
* test evidence;
* structured execution events;
* logs required for evidence;
* provenance.

Do not rely on a worker filesystem surviving termination.

⸻

56. ARTIFACT BUNDLE

Define a signed candidate artifact bundle containing:

* Work ID;
* attempt;
* repository;
* base SHA;
* candidate commit/tree;
* changed-file manifest;
* patch;
* implementation-visible test results;
* FactoryVersion;
* runtime image digest;
* harness identity;
* model identity;
* execution-environment identity;
* timestamps.

Candidate custody must validate this bundle independently.

⸻

57. ARTIFACT INTEGRITY

Hash artifacts before they leave the worker.

Recompute/verify after collection.

Require:

worker artifact hash

== collected artifact hash

== custody artifact hash.

Any mismatch:

fail closed.

⸻

58. LOGGING

Separate:

operational logs

from

evidence artifacts.

Logs may be ephemeral/retention-limited.

Evidence required for Result/Proof must be durable.

Never depend on raw logs as the only source of canonical truth.

⸻

59. REDACTION

Cloud logs/evidence must redact:

* bearer tokens;
* OIDC assertions;
* API keys;
* cookies;
* passwords;
* secret environment variables;
* private capability tokens.

Add automated secret-canary tests.

Require:

secret disclosure count = 0.

⸻

60. CLOUD CURRENT TRUTH

Extend Current Truth to understand cloud execution.

Owner-facing states should derive from canonical state, for example:

Queued

Starting cloud worker

Working

Running checks

Verifying

Needs You

Ready for review

Failed / Needs attention

Never derive owner-visible state merely from the last worker log line.

⸻

61. RESULT

Result must include execution-environment provenance.

Example advanced evidence:

* environment: cloud;
* provider;
* sandbox/job ID;
* runtime image;
* harness;
* model;
* candidate;
* verification.

Primary owner UI should remain simple.

⸻

62. PROOF OF WORK

Extend Proof with:

Execution

* environment;
* cloud provider;
* sandbox identity;
* harness;
* FactoryVersion.

Production

* repository/base;
* changed files;
* candidate;
* tests.

Verification

* verifier environment;
* protected checks;
* verdict.

Accounting

* Sofie;
* Factory model;
* cloud runtime;
* verifier;
* attributable total where available.

⸻

63. MYEVE UI — WORK DETAIL

Update Work detail to present:

Software Engineer

Working in cloud

rather than raw sandbox/provider terminology.

Suggested owner-facing timeline:

Received

→ Planning

→ Working

→ Running checks

→ Verifying

→ Ready for review.

Advanced details may expose:

execution environment

→ cloud provider

→ harness

→ model

→ sandbox/job ID.

⸻

64. TODAY

Cloud Work must appear in Today even when no browser session is active.

Sections should reflect real durable state:

Working

Waiting

Needs You

Recently completed.

⸻

65. DAILY BRIEF

Daily Brief should include autonomous cloud Work completed while owner was away.

Example:

While you were away

Software Engineer completed the checkout fix and MyEve independently verified it.

Needs you

Open the pull request?

⸻

66. UNIVERSAL INBOX

Cloud Work notifications/events may create or update canonical Inbox items.

Do not create duplicate Inbox items for every worker event.

Correlate them to the underlying Work.

⸻

67. NEEDS YOU

Background cloud Work should pause cleanly when owner authority is required.

Examples:

* publication;
* credential grant;
* scope expansion;
* ambiguous destructive action.

Owner response:

→ canonical decision

→ Work continues automatically if appropriate.

No manual "continue" message.

⸻

68. OWNER DISCONNECT

Explicitly test:

browser closes

→ Work continues.

User logs out

→ already-admitted Work continues according to its existing authority.

User later logs back in

→ Current Truth reconstructs accurately.

Logging out must not silently revoke already-admitted Work unless policy explicitly says so.

⸻

69. OWNER CANCELLATION WHILE OFFLINE

When owner reconnects and cancels:

cancellation must propagate to the cloud worker.

If worker is already terminal, cancellation must not rewrite historical truth.

⸻

70. DEPLOYMENT RESTART

Redeploy MyEve while cloud Work runs.

Work must continue.

MyEve restart:

→ reconnect/reconcile

→ Current Truth restored.

⸻

71. MYFACTORY RESTART

Restart MyFactory control plane during cloud Work.

Cloud worker continues where policy permits.

Control plane returns:

→ lease/event reconciliation

→ exactly one authoritative execution.

⸻

72. RELAY RESTART

If cloud Work uses Relay capabilities:

restart Relay.

Require bounded recovery without duplicate external effects.

⸻

73. CLOUD WORKER RESTART

Determine whether initial provider supports worker restart/resume.

If not:

fail/reconcile honestly.

Do not pretend resumability exists.

V1 may choose:

worker death

→ attempt failed/UNKNOWN

rather than unsafe transparent reconstruction.

Document exact semantics.

⸻

74. SANDBOX TEARDOWN

Teardown must occur after:

* success;
* failure;
* cancellation;
* timeout;
* verification completion.

Measure leaked sandboxes.

Target:

leaked terminal sandboxes = 0.

Reaper/reconciliation may clean stranded resources.

⸻

75. SANDBOX REAPER

Implement or reuse a bounded reconciliation/reaper process.

It may terminate sandboxes only when canonical state proves they are expired/orphaned according to policy.

Never destroy an authoritative active worker merely because a local process cannot see it momentarily.

⸻

76. QUOTAS

Private-alpha quotas should include:

* maximum simultaneous cloud workers;
* maximum Work duration;
* maximum model operations;
* maximum candidate attempts;
* disk;
* CPU/memory;
* optional daily resource ceiling.

Exceeding quota:

→ Waiting/denied

rather than unbounded consumption.

⸻

77. PROVIDER OUTAGE

Test cloud provider outage before allocation:

Work stays Waiting/Needs attention.

Test outage after allocation:

reconcile actual provider state.

Do not create a second sandbox until authority for the first is conclusively terminal.

⸻

78. MODEL PROVIDER OUTAGE

Preserve the Attempt-4/UNKNOWN lessons.

429/500/503/timeouts must respect:

* accounting;
* operation limits;
* no silent fallback;
* UNKNOWN where ambiguity exists;
* completion reserve.

⸻

79. SOURCE CONTROL OUTAGE

If repository checkout fails:

fail before productive execution.

If publication fails later:

retain verified candidate and Needs You/Needs attention state.

Never regenerate merely because GitHub is unavailable.

⸻

80. VERIFIER OUTAGE

Candidate may exist while verification is unavailable.

State:

Waiting for verification

Ready remains false.

Do not publish as verified.

⸻

81. CLOUD EXECUTION SECURITY TESTS

Add negative qualification for:

* cross-Work filesystem access;
* environment-secret enumeration;
* metadata-service access where relevant;
* unauthorized network destination;
* unauthorized repository;
* stale Work token;
* expired capability grant;
* attempt reuse;
* sandbox identity spoofing;
* artifact tampering.

⸻

82. PROMPT-INJECTION BOUNDARY

Repository content is untrusted.

README/source/tests may contain instructions attempting to:

* reveal credentials;
* change authority;
* bypass verification;
* publish externally;
* contact arbitrary services.

Repository text must never grant capability.

Add malicious-repository fixtures.

⸻

83. REPOSITORY NETWORK REQUESTS

Tests/build scripts are also untrusted.

Cloud execution must not implicitly grant unrestricted network access because npm test or another build script requests it.

Define network behavior explicitly.

⸻

84. BUILD SCRIPT SAFETY

Treat repository scripts as code execution inside the sandbox, not trusted host execution.

They must never execute on MyFactory control-plane hosts.

⸻

85. HOST BOUNDARY

MyFactory control plane must not execute arbitrary candidate repository commands directly.

All untrusted repository execution occurs inside qualified execution/verifier sandboxes.

⸻

86. VERIFIER SEPARATION

Producer and verifier should not share:

* mutable filesystem;
* process namespace;
* hidden verifier material;
* writer credentials.

Candidate artifacts are the bridge.

⸻

87. DEEPAGENT QUALIFICATION MATRIX

Before making DeepAgent the default cloud harness, qualify:


## Attachment 3: f62f9ccc-d0da-40d9-9bf1-72a3f53797ba

MYFACTORY CLOUD EXECUTION — LAPTOP-INDEPENDENT DIGITAL WORKER

DESIGN + IMPLEMENTATION PLAN — CONTINUED

⸻

91. CONTEXT ASSEMBLY

Cloud execution must preserve the context-quality improvements qualified during private-alpha Attempts 4–8.

Before the first productive model operation, MyFactory should deterministically assemble bounded, task-relevant context.

Context may include:

* Work objective;
* acceptance criteria;
* repository identity;
* exact base SHA;
* target files;
* relevant source;
* implementation-visible tests;
* package/runtime metadata;
* neighboring implementation patterns;
* approved skills;
* bounded prior Work context where authorized.

Do not dump the entire repository into the model.

Context selection must be deterministic, bounded and evidence-producing.

Protected verification material must never enter producer context.

⸻

92. IMPLEMENTATION-VISIBLE TESTS

Preserve the distinction established during Attempt 7:

PUBLIC / IMPLEMENTATION-VISIBLE CONTRACT

The producer may see:

* public specifications;
* public examples;
* repository tests intended for implementation;
* documented serialization requirements;
* build/type/lint contracts.

PROTECTED VERIFICATION

The producer may NOT see:

* holdout inputs;
* hidden expected outputs;
* verifier prompts;
* independent-review reasoning;
* protected acceptance fixtures.

Require:

protected holdout leakage = 0.

⸻

93. INNER ENGINEERING LOOP

Preserve the qualified engineering loop:

context

→ PRODUCTIVE 1

→ implementation/tools

→ host checkpoint

→ implementation-visible tests

→ if PASS, completion eligibility

→ if FAIL and repair capacity remains, bounded failure feedback

→ PRODUCTIVE 2

→ repair

→ host checkpoint

→ tests

→ completion eligibility or fail closed.

Testing is a host responsibility at the checkpoint.

Do not rely on the model voluntarily deciding when to run the correct tests.

⸻

94. BOUNDED FAILURE FEEDBACK

When implementation-visible checks fail, provide the repair model only bounded deterministic feedback.

Include where useful:

* command executed;
* exit status;
* pass/fail counts;
* failed test names;
* concise failure excerpts;
* expected/actual values;
* relevant compiler/linter diagnostics.

Exclude:

* credentials;
* unrelated logs;
* protected verifier information;
* hidden acceptance data.

Test feedback grants zero additional authority.

⸻

95. PRODUCTIVE CAPACITY

Cloud execution must preserve productive-capacity invariants.

Do not consume productive model operations merely for:

* repository listing;
* reading files;
* deterministic test execution;
* artifact hashing;
* status polling.

These should primarily use client/local tools.

Model operations are for reasoning and productive decision-making.

⸻

96. EARLY SUCCESS

If PRODUCTIVE 1 produces a correct implementation and host checks PASS:

do not consume PRODUCTIVE 2 for ceremony.

Transition directly toward completion.

Record unused productive capacity honestly.

⸻

97. REPAIR FAILURE

If PRODUCTIVE 2 still fails implementation-visible checks:

completion must be denied.

Preserve:

* failed workspace evidence;
* test results;
* accounting;
* Current Truth.

Fence execution authority.

Do not automatically create another candidate attempt.

⸻

98. COMPLETION PHASE

Preserve the qualified distinction:

PRODUCTIVE

may modify candidate source.

COMPLETION

is read-only with respect to candidate source.

Before completion:

* productive executor stopped;
* process group absent;
* Work generation current;
* writer valid;
* changes within scope;
* implementation-visible checks PASS;
* immutable tree captured;
* completion reservation available.

Then admit at most one completion operation.

⸻

99. EXACT-TREE INVARIANT

The tree that passes host checks must be the tree that becomes the candidate.

Require:

checked tree == completed tree == candidate tree.

Any mutation after protected pre-completion checks invalidates eligibility.

⸻

100. CANDIDATE COMMIT

Prefer host-side candidate commit after successful completion.

The harness/model must not receive unrestricted Git publication authority.

Candidate commit should contain:

* only authorized files;
* exact checked tree;
* deterministic metadata where canonical.

Candidate commit is still private.

It does not imply publication.

⸻

101. PUBLICATION BOUNDARY

Cloud execution must preserve the Attempt-8 owner/publication boundary.

Candidate production:

does not

→ push branch

→ create PR

→ merge

→ deploy.

Those remain separate owner-authorized external effects.

⸻

102. CLOUD PUBLICATION

Once separately approved, publication should not require Jay’s Mac.

The cloud control plane should be able to publish the already-verified candidate through scoped source-control authority.

Require:

verified candidate

→ owner approval

→ exact-tree guard

→ one branch push

→ one PR

→ CI/readback.

No local laptop dependency.

⸻

103. PUBLICATION IDENTITY

Use a bounded service identity or Relay/source-control capability.

Do not inject Jay’s broad personal GitHub credentials into the worker sandbox.

Publication identity must be scoped to required repositories/actions.

⸻

104. EXACT PUBLICATION GUARD

Before publication require:

* candidate commit matches custody;
* candidate tree matches verified tree;
* repository matches Work;
* base ref matches qualified base;
* expected base SHA unchanged;
* owner approval current;
* candidate not rejected;
* verification still valid.

If any check fails:

publication denied.

⸻

105. GITHUB CI

Publication should transition Work into:

Waiting for CI

when applicable.

Observe:

* workflow identity;
* candidate SHA;
* check status;
* conclusion.

CI result becomes evidence.

CI does not replace protected MyFactory verification.

⸻

106. INDEPENDENT REVIEW

Support independent post-publication review where canonical policy requires it.

Review must inspect the exact published candidate.

Reviewer may not silently mutate it.

Required changes create a new candidate lifecycle.

⸻

107. OWNER ACCEPTANCE

Verification, publication, CI and review do not automatically equal owner acceptance.

Owner acceptance is a separate durable decision.

Support:

* accept;
* reject;
* request changes;
* keep private.

⸻

108. BACKGROUND APPROVAL

If cloud Work reaches an approval boundary while Jay is offline:

execution pauses safely.

Notify through configured MyEve channels.

Owner may return hours later.

Approval must remain bound to:

* Work;
* candidate;
* revision/generation;
* requested effect.

⸻

109. STALE APPROVAL

If Work/candidate changes after approval was requested:

old approval becomes stale.

Do not apply approval to a successor candidate.

⸻

110. AGENT-TO-AGENT CLOUD WORK

Relay federation should allow another authorized MyEve/agent to request bounded Work from Sofie/MyFactory where policy permits.

Example:

Agent A

→ Relay

→ Sofie

→ MyFactory cloud Work

→ Result

→ Relay

→ Agent A.

Agent A’s request grants no owner authority by itself.

⸻

111. SPECIALISTS

Persistent MyEve specialists may delegate eligible production Work to MyFactory.

Specialist identity must be preserved in provenance.

Specialist cannot exceed capabilities granted by the owner.

⸻

112. CLOUD COMPUTER VS OWNER COMPUTER

Treat these as separate concepts.

Cloud Sandbox Computer

ephemeral environment owned by MyFactory Work.

Owner Computer

Jay’s Mac/paired machine.

A cloud worker must never assume access to the Owner Computer.

Explicit routing/capability is required.

⸻

113. CROSS-ENVIRONMENT WORK

Avoid V1 Work that simultaneously mutates cloud and owner-local environments unless a canonical orchestration contract already supports it.

Prefer decomposing:

local evidence/input

→ durable artifact

→ cloud Work.

This reduces split-brain execution.

⸻

114. FILE TRANSFER

If owner-authorized local files are needed in cloud Work:

transfer must be explicit and scoped.

Record:

* source;
* Work;
* hash;
* destination artifact;
* authorization.

Do not automatically mirror Jay’s filesystem into cloud sandboxes.

⸻

115. PRIVATE DATA

Owner-private Memory/Files may enter cloud Work only under appropriate Work-scoped authority.

Work-scoped access does not promote private data to shared/global Memory.

Artifacts must retain scope/provenance.

⸻

116. TWO-OWNER BUSINESS SCOPE

Cloud Work must preserve the canonical private/shared model:

OWNER_PRIVATE

BUSINESS_SHARED

WORK_SCOPED

Cloud execution must not collapse these scopes.

Cross-owner private disclosure target:

0.

⸻

117. MULTI-TENANCY

Private alpha is two trusted business partners.

Do not overbuild enterprise multi-tenancy.

But sandbox, identity, storage and capability boundaries must not assume a single global owner.

⸻

118. OBSERVABILITY

Every cloud Work should have one correlation identity spanning:

MyEve conversation

→ Work

→ route

→ Factory execution

→ sandbox

→ harness

→ model operations

→ candidate

→ verifier

→ Result.

This is essential for debugging.

⸻

119. TRACES

Emit structured traces for:

* queue delay;
* allocation;
* sandbox startup;
* repository checkout;
* context assembly;
* productive calls;
* tools;
* tests;
* repair;
* completion;
* custody;
* verification;
* teardown.

Avoid storing secrets/prompts containing unauthorized private material.

⸻

120. METRICS

Track at minimum:

* Work success rate;
* candidate success rate;
* verification pass rate;
* time to first worker;
* total Work duration;
* productive operations;
* repair rate;
* cloud worker failures;
* UNKNOWN rate;
* cancellation latency;
* leaked sandbox count;
* cost per Work;
* avoidable coordination debt.

⸻

121. CLOUD EXECUTION DASHBOARD

Add an operator/developer view for private alpha.

Show:

* queued Work;
* running workers;
* environment/provider;
* harness;
* duration;
* operation usage;
* resource envelope;
* Current Truth;
* cancellation;
* failed/UNKNOWN workers;
* sandbox teardown.

Keep this separate from the simpler owner UI.

⸻

122. OWNER UI

Owner should see:

Sofie is working

Software Engineer is working in the cloud

Running checks

Verifying

Ready for review

rather than infrastructure internals.

⸻

123. LIVE ACTIVITY

Work detail may stream bounded progress events.

Do not expose raw chain-of-thought or hidden reasoning.

Show meaningful actions:

* reviewing repository;
* implementing;
* running tests;
* repairing;
* verifying.

⸻

124. RECONNECT

Owner browser reconnect must query durable Current Truth.

It must not depend on replaying a lost websocket stream.


## Attachment 4: d1db59e5-57e9-453b-ae0c-2410d1cc1213

142. LIVE CLOUD CANARY — CONTINUED

Maintain one small bounded live cloud Work.

It should prove:

real Sofie

→ cloud MyFactory

→ real cloud sandbox

→ real production harness

→ real model through qualified OIDC/Gateway path

→ implementation

→ implementation-visible checks

→ protected completion

→ exact-tree candidate

→ separate cloud verifier

→ Result

→ Proof

→ final Sofie explanation.

Keep the canary:

* inexpensive;
* deterministic in objective;
* non-destructive;
* non-publishing by default;
* bounded by the same production authority model.

Do not make every PR execute the paid live canary.

⸻

143. LIVE LAPTOP-INDEPENDENCE CANARY

Create a second release-level qualification specifically proving laptop independence.

Before starting:

* local MyFactory worker OFF;
* Sofie Local/Mac companion OFF;
* no local repository checkout used by execution;
* no local verifier running.

Start the Work from the deployed MyEve web UI.

After admission, verify cloud execution identity.

Then require:

candidate

→ verification

→ Result

→ Proof

without any local process becoming involved.

Evidence must explicitly list all execution environments.

Require:

local execution dependencies = 0.

⸻

144. LAPTOP CLOSED ACCEPTANCE TEST

The ultimate private-alpha acceptance test is behavioral:

1. Jay starts Work through Sofie.
2. Cloud routing/admission succeeds.
3. Jay closes the browser.
4. Jay’s Mac is disconnected or the local companion is deliberately stopped.
5. MyFactory continues.
6. Producer completes.
7. Independent cloud verification completes.
8. Result/Proof persist.
9. Jay reconnects later.
10. Sofie shows what happened while he was away.

No manual intervention between steps 4 and 8.

This is a P0 release gate.

⸻

145. BACKGROUND DURATION

Qualify Work lasting longer than a normal browser/server request.

At minimum test:

* several minutes;
* browser disconnect;
* frontend redeployment;
* control-plane restart where architecture permits.

The Work lifecycle must not depend on a long-lived HTTP request.

⸻

146. ASYNCHRONOUS CONTROL MODEL

Cloud execution must be asynchronous.

Browser/API request should:

submit/admit Work

→ return durable Work identity/state.

Execution continues independently.

Do not hold a frontend request open for the entire Factory run.

⸻

147. DURABLE COMMANDS

Commands between MyFactory and cloud workers must survive:

* process restart;
* transient network interruption;
* duplicate delivery.

Every consequential command requires stable idempotency identity.

⸻

148. DURABLE RESULTS

Worker results must be durably persisted before owner-facing completion is claimed.

A successful model response existing only in worker memory is not a Result.

⸻

149. HEARTBEAT SEMANTICS

Define:

* heartbeat interval;
* lease duration;
* grace period;
* reconciliation behavior.

Missing one heartbeat must not immediately create a second worker.

Expired lease must not automatically release ambiguous paid/external effects.

⸻

150. LEASE FENCING

Every authoritative worker mutation must prove current lease/writer ownership.

Once fenced:

old worker cannot:

* emit authoritative candidate;
* mutate Work;
* settle new operations;
* publish;
* overwrite Result.

Test a zombie worker explicitly.

⸻

151. ZOMBIE WORKER TEST

Scenario:

worker A loses connectivity

→ authority eventually fenced

→ canonical reconciliation occurs

→ worker A reconnects late.

Require all stale mutations from A to be denied.

⸻

152. CLOCK / DEADLINE

Deadline enforcement belongs to trusted infrastructure.

Worker/model cannot extend its own deadline.

Record:

admitted deadline

* execution start
* terminal time.

⸻

153. CLOUD TIMEOUT

On deadline:

→ stop new model/tool operations

→ cancel worker

→ fence authority

→ collect safe evidence where possible

→ teardown

→ update Current Truth.

Do not silently convert timeout into success.

⸻

154. OPERATION LEDGER

Preserve durable per-Work operation accounting in cloud execution.

Each model operation should have:

* operation ID;
* Work;
* attempt;
* phase;
* model;
* reservation;
* settlement;
* status;
* timestamps.

⸻

155. PHASE ACCOUNTING

Distinguish:

SOFIE

PRODUCTIVE

COMPLETION

VERIFICATION, if verifier uses model resources.

Do not flatten all model usage into one ambiguous count.

⸻

156. CLOUD RESOURCE ACCOUNTING

Add runtime accounting where available:

* sandbox duration;
* CPU allocation;
* memory allocation;
* storage;
* network;
* provider charges.

If provider cost cannot be known exactly:

report:

UNKNOWN / unavailable

rather than $0.

⸻

157. BUDGET POLICY

Model/resource budget must be admitted before execution.

Cloud worker cannot increase it.

Owner may explicitly authorize expansion through a new canonical decision where product policy allows.

No automatic budget escalation.

⸻

158. COST UX

Owner-facing Result should summarize:

Model cost

Cloud execution cost

Total known cost

where available.

Keep detailed reservations/settlements in Proof.

⸻

159. FAILURE TAXONOMY

Standardize cloud failures:

USER_INPUT

AUTHORIZATION

CAPACITY

SOURCE

SANDBOX

HARNESS

MODEL

IMPLEMENTATION

VERIFICATION

PUBLICATION

UNKNOWN

Owner-facing copy should be simpler than internal classification.

⸻

160. RETRY TAXONOMY

Do not use a generic retry loop.

Define per failure class:

* retryable automatically;
* retryable only with reconciliation;
* requires owner;
* terminal;
* UNKNOWN.

Preserve the private-alpha principle:

ambiguity does not create new authority.

⸻

161. INFRASTRUCTURE RETRIES

Safe infrastructure operations such as status reads may retry.

Consequential operations require idempotency/reconciliation.

Model calls must obey operation accounting.

Candidate attempts must obey attempt accounting.

⸻

162. QUEUE DELIVERY RETRIES

Queue redelivery must not create:

* second worker authority;
* second model operation;
* second candidate.

Redelivery should reconcile existing state first.

⸻

163. MODEL REQUEST IDEMPOTENCY

Where provider semantics support idempotency, use it.

Where they do not, preserve UNKNOWN on ambiguous completion rather than assuming failure.

⸻

164. CANDIDATE IDEMPOTENCY

Candidate identity should be deterministic/bound to:

Work

* attempt
* checked tree
* FactoryVersion.

Repeated collection must return the same candidate identity rather than create another authoritative candidate.

⸻

165. VERIFICATION IDEMPOTENCY

Repeated readback of verification must not rerun protected verification unless explicitly scheduled as a new verification run.

Distinguish:

READ verification

from

RUN verification.

⸻

166. CURRENT TRUTH RECONCILER

Implement or extend a reconciler that compares:

* canonical database state;
* queue state;
* cloud-provider state;
* worker lease;
* candidate custody;
* verifier state.

It should derive Current Truth without inventing success.

⸻

167. RECONCILIATION SCHEDULE

Run reconciliation:

* on control-plane startup;
* on worker timeout;
* on suspicious event gap;
* periodically for active Work;
* on operator request.

Avoid excessive polling.

⸻

168. OPERATOR RECOVERY

Provide bounded operator actions:

* reconcile;
* cancel;
* fence;
* inspect evidence;
* teardown confirmed orphan.

Avoid:

* “mark successful”;
* arbitrary state editing;
* bypass verification.

⸻

169. ADMIN UI

Private-alpha operator UI should make stuck Work diagnosable.

Show:

* Work;
* route;
* writer;
* cloud worker;
* lease;
* last heartbeat;
* operations;
* sandbox;
* candidate;
* verifier;
* Current Truth.

Keep secrets hidden.

⸻

170. DEAD-LETTER / QUARANTINE

Irreconcilable execution events should enter a quarantine/dead-letter state for operator inspection.

Do not discard them.

Do not automatically replay consequential events.

⸻

171. CLOUD SANDBOX SECURITY BASELINE

Establish baseline:

* non-root where practical;
* minimal image;
* read-only base filesystem where practical;
* writable Work workspace only;
* no Docker socket;
* no host filesystem mount;
* no broad cloud metadata access;
* bounded network;
* resource limits;
* ephemeral identity.

⸻

172. DEPENDENCY INSTALLATION

Repository dependency installation executes inside sandbox.

Treat install scripts as untrusted.

Consider:

* network restrictions;
* lockfile enforcement where appropriate;
* package-manager cache isolation;
* install timeout.

Do not run install hooks on control-plane hosts.

⸻

173. PACKAGE CACHE

Performance caches may be used only if they do not allow cross-Work mutation/data leakage.

Prefer content-addressed/read-only caches.

Qualification must prove isolation.

⸻

174. SOURCE CACHE

Repository mirrors/caches may improve startup.

Worker must still verify exact requested base SHA.

Cache state is not source authority.

⸻

175. RUNTIME IMAGE SUPPLY CHAIN

Pin worker image by immutable digest.

Record build provenance where available.

Scan dependencies/images according to existing project security tooling.

FactoryVersion must identify exact digest.

⸻

176. CLOUD REGION

Select an initial region close to primary services/data where practical.

Do not introduce multi-region execution for private alpha unless required.

Record region in execution evidence.

⸻

177. DATA RESIDENCY

Document what data enters the cloud sandbox:

* repository source;
* Work context;
* authorized artifacts;
* model prompts;
* test output.

Document retention/teardown behavior.

⸻

178. SANDBOX RETENTION

Default:

destroy terminal sandbox after required artifacts/evidence are safely collected.

Debug retention, if supported, must be explicit, time-limited and access-controlled.

⸻

179. EVIDENCE RETENTION

Preserve enough evidence to reconstruct:

what ran

→ where

→ with which authority

→ against which source

→ producing which candidate

→ verified how.

Do not preserve unnecessary secrets/raw private data.

⸻

180. CLOUD PROVIDER CREDENTIALS

Control-plane credentials for cloud provider must live in approved deployment secret storage.

Worker should receive short-lived scoped identity where supported.

Never bake provider credentials into images.

⸻

181. PROVIDER PERMISSION SCOPE

Cloud control plane should receive only permissions required to:

* create/read/cancel/destroy workers;
* retrieve required artifacts/log metadata.

It should not receive unrelated infrastructure-admin authority.

⸻

182. OIDC-FIRST

Prefer workload identity/OIDC for:

* model gateway;
* cloud runtime;
* artifact store;
* source-control access

where supported and qualified.

Reduce long-lived static credentials.

⸻

183. RELAY CAPABILITY TOKENS

If Relay grants capabilities to a worker:

token must bind:

* worker;
* Work;
* attempt;
* capability;
* expiry.

Worker cannot transfer that authority to another Work.

⸻

184. SOURCE-CONTROL READ ACCESS

For private repositories, use scoped read access for repository materialization.

Producer sandbox does not need publication/write access.

Keep publication identity separate.

⸻

185. PRODUCER / PUBLISHER SEPARATION

This is a critical security boundary.

Producer

can create candidate artifacts.

Publisher

can perform separately approved GitHub effects.

Producer credentials must not inherently allow publication.

⸻

186. PRODUCER / VERIFIER SEPARATION

Producer identity cannot:

* modify verifier;
* read holdout material;
* approve itself;
* alter protected verdict.

⸻

187. VERIFIER IDENTITY

Verifier receives:

* candidate artifact;
* verification policy;
* protected tests/material.

It does not receive producer write authority.

⸻

188. PUBLISHER IDENTITY

Publisher receives:

* exact verified candidate;
* exact approved effect;
* bounded repository grant.

It does not receive authority to regenerate candidate source.

⸻

189. TRUST BOUNDARIES DOCUMENT

Create a dedicated architecture document describing:

1. Owner/MyEve boundary.
2. MyEve/MyFactory boundary.
3. MyFactory/cloud provider boundary.
4. Control plane/worker boundary.
5. Worker/model boundary.
6. Producer/custody boundary.
7. Custody/verifier boundary.
8. Result/owner approval boundary.
9. Approval/publisher boundary.

Include data and authority crossing each boundary.

⸻

190. THREAT MODEL

Document at least:

* malicious repository;
* prompt injection;
* compromised worker;
* stale worker;
* duplicate queue event;
* provider ambiguity;
* artifact tampering;
* secret exfiltration;
* unauthorized publication;
* cross-owner disclosure;
* verifier contamination.

Map each to controls/tests.

⸻

191. PHASE 0 — INVENTORY / DESIGN

Before major implementation:

inventory current canonical code for:

* MyFactory executor;
* DeepAgent;
* sandbox providers;
* Docker/container support;
* queues;
* worker protocol;
* Relay;
* OIDC;
* artifact storage;
* verification;
* deployment environment.

Produce a concrete architecture decision record.

Do not spend a week designing abstractions already present in the repository.

⸻

192. PHASE 0 DELIVERABLE

Commit:

docs/architecture/cloud-execution.md

or repository-consistent equivalent.

Include:

* current state;
* target state;
* provider selection;
* interfaces;
* trust boundaries;
* lifecycle;
* migration strategy;
* qualification plan;
* known limitations.

⸻

193. PHASE 1 — EXECUTION PROVIDER

Implement canonical ExecutionProvider and adapt existing local execution behind it.

Acceptance:

existing local Factory regressions remain PASS.

This proves the abstraction does not break current behavior.

⸻

194. PHASE 2 — CLOUD SANDBOX

Implement CloudExecutionProvider with:

* allocation;
* preparation;
* status;
* cancellation;
* artifact collection;
* teardown.

Initially run deterministic commands only.

Do not introduce real model execution yet.

⸻

195. PHASE 2 ACCEPTANCE

Prove:

Work

→ cloud sandbox

→ exact repository checkout

→ deterministic command

→ artifact

→ teardown.

Mac/local Factory OFF.

⸻

196. PHASE 3 — CLOUD HARNESS

Run the existing qualified harness in cloud first unless DeepAgent has already passed the required matrix.

Preserve:

productive/checkpoint/repair/completion semantics.

Use deterministic model fixture initially.

⸻

197. PHASE 4 — DEEPAGENT

Implement/qualify DeepAgentHarness behind HarnessProvider.

Compare it against the existing harness.

Do not block cloud launch on DeepAgent if the existing harness can safely deliver laptop independence sooner.

⸻

198. PHASE 5 — CLOUD VERIFIER

Move protected verification into an independent cloud sandbox.

Prove producer and verifier separation.

This phase is required before


## Attachment 5: 39174ed4-1c41-4678-b44a-04f256322be5

198. PHASE 5 — CLOUD VERIFIER — CONTINUED

Move protected verification into an independent cloud sandbox.

Prove producer and verifier separation.

This phase is required before declaring MyFactory fully laptop-independent.

Acceptance:

producer sandbox

→ candidate artifact

→ producer destroyed/fenced

→ independent verifier sandbox allocated

→ exact candidate materialized

→ protected verification

→ verdict

→ verifier teardown.

Require:

producer access to protected material = 0

verifier producer-write authority = 0.

⸻

199. PHASE 6 — DURABLE CLOUD CONTROL PLANE

Remove remaining dependencies on a locally running MyFactory supervisor.

Deploy the authoritative MyFactory control plane in cloud infrastructure.

It must own:

* admitted Work;
* execution queue;
* leases;
* worker allocation;
* reconciliation;
* cancellation;
* candidate custody;
* verifier dispatch;
* Result production.

Local MyFactory becomes a development/test execution mode, not the production control plane.

⸻

200. PHASE 6 ACCEPTANCE

With all local MyFactory processes stopped:

MyEve

→ MyFactory cloud control plane

→ cloud worker

→ candidate

→ cloud verifier

→ Result.

Require:

local MyFactory dependencies = 0.

⸻

201. PHASE 7 — REAL MODEL

Enable the already-qualified:

Vercel project OIDC

→ AI Gateway

→ exact pinned model

path inside cloud execution.

Use the same model-reference contract qualified during private-alpha Attempts 3–8.

No fallback.

Start with one bounded canary Work.

⸻

202. PHASE 7 ACCEPTANCE

Prove:

real model

→ cloud harness

→ implementation

→ host checkpoint

→ tests

→ optional repair

→ completion

→ candidate.

No laptop involvement.

⸻

203. PHASE 8 — RESULT / PROOF

Extend Result and Proof for cloud provenance and accounting.

Qualify:

candidate

→ custody

→ verification

→ canonical Result

→ Proof

→ final Sofie explanation.

Result must be durable before the worker/sandbox disappears.

⸻

204. PHASE 9 — OWNER APPROVAL / PUBLICATION

Integrate the real production owner-decision UI.

Verified cloud candidate

→ Needs You

→ owner chooses:

* Open a pull request;
* Push branch only;
* Keep private;
* Reject candidate.

Publication runs from cloud infrastructure.

Jay’s Mac remains unnecessary.

⸻

205. PHASE 10 — LAPTOP-INDEPENDENCE GOLDEN JOURNEY

Run the definitive acceptance journey.

Conditions before start:

* Sofie Local OFF;
* Mac companion OFF;
* local MyFactory OFF;
* local verifier OFF;
* no local repository workspace used.

From the deployed Sofie web UI:

owner sends a natural-language software request.

Require:

Sofie

→ Work

→ CLOUD route

→ MyFactory cloud control plane

→ cloud worker

→ harness

→ real model

→ implementation

→ tests

→ completion

→ candidate

→ independent cloud verifier

→ Result

→ Proof

→ Sofie.

Then owner may separately approve publication.

⸻

206. PHASE 10 CRITICAL ASSERTION

During the Golden Journey, intentionally verify that:

localhost

Jay's Mac

local Docker

local MyFactory

local verifier

local repository checkout

are not execution dependencies.

Evidence must demonstrate this rather than infer it.

⸻

207. PHASE 11 — BROWSER DISCONNECT

Repeat cloud Golden Journey with browser closed after Work admission.

Reopen later.

Require:

Current Truth reconstructed

→ Result available

→ Proof available.

⸻

208. PHASE 12 — CONTROL-PLANE RECOVERY

During active cloud Work:

restart MyFactory control plane.

Require:

cloud worker remains authoritative where canonical

→ control plane returns

→ reconciles

→ no duplicate execution.

⸻

209. PHASE 13 — CLOUD WORKER FAILURE

Kill worker during productive execution.

Qualify:

lease/reconciliation

→ canonical failed/UNKNOWN behavior

→ authority fencing

→ teardown

→ truthful Result/Current Truth.

Do not optimize for transparent recovery until correctness is established.

⸻

210. PHASE 14 — VERIFIER FAILURE

Producer succeeds.

Cloud verifier fails or becomes unavailable.

Require:

candidate retained

→ Ready false

→ Waiting for verification / Needs attention

→ no publication as verified.

⸻

211. PHASE 15 — CLOUD CANCELLATION

Owner cancels Work while cloud worker is active.

Require:

cancellation command

→ worker termination

→ authority fence

→ sandbox teardown

→ Current Truth update

→ no candidate publication.

⸻

212. PHASE 16 — OWNER OFFLINE

Start Work.

Owner closes browser and disconnects Mac.

Work reaches Needs You.

Require:

safe pause

→ durable decision request

→ notification

→ no unauthorized external effect.

Owner reconnects and responds.

Work continues where canonical.

⸻

213. PHASE 17 — MULTIPLE CLOUD WORK

Run two independent bounded cloud Works concurrently.

Prove:

* distinct sandboxes;
* distinct identities;
* distinct leases;
* no filesystem leakage;
* no candidate crossover;
* no accounting crossover.

⸻

214. PHASE 18 — TWO OWNERS

Run cloud Work for Jay and his business partner.

Verify:

owner-private Work isolation.

Then run one BUSINESS_SHARED Work.

Verify both authorized owners see the shared state according to policy.

⸻

215. PHASE 19 — RELAY CLOUD CAPABILITIES

Qualify one Work that uses a bounded Relay capability from the cloud worker.

Prove:

cloud worker

→ scoped Relay grant

→ authorized capability

→ Result.

Grant expires/revokes after Work.

⸻

216. PHASE 20 — AGENT-TO-AGENT CLOUD WORK

Qualify:

Sofie

→ Relay

→ authorized peer

→ bounded Work request

→ cloud execution where applicable

→ response/result

→ Sofie.

Preserve sender/recipient/provenance.

⸻

217. MIGRATION STRATEGY

Do not switch all Work to cloud in one step.

Introduce controlled routing stages:

Stage A

cloud execution disabled by default; explicit qualification Work only.

Stage B

cloud enabled for allowlisted repositories/objectives.

Stage C

cloud default for qualified software Work; local remains explicit.

Stage D

broader autonomous background Work after private-alpha evidence.

⸻

218. FEATURE FLAGS

Use canonical feature/config mechanisms for:

* cloud execution;
* cloud verifier;
* DeepAgent harness;
* automatic cloud routing.

Flags are deployment controls, not substitutes for authorization.

⸻

219. ROLLBACK

Rollback must not require reverting persisted Work history.

Ability to disable new cloud admissions while:

* allowing existing authoritative workers to finish safely;
* or cancelling them explicitly.

Never strand active workers through blind deployment rollback.

⸻

220. LOCAL MODE RETENTION

Keep local MyFactory execution available for:

* development;
* debugging;
* deterministic qualification;
* explicit local Work.

But production autonomous Work must not depend on it.

⸻

221. DEEPAGENT ROLLOUT

Treat DeepAgent rollout independently from cloud-provider rollout.

Possible sequence:

1. cloud + existing qualified harness;
2. qualify DeepAgent in cloud;
3. compare;
4. make DeepAgent default only after evidence supports it.

This prevents two major architectural changes from becoming one debugging problem.

⸻

222. DEEPAGENT ACCEPTANCE CORPUS

Build a bounded corpus containing:

* one-file implementation;
* multi-file implementation;
* failing-test repair;
* repository investigation;
* TypeScript task;
* Python task if supported;
* documentation task;
* no-change task;
* impossible/ambiguous task.

Compare harnesses against identical Work/FactoryVersion constraints.

⸻

223. HARNESS QUALITY METRICS

Measure:

* first-pass implementation success;
* repair success;
* visible test pass rate;
* protected verification pass rate;
* productive operations used;
* latency;
* token/model cost;
* tool-call count;
* invalid/out-of-scope edits;
* completion failures.

⸻

224. HARNESS SELECTION

Default harness selection must be based on qualification.

Do not let the model choose an unqualified harness.

FactoryVersion pins the selected harness.

⸻

225. CLOUD PROVIDER QUALIFICATION CORPUS

Run the same execution lifecycle across representative:

* successful Work;
* cancellation;
* timeout;
* worker death;
* provider outage;
* artifact collection;
* teardown.

Provider must prove lifecycle correctness, not merely container startup.

⸻

226. PERFORMANCE TARGETS

Establish private-alpha targets after baseline measurement.

Measure:

* queue latency;
* sandbox startup;
* repository materialization;
* time to first productive operation;
* test duration;
* verification duration;
* total Work duration.

Do not prematurely optimize before collecting baseline.

⸻

227. WARM POOL — NOT V1 BY DEFAULT

Do not introduce a warm worker pool unless cold-start measurements justify it.

Isolation/correctness first.

If later implemented:

reset/reuse must be independently qualified.

⸻

228. WORKER REUSE

V1 preference:

one ephemeral sandbox per candidate attempt.

This simplifies isolation.

Reuse may be considered later only with deterministic sanitization.

⸻

229. CLOUD CACHE POLICY

Optimize through immutable/content-addressed caches before worker reuse.

Cache poisoning and cross-owner leakage must be tested.

⸻

230. TEST MATRIX — UNIT

Unit tests should cover:

* execution routing;
* provider interfaces;
* harness interfaces;
* lifecycle transitions;
* leases;
* fencing;
* operation accounting;
* artifact manifests;
* environment classification;
* publication policy.

⸻

231. TEST MATRIX — INTEGRATION

Integration tests should cover:

* PostgreSQL;
* queue;
* cloud-provider adapter;
* sandbox lifecycle;
* worker protocol;
* artifact collection;
* candidate custody;
* verifier dispatch;
* cancellation/recovery.

⸻

232. TEST MATRIX — E2E

E2E should cover:

UI

→ MyEve

→ Work

→ cloud MyFactory

→ sandbox

→ harness

→ candidate

→ verifier

→ Result

→ owner decision.

Use deterministic model fixtures for the normal CI path.

⸻

233. TEST MATRIX — LIVE

Live qualification should cover only what deterministic tests cannot establish:

* real cloud allocation;
* real workload identity;
* real AI Gateway/model;
* real GitHub publication when separately authorized;
* real notification channels where needed.

⸻

234. PLAYWRIGHT P0 — NATURAL LANGUAGE

P0 must begin with a natural owner request.

Do not construct Work directly through database/API fixtures after the journey begins.

Example:

Sofie, fix the quantity validation bug and bring it back to me when it is verified.

Sofie must decide/create/manage the Work.

⸻

235. PLAYWRIGHT P0 — OWNER DOES NOT CHOOSE INFRASTRUCTURE

The test must not require the owner to select:

* cloud;
* sandbox;
* harness;
* model provider;
* verifier.

These are governed system decisions.

⸻

236. PLAYWRIGHT P0 — CLOSE BROWSER

After Work begins:

close the browser context.

Allow execution to continue.

Reopen a new browser context later.

Assert Current Truth.

⸻

237. PLAYWRIGHT P0 — RESULT

Result UI must show:

* what changed;
* verification outcome;
* meaningful evidence;
* cost;
* next owner decision.

Infrastructure detail belongs in expandable Proof.

⸻

238. PLAYWRIGHT P0 — APPROVAL

Verified candidate:

→ Needs You

→ Open PR.

Test exact-tree publication through controlled boundary in CI.

Live GitHub publication belongs in release qualification.

⸻

239. PLAYWRIGHT P0 — MOBILE

Run owner-critical cloud journey at 390px.

Owner must be able to:

* see Working;
* inspect Result;
* open Proof;
* respond to Needs You.

⸻

240. ACCESSIBILITY

Run axe against:

* Today;
* Work detail;
* Working state;
* Needs You;
* Result;
* Proof;
* cloud execution details.

Also qualify keyboard-only owner decision.

⸻

241. VISUAL REGRESSION

Capture stable components for:

* Working in cloud;
* Waiting for capacity;
* Waiting for verification;
* Needs You;
* Ready for review;
* Failed/Needs attention;
* Proof of Work.

⸻

242. FAULT-INJECTION SUITE

Automate:

* worker death;
* control-plane restart;
* queue duplicate;
* stale event;
* 503;
* model timeout;
* verifier failure;
* artifact corruption;
* teardown failure.

Every discovered production failure becomes a permanent regression.

⸻

243. ATTEMPTS 1–8 REGRESSIONS

Preserve all private-alpha lessons:

Attempt 1

response normalization.

Attempt 2

proposal versus authority.

Attempt 3

provider-qualified model IDs.

Attempt 4

productive capacity / provider failure.

Attempt 5

productive→completion.

Attempt 6

deterministic implementation feedback.

Attempt 7

public/protected output contract alignment.

Attempt 8

complete successful real Golden Journey.

Cloud migration must not regress any of these.

⸻

244. NEW CLOUD REGRESSION SERIES

Number significant cloud qualification failures separately.

Each real failure must produce:

* preserved evidence;
* root cause;
* deterministic reproduction where possible;
* regression;
* repair;
* requalification.

Do not repeatedly retry live Work until it happens to pass.

⸻

245. RELEASE GATE

Cloud execution is not private-alpha READY until:

Mac-off cloud Golden Journey: PASS

Browser-off continuation: PASS

Cloud producer: PASS

Cloud verifier: PASS

Candidate custody: PASS

Result/Proof: PASS/PARTIAL only for explicitly unestablished external acceptance

Cancellation: PASS

Control-plane restart: PASS

Worker death behavior: PASS

No silent local fallback: PASS

Cross-Work isolation: PASS

Secret disclosure: 0

Duplicate authoritative execution: 0

False Ready: 0.

⸻

246. PRIVATE-ALPHA DEFINITION OF DONE

A successful demo is NOT sufficient.

Definition of done:

Jay can:

1. open Sofie from another computer/phone;
2. ask for cloud-eligible Work;
3. close the UI;
4. leave his Mac off;
5. return later;
6. see a verified Result and Proof;
7. approve publication if desired.

The Work must not require a hidden local process.

⸻

247. PRODUCT DEFINITION

Once this passes, MyEve can truthfully support:

Sofie stays on the job even when your laptop doesn’t.

That promise must be backed by qualification evidence, not marketing copy


## Attachment 6: 90c1e14e-b1c3-479e-b6c9-060773550503

248. PRODUCT COPY BOUNDARY

Do not update public/product copy to claim laptop-independent background execution until the P0 Mac-off Golden Journey passes.

Before qualification, use:

Cloud execution — Beta / qualification in progress

After qualification, product copy may accurately state:

Sofie can continue eligible Work in the cloud while your computer is offline.

Never imply that Work requiring the owner’s local Computer can continue when that Computer is unavailable.

⸻

249. EXECUTION ENVIRONMENT UX

Add a simple owner-facing execution indicator:

☁️ Working in cloud

💻 Using your Mac

⏸ Waiting for your Mac

👤 Needs you

Avoid exposing provider names, container IDs or infrastructure jargon in the primary experience.

Advanced Proof may expose those details.

⸻

250. ROUTING EXPLANATION

When useful, Sofie should be able to answer:

Why is this running in the cloud?

Example:

This work only needs the repository and cloud-accessible tools, so Software Engineer can continue without your Mac.

Or:

This task needs a file that exists only on your Mac, so I’m waiting for your computer to reconnect.

The explanation must reflect deterministic routing state rather than invented model reasoning.

⸻

251. OWNER EXECUTION PREFERENCE

Support an owner preference such as:

Execution

Automatic — recommended

Prefer cloud

Prefer local

Preference influences routing but does not override capability/security requirements.

Prefer cloud cannot move Mac-only resources into cloud automatically.

Prefer local should not silently prevent scheduled/background Work if policy explicitly allows cloud and owner has configured that behavior.

For private alpha, Automatic should be the default.

⸻

252. BACKGROUND WORK POLICY

Add explicit owner policy:

Allow Sofie to continue approved Work while I’m away

This controls autonomous continuation of already-authorized Work.

It does not authorize:

* new unrelated objectives;
* publication;
* payments;
* destructive actions;
* scope expansion.

⸻

253. STANDING AUTHORITY

Cloud execution makes standing authority more important.

Model:

Goal authority

→ what outcome Sofie may continue pursuing.

Work authority

→ what this Work may do.

Capability authority

→ which tools/resources are available.

Effect authority

→ which external writes require owner approval.

Background execution must never collapse these into one blanket permission.

⸻

254. AUTHORITY EXPIRY

Long-running Work must respect:

* Work deadline;
* capability expiry;
* repository grants;
* owner policy;
* cancellation.

Expired authority:

→ pause/fail appropriately.

Do not refresh authority merely because the worker is still running.

⸻

255. SCHEDULED CLOUD WORK

MyEve proactive Work should be able to launch eligible cloud execution from:

* schedules;
* reminders;
* webhook/event triggers;
* Inbox events;
* Goal continuation.

No open browser or Mac required.

⸻

256. SCHEDULED WORK QUALIFICATION

Test:

scheduled event fires

→ MyEve creates Work

→ policy evaluates

→ cloud route admitted

→ MyFactory executes

→ Result appears.

Mac remains offline throughout.

⸻

257. EVENT-TRIGGERED CLOUD WORK

Test a deterministic inbound event:

event

→ Inbox correlation

→ Work

→ cloud execution

→ Result

→ Inbox/Today update.

Duplicate event must not create duplicate Work.

⸻

258. GOAL CONTINUATION IN CLOUD

Goal OS should be able to continue eligible Work while owner is away.

Example:

Goal:

Prepare MyEve for private alpha.

Completed Work produces Result.

Goal planner evaluates Result.

If existing authority permits:

→ next bounded Work may be proposed/admitted.

Do not let Goal existence become unlimited authority.

⸻

259. GOAL AUTONOMY BOUNDARY

Explicitly test:

Goal exists

→ model proposes unrelated Work.

Trusted policy must deny it.

Goal-derived authority expansion count:

0.

⸻

260. DAILY BRIEF + CLOUD WORK

Daily Brief should summarize:

Completed while you were away

Still working

Needs you

Failed / needs attention

This should derive from canonical Work/Result state.

⸻

261. MORNING EXPERIENCE

Target product experience:

Jay opens MyEve in the morning.

Today shows:

Completed while you were away

* Software Engineer fixed X.
* Verification passed.

Needs you

* Open PR?

Working

* Research specialist is still comparing Y.

This is a key product acceptance scenario.

⸻

262. OVERNIGHT QUALIFICATION

Create an accelerated test representing overnight Work:

start Work

→ disconnect owner

→ complete asynchronously

→ notification/state persisted

→ reconnect with a new session

→ Today/Daily Brief reconstruct outcome.

No dependence on previous browser memory.

⸻

263. UNIVERSAL INBOX AS RETURN SURFACE

Background Work requiring a decision should create/update one correlated Needs You item.

Avoid:

one Inbox item for worker completion

* another for verification
* another for publication.

Correlate to the same Work where product semantics permit.

⸻

264. NOTIFICATION ROUTING

Notification policy should distinguish:

informational

→ completed Work.

action required

→ Needs You.

urgent failure

→ Work blocked/UNKNOWN where owner intervention is necessary.

Do not notify on every internal execution event.

⸻

265. CHANNEL CONTINUITY

Background Work may begin from:

* Web;
* Slack;
* Telegram;
* future Email/SMS/voice.

Result should be available in canonical MyEve state regardless of origin channel.

Response may return to the initiating channel according to policy.

⸻

266. CHANNEL AUTHORITY

Starting Work from a channel does not automatically grant that channel all owner capabilities.

Preserve channel identity and owner authorization.

Guest/peer messages must not inherit owner authority.

⸻

267. RELAY AS DURABLE CAPABILITY PLANE

Continue evolving Relay toward:

identity

* capability grants
* communication
* events
* shared/private data access

rather than turning MyFactory into an integration hub.

MyFactory consumes qualified capabilities.

Relay owns capability governance.

⸻

268. MYFACTORY AS PRODUCTION PLANE

MyFactory owns:

* production planning/execution lifecycle;
* workers;
* harnesses;
* candidates;
* verification;
* production evidence.

It should not become:

* Memory;
* Inbox;
* owner messaging;
* general SaaS connector platform.

⸻

269. MYEVE AS DIGITAL-WORKER PLANE

MyEve owns:

* owner relationship;
* conversations;
* Goals;
* Work;
* Memory;
* Inbox;
* Today;
* Needs You;
* Result presentation;
* authority decisions.

MyEve delegates production to MyFactory rather than implementing production itself.

⸻

270. SOFIE AS ORCHESTRATOR

Sofie should feel like one Digital Worker even though the architecture contains multiple systems.

Owner asks Sofie.

Sofie determines:

* answer directly;
* use Computer;
* use Relay capability;
* delegate to specialist;
* create MyFactory Work;
* ask owner.

Owner should not manually orchestrate infrastructure.

⸻

271. FOREMAN POSITIONING

Resolve Foreman’s canonical role during implementation.

Do not maintain two overlapping concepts called “software factory” without a clear boundary.

Preferred conceptual options:

Option A

Foreman is a MyFactory workflow/skill for software production.

Option B

Foreman is a compatibility layer/front-end into MyFactory.

Option C

Foreman is superseded by canonical MyFactory functionality.

Choose based on current source reality.

Document explicitly.

⸻

272. DEEPAGENT POSITIONING

DeepAgent is a harness, not MyFactory itself.

Document:

MyFactory

→ ExecutionProvider

→ HarnessProvider

→ DeepAgent.

This distinction must remain clear in README, UI and architecture.

⸻

273. SOFTWARE ENGINEER PERSONA

Owner-facing UI may refer to MyFactory’s software-production capability as:

Software Engineer

rather than exposing:

MyFactory/DeepAgent/CloudExecutionProvider.

Advanced Proof retains technical provenance.

⸻

274. SPECIALIST IDENTITY

If Software Engineer is represented as a persistent specialist:

it must have:

* stable identity;
* purpose;
* capabilities;
* default Factory route;
* standing instructions;
* evidence attribution.

It does not own infrastructure authority.

⸻

275. SOFTWARE ENGINEER IN TEAM UI

Consider exposing Software Engineer alongside other specialists:

Sofie

Chief of Staff / Digital Worker.

Software Engineer

Builds and verifies software through MyFactory.

Researcher

Research specialist.

etc.

This should be backed by actual routing/capability semantics, not decorative personas.

⸻

276. SPECIALIST → FACTORY

A specialist may request Factory Work.

The request must still pass:

Work

→ policy

→ routing

→ admission.

Specialist instruction is not execution authority.

⸻

277. CLOUD WORK ROOMS

Future Agent Groups/Rooms may coordinate around cloud Work.

V1 requirement:

multiple agents can reference the same canonical Work/Result without creating duplicate execution.

Do not build full multi-agent rooms solely for this project unless already underway.

⸻

278. RESULT SHARING BETWEEN AGENTS

Relay should allow an authorized Result/evidence summary to be shared with another agent.

Sharing Result does not transfer candidate publication authority.

⸻

279. PERSONAL KNOWLEDGE GRAPH

Future Knowledge Graph may index:

Goal

→ Work

→ Result

→ candidate

→ repository

→ people/projects.

Cloud execution should emit clean provenance that can support this later.

Do not make Knowledge Graph a launch dependency.

⸻

280. LEARNING

Cloud Work outcomes should feed the existing governed learning lifecycle.

Potential learning sources:

* implementation success/failure;
* repair patterns;
* verification failures;
* owner acceptance/rejection;
* publication outcomes.

Learning remains advisory until promoted through canonical governance.

⸻

281. NO SELF-MODIFICATION AUTHORITY

MyFactory may produce improvements to MyFactory/MyEve code only as ordinary governed candidates.

It cannot directly deploy or rewrite its own production runtime merely because learning suggests an improvement.

Self-improvement:

telemetry

→ proposal

→ Work

→ candidate

→ verification

→ owner/release policy.

⸻

282. FACTORY TELEMETRY → IMPROVEMENT

Capture enough structured data to identify:

* recurring failures;
* excessive operations;
* context misses;
* flaky checks;
* harness differences;
* provider failures.

These can generate improvement proposals.

Do not automatically implement/deploy them without authority.

⸻

283. EVALUATION CORPUS

Maintain a versioned corpus of representative Work.

Include historical failure cases from Attempts 1–8 and cloud qualification.

Use corpus for:

* harness comparison;
* model routing;
* context strategy;
* regression;
* release qualification.

⸻

284. FACTORY VERSION QUALIFICATION

A FactoryVersion becomes eligible for production only after passing its required evaluation suite.

Pin:

* provider;
* harness;
* model;
* tools;
* runtime image;
* context policy;
* verification policy.

Qualification must be reproducible.

⸻

285. MODEL ROUTING — FUTURE

Preserve architecture for qualified model routing.

Do not introduce dynamic model selection during the initial cloud migration.

V1 should use one explicitly pinned qualified model per FactoryVersion.

⸻

286. MODEL ROUTING QUALIFICATION

Future routing must select only among qualified model tuples.

Routing may consider:

* Work type;
* cost;
* latency;
* quality evidence.

No unqualified fallback.

⸻

287. HARNESS ROUTING — FUTURE

Same principle:

route only among qualified harnesses.

FactoryVersion must preserve the chosen harness for the entire attempt.

⸻

288. EXECUTION PROVIDER ROUTING — FUTURE

Future cloud-provider selection may consider:

* availability;
* region;
* capability;
* cost.

V1 should prefer one qualified provider.

Avoid unnecessary routing complexity during launch.

⸻

289. PORTABILITY

Keep interfaces sufficiently portable that MyFactory can move providers without rewriting Work/Result semantics.

Portability does not require lowest-common-denominator design.

Use provider-specific capabilities behind the canonical interface where beneficial.

⸻

290. LOCAL DEVELOPMENT EXPERIENCE

Developers should be able to run:

MyEve

* MyFactory
* deterministic local ExecutionProvider

without cloud credentials for most development.

Cloud integration tests run separately.

⸻

291. CLOUD DEVELOPMENT MODE

Provide an explicit developer command/config for one bounded cloud qualification Work.

It must clearly identify:

environment

→ development/staging

and never accidentally target production owner Work.

⸻

292. ENVIRONMENT SEPARATION

Keep:

development

staging

production/private-alpha

identities and resources distinct.

Test artifacts must not appear in production Today/Inbox.

⸻

293. TEST OWNER

Automated E2E should use dedicated test owner identities/data.

Do not run destructive qualification against Jay’s production data when deterministic test environments suffice.

⸻

294. PRODUCTION CANARY IDENTITY

Live production canary should be clearly labeled and bounded.

It must not pollute normal owner Goals/Inbox/Memory.

Clean up according to canonical test policy.

⸻

295. CI PIPELINE

Add cloud-execution qualification stages to CI:

PR

* unit;
* contracts;
* deterministic worker lifecycle;
* P0 deterministic cloud E2E where practical.

MAIN

* broader sandbox integration;
* fault injection;
* Playwright.

RELEASE

* real cloud allocation;
* live canary;
* laptop-independence gate.

⸻

296. RELEASE ARTIFACT

Produce a release qualification artifact containing:

* canonical SHAs;
* worker image digest;
* FactoryVersion;
* cloud provider;
* harness;
* model;
* P0 results;
* fault-injection results;
* live-canary evidence;
* known limitations.

⸻

297. ROLLOUT DASHBOARD

Track:

cloud execution enabled?

cloud verifier enabled?

default routing?

harness?

live canary status?

last laptop-independence qualification?

Make rollout state explicit.

⸻

298. PRIVATE-ALPHA OPERATIONAL RUNBOOK

Document:

* provider outage;
* stuck worker;
* leaked sandbox;
* UNKNOWN Work;
* cancellation failure;
* verifier outage;
* queue backlog;
* OIDC failure;
* artifact mismatch.

Include safe operator actions.

⸻

299. DISASTER RECOVERY

Cloud workers are ephemeral.

Durable recovery depends on:

* canonical database;
* event log;
* artifact store;
* candidate custody.

Document backup/restore requirements for these systems.

⸻

300. DATABASE RECOVERY

Existing protected database backup/restore qualification must include new cloud execution state.

Restore must preserve:

* Work;
* attempts;
* events;
* leases/history;
* candidate custody;
* Results/Proof.

Do not restore active cloud authority blindly.

⸻

301. RESTORE RECONCILIATION

After database restore:


## Attachment 7: 990b432d-f2f6-435a-9c85-393795821374

301. RESTORE RECONCILIATION — CONTINUED

After database restore:

do not assume restored RUNNING state represents current external reality.

Reconcile every non-terminal cloud execution against:

* cloud provider;
* queue;
* worker identity;
* lease;
* candidate custody;
* verifier state.

Until reconciliation completes:

Work must not create new consequential execution authority.

⸻

302. RESTORED ACTIVE WORK

For each restored active Work determine:

worker still exists + valid lease

→ reconnect/reconcile.

worker conclusively terminal

→ reconcile terminal state.

worker missing with no ambiguous paid/external operation

→ apply canonical recovery policy.

external state cannot be established

→ UNKNOWN.

Never start another worker simply because the restored database says the previous one is old.

⸻

303. ARTIFACT STORE RECOVERY

Candidate/evidence artifacts must have durable identifiers independent of sandbox lifetime.

Backup/recovery must preserve:

* candidate bundle;
* hashes;
* custody record;
* verification evidence;
* Proof attachments.

Missing authoritative candidate artifacts must prevent publication.

⸻

304. EVENT LOG RECOVERY

Durable event history must support rebuilding derived execution views.

Test:

delete/rebuild non-authoritative read model

→ replay canonical events/state

→ same Current Truth.

Do not make UI caches authoritative.

⸻

305. READ MODEL

Create or extend an execution read model optimized for MyEve/UI consumption.

It may summarize:

* Work;
* environment;
* phase;
* progress;
* Needs You;
* Result;
* cost.

Read model is derived.

Canonical execution/custody state remains authoritative elsewhere.

⸻

306. EVENT → UI LATENCY

Measure cloud event-to-owner-UI latency.

Establish a private-alpha target after baseline.

Owner should not need to refresh manually to discover important state changes.

⸻

307. REAL-TIME UPDATES

Use existing MyEve real-time/event mechanisms where practical.

Reconnect must fall back to durable readback.

Websocket/SSE loss must not lose canonical state.

⸻

308. UI PROGRESS SEMANTICS

Progress shown to owner must represent observable execution stages.

Good:

* Reviewing repository
* Implementing
* Running checks
* Repairing
* Verifying

Avoid fabricated percentages such as 73% complete unless there is a real deterministic basis.

⸻

309. LONG-RUNNING WORK

Work lasting hours must not accumulate unbounded:

* model context;
* logs;
* browser state;
* database events.

Add bounded compaction/summarization where needed without destroying canonical evidence.

⸻

310. EXECUTION CHECKPOINTS

For future longer Work, distinguish:

evidence checkpoint

from

execution resumability checkpoint.

V1 does not need transparent arbitrary model-process resume.

Do not claim resumability unless it is qualified.

⸻

311. MULTI-WORKORDER OBJECTIVES

Preserve architecture for MyFactory objectives that decompose into multiple WorkOrders.

Cloud execution provider operates at the admitted execution unit defined by canonical MyFactory.

Do not let cloud worker invent new sibling WorkOrders with authority.

⸻

312. OBJECTIVE PLANNER

If an objective planner proposes multiple WorkOrders:

planner output remains proposal.

Trusted orchestration admits each WorkOrder separately according to policy.

Cloud availability does not grant planner authority.

⸻

313. DEPENDENCIES

WorkOrder dependencies must be durable.

Downstream Work must not execute until required predecessor state is canonically satisfied.

Test:

A → B

worker B cannot begin because worker A merely claims completion.

Require verified canonical predecessor state.

⸻

314. PARALLEL WORK

Independent WorkOrders may run concurrently where policy/capacity permits.

Preserve:

* repository conflict policy;
* writer constraints;
* candidate isolation;
* resource limits.

⸻

315. SAME-REPOSITORY CONCURRENCY

Define initial policy conservatively.

Prefer:

one authoritative writer per relevant repository/base scope

unless multi-writer semantics are explicitly qualified.

Do not allow two cloud workers to race edits into one mutable workspace.

⸻

316. CANDIDATE COMPOSITION

Future multi-Work candidate composition must be a separate governed operation.

V1:

each candidate remains attributable to one admitted attempt unless existing canonical MyFactory already supports composition safely.

⸻

317. MERGE CONFLICTS

Cloud producer should not silently resolve post-verification merge conflicts during publication.

If qualified base moved:

publication fails closed / Needs attention.

A new candidate/reverification lifecycle may be required.

⸻

318. BASE DRIFT

Before production:

verify exact base SHA.

Before publication:

verify expected base ref/SHA according to canonical publication policy.

Base drift must be explicit.

⸻

319. SOURCE OF TRUTH FOR REPOSITORIES

Define canonical repository registry containing:

* repository identity;
* allowed owners/orgs;
* default base;
* read capability;
* publication capability;
* execution policies.

Model-supplied arbitrary Git URLs must not automatically become authorized repositories.

⸻

320. REPOSITORY ONBOARDING

Owner can authorize a repository through a governed setup flow.

Capture:

* repo;
* default branch;
* allowed operations;
* execution environment policy;
* publication policy.

⸻

321. REPOSITORY POLICY

Per-repository settings may include:

* cloud execution allowed;
* local execution required;
* protected verification required;
* publication approval required;
* maximum Work duration;
* allowed harnesses/models.

Defaults should fail safely.

⸻

322. PRIVATE REPOSITORY ACCESS

Cloud worker receives read access only to the repository required for its Work.

Do not give every worker access to every owner repository.

⸻

323. MONOREPO SUPPORT

Cloud execution must preserve repository root while allowing bounded context and test targeting.

Do not assume every repository is a small single-package project.

Record working directory/package scope where relevant.

⸻

324. LARGE REPOSITORIES

For large repositories:

context assembly should use deterministic discovery/search rather than loading everything.

Sandbox may materialize the full repository if needed while model context remains bounded.

⸻

325. BINARY / LARGE FILES

Define limits for:

* artifact size;
* repository size;
* generated binaries;
* logs.

Oversized artifacts should fail clearly rather than exhaust worker storage.

⸻

326. GIT LFS / SUBMODULES

Inventory whether private-alpha repositories require:

* Git LFS;
* submodules.

Support only if needed.

If unsupported:

fail before productive execution with a truthful capability error.

⸻

327. LANGUAGE TOOLCHAINS

Initial runtime should support only toolchains required by actual target Work.

Likely:

* Node/TypeScript;
* Python if current repositories require it.

Add additional languages through versioned runtime images rather than ad hoc worker mutation.

⸻

328. TOOLCHAIN DETECTION

Detect repository toolchain deterministically from tracked files.

Examples:

* package.json;
* lockfile;
* pyproject.toml;
* requirements;
* Makefile.

Model may recommend commands, but trusted host controls what executes within sandbox policy.

⸻

329. TEST COMMAND DISCOVERY

Prefer repository-declared test/build commands.

Record commands executed in evidence.

Protected verification may use additional independent commands.

⸻

330. COMMAND POLICY

Sandbox may run repository commands, but control plane must enforce:

* timeout;
* resource bounds;
* network policy;
* working directory;
* environment redaction.

⸻

331. COMMAND EVIDENCE

For implementation-visible checks record:

* command;
* exit code;
* duration;
* bounded output digest/summary;
* pass/fail count where available.

Do not store unlimited raw output.

⸻

332. TOOL OUTPUT LIMITS

Limit model-visible tool output.

Large output should be:

* truncated deterministically;
* summarized by trusted tooling where appropriate;
* retrievable in bounded ranges.

Prevent context exhaustion from giant logs.

⸻

333. FILE EDITING

Harness may edit only within sandbox Work workspace.

Host validates changed-file scope before completion.

Out-of-scope changes:

completion denied.

⸻

334. SYMLINK SAFETY

Preserve symlink/path traversal protections.

Worker must not escape workspace through:

* symlink;
* ..;
* mount path;
* archive extraction.

Add negative fixtures.

⸻

335. ARTIFACT EXTRACTION SAFETY

Candidate/artifact collection must validate paths.

Never extract worker-provided archives directly onto control-plane filesystem without validation.

⸻

336. GENERATED EXECUTABLES

Treat generated binaries/scripts as untrusted artifacts.

Verification executes them only inside verifier sandbox.

⸻

337. CLOUD VERIFICATION IMAGE

Prefer verifier runtime image independently versioned from producer image where useful.

At minimum record exact verifier image digest.

Producer cannot modify verifier image.

⸻

338. VERIFICATION POLICY VERSION

Candidate evidence must record verification policy/version.

A PASS is meaningful only relative to the policy used.

⸻

339. REVERIFICATION

Support explicit reverification of the same immutable candidate under a newer policy where needed.

Preserve both verification records.

Do not rewrite historical verdict.

⸻

340. VERIFICATION EXPIRY

Define whether verification becomes stale after:

* base branch movement;
* policy change;
* dependency/security change.

Private alpha may keep this simple, but semantics must be explicit before publication.

⸻

341. RESULT VERSIONING

Result should reference:

* candidate;
* verification record;
* Work revision/generation;
* accounting snapshot.

New verification/publication events may produce updated Current Truth without rewriting historical Result artifacts.

⸻

342. PROOF VERSIONING

Preserve immutable Proof snapshots.

Owner-facing current Proof view may aggregate later events such as:

* final Sofie cost;
* publication;
* CI;
* review;
* acceptance.

Clearly distinguish snapshot from current aggregate.

⸻

343. PUBLICATION AFTER CLOUD VERIFICATION

Publisher consumes candidate from custody/artifact store.

It must not require producer sandbox to still exist.

This is essential for background Work.

⸻

344. DELAYED OWNER APPROVAL

Test:

candidate verified

→ producer/verifier sandboxes destroyed

→ owner waits several hours/days

→ approves PR.

Publication must succeed from durable custody alone.

⸻

345. CANDIDATE RETENTION

Define private-alpha retention period for unpublished verified candidates.

Candidate must not disappear simply because sandbox was destroyed.

⸻

346. REJECTED CANDIDATE RETENTION

Retain enough evidence for audit/learning while respecting storage/privacy policy.

Rejection does not require immediate evidence deletion.

⸻

347. OWNER DELETION

If owner explicitly deletes Work/artifacts according to product policy:

propagate deletion through durable stores where required.

Do not leave hidden sandbox copies.

⸻

348. DATA CLASSIFICATION

Classify cloud execution data:

* owner-private;
* business-shared;
* Work-scoped;
* public repository;
* protected verification.

Use classification to drive access/retention.

⸻

349. AUDIT LOG

Record security-relevant events:

* Work admission;
* environment selection;
* capability grant;
* worker allocation;
* candidate custody;
* verification;
* owner approval;
* publication;
* cancellation;
* operator recovery.

Audit log is not the same as verbose execution trace.

⸻

350. OWNER AUDIT VIEW

Owner-facing Proof should make important authority decisions understandable:

Sofie requested cloud execution

MyFactory admitted it

Software Engineer produced candidate

Independent verification passed

You approved publication

Avoid drowning owner in internal event IDs.

⸻

351. SECURITY OPERATOR VIEW

Advanced/operator evidence should expose:

* identities;
* grants;
* leases;
* signatures;
* hashes;
* environment IDs;
* event IDs.

⸻

352. PRIVACY

Cloud execution must not automatically copy:

* entire MyEve Memory;
* entire Inbox;
* unrelated Files;
* unrelated conversations.

Context is Work-scoped.

⸻

353. MEMORY ACCESS

If Work needs Memory:

retrieve only authorized relevant context through MyEve/Relay.

Record provenance.

Do not mount the Memory database into the sandbox.

⸻

354. FILE ACCESS

If Work needs MyEve Files:

provide specific authorized artifacts.

Record hashes and scope.

Do not mount all private storage.

⸻

355. CONNECTED APPS

Cloud worker accesses connected apps only through qualified capability interfaces.

Do not inject broad app OAuth tokens into sandbox.

⸻

356. BROWSER CAPABILITY

Cloud browser usage, if enabled later, should be a distinct qualified capability.

Do not assume code sandbox network/browser equals owner browser authority.

⸻

357. COMPUTER CAPABILITY

Cloud sandbox itself may be represented as a Computer capability internally.

Keep it distinct from paired Owner Computers.

⸻

358. APPROVAL CENTER

Cloud Work should integrate with the canonical Approval Center/Needs You model.

Approval request includes:

* requested effect;
* Work;
* candidate where relevant;
* scope;
* expiry.

⸻

359. APPROVAL ONCE PER CAPABILITY

If MyEve later supports Pluto-like “approve this capability for the rest of the turn,” scope it carefully.

It must bind to:

* Work/turn;
* capability;
* effect class;
* expiry.

It must not become a permanent blanket grant accidentally.

⸻

360. NO APPROVAL FATIGUE

Do not require owner approval for every internal:

* file read;
* test;
* local sandbox edit.

Approval should protect meaningful authority/effect boundaries.

⸻

361. EXTERNAL EFFECT CATALOG

Define canonical effect classes such as:

* source-control publication;
* email/message send;
* deployment;
* payment;
* destructive app mutation;
* public sharing.

Cloud execution cannot invent new effect classes through prompt text.

⸻

362. EFFECT ENFORCEMENT

Enforcement must occur in code/capability layer.

Prompt instructions are defense-in-depth, not authority enforcement.

⸻

363. CLOUD DEPLOYMENT CAPABILITY

Deployment from MyFactory is out of scope for initial cloud coding launch unless already canonically qualified.

Initial target:

candidate + PR.

Do not automatically extend success into deployment authority.

⸻

364. FUTURE DEPLOYMENT

Later:

verified candidate

→ CI

→ owner/release approval

→ qualified deployment capability

→ deployment verification.

Keep separate from current milestone.

⸻

365. RESEARCH WORK

Architecture should support non-code cloud Work eventually.

Examples:

* research;
* analysis;
* artifact creation.

But software-production Golden Journey is the P0 launch path.

⸻

366. ARTIFACT WORK

Future cloud harness may produce:

* documents;
* spreadsheets;
* decks;
* reports.

These should enter MyEve Files/Workspace through governed artifact custody.

Do not block software launch on full artifact support.

⸻

367. CLOUD SPECIALISTS

Persistent specialists may themselves run as cloud agents later.

Initial milestone does not require every specialist to become a long-lived cloud process.

Prefer stateless/durable orchestration around Work.

⸻

368. AGENT PERSISTENCE

“Persistent agent” should mean persistent identity/state/goals and ability to resume Work—not necessarily one immortal process.

Cloud workers should remain replaceable.

⸻

369. DURABLE ASSETS


## Attachment 8: 7ea22ff5-687e-4d78-adc2-eccb54276d92

369. DURABLE ASSETS

Preserve the principle:

Tools, Work, Results, evidence and capabilities are durable assets.

Individual agent processes are replaceable heads.

MyFactory cloud architecture should not depend on one immortal worker process.

Durable state belongs in governed systems outside the execution process.

⸻

370. AGENT REPLACEMENT

If a harness/worker process terminates:

canonical Work state remains.

A successor process may continue only when canonical recovery policy explicitly permits it.

Never infer authority merely because a successor can access the same files.

⸻

371. SPECIALIST REPLACEMENT

Persistent specialists should preserve:

* identity;
* purpose;
* instructions;
* granted capabilities;
* Work history;
* Results.

Their underlying model/runtime may change through qualified configuration without losing identity.

⸻

372. CLOUD WORK OWNERSHIP

Every Work must have an explicit owner/scope.

Examples:

OWNER_PRIVATE

BUSINESS_SHARED

SYSTEM_QUALIFICATION

Execution identity inherits only the Work’s authorized scope.

⸻

373. WORK CREATION PROVENANCE

Record how Work originated:

* direct owner request;
* Goal continuation;
* schedule;
* Inbox event;
* specialist delegation;
* peer agent request;
* qualification.

Origin does not replace authorization.

⸻

374. WORK INTENT

Preserve canonical Work intent classification.

Example:

DIRECT

Sofie can answer/do directly.

FACTORY

substantial production delegated to MyFactory.

LOCAL_COMPUTER

requires owner Computer.

HUMAN

requires owner action.

PEER

requires another authorized agent.

Do not force everything into MyFactory simply because cloud execution exists.

⸻

375. ROUTING POLICY TESTS

Add deterministic cases:

simple factual question

→ DIRECT.

repository coding task

→ FACTORY/CLOUD.

Mac-only README

→ LOCAL_COMPUTER.

external approval

→ HUMAN/Needs You.

peer knowledge request

→ RELAY/PEER.

Require no accidental cloud execution for DIRECT/HUMAN Work.

⸻

376. ROUTING CONFIDENCE

If routing cannot be established safely:

do not guess.

Use:

Needs You

or bounded clarification.

Avoid spinning up cloud workers merely to discover what the owner meant.

⸻

377. PREPARATION WITHOUT EXECUTION

MyEve/MyFactory may prepare:

* route proposal;
* execution envelope;
* context plan;
* capability requirements

before execution authority is admitted.

Preparation grants zero execution authority.

Preserve the Attempt-2 lesson permanently.

⸻

378. CLOUD ADMISSION

Trusted cloud admission must validate:

* Work;
* owner/scope;
* revision/generation;
* route;
* repository;
* ExecutionProvider;
* HarnessProvider;
* FactoryVersion;
* model;
* capability grants;
* resource envelope;
* deadline;
* writer state.

Model proposal cannot bypass this.

⸻

379. ADMISSION RECEIPT

Produce a durable admission receipt containing the admitted tuple.

Example:

Work

* generation
* FactoryVersion
* environment
* harness
* model
* resource envelope
* deadline.

This becomes evidence.

⸻

380. ROUTE IMMUTABILITY

Once an execution attempt begins:

environment/harness/model tuple is pinned.

Changing:

cloud provider

harness

model

requires canonical re-admission/new attempt semantics.

No mid-run silent fallback.

⸻

381. CLOUD FACTORYVERSION

Extend FactoryVersion to include at minimum:

executionProvider

executionProviderVersion

region

runtimeImageDigest

harness

harnessVersion

modelRoute

toolPolicy

skillSet

contextPolicy

verificationPolicy

networkPolicy

resourcePolicy.

Keep immutable after qualification.

⸻

382. FACTORYVERSION HASH

Produce deterministic identity/hash for immutable FactoryVersion configuration.

Result/Proof/candidate custody should reference it.

⸻

383. FACTORYVERSION UI

Primary owner UI should not show the entire tuple.

Proof → Advanced may show:

Factory version

Cloud runtime

Harness

Model

Verifier.

⸻

384. QUALIFIED TUPLE

Only qualified:

ExecutionProvider

× Harness

× Model

× Tool policy

× Verification policy

tuples may be admitted to production.

Fail closed for unknown tuple.

⸻

385. QUALIFICATION REGISTRY

Maintain a registry/table of qualified FactoryVersions or tuples.

Record:

* version;
* qualification evidence;
* status;
* date;
* limitations.

⸻

386. QUALIFICATION REVOCATION

Ability to revoke a FactoryVersion from new Work if a defect is discovered.

Existing Work follows explicit policy:

continue

/ cancel

/ Needs attention.

Do not silently mutate its version.

⸻

387. CANARY FACTORYVERSION

New cloud versions should first be:

CANARY

before:

QUALIFIED.

Only explicitly scoped Work uses canary versions.

⸻

388. PROMOTION

Promotion requires:

deterministic suite

* fault suite
* cloud integration
* laptop-independence test
* bounded live canary.

⸻

389. ROLLBACK VERSION

Keep last known qualified FactoryVersion available for new Work rollback.

Do not move active Work between versions.

⸻

390. DEEPAGENT VERSIONING

Pin DeepAgent dependency/runtime version.

Do not depend on an unversioned moving branch/package.

Record exact version in FactoryVersion.

⸻

391. DEEPAGENT TOOL ADAPTER

DeepAgent must consume MyFactory client tools through a bounded adapter.

It must not receive unrestricted host shell/network APIs outside the sandbox policy.

⸻

392. DEEPAGENT MODEL ADAPTER

DeepAgent model calls must flow through canonical MyFactory operation admission/accounting.

It must not independently call arbitrary model providers using hidden credentials.

⸻

393. DEEPAGENT OPERATION ACCOUNTING

Every DeepAgent model continuation maps to one canonical model operation where appropriate.

Tool loops must not bypass operation ceilings.

⸻

394. DEEPAGENT CHECKPOINT

Host retains authority to stop DeepAgent at checkpoint boundaries.

Harness cannot indefinitely continue model turns after productive capacity is exhausted.

⸻

395. DEEPAGENT COMPLETION

Adapt DeepAgent to the canonical read-only completion phase if required.

Do not weaken the completion invariant to accommodate harness behavior.

The harness adapts to MyFactory—not the reverse.

⸻

396. DEEPAGENT CANCELLATION

Prove:

cancel

→ active model/tool execution stops

→ child processes stop

→ authority fenced

→ no late authoritative events.

⸻

397. DEEPAGENT PROCESS CLEANUP

After terminal:

active DeepAgent processes = 0.

Child processes = 0.

Leaked background servers must be terminated unless explicitly declared as artifacts/services and supported by policy.

⸻

398. DEEPAGENT EVIDENCE

Harness emits structured evidence:

* operations;
* tools;
* edits;
* checkpoints;
* termination reason.

Do not require scraping human-formatted console output to establish canonical state.

⸻

399. DEEPAGENT CONTEXT

Feed DeepAgent the same canonical bounded context contract as other harnesses.

Harness-specific prompt formatting may differ.

Context authority and protected-material boundaries may not.

⸻

400. DEEPAGENT QUALIFICATION RESULT

At the end of implementation report:

DeepAgentHarness: QUALIFIED / NOT_QUALIFIED

Default cloud harness: …

If DeepAgent is not qualified, cloud execution must still launch using the currently qualified harness if possible.

⸻

401. PROVIDER SELECTION ADR

Create an Architecture Decision Record for initial cloud provider.

Include:

* alternatives considered;
* existing infrastructure compatibility;
* isolation;
* durability;
* cancellation;
* artifact handling;
* identity/OIDC;
* cost;
* operational complexity;
* local independence.

Choose one.

Avoid implementing multiple providers during V1.

⸻

402. QUEUE SELECTION ADR

Document whether existing infrastructure already provides an adequate durable queue.

If yes, reuse it.

If not, select the smallest appropriate mechanism.

Do not introduce Kafka-class infrastructure for a two-user private alpha without evidence it is necessary.

⸻

403. ARTIFACT STORE ADR

Prefer existing durable private storage if it satisfies:

* access control;
* integrity;
* size;
* retention;
* server-side/cloud access.

Do not add a second artifact platform unnecessarily.

⸻

404. CONTROL-PLANE HOSTING ADR

Determine where MyFactory control plane runs.

Requirements:

* always available independently of Jay’s Mac;
* durable database access;
* queue access;
* cloud-provider control;
* Relay access;
* OIDC/identity;
* observability.

Document why selected hosting fits long-running/background orchestration.

⸻

405. VERCEL BOUNDARY

MyEve may continue running on Vercel.

Do not assume a frontend/serverless request should host long-running MyFactory worker execution.

Use Vercel for:

* MyEve UI/API;
* Work admission/orchestration entry;
* qualified gateway identity

where appropriate.

Long-running cloud execution belongs in the selected execution runtime/control architecture.

⸻

406. SERVERLESS SAFETY

No correctness requirement may depend on one serverless invocation remaining alive for the entire Work.

Durable state/queue/events must bridge invocation boundaries.

⸻

407. CALLBACK SECURITY

If cloud provider calls MyFactory back:

callback must be authenticated.

Bind:

* provider;
* worker;
* Work;
* attempt;
* expiry/signature.

Reject replay/stale callbacks.

⸻

408. POLLING

If provider requires polling:

polling reads status only.

It must not become execution authority.

Backoff appropriately.

⸻

409. WEBHOOK IDEMPOTENCY

Duplicate provider webhook:

→ same event identity

→ no duplicate state transition.

⸻

410. PROVIDER EVENT LOSS

Reconciler must recover truth from provider read API if webhook/event is missed.

Event delivery alone cannot be the only source of truth.

⸻

411. PROVIDER READBACK

CloudExecutionProvider must expose enough readback to establish:

* existence;
* lifecycle state;
* timestamps;
* termination;
* artifacts.

If provider cannot establish these reliably, reconsider provider choice.

⸻

412. CLOUD EXECUTION API

Define an internal API/contract around MyFactory cloud execution.

Do not expose raw provider APIs to MyEve.

MyEve should operate on canonical:

Work

→ route

→ status

→ cancel

→ Result.

⸻

413. API AUTHORIZATION

MyEve-to-MyFactory requests must remain authenticated and Work-scoped.

Preserve current qualified admission semantics.

Cloud migration must not create a bypass API.

⸻

414. API VERSIONING

Version execution contracts sufficiently to allow worker/control-plane upgrades.

Reject incompatible worker protocol rather than guessing.

⸻

415. WORKER COMPATIBILITY

Worker reports:

* protocol version;
* runtime version;
* harness capabilities.

Control plane validates before START.

⸻

416. MIXED VERSION DEPLOYMENTS

During rollout, old and new workers may temporarily coexist.

FactoryVersion pins compatibility.

Do not let an old worker pick up Work requiring a newer protocol.

⸻

417. DEPLOYMENT STRATEGY

Prefer:

control-plane deployment

→ canary worker image

→ qualification Work

→ promotion.

Do not replace every component simultaneously.

⸻

418. ZERO-DOWNTIME EXPECTATION

Existing admitted Work should not be corrupted by routine deployment.

New admissions may briefly pause if required.

Correctness > zero milliseconds of downtime.

⸻

419. SCHEMA MIGRATIONS

Cloud execution schema changes must follow existing canonical migration lineage.

Never edit historical migration bytes.

Add:

* checksums;
* forward migration;
* restore qualification.

⸻

420. MIGRATION CONTENT

Likely new durable concepts may include:

* execution environment;
* provider execution;
* worker lease;
* worker events;
* artifact/custody references;
* FactoryVersion expansion.

Reuse existing entities where semantics already exist.

Do not duplicate Work/attempt/writer state unnecessarily.

⸻

421. DATABASE INVARIANTS

Preserve/enforce:

one authoritative writer

one authoritative execution per admitted attempt

one current lease where required

immutable candidate custody

immutable verification records.

⸻

422. DATABASE CONCURRENCY

Add PostgreSQL tests for:

* simultaneous worker claims;
* duplicate queue delivery;
* cancellation vs completion race;
* lease expiry vs heartbeat;
* candidate collection vs fencing;
* verification dispatch deduplication.

⸻

423. CANCELLATION VS SUCCESS RACE

Explicitly define:

owner cancels at same moment worker reports success.

Trusted ordering/transaction rules decide canonical outcome.

Do not let last HTTP response win.

⸻

424. COMPLETION VS LEASE EXPIRY

Worker completion arriving after lease is fenced:

must not become authoritative.

Preserve evidence if useful, but deny state mutation.

⸻

425. CANDIDATE COLLECTION RACE

Candidate artifact collection must bind to authoritative worker/attempt.

Late artifact from fenced worker cannot replace current candidate.

⸻

426. VERIFICATION DISPATCH RACE

Candidate custody should dispatch at most one canonical verification run for a given policy unless explicit reverification is requested.

⸻

427. PUBLICATION RACE

Double-click / two tabs / duplicate API request:

exactly one publication effect.

Preserve the publication controls being qualified after Attempt 8.

⸻

428. TEST HARNESS

Build reusable deterministic test harnesses for:

* fake cloud provider;
* fake queue;
* deterministic model gateway;
* worker lifecycle;
* artifact store;
* verifier.

These should exercise production interfaces, not alternate shortcut code paths.

⸻

429. CLOUD PROVIDER FAKE

Fake provider must simulate:

* allocate;
* ready;
* run;
* heartbeat;
* terminate;
* timeout;
* disappearance;
* delayed event;
* duplicate event;
* artifact corruption.

⸻

430. DETERMINISTIC MODEL

Support scripted responses for:

* correct first pass;
* repairable failure;
* repeated bad implementation;
* malformed tool request;
* timeout;
* 503;
* ambiguous operation.

⸻

431. GOLDEN REPOSITORIES

Maintain tiny fixture repositories for:

* quantity validator;
* multi-file task;
* TypeScript task;
* failing-test repair;
* malicious repository.

Pin fixture SHAs.

⸻

432. TEST ARTIFACT CLEANUP

CI tests must clean:

* cloud workers;
* queues;
* test artifacts;
* database state.

Leaked test resources become test failures.

⸻

433. TEST CORRELATION

Every E2E run receives a correlation ID.

Include it in:

Work

→ provider worker

→ events

→ candidate

→ verifier

→ Result.

⸻

434. PLAYWRIGHT TRACE

On P0 failure retain:

* trace;
* screenshots;


## Attachment 9: 1326845e-068c-48a2-bceb-5c4fa58d454b

434. PLAYWRIGHT TRACE — CONTINUED

On P0 failure retain:

* Playwright trace;
* screenshots;
* video where useful;
* browser console;
* failed network requests;
* correlation ID;
* Work ID;
* Result ID where created;
* sanitized Current Truth snapshot.

Never retain:

* credentials;
* bearer tokens;
* cookies;
* OIDC assertions;
* capability secrets.

⸻

435. PLAYWRIGHT PROJECTS

Define explicit Playwright projects for:

desktop-chromium

Primary P0 qualification.

mobile-390

Critical owner journeys at 390px.

webkit-critical

Critical private-alpha compatibility.

Do not multiply every expensive fault-injection test across every browser.

⸻

436. PLAYWRIGHT TEST TAGS

Establish tags equivalent to:

@p0

@cloud

@factory

@computer

@approval

@federation

@recovery

@live

@accessibility.

CI must be able to select the appropriate qualification tier.

⸻

437. P0 CLOUD HAPPY PATH

The most important automated UI test must exercise:

owner

→ real MyEve UI

→ natural request

→ Sofie

→ Work

→ CLOUD routing

→ MyFactory

→ cloud worker

→ implementation

→ checks

→ candidate

→ cloud verifier

→ Result

→ Proof

→ Needs You.

No direct database mutation may advance the journey.

⸻

438. P0 PUBLICATION HAPPY PATH

Separate P0:

verified candidate

→ real owner decision UI

→ Open a pull request

→ approval

→ exact-tree guard

→ exactly one controlled branch publication

→ exactly one PR

→ CI/readback

→ UI update.

CI version may use a controlled GitHub boundary.

Release qualification must exercise the real GitHub boundary.

⸻

439. P0 KEEP-PRIVATE PATH

verified candidate

→ Keep private.

Require:

branch pushes = 0

PRs = 0

deployments = 0.

Candidate remains available in private custody.

⸻

440. P0 FAILED VERIFICATION PATH

Producer completes.

Protected verifier rejects candidate.

Require UI:

Needs verification / Needs attention

Ready false.

No publication approval offered as though candidate passed.

Proof explains verification failure.

⸻

441. P0 REPAIR PATH

PRODUCTIVE 1 produces defective implementation.

Host tests fail.

PRODUCTIVE 2 receives bounded feedback.

Repair succeeds.

Verification passes.

UI should not expose internal model-operation mechanics unless opened in Proof.

⸻

442. P0 CANCEL PATH

Start cloud Work.

UI shows Working.

Owner selects Cancel.

Require:

Work cancellation

→ worker cancellation

→ fence

→ teardown

→ UI terminal state.

⸻

443. P0 BROWSER-DISCONNECT PATH

Start Work.

Wait until cloud worker owns execution.

Close browser.

Continue backend qualification independently.

Reopen.

Require Current Truth without manual continuation.

⸻

444. P0 MAC-OFF PATH

Before test:

assert:

local companion unavailable

* local MyFactory unavailable
* local verifier unavailable.

Start cloud Work.

Require complete lifecycle.

If any local dependency is contacted:

test FAIL.

⸻

445. P0 NEEDS-YOU CONTINUATION

Cloud Work pauses at a real owner-decision boundary.

Owner responds through UI.

Work automatically continues according to canonical lifecycle.

No manual:

"continue"

message.

⸻

446. P0 SAME-CONVERSATION CONTINUITY

Complete one cloud Work.

In the same Sofie conversation:

owner asks for another unrelated task.

Require fresh canonical Work/task binding.

Preserve historical first Work.

Stale authority carryover = 0.

⸻

447. P0 TODAY

Start background Work.

Navigate away.

Today must reflect:

Working

then

Ready for review / Needs You

without relying on the original chat page.

⸻

448. P0 DAILY BRIEF

Seed/execute completed background Work.

Daily Brief should truthfully summarize:

* what completed;
* verification status;
* what needs owner action.

Do not manufacture completion from execution-only state.

⸻

449. P0 NOTIFICATION

When cloud Work reaches Needs You:

verify one configured test notification event.

Duplicate internal events must not generate notification storms.

⸻

450. P0 RESULT ACCOUNTING

Result UI must show attributable known journey cost.

Assert:

Sofie

* Factory model
* cloud runtime where known
* verifier where known

= displayed known total.

UNKNOWN costs remain explicitly UNKNOWN.

⸻

451. P0 PROOF

Expand Proof.

Assert presence of:

* Work;
* execution environment;
* FactoryVersion;
* repository/base;
* changed files;
* candidate;
* implementation checks;
* verification;
* accounting;
* timeline/provenance.

⸻

452. ACCESSIBILITY RELEASE GATE

Critical owner states must have:

zero serious/critical axe violations.

Keyboard-only owner must be able to:

* submit Work;
* inspect Result;
* open Proof;
* respond to Needs You;
* choose publication action.

⸻

453. MOBILE RELEASE GATE

At 390px:

* no inaccessible approval actions;
* no clipped Result state;
* Proof expandable;
* Working/Needs You visible;
* navigation usable.

⸻

454. VISUAL RELEASE GATE

Component-level visual snapshots for stable critical states must be reviewed/versioned.

Do not make dynamic IDs, timestamps or model text create constant screenshot churn.

Mask dynamic fields where appropriate.

⸻

455. API CONTRACT TESTS

Add explicit contract tests between:

MyEve → MyFactory

MyFactory → CloudExecutionProvider

Control plane → worker

Worker → artifact custody

Custody → verifier

MyFactory → MyEve Result.

Version schemas where necessary.

⸻

456. CONTRACT COMPATIBILITY

CI must detect incompatible protocol/schema changes before deployment.

A newer control plane must not blindly send commands an older worker cannot understand.

⸻

457. SCHEMA VALIDATION

Validate all cross-process messages at runtime.

Reject malformed:

* commands;
* events;
* artifacts;
* Results.

Never trust JSON merely because it parsed.

⸻

458. EVENT CONTRACT

Events should be typed and versioned.

Avoid generic:

type: "status", data: any.

Prefer explicit event payload contracts.

⸻

459. ARTIFACT CONTRACT

Candidate bundle schema must be versioned.

Custody verifies:

schema

* signatures/hashes
* Work binding.

⸻

460. PROOF CONTRACT

Proof schema should support both:

* immutable snapshot;
* current aggregate view.

Keep semantics explicit.

⸻

461. SECURITY TEST — SECRET CANARY

Inject synthetic secret canaries into:

* control-plane environment;
* worker capability boundary;
* unrelated owner scope.

Execute malicious repository fixtures.

Require canaries absent from:

* model requests where unauthorized;
* logs;
* candidate;
* Result;
* Proof.

⸻

462. SECURITY TEST — CROSS-WORK CANARY

Work A contains unique private canary.

Work B executes concurrently.

Require Work B cannot:

* read;
* infer from shared filesystem;
* receive through environment;
* expose

Work A’s canary.

⸻

463. SECURITY TEST — CROSS-OWNER CANARY

Owner A Work contains private canary.

Owner B Work runs on another worker.

Cross-owner disclosure = 0.

⸻

464. SECURITY TEST — METADATA SERVICE

Where cloud runtime exposes infrastructure metadata endpoints:

block or safely scope access.

Malicious repository attempting metadata credential retrieval must fail.

⸻

465. SECURITY TEST — NETWORK EGRESS

Malicious repository attempts arbitrary outbound connection.

Require network policy behavior matches FactoryVersion.

Unauthorized egress must not succeed silently.

⸻

466. SECURITY TEST — PUBLISH ATTEMPT

Producer repository script/model attempts:

git push

or direct GitHub write.

Require denial because producer lacks publication authority.

⸻

467. SECURITY TEST — VERIFIER DISCOVERY

Producer attempts to locate:

* protected tests;
* verifier credentials;
* verifier artifacts.

Require denial.

⸻

468. SECURITY TEST — CONTROL PLANE

Worker attempts to call privileged control-plane mutation endpoint outside its Work-scoped contract.

Require denial.

⸻

469. SECURITY TEST — STALE WORKER

Fenced worker attempts:

* event;
* artifact upload;
* candidate mutation;
* operation settlement.

Require all authoritative mutations denied.

⸻

470. SECURITY TEST — ARTIFACT TAMPERING

Alter candidate bundle between worker and custody.

Hash/signature verification must fail.

No candidate admitted.

⸻

471. SECURITY TEST — RESULT SPOOFING

Worker submits payload claiming:

verified: true.

MyFactory must ignore producer’s verification claim.

Only canonical verifier can establish verification verdict.

⸻

472. SECURITY TEST — OWNER APPROVAL SPOOFING

Worker/model submits:

ownerApproved: true.

Must grant zero publication authority.

Owner decision comes only from trusted owner-decision path.

⸻

473. SECURITY TEST — BUDGET EXPANSION

Harness requests additional operations/resources.

Without new trusted admission:

denied.

Model authority expansion count = 0.

⸻

474. SECURITY TEST — DEADLINE EXPANSION

Worker attempts to extend deadline.

Denied.

Trusted control plane owns deadline.

⸻

475. SECURITY TEST — HARNESS SWITCH

Model/harness requests another harness/provider mid-run.

Denied.

FactoryVersion remains pinned.

⸻

476. SECURITY TEST — MODEL SWITCH

Provider/model fallback attempt:

denied unless a separately qualified/admitted policy explicitly permits it.

Initial private alpha:

fallback = disabled.

⸻

477. SECURITY TEST — REPOSITORY SWITCH

Worker attempts to clone/read another private repository.

Denied unless separately granted.

⸻

478. SECURITY TEST — OWNER COMPUTER

Cloud worker attempts to invoke Jay’s Mac capability without Work-scoped authorization.

Denied.

Cloud execution must not imply Computer authority.

⸻

479. SECURITY TEST — RELAY CAPABILITY

Worker attempts ungranted Relay capability.

Denied and audited.

⸻

480. PERFORMANCE — COLD START

Measure:

Work admitted

→ worker READY.

Record p50/p95 after enough samples.

Do not optimize blindly.

⸻

481. PERFORMANCE — REPOSITORY MATERIALIZATION

Measure clone/materialization duration separately from worker startup.

This will inform whether source caching is worthwhile.

⸻

482. PERFORMANCE — CONTEXT

Measure:

repository ready

→ first productive model request.

Context assembly should remain bounded.

⸻

483. PERFORMANCE — CHECKPOINT

Measure host test/check duration.

Slow repository tests may require targeted implementation-visible suites before broader protected verification.

Do not skip required checks solely for latency.

⸻

484. PERFORMANCE — VERIFICATION

Measure verifier allocation + verification duration.

Keep separate from producer latency.

⸻

485. PERFORMANCE — TOTAL

Measure:

owner request

→ verified Result.

This is the product metric that ultimately matters.

⸻

486. COST — BASELINE

For each qualification Work record:

* Sofie model;
* Factory model;
* producer cloud runtime;
* verifier runtime;
* storage/network where material;
* total known.

⸻

487. COST — EFFICIENCY

Track:

cost per verified successful candidate

rather than only cost per model call.

A cheaper run that fails verification may be less efficient.

⸻

488. COST — DEEPAGENT COMPARISON

Compare current harness and DeepAgent using:

* verified success rate;
* operations;
* latency;
* total known cost.

⸻

489. RELIABILITY — SLO BASELINE

During private alpha collect baseline for:

* admitted Work success;
* infrastructure failure;
* verification failure;
* UNKNOWN;
* leaked workers;
* duplicate effects.

Do not invent an SLO before observing real behavior.

⸻

490. ZERO-TOLERANCE COUNTERS

Regardless of baseline, target:

cross-owner disclosures = 0

unauthorized publications = 0

duplicate authoritative candidates = 0

concurrent authoritative writers where forbidden = 0

false Ready = 0

protected holdout leakage = 0

secret disclosure = 0.

⸻

491. CLOUD EXECUTION FEATURE PAGE

Add an owner-facing settings/status surface showing:

Cloud Work

Enabled / Disabled

Background Work

Allowed / Disabled

Default execution

Automatic

Connected repositories

…

Avoid exposing low-level cloud credentials/configuration.

⸻

492. COMPUTER PAGE

Computer page should distinguish:

Your computers

Jay’s Mac — online/offline.

Cloud execution

Available/unavailable.

This helps explain why some Work can continue while Mac is offline.

⸻

493. SOFTWARE ENGINEER PAGE

Consider a specialist/work surface:

Software Engineer

Status:

Working / Idle.

Current Work.

Recent Results.

Environment:

Cloud.

Advanced:

FactoryVersion/harness/model.

⸻

494. WORK HISTORY

Owner should be able to inspect completed cloud Work without returning to the original conversation.

Work history should link:

Goal

→ Work

→ Result

→ Proof.

⸻

495. RESULT SEARCH

Results should be searchable through MyEve.

Example:

What did Software Engineer change yesterday?

Sofie retrieves canonical Results rather than relying solely on conversational memory.

⸻

496. PROACTIVE FOLLOW-UP

After verified Work completes:

Sofie may proactively tell owner:

The fix is verified and ready for your review.

If owner does nothing:

do not publish automatically unless explicit standing publication policy exists.

Initial private alpha:

publication approval required.

⸻

497. RESULT FEEDBACK

Owner feedback:

* accepted;
* rejected;
* needs changes;
* not useful.

should attach to Result and feed governed learning.

⸻

498. CHANGE REQUEST

Needs changes should create/propose a new candidate lifecycle.

Do not mutate already verified candidate in place.

⸻

499. REJECT

Rejecting candidate:

* publication authority revoked/not granted;
* candidate retained according to policy;
* Result records rejection;
* learning signal captured.

⸻

500. ACCEPT

Owner acceptance is explicit.

Depending on policy it may occur:

* before publication;
* after PR/CI/review.

Define canonical semantics and make UI wording unambiguous.

⸻

501. MERGE

Merge is not part of initial cloud-execution Golden Journey unless separately authorized and qualified.

Do not conflate:

Open PR

with

Merge PR.

⸻

502. DEPLOY

Deployment is a separate effect class.

Initial cloud milestone stops at verified candidate/PR unless current canonical


## Attachment 10: 7776781e-2588-4440-8b2f-4868a18020bc

502. DEPLOY — CONTINUED

Deployment is a separate effect class.

Initial cloud milestone stops at verified candidate/PR unless current canonical policy explicitly includes a separately approved deployment path.

Never interpret:

verification PASS

or

PR creation

as deployment authority.

⸻

503. DEPLOYMENT AUTHORITY

Future deployment authority must bind:

* Work;
* candidate;
* verified tree;
* environment;
* deployment target;
* approval;
* expiry.

A deployment approval for staging must not authorize production.

⸻

504. DEPLOYMENT VERIFICATION

Future deployment lifecycle should require:

verified candidate

→ deployment approval

→ deployment

→ health/readiness

→ bounded post-deployment verification

→ Result update.

Keep this outside V1 unless already qualified.

⸻

505. CLOUD EXECUTION API SURFACE

Define a small canonical internal API rather than leaking provider-specific concepts.

Conceptual operations:

prepareExecution

startExecution

readExecution

cancelExecution

collectExecution

destroyExecution

reconcileExecution.

Use repository naming conventions rather than mechanically adopting these names.

⸻

506. EXECUTION DESCRIPTOR

Every cloud execution should have a durable descriptor equivalent to:

* execution ID;
* Work ID;
* attempt;
* generation;
* provider;
* region;
* worker identity;
* FactoryVersion;
* runtime image digest;
* status;
* lease;
* timestamps.

Provider-specific metadata belongs behind the canonical descriptor.

⸻

507. WORKER COMMAND ENVELOPE

Every worker command must carry enough information to reject stale or misrouted commands.

Include:

* command ID;
* execution ID;
* Work ID;
* attempt;
* generation;
* writer/lease identity;
* command type;
* issued timestamp;
* expiry;
* protocol version.

⸻

508. WORKER RESULT ENVELOPE

Worker responses/events must bind to the same execution identity.

A valid signature from the wrong Work is still invalid.

⸻

509. COMMAND SIGNING

If architecture crosses an untrusted network boundary, authenticate/sign worker control messages using existing platform mechanisms where possible.

Do not invent custom cryptography when standard authenticated transport/workload identity already satisfies the requirement.

⸻

510. WORKER AUTHENTICATION

Worker authenticates to control plane using short-lived workload identity.

Authentication establishes identity.

Authorization still checks Work/attempt/capability.

⸻

511. WORKER REGISTRATION

On boot:

worker registers:

* execution identity;
* protocol;
* runtime;
* harness capabilities.

Registration alone grants zero Work execution authority.

START remains separately admitted.

⸻

512. WORKER READINESS

READY means:

runtime initialized

* repository verified
* harness available
* required bounded capabilities available.

READY does not mean productive execution has started.

⸻

513. START FENCING

START requires current:

* Work;
* generation;
* writer;
* execution lease;
* FactoryVersion.

Duplicate START:

→ same execution/readback

rather than duplicate productive execution.

⸻

514. STOP FENCING

STOP/CANCEL must be idempotent.

Repeated cancellation should not create conflicting terminal states.

⸻

515. EXECUTION STATUS

Define canonical status separately from owner-facing status.

Internal states may include:

ALLOCATING

PREPARING

READY

PRODUCTIVE

CHECKPOINT

REPAIRING

COMPLETING

COLLECTING

VERIFYING

TERMINAL.

Owner-facing UI maps these into simpler states.

⸻

516. STATE MACHINE TESTING

Generate/maintain exhaustive transition tests.

Invalid transitions must fail.

Examples:

ALLOCATING → COMPLETING

invalid.

TERMINAL → PRODUCTIVE

invalid.

VERIFYING → PRODUCTIVE

invalid for same immutable candidate lifecycle.

⸻

517. PROPERTY-BASED TESTING

Where existing stack supports it, use property-based/model-based tests for:

* lifecycle transitions;
* duplicate events;
* ordering;
* lease/fencing.

Invariants matter more than enumerating only happy examples.

⸻

518. CORE INVARIANTS

Encode as tests:

authoritative writers <= 1

authoritative cloud executions per attempt <= 1

completion operations <= admitted completion limit

candidate commits <= candidate attempt limit

verified candidate tree == custody tree

publication tree == verified tree

model authority expansions == 0

protected holdout leakage == 0.

⸻

519. CLOUD PROVIDER ERROR MODEL

Normalize provider-specific errors into canonical classes.

Example:

CAPACITY_UNAVAILABLE

ALLOCATION_FAILED

WORKER_LOST

PROVIDER_TIMEOUT

ARTIFACT_UNAVAILABLE

AUTHENTICATION_FAILED

UNKNOWN.

Preserve provider-native evidence separately.

⸻

520. HARNESS ERROR MODEL

Normalize:

MODEL_FAILURE

TOOL_FAILURE

IMPLEMENTATION_FAILED

CHECK_FAILED

PROCESS_FAILED

COMPLETION_FAILED

CANCELLED.

Do not map everything to generic 500.

⸻

521. ERROR UX

Owner-facing copy should answer:

What happened?

Did anything leave MyEve?

What can I do next?

Example:

Software Engineer couldn’t finish this change. Nothing was published. The failed attempt and evidence are preserved.

Avoid infrastructure jargon by default.

⸻

522. RETRY UX

When retry is appropriate:

owner should see a meaningful action such as:

Try again

or

Review issue

not:

Restart worker.

A retry creates canonical new authority/attempt according to policy.

⸻

523. AUTOMATIC RETRY UX

If infrastructure-only automatic retry is eventually supported:

UI should still represent one logical Work while Proof records actual attempts.

Do not hide consequential retries.

Initial private alpha should remain conservative.

⸻

524. ATTEMPT HISTORY

Work detail should expose attempt history in Advanced/Proof:

Attempt 1 — failed

Attempt 2 — verified

etc.

Current Truth derives from canonical current attempt/Result.

⸻

525. FACTORY DEBUGGING

Operator should be able to retrieve all evidence for one Work using one correlation identity.

No more searching unrelated temp directories and terminals manually.

⸻

526. EVIDENCE INDEX

Create durable evidence index:

Work

→ attempts

→ execution

→ model operations

→ artifacts

→ candidate

→ verification

→ Result/Proof.

⸻

527. EVIDENCE LINKS

README/qualification reports should link durable evidence locations where appropriate.

Avoid relying on /private/tmp as the only long-term evidence location.

⸻

528. EVIDENCE PORTABILITY

Qualification report should remain understandable without access to the original worker.

Include hashes/identities necessary to establish provenance.

⸻

529. README — TOP-LEVEL PRODUCT MODEL

Update MyEve README to clearly describe:

MyEve

persistent personal-agent platform.

Sofie

reference Digital Worker.

Relay

governed capability and agent-communication layer.

MyFactory

governed production/execution system.

DeepAgent

one possible qualified execution harness inside MyFactory.

Foreman

canonical role as decided during implementation.

⸻

530. README — CLOUD EXECUTION

Document:

Eligible Work can run in isolated cloud execution environments so Sofie can continue working while the owner’s computer is offline.

Only use this wording after P0 laptop-independence qualification passes.

Before that:

label capability Beta/qualification in progress.

⸻

531. README — LOCAL COMPUTER

Clarify:

local Computer is used when Work genuinely requires owner-local resources.

Cloud Work and Owner Computer are separate capabilities.

⸻

532. README — EXECUTION FLOW

Include a simple architecture flow:

Owner

→ Sofie / MyEve

→ Work

→ MyFactory

→ CloudExecutionProvider

→ Harness

→ Candidate

→ Independent Verifier

→ Result / Proof

→ Owner Approval.

⸻

533. README — AUTHORITY

Explain:

models propose.

trusted services authorize.

workers execute.

independent verification evaluates.

owner approves consequential external effects.

⸻

534. README — BACKGROUND WORK

Document:

* browser may close;
* Work persists;
* Today shows Current Truth;
* Needs You pauses for owner;
* notifications may surface completion/decisions.

⸻

535. README — HARNESS

Do not market DeepAgent as synonymous with MyFactory.

Explain it as a pluggable execution harness.

⸻

536. README — QUALIFICATION

Document:

* deterministic E2E;
* Playwright P0;
* live cloud canary;
* laptop-independence test;
* protected verification;
* known limitations.

⸻

537. README — STATUS MATRIX

Add a concise capability matrix:


## Attachment 11: 5aa9803c-5651-411d-b9ba-300151041f7e

538. DOCUMENTATION — CLOUD RUNBOOK

Create:

docs/runbooks/cloud-execution.md

or repository equivalent.

Include:

* enable/disable;
* qualification;
* worker inspection;
* cancellation;
* reconciliation;
* provider outage;
* leaked worker;
* rollback.

⸻

539. DOCUMENTATION — HARNESS

Document HarnessProvider contract and each qualified implementation.

Include DeepAgent limitations honestly.

⸻

540. DOCUMENTATION — PROVIDER

Document initial cloud provider:

* architecture;
* identity;
* resource limits;
* artifact flow;
* teardown;
* known limitations.

⸻

541. DOCUMENTATION — SECURITY

Add/update threat model and trust-boundary diagrams.

Security documentation must match implementation rather than aspirational architecture.

⸻

542. DOCUMENTATION — EVIDENCE

Every milestone should produce a qualification report containing:

* canonical SHAs;
* implementation status;
* tests;
* live evidence;
* limitations;
* next steps.

⸻

543. DOCUMENTATION — README REQUIREMENT

Every implementation phase that materially changes capability must update relevant README/docs with:

* capability;
* status;
* evidence links;
* limitations;
* next steps.

Do not leave documentation until the final phase.

⸻

544. IMPLEMENTATION CHECKPOINTS

Commit/push frequently after verified milestones.

Do not allow substantial qualified work to exist only in a temporary worktree.

Each checkpoint should be recoverable from remote Git.

⸻

545. BRANCH DISCIPLINE

Use one dedicated cloud-execution feature branch/worktree unless repository architecture requires coordinated branches.

Avoid creating a new branch for every small subphase.

⸻

546. REMOTE DURABILITY

After meaningful qualification:

commit

→ push

→ verify remote SHA.

This requirement exists specifically because prior MyFactory work was lost from temporary local state.

⸻

547. TAGGING

Use existing repository tag/release conventions if present.

Do not invent a new tag scheme casually.

At major cloud milestone, create a durable milestone reference if canonical release process supports it.

⸻

548. WORKTREE HYGIENE

Do not delete other dirty/protected worktrees.

At completion:

clean only this workstream according to canonical repository hygiene.

⸻

549. PARALLEL DEVELOPMENT

The Attempt-8 owner-publication workstream may advance MyEve main concurrently.

Before every integration:

fetch remote main

→ reconcile normally

→ preserve newer canonical work

→ rerun affected qualification.

Never reset or force-push to win a race.

⸻

550. MYFACTORY PARALLELISM

Same rule for MyFactory.

Cloud work must preserve all current private-alpha execution fixes from Attempts 1–8.

⸻

551. RELAY PARALLELISM

If Relay changes are required:

minimize them.

Fetch/reconcile current canonical Relay main.

Do not fork Relay semantics unnecessarily into MyFactory.

⸻

552. PHASE REPORTING FORMAT

After each major phase report:

Phase: …

Status: PASS / PARTIAL / FAIL

Implemented: …

Tests: …

Canonical/feature SHA: …

Remote verified: …

Live evidence: …

Known limitations: …

Next phase: …

Continue automatically unless a genuine owner decision/credential/external-effect approval is required.

⸻

553. DO NOT STOP FOR ROUTINE QUESTIONS

Do not repeatedly ask Jay:

* which file to edit;
* whether to run tests;
* whether to commit;
* whether to continue to the next implementation phase.

Those are part of this authorized development mission.

Stop only for:

* new external credentials requiring owner setup;
* consequential external effects outside existing authorization;
* architectural decision with materially different product consequences that cannot be resolved from repository evidence;
* genuine security boundary requiring owner approval.

⸻

554. NO PAID LIVE EXECUTION UNTIL READY

Use deterministic/synthetic provider qualification throughout implementation.

Do not spend real model operations simply to discover basic wiring defects.

Reach the controlled provider boundary first.

⸻

555. LIVE CANARY AUTHORIZATION

Before the first paid/real cloud model Work:

return a bounded authorization envelope containing:

* Work;
* repository;
* objective;
* cloud provider;
* region;
* runtime image digest;
* harness;
* model;
* operation limits;
* attempt limits;
* duration;
* resource/cost ceiling;
* allowed effects;
* publication state.

Wait for explicit authorization for that live canary.

⸻

556. CLOUD INFRASTRUCTURE CREATION

Development of required cloud infrastructure is authorized within the project’s existing development/staging environment where current repository/deployment permissions permit it.

Do not create production resources, incur material new recurring infrastructure commitments, or modify unrelated external systems without the appropriate explicit approval.

Prefer staging qualification before production/private-alpha activation.

⸻

557. CLOUD PROVIDER COST CONTROL

Before provisioning:

estimate:

* worker runtime cost;
* storage;
* expected private-alpha usage.

Do not block the project over pennies, but do not accidentally create unbounded always-on infrastructure.

Prefer scale-to-zero/ephemeral execution for private alpha where technically appropriate.

⸻

558. PRIVATE-ALPHA CAPACITY

Initial target is two business partners, not thousands of tenants.

Optimize for:

correctness

→ isolation

→ recoverability

→ usability

before massive scale.

⸻

559. INITIAL CONCURRENCY TARGET

Start with a small explicit limit, for example:

* 1–2 concurrent Work executions per owner;
* small deployment-wide worker ceiling.

Determine exact value from provider/resource architecture.

Make it configurable.

⸻

560. SCALE PATH

Document how architecture could later support:

* more owners;
* more concurrent workers;
* multiple providers/regions;
* warm capacity.

Do not implement those prematurely.

⸻

561. PROVIDER LOCK-IN REVIEW

After initial provider works, identify provider-specific dependencies.

Ensure canonical Work/Result/Proof semantics remain provider-independent.


## Attachment 12: 3008687f-6591-4e18-b8c1-bf30c52b84d5

562. PROVIDER ABSTRACTION TEST

Prove the canonical MyFactory execution lifecycle can be exercised against:

* deterministic/fake provider;
* selected real cloud provider

through the same ExecutionProvider contract.

Provider-specific shortcuts must not leak into Work/Result semantics.

⸻

563. PORTABILITY DEFINITION OF DONE

Portability does NOT require implementing a second real provider.

It requires:

* provider-neutral canonical contracts;
* deterministic fake provider;
* selected production provider behind those contracts;
* no provider-specific authority encoded into Work itself.

⸻

564. CLOUD SERVICE OWNERSHIP

Document which component owns each production responsibility:

MyEve

owner experience, Work, Goals, approvals, Result presentation.

Relay

identity/capabilities/agent communication.

MyFactory Control Plane

execution orchestration, leases, candidate lifecycle, verification orchestration.

CloudExecutionProvider

isolated execution environment.

HarnessProvider

agent execution inside sandbox.

Artifact/Custody Layer

immutable candidate/evidence.

Verifier

independent qualification.

Publisher

separately approved external source-control effects.

Avoid overlapping ownership.

⸻

565. CONTROL PLANE HIGH AVAILABILITY

Private alpha does not require sophisticated multi-region HA.

It does require:

* durable state;
* restart recovery;
* no dependence on one developer laptop;
* safe reconciliation after process loss.

One restartable cloud control-plane deployment is acceptable initially.

⸻

566. CONTROL PLANE SINGLETON ASSUMPTION

Do not rely on an unenforced singleton process for correctness.

Even if private alpha initially runs one control-plane instance:

database/lease invariants must prevent two instances from creating duplicate authoritative execution.

⸻

567. MULTIPLE CONTROL PLANE TEST

Start two control-plane instances against the same durable state.

Submit one Work.

Require:

authoritative worker allocations = 1

authoritative writers = 1

duplicate dispatches = 0.

⸻

568. SCHEDULER LEADERSHIP

If scheduler requires one active leader:

implement durable leader election/lease using existing infrastructure where practical.

Do not depend on “we only deploy one instance.”

⸻

569. QUEUE VISIBILITY TIMEOUT

If selected queue uses visibility leases:

configure them relative to execution admission/worker handoff.

Queue visibility is not the same as MyFactory execution authority.

⸻

570. QUEUE POISON MESSAGE

Malformed/unprocessable queue item:

→ quarantine/dead-letter

→ no infinite hot loop

→ no authority creation.

⸻

571. QUEUE BACKLOG UX

If Work waits because of capacity/backlog:

owner sees:

Waiting for execution capacity

not:

Working

when no worker exists.

⸻

572. CAPACITY ESTIMATE

Work admission should know whether cloud execution is:

* available;
* temporarily capacity-constrained;
* disabled.

This may influence owner-facing state but must not bypass authorization.

⸻

573. PRIORITY

Initial queue priority should remain simple.

Suggested:

* owner-interactive;
* normal background;
* scheduled/low priority.

Do not implement elaborate priority economics for private alpha.

⸻

574. STARVATION

Ensure low-priority Work is not permanently starved.

Basic FIFO within priority class is sufficient initially.

⸻

575. CANCELLATION PRIORITY

Cancellation/control commands must not wait behind normal Work queue.

They require a responsive control path.

⸻

576. RESOURCE RESERVATION

Cloud worker allocation and model-operation reservation are separate resources.

A worker existing does not imply permission to spend model operations.

Preserve canonical operation admission.

⸻

577. PREWARMING

If later using warm workers:

prewarmed worker has:

capacity

but zero Work authority.

Authority begins only after canonical Work binding/admission.

⸻

578. WORKER BINDING

Once a worker is assigned:

bind:

worker

→ execution

→ Work

→ attempt

→ generation.

Worker must reject commands for another binding.

⸻

579. WORKER REBINDING

V1 preference:

do not rebind one live worker between unrelated Work.

Use ephemeral one-Work workers.

This reduces isolation complexity.

⸻

580. CLOUD EXECUTION DATABASE MODEL

Before adding schema, map existing MyFactory entities.

Prefer extending existing:

WorkOrder

execution/attempt

writer/lease

operation ledger

candidate

verification

rather than creating parallel concepts with slightly different names.

⸻

581. NO SECOND SOURCE OF TRUTH

Cloud provider state is external execution state.

It must not become a second independent business source of truth.

Canonical MyFactory state + reconciliation determines Current Truth.

⸻

582. PROVIDER IDENTIFIER

Persist provider execution/job/sandbox identifier as external reference.

Never use it as the sole internal Work identity.

⸻

583. CLOUD EVENT STORAGE

Store structured cloud execution events with bounded payloads.

Large logs/artifacts belong in artifact storage with references.

⸻

584. EVENT RETENTION

Retain enough event history for:

* debugging;
* reconciliation;
* Proof.

Compact/archive older low-value operational events according to policy.

⸻

585. MODEL REQUEST PRIVACY

Before sending model context:

validate Work scope.

Do not automatically send:

* unrelated conversations;
* full Memory profile;
* unrelated repository secrets;
* protected verification material.

⸻

586. MODEL REQUEST EVIDENCE

Record safe metadata:

* model;
* operation;
* context artifact/hash;
* usage;
* timing.

Avoid retaining full sensitive prompts unnecessarily.

⸻

587. CONTEXT ARTIFACT

Consider producing a deterministic context manifest:

* files/ranges included;
* public tests included;
* skills included;
* memory/artifacts included where authorized.

This helps diagnose context misses without storing hidden reasoning.

⸻

588. CONTEXT HASH

Hash canonical context manifest/content where practical.

Candidate Proof may reference it.

This helps reproduce why two runs differed.

⸻

589. CONTEXT BUDGET

Enforce bounded context size.

When repository context exceeds budget:

deterministic discovery/retrieval selects relevant material.

Do not silently truncate arbitrary bytes.

⸻

590. CONTEXT RETRIEVAL

Future context retrieval may use search/indexing.

Retrieval system may propose relevant content.

Work authority still determines what content is allowed.

⸻

591. CONTEXT FAILURE

If required context cannot be retrieved:

fail/Needs attention rather than hallucinating repository state.

⸻

592. REPOSITORY INDEX

Cloud execution may build ephemeral repository indexes.

Index must remain Work/repository scoped.

Do not leak private repo content into a global cross-owner index.

⸻

593. INDEX CACHE

Future content-addressed repository index cache may be shared only where access policy permits.

Private-alpha implementation may skip this optimization.

⸻

594. SKILL EXECUTION

Skills may provide instructions/tool workflows.

They do not grant new capabilities.

Capability authorization remains separate.

⸻

595. SKILL HASHING

Record exact skill versions/hashes in FactoryVersion/evidence.

Dynamic skill content must not silently change a running attempt.

⸻

596. SKILL QUALIFICATION

Production Factory skills should be qualified against relevant corpus.

A new skill version should not automatically replace the pinned version for active Work.

⸻

597. DEEPAGENT SKILLS

If DeepAgent has its own skill/plugin mechanism:

adapt it to canonical MyFactory skill/capability policy.

Do not create an independent ungoverned skill authority.

⸻

598. MCP

If MCP tools are exposed to cloud harness:

each server/tool must be:

* explicitly configured;
* capability-scoped;
* authenticated;
* versioned/qualified where necessary.

Do not expose arbitrary owner MCP servers to every cloud worker.

⸻

599. MCP NETWORK BOUNDARY

Prefer Relay or another governed proxy for sensitive owner capabilities rather than direct worker access to private networks.

⸻

600. MCP TOOL SEARCH

Preserve qualified client-executed tool-search semantics.

Tool search itself grants zero tool authority.

Returned tools must still pass capability policy.

⸻

601. TOOL INVENTORY

FactoryVersion should identify allowed tool inventory or policy.

Unknown tool definition:

fail closed according to existing governance.

⸻

602. TOOL AUDIT

Record meaningful tool operations:

* tool identity;
* operation;
* outcome;
* duration;
* bounded evidence.

Do not log secrets/tool payloads indiscriminately.

⸻

603. SHELL TOOL

Shell runs only inside execution sandbox.

Never expose control-plane host shell as a generic model tool.

⸻

604. FILE TOOL

File tool root is the Work workspace and explicitly mounted artifacts.

Path escape denied.

⸻

605. GIT TOOL

Producer Git capability:

* status;
* diff;
* local commit where host policy allows.

No remote push.

Publication uses separate publisher.

⸻

606. TEST TOOL

Host checkpoint may execute canonical tests without model intervention.

Test results become bounded feedback/evidence.

⸻

607. NETWORK TOOL

Generic arbitrary network tool should not be granted by default.

External APIs should preferably be explicit capabilities.

⸻

608. BROWSER TOOL

If coding Work requires web research:

use qualified browser/web capability with bounded network policy.

Do not equate browser access with arbitrary internet mutation.

⸻

609. DOCUMENTATION TOOL

Repository documentation edits follow same candidate lifecycle as code.

No special bypass because a change is “just docs.”

⸻

610. NO-CHANGE RESULT

MyFactory must support legitimate:

No change required

outcome.

Model should not be forced to manufacture a diff.

Host verifies no candidate changes and produces truthful Result.

⸻

611. NO-CHANGE QUALIFICATION

Add corpus case:

objective already satisfied.

Expected:

* no file mutation;
* no candidate commit unless canonical policy requires evidence commit;
* Result explains why no change was necessary;
* verification may confirm existing state.

⸻

612. IMPOSSIBLE WORK

Add corpus case:

requirement cannot be satisfied from available repository/capabilities.

Expected:

Needs attention / blocked.

No fabricated candidate.

⸻

613. AMBIGUOUS WORK

Add corpus case where acceptance criteria are materially ambiguous.

Sofie/MyFactory should seek clarification before expensive cloud execution where appropriate.

⸻

614. CLARIFICATION BOUNDARY

Clarification request does not consume candidate attempt.

Work remains waiting on owner.

⸻

615. OWNER RESPONSE

Owner response updates canonical Work intent/revision.

Stale worker from previous generation must remain fenced.

⸻

616. WORK REVISION

Material objective/acceptance changes increment Work revision/generation according to canonical semantics.

Do not mutate an active execution’s objective underneath it.

⸻

617. CANDIDATE SUPERSESSION

New candidate resulting from requested changes supersedes previous candidate but does not delete its history.

⸻

618. RESULT SUPERSESSION

Current Result may point to latest canonical outcome.

Historical Results remain immutable.

⸻

619. CLOUD QUALIFICATION DATASET

Create versioned qualification dataset containing:

* Work objective;
* fixture repo SHA;
* expected visible checks;
* protected verifier policy;
* expected lifecycle outcome.

⸻

620. QUALIFICATION REPRODUCIBILITY

Running the deterministic qualification suite against same FactoryVersion should produce equivalent lifecycle/evidence expectations.

Model fixture randomness = 0.

⸻

621. LIVE VARIABILITY

Live model canary may vary in implementation.

Success is judged by:

contract

* tests
* independent verification

rather than byte-identical generated source.

⸻

622. LIVE CANARY HISTORY

Preserve canary outcomes over time.

Track regressions by:

FactoryVersion

* model
* harness
* provider.

⸻

623. CANARY FAILURE POLICY

Failed live canary:

* freeze promotion;
* preserve evidence;
* investigate;
* add deterministic regression where possible.

Do not repeatedly rerun until green.

⸻

624. RELEASE QUALIFICATION REPORT

Generate a durable report:

Source

MyEve SHA

Relay SHA

MyFactory SHA.

Runtime

cloud provider

image digest

harness

model

FactoryVersion.

Deterministic

unit/integration/E2E/fault/security.

Live

cloud canary

laptop-off canary.

Safety

zero-tolerance counters.

Limitations

known unsupported capabilities.

⸻

625. RELEASE QUALIFICATION STATUS

Use:

READY

PARTIAL

NOT_READY.

Never collapse


## Attachment 13: a42a1bb5-c3e1-4ce5-a66c-385884dcee9e

635. PRODUCT BEHAVIOR — FAILED BACKGROUND WORK

If background cloud Work fails while owner is away:

Sofie should return with a truthful bounded summary:

I couldn’t finish this change. Nothing was published. I preserved the failed attempt and evidence so we can review what happened.

Provide:

* failure category;
* last trustworthy state;
* whether candidate exists;
* whether anything external occurred;
* recommended next action.

Do not bury failures because the owner was offline.

⸻

636. PRODUCT BEHAVIOR — VERIFICATION FAILURE

If implementation completes but independent verification fails:

owner experience should distinguish:

Work was produced

from

Work was verified.

Example:

Software Engineer produced a candidate, but independent verification found a problem. I did not publish it.

Ready remains false.

⸻

637. PRODUCT BEHAVIOR — WAITING FOR OWNER

If Work reaches an approval boundary:

Sofie should stop safely and surface:

Needs You

with:

* what is ready;
* what decision is needed;
* what will happen if approved;
* what will remain private if declined.

⸻

638. PRODUCT BEHAVIOR — WAITING FOR MAC

If Work genuinely requires owner-local resources while Mac is unavailable:

Sofie should say:

This needs your Mac, so I’ve paused it until your computer reconnects.

Do not silently substitute cloud resources.

⸻

639. PRODUCT BEHAVIOR — WAITING FOR CAPACITY

If cloud capacity is unavailable:

owner sees:

Waiting for cloud capacity

rather than false Working.

Work should automatically begin when capacity becomes available if existing authority remains valid.

⸻

640. PRODUCT BEHAVIOR — UNKNOWN

UNKNOWN must have distinct owner semantics.

Example:

I can’t yet confirm whether the last operation completed, so I stopped rather than risk doing it twice.

Provide safe recovery/action when available.

Never present UNKNOWN as ordinary failure.

⸻

641. OWNER TRUST MODEL

The product should make four states easy to understand:

Working

MyEve has authority and is actively progressing.

Waiting

Work is safe but blocked on capacity/dependency.

Needs You

owner authority/decision is required.

Needs Attention

execution or verification failed/ambiguous.

These states should be consistent across Today, Work, Inbox and chat.

⸻

642. OWNER INTERRUPTION

Owner may send a new message while background Work is running.

Sofie must distinguish:

* question about existing Work;
* request to change existing Work;
* unrelated new request;
* cancellation.

Do not accidentally mutate active Work intent from casual conversation.

⸻

643. ASK ABOUT RUNNING WORK

Example:

How is the checkout fix going?

Sofie should read canonical Current Truth and answer.

This must not create another Work or model execution in MyFactory merely to obtain status.

⸻

644. CHANGE RUNNING WORK

Example:

Also make it support coupons.

Determine whether this materially changes Work scope.

If yes:

require canonical revision/replanning semantics.

Do not silently add scope to active worker.

⸻

645. CANCEL NATURALLY

Example:

Stop working on the checkout fix.

Sofie should resolve the referenced Work and invoke canonical cancellation.

No Work ID should be required from owner.

⸻

646. MULTIPLE ACTIVE WORK

Sofie may have multiple background Works.

Natural references such as:

the checkout fix

the research task

should resolve through canonical Work metadata.

If ambiguous:

ask.

⸻

647. WORK TITLES

Generate concise human-readable Work titles from objective.

Titles are presentation metadata, not authority.

Preserve canonical Work ID internally.

⸻

648. WORK SUMMARY

Maintain a bounded owner-facing summary separate from raw model context.

Update from canonical events/Results.

Do not use mutable summary as source of execution truth.

⸻

649. LIVE PROGRESS

Owner may inspect live activity.

Show:

* stage;
* meaningful recent action;
* elapsed time.

Avoid raw hidden reasoning.

⸻

650. WORK TIMELINE

Timeline should include meaningful milestones:

* requested;
* admitted;
* started in cloud;
* implementation completed;
* checks;
* verification;
* owner decision;
* publication.

Internal heartbeats should not flood timeline.

⸻

651. PROOF TIMELINE

Advanced Proof may expose more granular evidence:

* model operations;
* tool/checkpoint activity;
* candidate custody;
* verifier.

Keep owner timeline readable.

⸻

652. WORK DURATION UX

Show:

Started 3:42 PM

Finished 3:48 PM

or elapsed duration.

Do not promise estimated completion time unless supported by measured prediction.

⸻

653. CLOUD WORK BADGE

Use subtle environment indication:

Cloud

or

Working in cloud.

Avoid making infrastructure the dominant UI.

⸻

654. HARNESS NOT PRIMARY UX

Do not show:

DeepAgent

as the primary owner-facing worker name unless user explicitly opens technical details.

Owner cares that Software Engineer is working.

⸻

655. MODEL NOT PRIMARY UX

Likewise:

model identity belongs in Advanced/Proof.

Owner should not need to understand model routing to use Sofie.

⸻

656. COST WHILE RUNNING

If reliable accounting supports it:

Work detail may show bounded:

Used $0.04 so far

or resource usage.

Avoid implying exactness if provider settlement is incomplete.

⸻

657. BUDGET OWNER UX

For substantial Work, owner may see:

Budget

$X maximum.

Ordinary low-cost Work should not require manual budget configuration every time once standing policy exists.

⸻

658. BUDGET POLICY SETTINGS

Future owner settings may include:

* maximum per Work;
* maximum daily autonomous spend;
* require approval above threshold.

Do not make this a blocker for initial two-user private alpha.

⸻

659. DEFAULT BUDGET POLICY

Establish conservative private-alpha defaults.

Defaults must be enforced server-side.

Model cannot raise them.

⸻

660. OWNER APPROVAL FOR BUDGET EXPANSION

If Work legitimately needs more resources:

pause

→ Needs You

→ explain why

→ request bounded expansion.

Approval creates new canonical authority.

⸻

661. NO MICRO-APPROVALS

Do not ask owner to approve:

* every model call;
* every test;
* every local sandbox edit.

Once Work is admitted within policy, MyFactory should execute autonomously until a meaningful authority boundary.

⸻

662. APPROVAL POLICY

Initial private-alpha default:

Internal sandbox work

autonomous.

Verification

autonomous.

Publication

owner approval.

Merge

owner approval/not enabled.

Deployment

separate approval/not enabled.

⸻

663. STANDING PUBLICATION POLICY — FUTURE

Future owners may configure bounded standing policy for low-risk repositories.

Do not implement automatic publication during initial private alpha.

⸻

664. OWNER DECISION UI

Preserve the four canonical candidate actions:

Open a pull request

Push branch only

Keep private

Reject candidate

Tie these to actual Result/candidate.

Fixture-only UI does not qualify.

⸻

665. OPEN PR

Owner approval authorizes:

* exact verified candidate;
* exact repository;
* exact branch;
* exact base;
* one PR.

No merge.

⸻

666. PUSH ONLY

Owner approval authorizes:

* exact verified candidate;
* one branch push.

PR count = 0.

⸻

667. KEEP PRIVATE

No source-control external write.

Candidate remains durable in custody.

⸻

668. REJECT

No source-control write.

Candidate cannot later publish under stale approval.

⸻

669. OWNER DECISION PLAYWRIGHT

Automate all four real choices through production UI against controlled publisher boundary.

Assert exact effects.

⸻

670. PUBLICATION CI

Once publication qualification workstream completes, integrate its exact-tree/base-ref/dirty-workspace guards into cloud publisher.

Do not build a second publication implementation.

⸻

671. CLOUD PUBLICATION REUSE

Cloud execution project should consume the canonical publisher developed from Attempt 8.

Producer location must not alter publication semantics.

⸻

672. PUBLISHER DURABILITY

Publisher must operate from durable candidate custody.

It must work after producer/verifier sandboxes are gone.

⸻

673. PUBLISHER RESTART

Restart publisher/control plane during publication.

Reconcile:

branch exists?

PR exists?

exact candidate?

Then continue/readback without duplicate effect.

⸻

674. GITHUB AMBIGUITY

If push/PR request times out:

reconcile GitHub state before retrying.

Do not blindly repeat external writes.

⸻

675. CI READBACK

CI status polling/readback may retry safely.

It must remain bound to exact published candidate SHA.

⸻

676. REVIEW READBACK

Independent review state similarly binds to exact candidate/PR.

Stale review for prior candidate cannot approve successor.

⸻

677. OWNER ACCEPTANCE AFTER CI

Target initial lifecycle:

verified candidate

→ owner approves PR

→ PR published

→ CI

→ independent review

→ owner acceptance.

Result may remain PARTIAL until acceptance according to canonical semantics.

⸻

678. FINAL RESULT

Once all required acceptance conditions are established:

Result may become canonical PASS/accepted state.

Do not rewrite historical pre-publication Proof snapshot.

⸻

679. GOLDEN JOURNEY V2

After cloud + publication qualification:

define the full product Golden Journey:

Natural owner request

→ Sofie

→ cloud Work

→ verified candidate

→ owner approval

→ PR

→ CI

→ review

→ owner acceptance

→ final Result.

⸻

680. GOLDEN JOURNEY V2 PLAYWRIGHT

Automate this end-to-end using:

* real UI;
* deterministic model provider;
* real cloud execution contract/fake or staging sandbox according to tier;
* controlled GitHub publisher in CI.

Release qualification additionally exercises real external boundaries.

⸻

681. NO INTERNAL SHORTCUTS IN P0

P0 test may seed prerequisite identities/configuration.

Once owner submits the natural request:

do not:

* insert Result directly;
* create candidate directly;
* mark verification PASS directly;
* invoke publisher without owner UI.

Drive production lifecycle.

⸻

682. TEST SPEED

Keep deterministic P0 fast enough for regular CI by:

* tiny fixture repositories;
* deterministic model responses;
* bounded sandbox startup;
* targeted tests.

Do not remove lifecycle boundaries merely for speed.

⸻

683. TEST PARALLELISM

E2E tests may run in parallel only when:

* test owners isolated;
* repositories/


## Attachment 14: 811c0c91-3e67-4b23-a191-826f3bc3de64

705. ROUTING CURRENT TRUTH

Execution routing decisions must become durable evidence.

Record:

* requested capabilities;
* eligible environments;
* selected environment;
* policy/version;
* decision timestamp.

Do not require hidden model reasoning to explain the route.

⸻

706. ROUTING REEVALUATION

A Work waiting for an unavailable environment may be reevaluated when availability changes.

Reevaluation may begin execution only if:

* existing authority remains valid;
* Work generation remains current;
* selected environment remains permitted.

⸻

707. ROUTING CHANGE

Changing an already-admitted execution environment requires canonical re-admission.

Example:

CLOUD

→ LOCAL_COMPUTER

cannot occur as an invisible failover.

⸻

708. WAITING FOR COMPUTER

When Mac reconnects:

MyEve should detect eligible waiting Work.

If existing authority permits:

→ continue automatically.

Otherwise:

→ Needs You.

⸻

709. WAITING FOR CLOUD

When cloud capacity/service returns:

queued eligible Work may proceed automatically under its still-valid admission.

Preserve deadline/authority checks.

⸻

710. CLOUD AVAILABILITY EVENTS

Availability changes should not create owner-notification noise.

Notify only when:

* Work becomes actionable;
* owner intervention is required;
* meaningful failure occurs.

⸻

711. CLOUD EXECUTION CONTROL CENTER

Extend the agent-native MyFactory control-center design to include cloud execution.

Operator view should support drill-down:

Objective

→ WorkOrder

→ Task

→ route

→ execution environment

→ worker

→ harness

→ operations

→ candidate

→ verification

→ Result.

⸻

712. CONTROL CENTER — RUN DASHBOARD

Dashboard cards:

Active Work

Queued

Needs Attention

Verifying

Ready for Review

Recently Completed.

Show cloud/local distinction without making provider details dominant.

⸻

713. CONTROL CENTER — EXECUTION DETAIL

Execution detail should show:

* environment;
* provider;
* sandbox/job;
* FactoryVersion;
* harness;
* exact model;
* operation envelope;
* operations consumed;
* duration;
* lease;
* heartbeat;
* resource usage.

⸻

714. CONTROL CENTER — ROUTING DECISION

Show:

Selected: Cloud

Why: repository and required capabilities are cloud-accessible.

Alternatives: Local not required.

This explanation comes from policy/routing evidence.

⸻

715. CONTROL CENTER — CANDIDATE

Candidate detail:

* base SHA;
* candidate SHA;
* tree SHA;
* files changed;
* implementation checks;
* custody;
* verification.

⸻

716. CONTROL CENTER — EVIDENCE

Provide evidence navigation without requiring filesystem archaeology.

Links:

* admission;
* execution;
* checkpoint;
* candidate;
* verification;
* Result;
* Proof.

⸻

717. CONTROL CENTER — OPERATOR ACTIONS

Allow only bounded actions:

Cancel

Reconcile

Inspect

Fence

Teardown confirmed orphan

according to authorization.

Do not add:

Mark PASS

or

Skip verification.

⸻

718. CONTROL CENTER — AGENT NATIVE

The control center itself should be agent-native.

Operator may ask:

Why is this Work waiting?

Show me cloud executions with stale heartbeats.

What failed verification today?

Reconcile this Work.

Agent actions still use canonical governed operator capabilities.

⸻

719. AGENT-NATIVE UI ACTIONS

UI components should expose machine-readable actions/state so Sofie/operator agents can navigate the same product model.

Do not build a second hidden admin API with broader authority solely for agents.

⸻

720. CONTROL CENTER PLAYWRIGHT

Automate:

* active cloud Work visible;
* execution drill-down;
* candidate evidence;
* verification;
* cancellation;
* reconciliation.

⸻

721. CONTROL CENTER MOBILE

Full operator control center does not need complete mobile parity for V1.

Critical:

* status;
* Needs Attention;
* Cancel

should remain usable where practical.

⸻

722. MYEVE / MYFACTORY LINK

From MyEve Work:

advanced users may open:

View execution details

→ MyFactory control center.

Preserve Work correlation.

⸻

723. MYFACTORY → MYEVE LINK

From Factory execution:

operator can navigate back to:

* originating Sofie conversation;
* Goal;
* Work;
* Result.

⸻

724. RELAY CONTROL CENTER

Do not duplicate Relay’s capability-management UI inside MyFactory.

MyFactory may link to relevant grant/audit evidence.

⸻

725. DISTRIBUTION REQUIREMENT

Architecture must continue supporting distribution to other users.

Do not hard-code:

* Jay’s account;
* Jay’s repositories;
* Sofie’s deployment;
* one Vercel project;
* one cloud-provider account.

⸻

726. PER-DEPLOYMENT CLOUD CONFIGURATION

Builder/deployment configuration should eventually support:

* cloud execution enabled;
* provider configuration;
* allowed repositories;
* resource policy;
* harness selection among qualified options.

Do not expose unnecessary complexity during initial setup.

⸻

727. MYEVE BUILDER

Extend Builder only after cloud execution is qualified for the reference deployment.

Builder should eventually provision/configure cloud execution safely for another MyEve owner.

⸻

728. BUILDER EXPERIENCE

Target:

owner deploys MyEve

→ cloud execution provisioned/configured

→ MyFactory connected

→ Relay connected

→ qualification check

→ ready.

Avoid requiring dozens of manual environment variables.

⸻

729. BUILDER SECRETS

Builder must never display/copy raw long-lived secrets unnecessarily.

Prefer workload identity and generated scoped credentials.

⸻

730. BUILDER QUALIFICATION

Automated Builder test should deploy/configure a disposable MyEve instance with deterministic cloud execution and run a smoke Work.

⸻

731. MULTIPLE MYEVE INSTANCES

Relay/MyFactory architecture should support multiple independently deployed MyEve agents.

Each instance must have explicit identity.

⸻

732. MYFACTORY SHARING MODEL

Decide whether distributed MyEve installations use:

one MyFactory per owner/business

or

shared MyFactory control plane with strong tenant isolation.

For current private alpha, prefer the architecture already closest to canonical source reality.

Document the decision.

⸻

733. SHARED CONTROL PLANE

If shared:

tenant/owner scope must bind:

* Work;
* queue;
* worker;
* artifacts;
* verification;
* publisher.

Cross-tenant leakage target = 0.

⸻

734. DEDICATED CONTROL PLANE

If dedicated:

deployment automation must make provisioning/update manageable.

Do not assume manual developer setup forever.

⸻

735. ONE MYFACTORY PER BUSINESS

This may align with the product model used by private agent deployments:

one business

→ MyEve

→ Relay scope

→ MyFactory.

Evaluate operational cost and isolation.

⸻

736. SHARED RELAY

Relay may remain shared capability infrastructure across an owner’s agents.

MyFactory should integrate through explicit agent/Work grants rather than implicit trust.

⸻

737. AGENT GROUPS

Future Agent Groups may share one MyFactory while retaining per-agent grants.

Do not make Group support a prerequisite for cloud execution.

⸻

738. EXTERNAL AGENTS

Muse, GrokBots or other agents may eventually request/share information through Relay.

They must not directly invoke privileged MyFactory execution without registered identity and authorization.

⸻

739. FEDERATED WORK REQUEST

Future protocol:

peer

→ Relay

→ request

→ MyEve policy

→ Work proposal

→ admission

→ MyFactory.

Peer request itself grants zero Factory authority.

⸻

740. FEDERATED RESULT

Result may be shared back according to scope.

Do not automatically share:

* private repository source;
* protected verification;
* owner-private Proof.

Provide bounded Result summary.

⸻

741. CLOUD EXECUTION AS RELAY CAPABILITY

Consider representing MyFactory submission/readback as a Relay-governed capability for agents.

Preserve MyEve’s owner policy/admission layer.

Do not let Relay grant Factory authority merely because an agent can message it.

⸻

742. AGENT ADDRESSING

Work provenance should retain originating agent identity/address when created through federation.

⸻

743. FEDERATION PLAYWRIGHT / CONTRACT

UI + contract qualification:

external authorized peer

→ Relay

→ Sofie

→ cloud Work

→ Result

→ peer.

No duplicate Work from duplicate peer delivery.

⸻

744. FEDERATION REVOCATION

Revoke peer grant while Work is active.

Existing admitted Work behavior follows explicit policy.

New peer requests denied.

⸻

745. CLOUD EXECUTION LEARNING

Capture structured failure/success signals for future governed learning.

Example:

* context miss;
* first-pass success;
* repair success;
* verifier failure;
* provider failure;
* owner rejection.

⸻

746. LEARNING DATA PRIVACY

Learning corpus must respect:

* owner;
* repository;
* private/shared scope.

Do not create a cross-owner training corpus from private source without explicit policy.

⸻

747. SELF-IMPROVEMENT FACTORY

Future MyFactory improvements may be proposed from telemetry.

They still travel:

insight

→ proposal

→ Work

→ candidate

→ verification

→ approval.

No self-deploying autonomous mutation.

⸻

748. CONTINUOUS EVALUATION

Run qualification corpus against new:

* models;
* harness versions;
* context strategies;
* runtime images.

Compare against current qualified baseline.

⸻

749. REGRESSION THRESHOLD

New FactoryVersion must not promote if it regresses launch-critical invariants even if average coding quality improves.

Safety/correctness gates are hard gates.

⸻

750. QUALITY METRICS

Compare:

* verified success rate;
* first-pass success;
* repair success;
* operations;
* cost;
* latency.

Avoid optimizing solely for visible test pass.

⸻

751. VERIFICATION QUALITY

Protected verification itself needs evaluation.

Track:

* defects caught after visible PASS;
* false rejection investigations;
* public/protected contract drift.

Attempt 7 becomes a permanent example.

⸻

752. CONTRACT DRIFT

Public specification and protected verifier must share canonical public contract artifacts where appropriate.

Protected verifier may add hidden cases, not undocumented public requirements.

⸻

753. CONTRACT VERSION

Record public contract version/hash used by:

* implementation context;
* visible tests;
* verifier.

⸻

754. HOLDOUT ROTATION

Future protected holdouts may rotate without changing public contract.

Producer must not gain access to rotation data.

⸻

755. VERIFIER MODEL — FUTURE

If verifier later uses an LLM:

pin and account it separately.

Deterministic verification should remain preferred where sufficient.

⸻

756. MULTI-VERIFIER — FUTURE

Architecture may support:

* deterministic tests;
* static analysis;
* security;
* model review.

Do not implement a complex voting system for V1.

⸻

757. GATE SEMANTICS

Keep Gate B/C naming internally if canonical.

Owner UI should use:

Independent verification passed

rather than requiring owner to understand gate letters.

⸻

758. VERIFICATION EVIDENCE

Owner sees concise:

11/11 independent checks passed.

Proof may expose detailed verifier evidence.

⸻

759. VERIFICATION FAILURE FEEDBACK

Protected verifier failure should not automatically feed hidden answers back into producer.

A new repair candidate may receive only public-safe defect information according to policy.

⸻

760. POST-VERIFICATION REPAIR

If protected verification finds a defect:

candidate remains immutable failed candidate.

Repair requires new candidate lifecycle.

Do not mutate verified/failed candidate in place.

⸻

761. CLOUD REPAIR AFTER VERIFICATION

Future flow:

verifier failure

→ public-safe failure classification

→ new Work/candidate attempt if authorized

→ producer

→ new candidate

→ fresh verification.

Attempt limits remain enforced.

⸻

762. OWNER VISIBILITY OF REPAIR

Owner should see:

Verification found an issue; Software Engineer is repairing it

only if repair is actually authorized and underway.

Otherwise:

Needs attention.

⸻

763. MAX REPAIR POLICY

Initial cloud private alpha should retain conservative attempt limits.

Do not create endless autonomous repair loops.

⸻

764. TIME BUDGET

Work deadline includes:

* queue;
* production;
* checkpoint;
* completion

according to canonical policy.

Verification may have a separately bounded deadline if architecture requires.

⸻

765. QUEUE DEADLINE

If Work waits so long that its authority/deadline expires:

do not start it later.

Mark expired/Needs attention according to canonical semantics.

⸻

766. OWNER REAUTHENTICATION

Long-running Work should not require owner browser session to remain alive.

Already-admitted Work uses its own Work identity/capability grants.

⸻

767. OWNER ACCOUNT REVOCATION

If owner/account is disabled or access revoked:

define policy for active Work.

At minimum block new Work and consequential owner-bound effects.

Private alpha may conservatively cancel/fence active Work.

⸻

768. BUSINESS PARTNER ACCESS

Shared Work owner decisions must follow configured shared-business authority.

Do not assume either partner may approve every effect unless policy explicitly says so.

⸻

769. DUAL APPROVAL — FUTURE

Architecture may support dual-control approvals for high-risk effects.

Do not require this for ordinary private-alpha PR publication unless current canonical policy already does.

⸻

770. AUDITABLE OWNER DECISIONS

Record:

* decision;
* actor;
* Work/candidate;
* effect;
* timestamp;
* current generation.

⸻

771. APPROVAL EXPIRY

Publication approval should have bounded validity or fail if candidate/base state changes.

⸻

772. APPROVAL REPLAY

Reusing an already-consumed approval:

must not create another external effect.

⸻

773. OWNER UI DOUBLE CLICK

Playwright:

double-click Open PR.

Require one decision/effect.

⸻

774. MULTI-TAB APPROVAL

Two tabs approve same candidate concurrently.

Exactly one canonical effect.

⸻

775. APPROVAL VS REJECT RACE

Two owner actions race:


## Attachment 15: c97503a3-60c3-4ece-bcdd-0ff75d4e64ee

775. APPROVAL VS REJECT RACE — CONTINUED

Two owner actions race:

Open PR

versus

Reject.

Canonical transactional ordering determines exactly one outcome.

Never publish a candidate after canonical rejection.

⸻

776. FINAL SECURITY GATES

Before production cloud enablement require:

* cross-owner leakage = 0;
* cross-Work leakage = 0;
* secret disclosure = 0;
* unauthorized network effects = 0;
* unauthorized publication = 0;
* stale-worker mutations = 0;
* duplicate authoritative execution = 0;
* protected holdout leakage = 0;
* false Ready = 0.

⸻

777. FINAL RELIABILITY GATES

Require PASS:

* worker allocation;
* worker cancellation;
* worker teardown;
* control-plane restart;
* duplicate queue delivery;
* stale event;
* browser disconnect;
* Mac offline;
* provider outage;
* model failure;
* verifier failure;
* candidate custody;
* Current Truth reconstruction.

⸻

778. FINAL FACTORY GATES

Require PASS:

* Attempts 1–8 regressions;
* PRODUCTIVE checkpoint loop;
* repair loop;
* read-only completion;
* exact checked-tree commit;
* signed custody;
* independent cloud verification;
* Result;
* Proof;
* accounting;
* publication boundary.

⸻

779. FINAL DEEPAGENT DECISION

Before launch report:

DeepAgent deterministic: PASS/FAIL
DeepAgent cloud: PASS/FAIL
DeepAgent cancellation/recovery: PASS/FAIL
DeepAgent security: PASS/FAIL
DeepAgent live: PASS/FAIL/NOT_RUN

Then select:

Default cloud harness: DeepAgent or existing-qualified-harness

based on evidence.

Cloud launch must not be blocked merely because DeepAgent is not yet qualified if the existing harness safely satisfies the cloud requirement.

⸻

780. FINAL PLAYWRIGHT RELEASE GATES

Require automated UI PASS for:

1. Natural request → cloud Work.
2. Mac-off execution.
3. Browser-off continuation.
4. Result/Proof.
5. Failed verification.
6. Needs You.
7. Open PR.
8. Keep private.
9. Cancellation.
10. Same-conversation follow-up.

Run P0 on desktop Chromium.

Run critical owner paths at 390px.

Run accessibility checks.

Run critical WebKit coverage where supported.

⸻

781. AUTOMATION MUST BE RELEASE-BLOCKING

These are not informational tests.

Failed P0:

→ release NOT_READY.

A manual demo cannot override a failing automated critical journey.

⸻

782. ONE-COMMAND QUALIFICATION

Provide repository-native commands equivalent to:

test:cloud:p0

test:cloud:integration

test:cloud:faults

test:cloud:security

test:cloud:release

test:cloud:live

Use existing repository conventions rather than inventing these exact script names if another convention already exists.

⸻

783. CI REQUIRED CHECKS

Configure appropriate required CI gates so critical automation cannot quietly regress.

At minimum the deterministic cloud Golden Journey and critical contracts must gate relevant changes.

Live paid canary remains a release/scheduled gate rather than every PR.

⸻

784. WEEKLY QUALIFICATION

Schedule a broader recurring qualification including:

* P0 E2E;
* recovery;
* fault injection;
* security;
* browser matrix;
* sandbox cleanup.

Live canary cadence should remain bounded and inexpensive.

⸻

785. FINAL LIVE CANARY

After all deterministic and connected gates pass, prepare — but do not execute without explicit authorization — one bounded real cloud Golden Journey.

Return an authorization envelope with:

* Work ID;
* objective;
* repository;
* cloud provider;
* runtime image digest;
* harness;
* exact model;
* operation limits;
* attempt limit;
* deadline;
* model ceiling;
* cloud-resource ceiling where available;
* allowed effects;
* publication disabled.

⸻

786. FINAL LAPTOP-INDEPENDENCE LIVE TEST

For that live journey:

before execution

verify:

* Mac companion OFF;
* local MyFactory OFF;
* local verifier OFF.

Start from deployed Sofie.

Once Work is admitted:

browser may close.

Require cloud completion without local intervention.

⸻

787. LIVE SUCCESS CRITERIA

Require:

Real Sofie: PASS
Cloud routing: PASS
Cloud control plane: PASS
Cloud sandbox: PASS
Real harness: PASS
Real model: PASS
Implementation: PASS
Visible checks: PASS
Completion: PASS
Candidate custody: PASS
Independent cloud verification: PASS
Result: PASS/PARTIAL only for intentionally unestablished publication/acceptance
Proof: PASS/PARTIAL for same reason
Final Sofie explanation: PASS
Local execution dependencies: 0.

⸻

788. AFTER LIVE CLOUD PASS

Do not repeat the toy qualification task.

Move immediately to a different natural software request through Sofie’s production UI.

The owner should not provide:

* Work ID;
* route;
* provider;
* harness;
* operation envelope.

MyEve handles those internally.

⸻

789. PRIVATE ALPHA PRODUCT TEST

Jay should be able to type something like:

“Sofie, review MyEve and find one worthwhile issue you can safely fix. Make the change, verify it, and bring it back to me when it’s ready.”

Then close the laptop.

This becomes the defining private-alpha product test.

⸻

790. OWNER RETURN EXPERIENCE

On return, target:

Completed while you were away

Software Engineer completed the change in the cloud.

Implementation checks: PASS
Independent verification: PASS

Needs you: Review the candidate.

Actions:

Open pull request

Push branch only

Keep private

Reject candidate

⸻

791. FINAL ARCHITECTURE

Target architecture:

Owner

↓

Sofie / MyEve

↓

Goal / Work / Authority

↓

MyFactory Cloud Control Plane

↓

ExecutionProvider

↓

Ephemeral Cloud Sandbox

↓

HarnessProvider

↓

DeepAgent OR Existing Qualified Harness

↓

Qualified Model Route

↓

Implementation + Host Checkpoints

↓

Immutable Candidate Custody

↓

Independent Cloud Verifier

↓

Result + Proof

↓

Sofie

↓

Needs You

↓

Publisher

↓

PR / CI / Review

Jay’s Mac is not in this path unless Work explicitly requires the Owner Computer.

⸻

792. FINAL SYSTEM BOUNDARIES

MyEve

owns owner relationship, Goals, Work, Memory, Inbox, Today and approvals.

Relay

owns governed capabilities and agent-to-agent communication.

MyFactory

owns production execution, candidates and verification orchestration.

DeepAgent

is a replaceable execution harness.

CloudExecutionProvider

supplies isolated compute.

Verifier

independently evaluates candidates.

Publisher

performs separately approved external effects.

Keep these boundaries explicit.

⸻

793. FINAL IMPLEMENTATION PRIORITY

Do not attempt all 792 preceding requirements simultaneously.

Execute in this order:

P0 — Laptop independence

1. ExecutionProvider abstraction.
2. Initial cloud provider.
3. Durable queue/control plane.
4. Existing qualified harness in cloud.
5. Candidate custody.
6. Independent cloud verifier.
7. Result/Proof.
8. Mac-off Golden Journey.

P1 — Productization

9. Real owner Working/Needs You UI.
10. Attempt-8 canonical publisher integration.
11. Playwright P0 suite.
12. Browser-off/restart/cancellation.
13. Notifications/Today/Daily Brief.

P2 — DeepAgent

14. DeepAgentHarness.
15. Qualification corpus.
16. Harness comparison.
17. Promote only if qualified.

P3 — Expansion

18. Federation.
19. Multiple cloud Work.
20. broader specialists/artifact Work.

⸻

794. FIRST IMPLEMENTATION MILESTONE

The first milestone is deliberately smaller than the entire design:

Sofie → MyFactory → cloud sandbox → deterministic worker → artifact → Result

with:

Mac OFF.

No real model required yet.

This proves the architecture before adding model variability.

⸻

795. SECOND IMPLEMENTATION MILESTONE

Add the existing qualified Factory harness using deterministic model responses:

Cloud sandbox

→ productive

→ checkpoint

→ repair if needed

→ completion

→ candidate.

⸻

796. THIRD IMPLEMENTATION MILESTONE

Add independent cloud verification:

producer sandbox

→ candidate custody

→ separate verifier sandbox

→ Result/Proof.

At this point deterministic laptop independence must PASS.

⸻

797. FOURTH IMPLEMENTATION MILESTONE

Add the real qualified OIDC/Gateway/model route.

Prepare a bounded live authorization envelope.

Do not execute paid live Work until explicitly authorized.

⸻

798. FIFTH IMPLEMENTATION MILESTONE

Wire the production owner UI and publisher:

Result

→ Needs You

→ exact candidate

→ owner decision.

Reuse the canonical Attempt-8 publication implementation.

⸻

799. SIXTH IMPLEMENTATION MILESTONE

Make P0 Playwright automation release-blocking:

natural request

→ cloud execution

→ Result

→ owner decision.

Include Mac-off and browser-off variants.

⸻

800. FINAL DEFINITION OF DONE

This mission is complete only when:

1. Sofie can start eligible Work from the deployed UI.

2. MyFactory control plane runs independently of Jay’s laptop.

3. Production executes in an isolated cloud sandbox.

4. The harness is replaceable and versioned.

5. DeepAgent is either qualified or explicitly NOT_QUALIFIED without blocking cloud execution.

6. Candidate custody is durable and exact.

7. Independent verification runs in a separate cloud environment.

8. Result and Proof return to MyEve.

9. Jay can close the browser and turn off/disconnect the Mac.

10. Work continues.

11. Owner approval gates publication.

12. P0 Playwright automation proves the journey.

13. Recovery/fault/security suites pass.

14. README/design/runbook accurately describe reality.

15. A bounded real cloud Golden Journey passes.

16. Local execution dependencies for cloud-eligible Work = 0.

⸻

801. FINAL REPORT REQUIRED

Return:

Overall: READY / PARTIAL / NOT_READY

Canonical MyEve SHA: …

Canonical Relay SHA: …

Canonical MyFactory SHA: …

Cloud provider: …

Control-plane location: …

Runtime image digest: …

ExecutionProvider: PASS/FAIL

Cloud sandbox: PASS/FAIL

Durable queue: PASS/FAIL

Lease/fencing: PASS/FAIL

Default harness: …

DeepAgent: QUALIFIED / NOT_QUALIFIED

Real model route: PASS/FAIL/NOT_RUN

Candidate custody: PASS/FAIL

Cloud verifier: PASS/FAIL

Result: PASS/FAIL

Proof: PASS/FAIL

Mac-off deterministic Golden Journey: PASS/FAIL

Browser-off: PASS/FAIL

Control-plane restart: PASS/FAIL

Cancellation: PASS/FAIL

Worker-death behavior: PASS/FAIL

P0 Playwright: PASS/FAIL

390px: PASS/FAIL

Accessibility: PASS/FAIL

Security suite: PASS/FAIL

Cross-Work disclosure: N

Cross-owner disclosure: N

Secret disclosure: N

Duplicate authoritative executions: N

Unauthorized publications: N

False Ready: N

Live cloud Golden Journey: PASS/FAIL/NOT_RUN

Local execution dependencies: N

Known limitations: …

Next steps: …

⸻

802. START NOW

Begin with Phase 0 inventory and architecture verification against current canonical source.

Then proceed autonomously through:

Phase 1 ExecutionProvider

→ Phase 2 cloud sandbox

→ Phase 3 qualified harness

→ Phase 5 cloud verifier

→ Phase 6 durable cloud control plane

→ deterministic Mac-off Golden Journey

→ P0 Playwright automation.

Do not jump directly to DeepAgent or a paid model call before the underlying cloud lifecycle is proven.

Commit and push verified checkpoints frequently.

Update README/design/runbooks throughout.

Stop only for a genuine external approval, credential/configuration action that requires the owner, or the bounded authorization required before the first real paid cloud Golden Journey.

The mission is not “run an agent in a container.”

The mission is: Sofie stays on the job when the laptop is gone — safely, durably, independently verified, and proven end-to-end through the real product UI.
