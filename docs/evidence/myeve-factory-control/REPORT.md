# Local Factory control checkpoint

Baseline: `fcd8afd6fbaa2b9045b9e9700608d546edf011a9`. Candidate: the commit containing this report on `codex/digital-worker-factory`.

PASS: 101 workspace tests; producer TypeScript; governance UNKNOWN=0; web production build. The six control tests use actual HTTP/SQLite/Git/signing with explicit synthetic coding/verifier dependencies. Existing actual process and verifier regressions also pass. Consumer paired evidence resides in MyEve `docs/verification/2026-09-27-myfactory-beta/`. No live execution or external publication occurred.

All old governance source entries retain their original bytes. The one added owned entry covers dispatch-control.ts. Existing changed source fingerprints are retained in sources.json.

## Producer handoff received during qualification

The separately published `codex/connected-execution-control` candidate `c1c9cd49b5b974dc343cacecf1bd1411b01885e7` was fetched and inspected read-only. It shares this baseline but introduces an incompatible `/executions` contract: actual Run binding is allocated during START, whereas canonical MyEve 0056 requires complete Gate C execution binding before writer admission. Its readback and quiescence contract differ. It has not been merged or silently treated as compatible. This branch exposes only `/dispatches`; the two implementations are not combined. The delivered `/executions` producer remains an explicit integration dependency before deployment or live qualification can be proposed.

Live MyFactory: **NOT_RUN / NOT READY**. This checkpoint enables only local synthetic execution; paid dispatch is denied even with a valid connection token and exact identity. No enforceable per-attempt dollar ceiling is qualified. No change to the original producer owner checkout, main, or other worktrees.
