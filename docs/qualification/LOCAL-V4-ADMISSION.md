# Retained original local V4 admission

This explicit producer API retains provenance for an already admitted Work and
Run. It does not select V4 in the server, JobManager, dispatch controller or
execution provider. Existing producer methods, signing configuration, pinned Git
helper, spending controls and installation authority remain unchanged.

`captureAdmitted(work, run, model, executorVersion)` returns the actual V4
execution snapshot. It detaches plain inputs before storage hooks, checks the
current signing key, and uses the existing actual capture and one outer SQLite
transaction to append the snapshot and original admission together. Callers
cannot supply serialized admission payloads or expected identities to persist.

The distinct `run.local_v4_admission` payload has exactly three fields:

```json
{"schema":"myfactory.local-producer-admission/v4","work":{},"expected":{}}
```

`work` is the exact detached original WorkOrder. It has the existing required
fields and only the declared optional `idempotencyKey` string and
`syncToLinear` boolean. Those optional fields must still pass the existing exact
stored Work comparison; they do not create new persisted input authority.
`expected` is the exact `LocalResultV4Expected` derived from actual capture,
excluding version, workspace and capture time. The record permits only bounded
plain canonical JSON: 256 KiB, depth 16, 8,192 nodes and 65,536 characters per
string. Accessors, symbols, hidden keys, sparse arrays, nonplain objects,
undefined, cycles and nonfinite numbers are refused before cloning.

Both records absent permits fresh actual planning capture under the existing
source, Work, Run, key and pinned Git checks. Both present permits only exact
capture replay with the original Work, immutable Run fields, model, executor
version and source; no events are appended. A preexisting signed Result must use
retained reads instead. A missing, duplicate, conflicting or legacy member is a
hold. A snapshot alone can never be backfilled into original admission. Failure
at either append or in an enclosing transaction rolls back the pair; an outer
run-creation rollback also removes that new Run.

`admission(run)` returns detached `{work, expected}` after checking the actual
immutable Run, strict pair, current stable Work and exact V4 snapshot. It never
creates data. `readAdmitted(run)` and `finalizeAdmitted(run)` resolve that retained
original and invoke the existing explicit V4 readers. RUNNING, STOPPING and
UNKNOWN reads return no Result. Historical signed reads retain the existing
historical key semantics; they cannot authorize current capture or spending.
Explicit new terminal freeze retains the existing current-key and bounded
pinned Git checks. Producer checks are not independent verification or Proof.

Portable public retained-record tests explicitly seed synthetic SQLite records
and already frozen signed data. They prove read, replay and refusal behavior;
they do not prove Git capture or execution:

```sh
node --test apps/supervisor/test/local-v4-admission.test.mjs
```

Actual capture and transaction interruption are separately tested against the
unchanged pinned Mac Git executable in fresh owned repositories:

```sh
node --test apps/supervisor/qualification/local-v4-admission.test.mjs
```

An unsupported host fails that qualification rather than skipping or substituting
an executable. No provider, protected verifier, private custody, charge or live
installation is used by either suite. Supplemental hosted CI selects portable
contracts, existing producer/legacy cases, unchanged governance and types from
the exact push SHA. Actual Mac qualification remains separate evidence.

The conservative MyEve text materializer still does not support structural
rename/copy or binary producer patches. Service composition must separately
align that policy, retain all existing execution fences, and qualify actual
independent verification, authenticated Proof and MyApps delivery. This record
and its digest grant none of those authorities.
