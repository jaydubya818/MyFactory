# Worktree cleanup manifest

Fresh inspection after canonical publication. Dirty contents and inaccessible paths must be retained. Other-chat managed worktrees are not attached to this chat and cannot be archived by this chat’s managed-worktree tool; they retain their source and evidence. Unique historical commits remain preserved even where accepted implementation was selectively integrated. Task-owned candidates may be retired after the final audit commit is durable. Stale registrations may be pruned only after preserving their recorded HEAD.

| Path | Branch / SHA | Dirty paths | Unique commits vs main | Disposition |
|---|---|---|---:|---|
| /Users/jaywest/Documents/ChatGPT/MyFactory | refs/heads/codex/q37-gate-c / `454a49064d52a6f3cf7a92a418cd70dda035bf1c` | 1 | 6 | KEEP_DIRTY_OR_INACCESSIBLE |
| /private/tmp/canonical-consolidation-myfactory | refs/heads/codex/canonical-consolidation / `7591e521db55681e018e5e4aca3a286611059ce2` | 0 | 0 | REMOVE_TASK_OWNED_AFTER_FINAL_COMMIT |
| /private/tmp/myfactory-workorder-e2e-data/workspaces/15d992ec-0582-4244-ba72-d3e852dbdca7 | DETACHED / `37c71fdbe30661adfd9371dd0096b8da74e138b1` | MISSING_REGISTRATION | 1 | PRUNED_STALE_REGISTRATION |
| /private/tmp/myfactory-workorder-e2e-data/workspaces/3f678992-6a69-46c7-b568-3a12914e7e05 | DETACHED / `eb67370161bd110dd48355e87c8511430ce0d064` | MISSING_REGISTRATION | 1 | PRUNED_STALE_REGISTRATION |
| /Users/jaywest/.codex/worktrees/digital-worker-factory/MyFactory | refs/heads/codex/digital-worker-factory / `d9564beef41590c3700069ec340d926db23b7ba7` | 0 | 0 | KEEP_MANAGED_OTHER_CHAT |
| /Users/jaywest/.codex/worktrees/private-alpha-myfactory/MyFactory | refs/heads/codex/private-alpha-myfactory / `925530a6ba8764df6a7b8637192fe32edcbaff97` | 0 | 0 | KEEP_MANAGED_OTHER_CHAT |
| /Users/jaywest/.codex/worktrees/q37-producer-attestation/MyFactory | refs/heads/codex/q37-producer-attestation / `fcd8afd6fbaa2b9045b9e9700608d546edf011a9` | 0 | 0 | KEEP_MANAGED_OTHER_CHAT |
