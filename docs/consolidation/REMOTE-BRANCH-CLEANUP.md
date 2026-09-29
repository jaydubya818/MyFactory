# Remote branch cleanup manifest
No branch or worktree is authorized for deletion by this report yet. Canonical merge, post-merge and fresh-clone gates remain open.

| Branch | Tip | Unique commits vs canonical | Disposition after gates | Reason |
|---|---|---|---|---|
| refs/remotes/origin/HEAD | 8c5de7794ffa377420ef5dcdbda44aa9fa2328b8 | 0 | KEEP_ACTIVE | Actual origin default branch is main; preserve canonical checkout, including local divergence. |
| refs/remotes/origin/codex/canonical-consolidation | cf3c086be31f2423d289b192c0172b39bbfbb0bd | 6 | KEEP_ACTIVE | Task-owned integration checkpoint; not yet final qualified canonical source. |
| refs/remotes/origin/codex/connected-execution-control | c1c9cd49b5b974dc343cacecf1bd1411b01885e7 | 4 | KEEP_ARCHIVE | Earlier ConnectedExecutionControl/tables replaced by exact prepared FactoryDispatchControl and retained Work event state in d9564be/925530a. Do not combine competing dispatch stores. |
| refs/remotes/origin/codex/digital-worker-factory | d9564beef41590c3700069ec340d926db23b7ba7 | 2 | DELETE_LOCAL_AND_REMOTE | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/hard-work-spend | 8f5e3774129b5f9f4b1c9655ffbbb531cd20fa0f | 3 | DELETE_LOCAL_AND_REMOTE | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/local-factory | 101536750b195ddebde9cae694894b0659a0abf4 | 1 | KEEP_ARCHIVE | Preview cache preparation and timeout fix from 1015367 cherry-picked as cf3c086; final qualification and canonical publication pending. |
| refs/remotes/origin/codex/private-alpha-myfactory | 925530a6ba8764df6a7b8637192fe32edcbaff97 | 4 | KEEP_ACTIVE | 925530a reconstructed producer integrated directly. Keep producer source while final Beta consumes it and canonical post-merge qualification is pending. |
| refs/remotes/origin/codex/q37-gate-c | 454a49064d52a6f3cf7a92a418cd70dda035bf1c | 6 | KEEP_ARCHIVE | Historical hosted-return prototype reports PARTIAL protocol/schema reconciliation. Canonical producer uses immutable attestation/result protocol from fcd8afd and V2 successor; preserve evidence. |
| refs/remotes/origin/codex/q37-producer-attestation | fcd8afd6fbaa2b9045b9e9700608d546edf011a9 | 1 | DELETE_LOCAL_AND_REMOTE | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/main | 8c5de7794ffa377420ef5dcdbda44aa9fa2328b8 | 0 | KEEP_ACTIVE | Actual origin default branch is main; preserve canonical checkout, including local divergence. |
