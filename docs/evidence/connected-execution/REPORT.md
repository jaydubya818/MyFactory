# Connected execution control — local producer qualification

**Implementation source SHA:** `211ed456cbac6d9cd411b17e48beb9784af0dd78` on `codex/connected-execution-control`, based on qualified producer attestation `fcd8afd6fbaa2b9045b9e9700608d546edf011a9`.

**Producer contract: PASS locally, with synthetic worker/check fixtures.** No live MyFactory coding attempt, MyEve Gate B adapter, MyEve writer release, publication, or external effect was exercised. The producer branch is an isolated candidate and has not been merged to main. `docs/connected-execution-protocol.md` is the wire and recovery contract; `source-inventory.json` records every new or modified runtime source. The historical Q37 producer inventory is preserved.

## Durable model and authority

SQLite schema version **7** adds `connected_executions` with a primary dispatch-operation key, unique exact Run binding, one open dispatch per WorkOrder, immutable client/Factory/FactoryVersion/request/Work/policy/deadline identity, and terminal-state constraints. PREPARE writes this row without starting a Run. START commits STARTING before entering the canonical JobManager. Run creation, producer execution snapshot and dispatch-to-Run/attempt binding share one SQLite transaction. STOP commits a permanent start fence before requesting worker cancellation. A stopped or expired dispatch cannot start later, including after restart.

The four `factory.execution.*` capabilities must be granted separately to a repository-scoped backend connection. They are not available through general `/api/connect/v1/actions`; the existing human `run.start` and `run.cancel` actions remain human-only. A connected WorkOrder blocks a simultaneous human start. The connected protocol does not grant approval, draft publication, merge, deployment, MyEve writer custody, or Ready authority.

FactoryVersion is calculated from loaded runtime source and the effective execution configuration. The connected PREPARE pin is checked again when the existing producer captures its immutable Run snapshot. A changed version prevents Run creation. The snapshot stores the prepared MyEve request ID, and the pre-existing signed result binds that ID, FactoryVersion, WorkOrder, Run, attempt, candidate, evidence and artifact bytes. No second result protocol was introduced.

## Qualification commands and outcomes

| Gate | Outcome | Evidence |
| --- | --- | --- |
| Full workspace tests | **108 PASS / 0 FAIL** across supervisor (70), agents (9), app builder (8), hosted routing (6), storage (9), verification (6) | [npm-test.log](npm-test.log) |
| Web typecheck | PASS | [typecheck.log](typecheck.log) |
| Producer TypeScript typecheck | PASS | [typecheck-producer.log](typecheck-producer.log) |
| Producer governance | PASS; three inventoried new runtime files relative to old baseline, seven reviewed modified files, UNKNOWN 0 | [governance.log](governance.log), [source-inventory.json](source-inventory.json) |
| Production web build | PASS | [build.log](build.log) |
| Diff whitespace | PASS | `git diff --check` before implementation commit |

The connected HTTP tests use a real loopback server, bearer-token client configuration, the actual SQLite store, generated signing keys, real Git candidate objects, and deterministic synthetic worker/check callbacks. They exercise PREPARE → START → exact signed result, lost response/readback, restart, and stop before/while running. Direct control tests additionally exercise concurrent starts, version substitution, deadline expiry, two competing dispatch identities, stop during STARTING, process shutdown with an unresolved worker, cross-client denial, and immutable result identity. The existing supervisor and producer suites cover process-group abort, recovery hold, key rotation, candidate integrity, and exact signed-result replay.

## Safety assertions in the bounded tests

| Counter | Observed |
| --- | ---: |
| Duplicate logical executions | 0 |
| Post-fence starts | 0 |
| Cross-client execution control | 0 |
| FactoryVersion substitutions | 0 |
| Lost exact Run/attempt identities | 0 |
| False terminal/quiescent observations | 0 |
| Unbounded connected actions | 0 |

These are test assertions, **not live telemetry**. In the process-loss fixture, a started worker with unresolved effects remains UNKNOWN/nonquiescent, even after STOP. A prepared dispatch stopped before any Run is terminally fenced, and a delayed START is denied after database reopen. A stop request during an active worker remains nonquiescent until that worker exits and the existing producer freezes a signed terminal result.

## Limits and MyEve handoff

- One local supervisor should own a data directory. The protocol uses SQLite transaction serialization; it is not a multi-host execution cluster.
- UNKNOWN requires the existing recovery-hold/operator process reconciliation. Elapsed time or a missing heartbeat never converts it to terminal. MyEve must retain Factory writer authority while UNKNOWN or STOPPING.
- The 30-minute producer timeout is an upper bound. The prepared absolute deadline also aborts the connected attempt. Actual model spend remains governed by the existing local host configuration; this change does not introduce a separate billing ledger.
- A local WorkOrder's task worktree may require operator cleanup after process loss before Run creation. No live cleanup was qualified here.
- The connection remains loopback-only. No new client credential or cloud transport was created.

MyEve integration must read the FactoryVersion through the prepare-scoped endpoint, establish its own Stage-1 Work/writer/request fence, PREPARE with its request UUID and a fresh dispatch UUID, START once, READ the **same** dispatch after any lost response, bind returned WorkOrder/Run/attempt immutably as Stage 2, admit the exact signed result through Gate C, and wait for `quiescent: true` before releasing its Factory writer. It must treat a later result from a superseded writer as historical. The candidate still requires independent MyEve protected verification. See [protocol](../../connected-execution-protocol.md).

**MyEve consumer:** NOT YET INTEGRATED. **Gate C two-stage binding:** NOT YET QUALIFIED. **Gate B live adapter:** NOT YET QUALIFIED. **Live MyFactory:** NOT_RUN / NOT_READY. This report authorizes no live execution.
