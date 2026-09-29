# MyFactory canonical status

**WAIT_FOR_ACTIVE_COMPONENTS — Stage 1 candidate, not a completed canonical consolidation.**

Canonical branch: `main`. Verified remote baseline: `8c5de7794ffa377420ef5dcdbda44aa9fa2328b8`. Implementation checkpoint on `codex/canonical-consolidation`: `cf3c086be31f2423d289b192c0172b39bbfbb0bd`. Subsequent documentation commits retain this implementation pin; final exact remote checkpoint is recorded by the handoff.

134 workspace tests PASS / 1 opt-in skip; that installed-CLI test separately PASS against loopback provider. General and producer typechecks, governance (UNKNOWN=0), build and V2 negative probes PASS. Fresh/v6→v8/v7→v8 populated upgrade and replay PASS with unchanged historical SQL. Fresh remote-candidate clone repeats tests, producer typecheck, governance and build PASS.

Final integration review, canonical merge/push, post-merge regression, fresh **canonical** clone and whole-product composition remain NOT_RUN. Repository merge does not establish live/deployed status. No real provider call, paid operation, deployment or publication was authorized or performed here.

See [capabilities](CAPABILITY-INVENTORY.md), [migration reconciliation](MIGRATION-RECONCILIATION.md), [crosswalk](CANONICAL-INTEGRATION-CROSSWALK.md) and [branch inventory](BRANCH-INVENTORY.md).

Cleanup executed: **0 worktrees / 0 local branches / 0 remote branches**. No milestone tag was created. No unique source was deleted. Keep all active, deferred, unknown-status and historical-required worktrees. Two hosted Relay worktrees cannot yet be classified clean: read-only Git status/diff timed out; no cleanup is permitted for them.
