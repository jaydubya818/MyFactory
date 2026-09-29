# Migration reconciliation
**SQLite v8 fresh, canonical populated upgrade, v7 populated upgrade and replay PASS.** All original canonical migration SQL strings remain byte-identical. See qualification/migration-probe.json for individual hashes. Historical q37-gate-c/connected-control lineages are not adopted.
Candidate `cf3c086be31f2423d289b192c0172b39bbfbb0bd`. Historical hashes are retained in inventory.initial.json.

| File | Distinct source checksums | Originating SHAs |
|---|---|---|
| packages/storage/src/index.ts | 0f4029aa0e8de0f38a5b999303fe5e6981067c8636252e86a5e337cc7082db4c<br>105e4282d935ee9ef9ecad9f372f41b8b24758594de58d598eac8e5277cac3b9<br>a3d8156daf62c080a6e124b397861d6318476590ac9bac3043b98e66c4822a14<br>d620f7f5c897bc469a863206ecf67a4e1f83fca5ad24b64e31fbd68250ea006a<br>d85c8d45712630fc3567d220545050c5ff522f0aa35d563d33057c5b9b7c7001 | 101536750b19, 454a49064d52, 543906dc20fe, 8c5de7794ffa, 8f5e3774129b, 925530a6ba87, c1c9cd49b5b9, d9564beef415, fcd8afd6fbaa |
