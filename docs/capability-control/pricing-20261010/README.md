# OpenAI pricing qualification — 2026-10-10 v2

Status: independently reviewed pricing proposal; **NOT ADOPTED**. Runtime price records, stored source identity, approvals, FactoryVersion pins and installation settings remain unchanged by this documentation commit. PR #14 remains HOLD. The separate PR #14 qualification instruction preserves production pricing identity; an explicit adoption decision is pending.

Root cause: `cloud-codex-deterministic-v1` expired October 9; `production-openai-mini-20261003-v1` expired October 10 UTC. Admission correctly fails closed. MyEve's pinned Factory integration imports the same production plan. No incorrect accounting calculation or changed rate was demonstrated.

## Exact proposed record

`20261010-v2.json` records OpenAI `gpt-5.4-mini` through Vercel AI Gateway `openai/gpt-5.4-mini`, Responses endpoint, default service tier, OpenAI only, no fallback/BYOK or regional processing. Current official OpenAI and Vercel pages confirm $0.75 input / $4.50 output per million tokens. Exact URLs, observation timestamps and SHA-256 hashes are preserved. `historical-v1.json` retains the original records and contract digest from `195b1d1`.

The proposed revisions expire October 17 UTC, a seven-day internal revalidation deadline rather than a provider guarantee. Production limits remain 64,000 input and 8,192 output; deterministic limits remain 200,000 / 8,192. Conservative reserves remain 84,864 and 186,864 micro-USD, two productive plus one completion operation, maximum three operations, $1 ceiling. No rates or ceilings are silently substituted.

`identity-impact.json` states the exact candidate source/configuration/FactoryVersion and contract impact. The source identity was already inconsistent before this proposal; no repin is performed. `adoption.patch` is the exact unadopted code/test proposal against the stated base. It retains runtime pricing inline in inventoried `.mjs`; JSON is evidence only. Independent review rejected an earlier JSON runtime import because that would escape source-identity inventory, and caught the need for a direct old-approval denial regression. Both were corrected before this record was published.

## Deterministic qualification of the unadopted patch

- 33 pricing/provider/accounting regressions pass: original records expire, successor expires, exact rates/bounds/reserves persist, expiry blocks credential acquisition, old approval cannot authorize the new contract, a new price cannot reset Work or UNKNOWN exposure, and the original receipt can settle it.
- Full local workspace suite on the earlier successor iteration: 599 passed, zero failed, 27 explicit environment skips using existing dependencies and synthetic providers. The final inline-record/approval-denial corrections were then checked by the 33 focused tests. This is not final-patch full CI, hosted CI or a fresh install.
- Expanded disposable PostgreSQL: 22 passed, zero failed or skipped, including owner isolation, concurrent intake, revocation and paid ambiguity with mocked provider effects.
- Composed MyEve PostgreSQL: 49 passed with its canonical restricted-role capability fixture correction and this unadopted Factory patch. Before that test-only correction, 48 passed and one failed `CAPABILITY_INSTALLATION_UNQUALIFIED` after the pricing expiry was cleared.
- One independent read-only reviewer verified authoritative source hashes, exact rates, identity effects, old-approval denial, and preservation of historical accounting. This is not release approval.

No fake clock replaces PostgreSQL freshness. Unit-only deadline tests explicitly control Date and test expiry rejection. A broad test-clock freeze would conceal real expiry and is not an acceptable integration fix.

Published-head CI still uses expired historical prices and must remain red until approved adoption and complete reruns. No production grant, model call, deployment, migration, credential change or external-alpha change occurred. Local clone/install qualification remains blocked by the storage hold.
