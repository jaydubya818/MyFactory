# Private-alpha source manifest

Independent review **PASS**. These exact reviewed source pins are the accepted baseline; later documentation/evidence descendants are identified by remote `main` and the final canonical receipt. Canonical fresh-clone validation remains a separate gate until its receipt is recorded.

| Repository | Reviewed implementation and evidence candidate | Migration head |
|---|---|---|
| MyEve | `2f70ab3c6eb9e31b3a16525a57b2e701144c3c93` | 0071; 67 files (0058–0061 reserved), immutable legacy ledger bridge |
| Relay | `aaa10405afb89a41624b081a40c0282b70697e8b` | 0028; 29 Drizzle entries |
| MyFactory | `d2e19e286bc7462a36d2bf0009e37de3255831c1` | SQLite v8 |

Accepted inputs: Beta `52b3891a2685307cbb50bba97680070700df4cc0`, Q37 `cf83e3bec6f02ca812b2e08e04c188eaa271bede` through Beta, selectively integrated Product Expansion code `9caacf60c6affae48f3cdaadfd3ecd7ca50dd0c2`. Late Product handoff `52141ba7d73bdc07f4ceff001b9dfccc5cae40c9` changes documentation/evidence only; its apps/eve tree is byte-identical to that accepted code pin.

MyFactory lost `efe9e856f8fffbdb785497444a08d39e54d8f78d` is historical evidence only. Durable `925530a6ba8764df6a7b8637192fe32edcbaff97` is a reconstruction, not byte-equivalent recovery. Its reviewed successor above is the canonical producer. Runtime must use an explicit clean checkout of canonical MyFactory, never a feature worktree or lost source.

Two-owner scope is implemented and qualified: owner-private defaults; explicit business grants; bounded Work context; no automatic promotion or credential sharing. Our business is the shared-context interface. Legacy deployment services remain primary-owner-only; optional Rooms, business specialists and business-owned connections are deferred.

Controlled whole-product tests PASS while Result/Proof classification remains **PARTIAL**: local verification is not hosted CI, publication, deployment or owner acceptance. Real-provider calls and production deployment are NOT_RUN and require their separate launch authorization.

See CANONICAL-STATUS.md, INDEPENDENT-REVIEW.md, SHARED-SCOPE-IMPLEMENTATION.md (MyEve), migration reconciliation and qualification evidence. Final exact remote main SHAs, fresh-clone results and cleanup receipts are recorded in CANONICAL-RECEIPT.json after execution.
