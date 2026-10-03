# Production execution contract — preparation

Status: **NOT_READY**. Production admission remains disabled. Preparing this contract is not owner authorization for a model operation.

## Model connection

The host-only `production-model-provider.mjs` supplies a ProviderConnection to the existing SpendGateway. It does not introduce a HarnessProvider or execution engine. It is not yet connected to production Work admission.

Each operation must first pass a durable, exact Work authorization assertion. The adapter then acquires fresh runtime OIDC, verifies the signature and exact Factory production project/team/issuer/audience/environment, and refuses expired identities. No static API-key fallback, qualification identity or provider credential enters the producer/verifier. The existing SpendGateway reserves budget and rechecks authority after identity acquisition, prohibits server-side conversations/background execution, enforces input/output caps, uses one HTTP attempt, rejects redirects and credential echoes, and records unknown spend conservatively.

Provider: Vercel AI Gateway Responses API; upstream restricted to OpenAI. Model: `openai/gpt-5.4-mini`; standard service tier; storage disabled. Production rate revision `production-openai-mini-20261003-v1` expires2026-10-10T00:00:00Z. Input750,000 and output4,500,000 micro-USD per million tokens. Conservative operation caps:64,000 input context tokens and8,192 output tokens. Full operation reserve84,864 micro-USD ($0.084864), including one separately reserved completion operation. Final Work budget/operation count must be bound in the reviewed envelope before authorization.

Primary references checked2026-10-03: [Gateway model/rates](https://vercel.com/ai-gateway/models/gpt-5.4-mini), [OIDC authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok), installed `@vercel/oidc`3.8.10 verification API and canonical SpendGateway. No paid request was used to validate the price or identity adapter. Revalidate current pricing before presenting the final canary envelope if this rate card expires.

## Qualification boundary

Adapter unit tests:14 PASS, independent read-only review PASS. Cloud regression suite127 PASS/4 gated skips; typecheck PASS. An initial sandboxed run could not bind its loopback test listeners; the same suite passed with localhost permission. These are local adapter/regression results, not live model transport or full production execution qualification.

Still required: exact harmless source/checkpoint binding; separately bound protected verifier; canonical Work/owner grant; production queue/provider/custody/signing composition; production EvidenceProvider and MyEve durable Proof ingestion; deterministic composed qualification; final exact Work/FactoryVersion/Environment authorization envelope. No provider adapter is enough to establish Ready.

## Prepared source, checks and composition

A new harmless three-file source is durably preserved as ancestor commit `8f1d9527d480a0cb500d188874b35398b0ebcbf1`, tree `32483deb1b36516d58dee7be7ae90b927f5e8b78`. Only `fixtures/production-canary/line-endings/normalize.mjs` may change. The objective is primitive-string line-ending normalization: CRLF and lone CR become LF, all other characters remain exact, and non-strings throw. This initial source intentionally fails its visible tests. It is not a generated candidate, completed Work or alteration to historical Attempt8.

The production plan explicitly binds the existing myfactory-codex0.157.0 harness, source, command, implementation checkpoint, read-only completion, separate protected policy, price and conservative reserves. Its proposed bounds are one candidate attempt, at most two productive operations plus one completion operation,180 seconds and$1 maximum. These are preparation limits, not an approved Work envelope. The exact canonical Work, owner grant, FactoryVersion, Environment, validity window and production qualification are still required before Section17 authorization can be requested.

The retained Cloud components now accept trusted host configuration for source/checkpoints, provider credentials, custody prefix/store, queue/client identity, spend plan and protected verifier. `production-runtime-components.mjs` composes those existing components with production bindings but is **not imported by HTTP or queue entrypoints**. It does not open a database, enqueue a dispatch, acquire identity or call a model during construction. Production admission remains at the deployed disabled boundary. No second execution engine or HarnessProvider was added.

Protected policy answers remain outside the three-file source and producer harness/context. Local subprocess tests reject identity, trimming, coercion and false-verdict candidates. These tests do not establish hosted sandbox isolation. Existing lifecycle, custody, signer and verifier components must be composed and live-qualified before Ready.

Final local corpus:486 PASS/21 gated skips; connected verified-TLS disposable PostgreSQL22 PASS; typecheck PASS. Independent bounded-composition review passed30 focused cases after fixing two findings: invalid Work-limit values now reject, and missing/mismatched Cloud verification policies can no longer silently downgrade to unprotected completion. New tests exercise both. Initial failures (loopback sandbox restriction and fixture-reconstruction/path assumptions) were corrected and are not relabeled passing runs.

The final production platform readback is retained under [evidence](evidence/): MyEve main/deployment `82b4284b100f13b91ed5ba8142716033d695aac0`, Factory main/deployment `7e60ad2044b2805f5c7caad7dca4811fca777e33`; exact All Deployments protection and sole Sofie Production→Factory Production trust remain intact. Owner connection checks passed again after redeployment. This platform result does not promote this preparation branch into production.

Remaining: durable exact Work authority and qualified entrypoints; production signer provisioning; production queue activation; MyEve production configuration/Environment binding; new production EvidenceProvider→Proof ingestion; full deterministic composed qualification and final canary envelope. Overall remains NOT_READY for paid execution. No paid model call or generated publication occurred.
