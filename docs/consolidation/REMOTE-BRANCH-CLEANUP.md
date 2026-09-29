# Exact remote deletion manifest

Each DELETE_PROVEN_OBSOLETE tip is reachable from verified canonical `main` (`7591e521db55681e018e5e4aca3a286611059ce2`), was classified obsolete in the source audit, and is not used by an existing registered worktree. Fresh-canonical qualification PASS. Automatic approval review requires separate final approval of this exact manifest; no remote deletion has occurred. A compare-and-swap lease must match every listed tip; changed tips are retained. Unique history, active/recovery and shared-checkout branches are retained.

| Branch | Expected tip | Unique vs main | Disposition |
|---|---|---:|---|
| codex/canonical-consolidation | `7591e521db55681e018e5e4aca3a286611059ce2` | 0 | KEEP |
| codex/connected-execution-control | `c1c9cd49b5b974dc343cacecf1bd1411b01885e7` | 3 | KEEP |
| codex/digital-worker-factory | `d9564beef41590c3700069ec340d926db23b7ba7` | 0 | KEEP |
| codex/hard-work-spend | `8f5e3774129b5f9f4b1c9655ffbbb531cd20fa0f` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/local-factory | `101536750b195ddebde9cae694894b0659a0abf4` | 1 | KEEP |
| codex/private-alpha-myfactory | `925530a6ba8764df6a7b8637192fe32edcbaff97` | 0 | KEEP |
| codex/q37-gate-c | `454a49064d52a6f3cf7a92a418cd70dda035bf1c` | 6 | KEEP |
| codex/q37-producer-attestation | `fcd8afd6fbaa2b9045b9e9700608d546edf011a9` | 0 | KEEP |
| main | `7591e521db55681e018e5e4aca3a286611059ce2` | 0 | KEEP |
