# MyFactory canonical status

**LOCAL CANDIDATE QUALIFIED — CANONICAL MERGE BLOCKED.**

Canonical branch: `main`; unchanged remote SHA `8c5de7794ffa377420ef5dcdbda44aa9fa2328b8`. Qualified consolidation checkpoint: `6e164ca2f3c58a7bf2d0c905c0908dfea0ceadf9` on `codex/canonical-consolidation`. Evidence-only descendants do not imply canonical merge.

- Workspace tests: **134 PASS / 1 opt-in skip**; installed CLI test separately PASS against scripted loopback provider.
- General/producer typechecks, executor governance (UNKNOWN=0), build and spend/resource V2 negative probes PASS.
- Fresh/v6→v8/v7→v8 populated upgrades and replay PASS with unchanged historical SQL and existing Work retained.
- Independent fresh remote-candidate clone repeats tests, producer typecheck, governance and build PASS.
- MyEve's final combined candidate consumes this exact clean source in the SQLite crosswalk, 16 connected CLI checks and the controlled whole-product journey. Real provider NOT_RUN.

## Required decisions before canonical merge

1. The requested two-owner shared-business journey cannot pass from the available implementation. Product Expansion explicitly leaves membership, shared Goal/Result audiences, revocation and Rooms as unallocated schema proposals. Private-owner isolation passes, but it is not shared-business acceptance. Product-owner decision pending: explicitly defer this release gate for consolidation, or implement/qualify the shared scope before merge. No authority model was invented during cleanup.
2. Final independent review of the combined candidate remains PENDING. Component reviews are retained but do not replace this gate. This session requires explicit authorization before delegating; a request for one read-only reviewer is pending. No review agent has been started.

No canonical merge/push, post-merge qualification, milestone tag or cleanup has occurred. These gates remain required after the decisions. The disconnected Work Canvas preview is not a production approval, email, publication or sharing implementation. Live provider execution and deployment remain NOT_RUN and are outside this consolidation authorization.

## Preservation and cleanup

Cleanup executed: **0 worktrees, 0 local branches, 0 remote branches**. No existing tag moved or milestone tag created. Primary checkout dirty state is preserved in private recovery archives; it was not reset or cleaned. Candidate checkouts are committed and remotely verified at handoff. Active/historical source remains durable. Two hosted Relay worktree inspections timed out and remain DO_NOT_DELETE. Initial ref inventory is a timestamped audit snapshot, supplemented by SOURCE-UPDATES.md; no destructive final manifest has been executed.

See [source manifest](PRIVATE-ALPHA-SOURCE-MANIFEST.md), [capability crosswalk](CANONICAL-INTEGRATION-CROSSWALK.md), [migration ledger](MIGRATION-RECONCILIATION.md), [qualification index](EVIDENCE-INDEX.md), and [development policy](DEVELOPMENT-POLICY.md).
