# Capability inventory

| Capability | Source | Destination | Migration impact | Integration method | Disposition |
|---|---|---|---|---|---|
| Producer attestation / FactoryVersion / signed Results | fcd8afd → 925530a | apps/supervisor/src/producer-results; packages/hosted-routing/src/result | SQLite through 8 | Normal merge of reconstructed producer | ADOPTED; controlled tests PASS |
| Connected PREPARE / START / READ / STOP / process recovery | d9564be → 925530a | apps/supervisor/src/dispatch-control; jobs; server | SQLite through 8 | Use prepared dispatch and Work event record; supersede old ConnectedExecutionControl | ADOPTED; exact current source must be consumed by final Beta |
| Spend/resource V2 / UNKNOWN / reserve / paid-operation limits / atomic admission | 925530a | packages/storage/src/spend; apps/supervisor/src/spend-gateway | 7 unchanged; append 8 | Durable reconstruction, not lost-source recovery | ADOPTED; local negative-probe counters 0 |
| Client tool search / installed CLI / provider loader | 925530a | apps/supervisor/src/real-provider; spend-gateway; packages/agents | No additional migration | Prepared explicit loader; default startup stays disabled | ADOPTED; loopback CLI PASS, real provider NOT_RUN |
| Offline preview cache preparation | 1015367 → cf3c086 | package.json; README; packages/agents/test | None | Cherry-pick small operational delta; retain producer changes | ADOPTED; fresh-clone build and tests PASS |
| Older hosted Gate C and connected-control prototypes | 454a490; c1c9cd4 | Retained source branches | Alternative old migration lineage | Keep historical protocol/evidence; no competing dispatch store | SUPERSEDED |

Exact durable branch tips, source dependencies and retention reasons are in [BRANCH-INVENTORY.md](BRANCH-INVENTORY.md). Initial evidence directories and migration checksums are in [inventory.initial.json](inventory.initial.json). Historical PASS never implies a modified candidate or live deployment PASS.
