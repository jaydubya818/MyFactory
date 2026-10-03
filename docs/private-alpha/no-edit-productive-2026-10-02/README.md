# No-edit productive response — offline repair qualification, 2026-10-02

## Preserved failure and first controllable divergence

Failed Work `54af9acf-df9e-4d69-811e-aa886f3a138e`, Factory run `c8a2af28-22be-48ba-87f4-bdf205287a58`, is preserved, fenced and paused at revision/generation 3/3. Its one productive response called `pwd` then `rg --files`, made no edit and settled normally. The next model request was rejected locally at PRODUCTIVE_CHECKPOINT, without another provider operation. The host correctly rejected the unchanged tree. The safe-integer implementation contract was never exercised. Retained spend remains Sofie $0.001200 + Factory $0.008419 = $0.009619, two total model operations, zero UNKNOWN exposure.

The sanitized captured response and full public task context are in MyFactory `apps/supervisor/test/fixtures/no-edit-productive.json`. The retained prompt already contained:

| Required fact | Captured evidence |
| --- | --- |
| Current quantity source | `quantity.mjs: null`, accurately recording an absent file |
| Public numeric/output contract | README and public contract artifact: 1..9007199254740991, exact compact JSON plus one LF, exit 0, empty stderr |
| Implementation-visible checks | Complete test source and 16-case public boundary corpus |
| Runtime/package | Node >=20, ESM, node:test and test command |
| Prior reconnaissance | Explicit host-provided bounded inventory and inspection-complete instruction |
| Productive expectation | Explicit one-response implementation/edit instruction |

No missing repository fact explains generic discovery. The first controllable integration gap was between the host's bounded execution mode and the CLI session: the mode existed only in task text while the generic executor retained context-gathering/announce-first instructions. The exposed local tools were available; no client-tool search or missing-tool response preceded the two discovery commands. This establishes a harness instruction/sequence mismatch, not a missing safe-integer requirement or evidence that the model lacked implementation capacity.

## Minimal repair and limits

