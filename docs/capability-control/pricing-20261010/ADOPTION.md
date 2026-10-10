# Successor pricing adoption — 2026-10-10

**Adopted in the isolated Capability Control Plane source candidate. PR #14 remains HOLD; production and deployment are not qualified.** The owner's explicit successor-adoption approval supersedes the proposal's pending-decision label. The proposal, historical record, source record, identity-impact file and patch retain their original bytes. `adoption-receipt.json` records their hashes and the authorization boundary.

## Exact adoption

Applied `adoption.patch` without modification. Production `production-openai-mini-20261003-v1` becomes `production-openai-mini-20261010-v2`; deterministic `cloud-codex-deterministic-v1` becomes `cloud-codex-deterministic-20261010-v2`. The original expired records remain in `historical-v1.json`. Effective date is October 10; internal review deadline is October 17 UTC. Expiry continues to fail closed.

The immutable `20261010-v2.json` records authoritative OpenAI and Vercel URLs, retrieved bytes' SHA-256s, observation timestamps and exact OpenAI `gpt-5.4-mini` / Gateway `openai/gpt-5.4-mini` binding. Default tier, OpenAI only, no fallback/BYOK, regional processing or hosted billable tools. Rates remain $0.75/$4.50 per million input/output tokens. Limits, 84,864/186,864 micro-USD reservations, two productive plus one completion operation and $1 ceiling are unchanged. Pricing supplies no execution authority.

Runtime prices remain inline in inventoried `.mjs` sources. Only the two corresponding producer-governance hashes are refreshed after independent byte review. The gate and authority classifications are unchanged.

## Identity and execution contract

Computed source digest: `59d4fc1f1bd7bd5206040994e31906ea3bb3d76d3c4a0f8b26a5d407bfd03699`.
Configuration digest remains `415f52a554e8dbdcc48019609e4611f07085622abf5c91cd67b516e978a593ae`.
Computed successor FactoryVersion: `fed1724f60a7783a2dc5155928bd7f4df5a34970d9de3be53cdacc4dd0a9c30b`.
Execution contract changes from `29ff7774ec7ac08a061f28fe2f81bff4a8f1124987f64a69a1b5cb8e21976b66` to `d7a24ed69b7d8267d4817961bd0ee22c76b6313650177b31322783dcc9d2d9a3`.

Stored source identity `1c69113378ed82428d13a2f89452708204e171ac9cb952b0a725acff83844548` is deliberately unchanged. It was inconsistent before this patch (baseline computed `a2e618470e1c26e85047d430182516e9395b131130d03cb4d9c6a2ad000fcbf2`). Source-identity verification remains a known blocking failure; the computed successor is not an installed or executable FactoryVersion. Source/configuration reconciliation and target-specific successor qualification need separate approval. Old approval cannot authorize the new contract. No existing Work, budget, receipt or UNKNOWN exposure is migrated or reset.

## Deterministic qualification

- Exact final patch: 33 pricing/provider/accounting regressions PASS.
- Full workspace suite: 600 PASS, zero FAIL, 28 explicit environment skips. Hosted container/browser/database checks remain separate gates.
- Disposable real PostgreSQL: Factory 22/22 and MyEve 49/49 PASS, no skips. Covers concurrency, owner isolation, revocation, UNKNOWN retention/recovery and original-price reconciliation.
- MissionControl unchanged source: 1,490 Convex tests PASS; disposable real Convex admission/fence checks PASS. The composed source/Relay option was not run in this local invocation; existing exact-source hosted composition is independently green.
- Independent read-only reviewer verified exact patch, immutable hashes, source provenance, recomputed identity/contract, expiry and old-approval rejection. Final committed evidence is reviewed separately.
- Exact-SHA hosted CI is recorded in the PR after publication. Local fresh clone/install remains NOT_RUN under the storage hold (25 GiB free; documented release threshold 60 GB).

## Consumer compatibility

| Consumer | Impact and permitted action |
| --- | --- |
| MyEve #70, preserved `9200bd3826350ad586bb5640ca08557da7d1b984` | Its real PostgreSQL test imports `productionSpendPlan` from the exact Factory source. Update only its isolated CI reference to this qualified successor commit. `factory-spend.ts`, producer protocol and validation materializer retain exact source/FactoryVersion/expiry/contract checks. No runtime or installation pin migration. |
| MissionControl #238, `11651a30f2c6f5f7e46a1a01328fe3cf6749411a` | No direct Factory price import in the capability admission path. Signed permits bind exact action/native Mission/WorkOrder snapshots and budget; native authority checks remain independent. Native Bedrock pricing is separate. A computed Factory successor does not qualify delegated runtime bindings, WorkOrder/Attempt lineage or grant a budget. No source change required for this pricing adoption. |
| Relay #35, `aec9d9adb4c057f4bbd85a3ec27155d14fe6f24b` | Policy propagation owns no model tariff; source and signed policy checks unchanged. No source change. |
| MyApps | Read-only source report records preparation MyEve #72 `fa55ddf2778712bef2b7f1110520a3eedae95e26`, Factory #15 `025a06e58200333f2df32a3910b235e7ffaff0b7`; canonical inputs MyEve `afa65bd4c2d3ce26691a07132030cad1a1ef140e`, Factory `18e59dbedbe04275858327ca47d2bd7ec01a407c`. Dedicated allowance composition passed 208 cases but broad fixture/packaging and UNKNOWN partition gates remain separately owned. These candidates and pins are untouched. This record is not authorization to adopt production pricing or repin FactoryVersion there. |
| External Alpha | Frozen installation remains untouched. Separately reported Factory `18e59dbedbe04275858327ca47d2bd7ec01a407c` and MyEve `6c02ab1ed9f2a80c04b88fe75083e574426af68d` are workstream evidence, not a verified live installation inventory. No installation access or migration. Exact installed source/configuration/grant identities must be read and reconciled in that separately authorized workstream before any successor use. |

For other workstreams authorized only for deterministic fixture repair: retain historical production identities and test them with explicit historical unit clocks; test rejection at and after expiry. Isolate synthetic fixtures from production records, preserve model/provider identity, ceilings, UNKNOWN and accounting assertions. Never freeze PostgreSQL policy/deadline time globally or extend live qualification to make tests green. Importing this successor into those candidates requires their own explicit source-adoption approval; no patch or pin is supplied as an automatic update.

## Holds

All four integration PRs remain HOLD. Required final source reconciliation, merge-candidate qualification and fresh-clone gates are not waived by pricing adoption. MissionControl main conflicts need separately authorized reconciliation. Real owner/installation binding, restore witnesses, delegated positive execution and authoritative pause/stop/cleanup remain deployment gates. No production deployment, paid operation, executable production grant, credential change, external-alpha modification or dependency merge occurred.
