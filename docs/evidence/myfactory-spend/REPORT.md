# MyFactory producer spend qualification

## Pin and scope

Producer input: `d9564beef41590c3700069ec340d926db23b7ba7` on `codex/digital-worker-factory`. Work occurred only on isolated `codex/hard-work-spend`; no MyEve files or branches were edited. The active MyFactory worktrees were inspected before schema work. None owned a spend migration. The appended SQLite migration is **version 7**; versions 1–6 are unchanged. SHA-256 of the exact version-7 SQL template literal: `208fd0facca9f2535c30e558bf261243efd3ababd3113697e34dbefdf8f1598e`.

## Boundary and behavior

The prior path was connected START → `JobManager.#execute` → `packages/agents.runCodex` → `codex exec`. A single CLI turn can issue multiple model requests. The trusted spend boundary is therefore each Responses request emitted by the CLI, intercepted by the local `SpendGateway`. A launch-level allowance alone was rejected as unenforceable.

`SpendLedger` creates a per-Work ceiling in integer USD micro-dollars, bound to active Work generation, request and WorkOrder. A newer generation can inherit the remaining balance but cannot alter the ceiling. A reservation records exact dispatch, FactoryVersion, run, model and pricing revision. `BEGIN IMMEDIATE` serializes reservations across independent SQLite connections and processes. The gateway commits a conservative full-context plus output-cap reservation, then marks the operation dispatched immediately before its upstream request. Settlement requires an upstream provider request identity and authoritative input/output usage. Any lost, malformed, incomplete or oversized response keeps the full reservation as UNKNOWN. Startup converts interrupted reservations and dispatches to UNKNOWN. Cancellation prevents new starts without releasing earlier exposure.

The child Codex process uses `--ignore-user-config`, a custom loopback Responses provider, isolated `HOME`/`CODEX_HOME`, and a gateway-only bearer token. It does not inherit a provider API key. Unknown routes and unpriced modalities/tools fail closed. No actual provider credential or paid call was used.

## Local qualification

- Full `npm test`: **PASS** (supervisor suite with one opt-in installed-CLI test skipped in the default suite; agents 10, app builder 8, hosted routing 6, storage 14, verification 6).
- Opt-in `FACTORY_TEST_CODEX_CLI=1 node --test apps/supervisor/test/spend-codex-cli.test.mjs`: **PASS** against a loopback fake provider that returned 503. The installed Codex CLI reached the gateway; gateway retained UNKNOWN exposure.
- Connected synthetic START → worker → gateway → fake provider → settled readback: **PASS**. Exact Work readback showed one provider call and authoritative 30 micro-USD settlement.
- Concurrent calls that individually fit but jointly exceed a Work ceiling: **PASS**; one reached the fake provider, the second was denied before outbound.
- Replay, provider switch, generation retry, cancellation, process-loss recovery, stale-generation denial and UNKNOWN non-release: **PASS** in storage/gateway fixtures.
- `npm run typecheck`, `npm run typecheck:producer`, `npm run check:producer-governance`, `npm run build`, and `git diff --check`: **PASS**.

## Safety counters and release status

In local controlled fixtures: paid calls without a budget **0**; ceiling violations **0**; concurrent oversubscription **0**; unaccounted synthetic provider calls **0**; incorrect UNKNOWN releases **0**; budget resets **0**; cross-Work budget use **0**; post-cancel starts **0**. These counters describe the tested paths, not real commercial provider qualification.

**Live MyFactory: NOT_RUN / NOT READY.** Default connected paid dispatch remains `DISABLED`; default host Codex execution also stops before model invocation. Real provider success/streaming semantics and a current operator-approved model price card are not yet qualified. A production provider credential and any actual paid call require separate authorization. No MyEve consumer code was modified. The exact interface and admission conditions are in [the handoff](../../my-eve-spend-handoff.md).
