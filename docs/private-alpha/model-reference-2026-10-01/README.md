# Canonical model reference and Attempt-3 qualification gap

Attempt 3 remains failed historical evidence. Work `7e4b305b-72e5-40f7-95e1-150456b84c66` is never reused. Sofie, canonical proposal, admission, PREPARE and one START/writer succeeded. The executor rejected `openai/gpt-5.4-mini` before process launch. One Sofie operation cost $0.000975; Factory operations were zero. Its raw evidence remains protected locally; [sanitized outcome](attempt-3.json).

## Root cause and contract

The executor accepted only a simple unnamespaced identifier while producer snapshot and spend validators already accepted a slash. Connected Factory fixtures used `gpt-5.5`, so model eligibility and Sofie checks did not exercise the exact executor input.

`packages/contracts/src/model-reference.ts` now defines the shared contract: one opaque model component or one provider/model pair, at most 120 ASCII characters, each component beginning alphanumeric and continuing with alphanumeric, dot, underscore or hyphen. Empty components, extra separators, repeated dots/traversal, URL/scheme syntax, whitespace/control characters, shell syntax and oversized input fail closed. No trimming, splitting for routing, prefix stripping, substitution or fallback occurs. Legacy unqualified references remain valid syntax. Syntax acceptance does not qualify a model or authorize execution.

The executor, producer snapshot, spend price, ledger plan and signed-result verifier use this contract. The executor passes the unchanged model as one `spawn` argument without a shell. Exact configured model equality, scoped OIDC, pricing, Work identity, limits, reserve and UNKNOWN fencing remain independent mandatory gates.

## Identity audit

| Boundary | Source of truth and preservation |
| --- | --- |
| MyEve selected Work / Sofie | Private-alpha qualification pins `openai/gpt-5.4-mini`; model proposals cannot select or expand it. |
| Route / Factory request | Backend-reviewed connection pins FactoryVersion and pricing review. Work input does not grant a model override. |
| FactoryVersion / PREPARE | Source digest and execution configuration digest bind the exact configured model; capture uses the shared grammar. |
| START / executor | The immutable prepared snapshot supplies the model; executor accepts it unchanged as one `-m` argument. |
| Harness / bounded gateway | Isolated child uses only the local spend gateway; exact `payload.model === price.model` is required before reserve/forwarding. |
| OIDC / AI Gateway | OIDC provider requires the exact `openai/gpt-5.4-mini` constant and OpenAI-only route; no fallback or provider-prefix removal. |
| Accounting / signed evidence | Ledger plan and operation compare exact model identity; signed snapshot includes it in configurationDigest and FactoryVersion. |

The MyEve native Claude validator belongs to a separate disabled route and is unchanged. The historical Keychain provider's literal legacy model pin is unchanged and is not used by this private-alpha Gateway path.

## Regression and qualification

The exact Attempt-3 adapter regression failed twice before repair with the original message. After repair it starts a synthetic executable that requires the unchanged namespaced argument. Invalid-model cases must fail before any process starts.

Connected qualification now defaults Factory configuration, pricing and synthetic/installed harness requests to the production namespaced model. The installed controlled-boundary mode follows captured Sofie proposal → canonical queue → route admission → PREPARE → START → installed executor → loopback upstream `/v1/responses`. It checks the exact model, sends no request to a real provider and terminates without generation; synthetic transport uncertainty remains fenced. Separate controlled success tests cover candidate custody and independent Docker verification.

All test providers and publication adapters are local fixtures. Their simulated receipts and counters are not live model usage or publication. A successful controlled boundary does not prove a future real generation or candidate.


Qualification passed: MyFactory 154 tests plus one gated skip; typecheck, producer typecheck, governance (15 reviewed sources, UNKNOWN=0) and build. MyEve 1,990 tests plus 53 gated skips; captured connected 23 checks; installed-CLI exact-model boundary 22 checks; root regressions, 73 ordered migrations, typecheck, governance and build. All additional real model operations: zero.

Diagnostics retained locally: the initial Factory full suite needed loopback permissions; the first boundary assertion used `/responses` instead of the actual `/v1/responses` and was corrected only in the test; an unrelated native-repair admission fixture returned `routing_changed` once under concurrent qualification and passed on isolated rerun without weakening checks. No production admission or timeout change was made.
