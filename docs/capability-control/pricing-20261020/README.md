# Pricing v3 adoption — 2026-10-20

> **⚠ RE-QUALIFY BEFORE 2026-10-28T00:00:00Z.** Both pinned prices expire then and every paid path fails closed. Before that date, re-check the `openai/gpt-5.4-mini` rate on Vercel AI Gateway and OpenAI, write a new revision record, and get explicit owner approval. Never extend `validUntil` silently, and never backdate a revision.

Owner-approved 2026-10-20. Record: `20261020-v3.json`.

| | Revision | Input | Output | Valid until |
|---|---|---|---|---|
| Production | `production-openai-mini-20261020-v3` | $0.75 / 1M | $4.50 / 1M | 2026-10-28T00:00Z |
| Deterministic | `cloud-codex-deterministic-20261020-v3` | $0.75 / 1M | $4.50 / 1M | 2026-10-28T00:00Z |

- Rates are unchanged from `20261010-v2`. OpenAI's model page is byte-identical to the 10-10 capture. Gateway `/v1/models` shows the same default-tier rate. The US-regional tier ($0.825 / $4.95) does not apply, because the route keeps `regionalProcessing: false` and `serviceTier: default`.
- **Gap not covered:** `20261010-v2` expired 2026-10-17T00:00Z. No price was valid from 2026-10-17 to 2026-10-20, and this revision is not backdated.
- Reserves are unchanged: production 84,864 µUSD per operation, deterministic 186,864 µUSD per operation, ceiling 1,000,000 µUSD.
- The execution contract changes from `d7a24ed6…` to `377cf5e6…`, so approvals bound to the old contract cannot authorize the new one.
- Source identity was repinned to `3833892f…` (FactoryVersion `78ef5eb7…`). See `../source-identity-20261020/pricing-successor.json`. **No qualification evidence is inherited from earlier FactoryVersions.**
- Producer-governance hashes were refreshed for exactly `cloud-harness-plan.mjs` and `production-model-provider.mjs`. The byte diff in each is the revision and `validUntil` strings only.
