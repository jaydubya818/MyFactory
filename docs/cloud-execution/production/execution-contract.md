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
