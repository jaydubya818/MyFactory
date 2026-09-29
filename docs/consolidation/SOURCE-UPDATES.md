# Source updates after initial inventory

The initial inventory remains immutable evidence; branch cleanup has not begun.

- Final Beta successor: `origin/codex/myeve-beta-integration` → `52b3891a2685307cbb50bba97680070700df4cc0`, remotely verified and merged into MyEve consolidation at `cd14eea`. Includes qualified 0068 bridge. KEEP until canonical incorporation and post-merge checks.
- Product Expansion: `origin/codex/private-alpha-product-expansion` → `9caacf60c6affae48f3cdaadfd3ecd7ca50dd0c2`. Expansion delta and explicit disconnected preview adopted; protected canonical runtime retained. KEEP until canonical integration passes; any new work after this pin is outside this snapshot.
- Q37 `cf83e3bec6f02ca812b2e08e04c188eaa271bede` is incorporated through final Beta. Historical test dependency closure is preserved.
- Rejected consolidation migration draft: `codex/consolidation-bridge-draft` → `8c30a7cef2be998b5303d7c97511cb44b814ff79`. FAILED_PROVISIONAL_DRAFT; never merge. Retained until final audit/cleanup gate, not a release input.
- Dirty primary recovery: `codex/consolidation-recovery-main-20260929` → `8d69688d536ec2502f74b8af39a04da987cf5d85`, pushed and remotely verified; private untracked evidence also archived locally.
- Consolidation source pins and current limitations are in PRIVATE-ALPHA-SOURCE-MANIFEST.md. No remote deletion is authorized by this additive update itself.