The host sets a fixed `boundedProductiveContext` flag only after collecting context and establishing the metered productive checkpoint. The adapter injects a fixed developer instruction through the documented [Codex developer_instructions setting](https://learn.chatgpt.com/docs/config-file/config-reference). Repository text cannot supply or change that instruction. Completion rejects the productive flag and remains read-only/tool-free.

The instruction explains that supplied context completes generic reconnaissance, null target source means absent, and a productive response is expected to perform the scoped implementation. Necessary targeted reads remain allowed. A tool can read a concrete missing fact and perform a dependent scoped edit with local validation in the same response. If this safely requires another inference before any edit, the process still fails closed; another productive slot is not automatically granted for exploration. The no-change checkpoint, metering, operation/attempt limits, tool exposure, sandbox, repair eligibility and completion authority are unchanged.

This is a fixed instruction repair, not a guarantee of model compliance. The deterministic contract-sensitive fixture checks the actual outgoing developer-role instructions and selects captured no-edit output when they are absent. Its expected-success assertion failed before the repair with `Agent produced no source changes`. After repair it passes. The separately replayed exact captured no-edit output continues to fail closed. Live adherence is unproven until another explicitly authorized execution.

## Qualification

| Case | Result |
| --- | --- |
| A: sufficient supplied context → scoped edit | PASS; installed CLI, actual outbound developer-role protocol checked |
| B: genuinely omitted schema fact → targeted read + dependent edit | PASS; one productive response, no generic reconnaissance |
| C: captured pwd/rg-only response | PASS; one consumed operation, no candidate/completion, fenced |
| D: outside-scope edit | PASS; fenced without candidate/completion |
| E: correct first implementation | PASS; unused Productive 2 preserved; completion, exact tree, signed custody and protected verification |
| F: repairable first implementation | PASS; bounded deterministic feedback, Productive 2, checks then completion/custody/verification |
| Still-failing second implementation | PASS; no completion |
| Numeric public/protected/review corpus | PASS; unsafe-number rounding stays rejected, byte-exact output and public range retained |

Installed-CLI checkpoint suites: 16/16 PASS, covering the new cases, safe-integer boundaries and prior feedback semantics. MyFactory ordinary suites: 175 PASS, 16 optional skips; typecheck, producer typecheck, governance (18 classified, UNKNOWN 0) and build PASS. MyEve root: 145 PASS, 2 optional skips; application: 1,992 PASS, 94 optional skips; typecheck, governance and build PASS. Protected numeric Docker corpus: 3/3 PASS, including independent 11/11 positive control.

Two full connected offline journeys each passed 26/26 using the installed CLI, loopback synthetic responses, isolated local database and protected Docker verification. Correct-first used synthetic Sofie → productive → completion → explanation (4 operations); repair used the existing second productive slot (5). Both exercised proposal normalization/admission, namespaced model, writer/deduplication, UNKNOWN/cancellation/recovery, Gate C/B, exact-tree custody, verification, accounting and immutable Proof versus current spend. No paid provider endpoint was used. Offline Result remains PARTIAL because publication/review/acceptance were not established by these fixtures.

Qualified Factory source digest: `ebb9cbfb207c08d689aa7ea95c80ea9436b60509822676e6a1dd1a3c4f7c1804`.
Qualified FactoryVersion: `c1d7a9a34fa78bf902ca14d810c1233ff3138e9442d34b0c53fd88dd44ac56e4`.

Reproduction commands (run from MyFactory root, using the existing installed CLI):

```sh
FACTORY_INSTALLED_CLI=1 node --test apps/supervisor/test/productive-context.test.mjs apps/supervisor/test/numeric-range-checkpoint.test.mjs apps/supervisor/test/implementation-loop.test.mjs
npm test
npm run typecheck
npm run typecheck:producer
npm run check:producer-governance
npm run build
```

Connected evidence is retained in the private qualification archive as `no-edit-connected-first.json` and `no-edit-connected-repair.json`. Their fixtures use `FACTORY_PRODUCTIVE_CONTRACT=1`, `FACTORY_NUMERIC_RANGE=1`, `FACTORY_SPEND_FIXTURE=1`, `FACTORY_INSTALLED_CLI=1`, and the repaired `MYFACTORY_SOURCE_ROOT`; correct-first additionally uses `FACTORY_FIRST_PASS=1`.

## Historical preservation and fresh authorization gate

All 21 hashed failed-run artifacts remain byte-identical. The failed Factory run remains failed with no candidate and one settled operation. Historical Attempt 8 candidate `1253fcbd5a4e11d72f8ee43c7025b0729d9fa298`, verified tree `ddcb301db219a744fe741d745f85a97da8a3cd22`, draft PR #2 and immutable Proof remain unchanged: CI PASS, review FAIL, Result PARTIAL, Ready false, owner acceptance NOT_RUN. Its base is still `codex/private-alpha-release` at `7380d3324224a5660daa1556384c7a1a17d7d21e`. No historical candidate mutation, budget reuse, retry or external publication occurred.

Fresh Work: `db8d221c-275a-498f-90ed-c42fd3b4e157`, revision/generation 1/1, PAUSED, model calls 0, route runs 0, Factory commands 0. The existing approved safe-integer profile and protected criteria are staged for this new identity only; they were not activated and historical bindings were not rewritten.

Proposed envelope: repository `jaydubya818/myeve-golden-work-qual`, base `codex/quantity-safe-integer-contract` at `0d61cf7cbad18831543ae93f118f18595d2a0be2`; modify only `quantity.mjs`. Exact model `openai/gpt-5.4-mini`, project-scoped Vercel OIDC → AI Gateway → OpenAI only, no fallback. At most 5 model operations (2 Sofie, 2 productive, 1 read-only completion), one candidate attempt, 600 seconds from first Sofie reservation, $1.35 total ($0.30 Sofie/$1.05 Factory), reserves $0.336864 Factory completion and $0.15 final Sofie explanation. Unused productive capacity stays unused. Local exact-tree commit, custody, Gate C/B, independent verification, Result, Proof and final explanation only. Publication, merge, candidate deployment and owner acceptance remain disabled.

Before any subsequently authorized paid operation, activate the repaired runtime, verify its exact source/FactoryVersion, freshly bind only the new Work and refresh canonical provider/pricing/base/writer preflight. Any preflight denial stops before spend. This repair turn did not activate runtime or perform another real model operation. New Work execution requires explicit approval.
