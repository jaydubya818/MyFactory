# MyFactory branch inventory
Initial inventory: 2026-09-29T06:10:58.099059+00:00. Current candidate: `cf3c086be31f2423d289b192c0172b39bbfbb0bd`. Remote canonical: `8c5de7794ffa377420ef5dcdbda44aa9fa2328b8`.
No branch or worktree is authorized for deletion by this report yet. Canonical merge, post-merge and fresh-clone gates remain open.

Classifications use ancestry, commit/file deltas and the documented source/qualification findings. UNKNOWN is deliberately retained where semantic reconciliation is unfinished.

| Ref | Exact tip | Behind / ahead canonical | Classification | Reason |
|---|---|---|---|---|
| refs/heads/codex/canonical-consolidation | cf3c086be31f2423d289b192c0172b39bbfbb0bd | 0	6 | CANONICAL_INPUT | Task-owned integration checkpoint; not yet final qualified canonical source. |
| refs/heads/codex/digital-worker-factory | d9564beef41590c3700069ec340d926db23b7ba7 | 0	2 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/heads/codex/local-factory | 543906dc20fefed2def97e43953095ea0b7c60bc | 3	0 | UNIQUE_WORK_TO_INTEGRATE | Preview cache preparation and timeout fix from 1015367 cherry-picked as cf3c086; final qualification and canonical publication pending. |
| refs/heads/codex/private-alpha-myfactory | 925530a6ba8764df6a7b8637192fe32edcbaff97 | 0	4 | CANONICAL_INPUT | 925530a reconstructed producer integrated directly. Keep producer source while final Beta consumes it and canonical post-merge qualification is pending. |
| refs/heads/codex/q37-gate-c | 454a49064d52a6f3cf7a92a418cd70dda035bf1c | 3	6 | SUPERSEDED | Historical hosted-return prototype reports PARTIAL protocol/schema reconciliation. Canonical producer uses immutable attestation/result protocol from fcd8afd and V2 successor; preserve evidence. |
| refs/heads/codex/q37-producer-attestation | fcd8afd6fbaa2b9045b9e9700608d546edf011a9 | 0	1 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/HEAD | 8c5de7794ffa377420ef5dcdbda44aa9fa2328b8 | 0	0 | CANONICAL_INPUT | Actual origin default branch is main; preserve canonical checkout, including local divergence. |
| refs/remotes/origin/codex/canonical-consolidation | cf3c086be31f2423d289b192c0172b39bbfbb0bd | 0	6 | CANONICAL_INPUT | Task-owned integration checkpoint; not yet final qualified canonical source. |
| refs/remotes/origin/codex/connected-execution-control | c1c9cd49b5b974dc343cacecf1bd1411b01885e7 | 0	4 | SUPERSEDED | Earlier ConnectedExecutionControl/tables replaced by exact prepared FactoryDispatchControl and retained Work event state in d9564be/925530a. Do not combine competing dispatch stores. |
| refs/remotes/origin/codex/digital-worker-factory | d9564beef41590c3700069ec340d926db23b7ba7 | 0	2 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/hard-work-spend | 8f5e3774129b5f9f4b1c9655ffbbb531cd20fa0f | 0	3 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/local-factory | 101536750b195ddebde9cae694894b0659a0abf4 | 3	1 | UNIQUE_WORK_TO_INTEGRATE | Preview cache preparation and timeout fix from 1015367 cherry-picked as cf3c086; final qualification and canonical publication pending. |
| refs/remotes/origin/codex/private-alpha-myfactory | 925530a6ba8764df6a7b8637192fe32edcbaff97 | 0	4 | CANONICAL_INPUT | 925530a reconstructed producer integrated directly. Keep producer source while final Beta consumes it and canonical post-merge qualification is pending. |
| refs/remotes/origin/codex/q37-gate-c | 454a49064d52a6f3cf7a92a418cd70dda035bf1c | 3	6 | SUPERSEDED | Historical hosted-return prototype reports PARTIAL protocol/schema reconciliation. Canonical producer uses immutable attestation/result protocol from fcd8afd and V2 successor; preserve evidence. |
| refs/remotes/origin/codex/q37-producer-attestation | fcd8afd6fbaa2b9045b9e9700608d546edf011a9 | 0	1 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/main | 8c5de7794ffa377420ef5dcdbda44aa9fa2328b8 | 0	0 | CANONICAL_INPUT | Actual origin default branch is main; preserve canonical checkout, including local divergence. |

Full branch unique-commit lists and merge bases: [branch-dispositions.json](branch-dispositions.json). Initial reflogs, unreferenced candidates, migration hashes, evidence indexes and worktree status: [inventory.initial.json](inventory.initial.json).
