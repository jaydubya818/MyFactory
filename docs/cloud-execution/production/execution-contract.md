# Production execution contract and release qualification

Status: **LOCAL_QUALIFIED / LIVE_VALIDATION_PENDING**. General production admission remains disabled. This contract does not authorize the first paid canary.

## Model connection

The host-only `production-model-provider.mjs` supplies a ProviderConnection to the existing SpendGateway. It does not introduce a HarnessProvider or execution engine. Its dedicated canary route requires a separately installed exact owner authorization hash and an immutable matching database grant; neither is installed by the release-validation path.

Each operation must first pass a durable, exact Work authorization assertion. The adapter then acquires fresh runtime OIDC, verifies the signature and exact Factory production project/team/issuer/audience/environment, and refuses expired identities. No static API-key fallback, qualification identity or provider credential enters the producer/verifier. The existing SpendGateway reserves budget and rechecks authority after identity acquisition, prohibits server-side conversations/background execution, enforces input/output caps, uses one HTTP attempt, rejects redirects and credential echoes, and records unknown spend conservatively.

Provider: Vercel AI Gateway Responses API; upstream restricted to OpenAI. Model: `openai/gpt-5.4-mini`; standard service tier; storage disabled. Production rate revision `production-openai-mini-20261003-v1` expires2026-10-10T00:00:00Z. Input750,000 and output4,500,000 micro-USD per million tokens. Conservative operation caps:64,000 input context tokens and8,192 output tokens. Full operation reserve84,864 micro-USD ($0.084864), including one separately reserved completion operation. Final Work budget/operation count must be bound in the reviewed envelope before authorization.

Primary references checked2026-10-03: [Gateway model/rates](https://vercel.com/ai-gateway/models/gpt-5.4-mini), [OIDC authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok), installed `@vercel/oidc`3.8.10 verification API and canonical SpendGateway. No paid request was used to validate the price or identity adapter. Revalidate current pricing before presenting the final canary envelope if this rate card expires.

## Qualification boundary

Adapter unit tests:14 PASS, independent read-only review PASS. Cloud regression suite127 PASS/4 gated skips; typecheck PASS. An initial sandboxed run could not bind its loopback test listeners; the same suite passed with localhost permission. These are local adapter/regression results, not live model transport or full production execution qualification.

Still required: exact harmless source/checkpoint binding; separately bound protected verifier; canonical Work/owner grant; production queue/provider/custody/signing composition; production EvidenceProvider and MyEve durable Proof ingestion; deterministic composed qualification; final exact Work/FactoryVersion/Environment authorization envelope. No provider adapter is enough to establish Ready.

## Prepared source, checks and composition

A new harmless three-file source is durably preserved as ancestor commit `8f1d9527d480a0cb500d188874b35398b0ebcbf1`, tree `32483deb1b36516d58dee7be7ae90b927f5e8b78`. Only `fixtures/production-canary/line-endings/normalize.mjs` may change. The objective is primitive-string line-ending normalization: CRLF and lone CR become LF, all other characters remain exact, and non-strings throw. This initial source intentionally fails its visible tests. It is not a generated candidate, completed Work or alteration to historical Attempt8.

The production plan explicitly binds the existing myfactory-codex0.157.0 harness, source, command, implementation checkpoint, read-only completion, separate protected policy, price and conservative reserves. Its proposed bounds are one candidate attempt, at most two productive operations plus one completion operation,180 seconds and$1 maximum. These are preparation limits, not an approved Work envelope. The exact canonical Work, owner grant, FactoryVersion, Environment, validity window and production qualification are still required before Section17 authorization can be requested.

The retained Cloud components now accept trusted host configuration for source/checkpoints, provider credentials, custody prefix/store, queue/client identity, spend plan and protected verifier. `production-runtime-components.mjs` composes those existing components behind distinct production validation and canary HTTP/queue entrypoints. It does not open a database, enqueue a dispatch, acquire identity or call a model during construction. Production admission remains at the deployed disabled boundary. No second execution engine or HarnessProvider was added.

Protected policy answers remain outside the three-file source and producer harness/context. Local subprocess tests reject identity, trimming, coercion and false-verdict candidates. These tests do not establish hosted sandbox isolation. Existing lifecycle, custody, signer and verifier components must be composed and live-qualified before Ready.

Final local corpus:486 PASS/21 gated skips; connected verified-TLS disposable PostgreSQL22 PASS; typecheck PASS. Independent bounded-composition review passed30 focused cases after fixing two findings: invalid Work-limit values now reject, and missing/mismatched Cloud verification policies can no longer silently downgrade to unprotected completion. New tests exercise both. Initial failures (loopback sandbox restriction and fixture-reconstruction/path assumptions) were corrected and are not relabeled passing runs.

The final production platform readback is retained under [evidence](evidence/): MyEve main/deployment `82b4284b100f13b91ed5ba8142716033d695aac0`, Factory main/deployment `7e60ad2044b2805f5c7caad7dca4811fca777e33`; exact All Deployments protection and sole Sofie Production→Factory Production trust remain intact. Owner connection checks passed again after redeployment. This platform result does not promote this preparation branch into production.

Remaining: durable exact Work authority and qualified entrypoints; production signer provisioning; production queue activation; MyEve production configuration/Environment binding; new production EvidenceProvider→Proof ingestion; full deterministic composed qualification and final canary envelope. Overall remains NOT_READY for paid execution. No paid model call or generated publication occurred.


## Final release assembly

The operator validation uses a fixed, reviewed implementation of line-ending normalization. It is attributed as `operator-authored-candidate-validation`, model `none`, evidence class `DETERMINISTIC`; it never installs a Harness or invokes a model adapter. It exercises real source materialization, visible checks, durable candidate custody, producer teardown, separate protected verification, signed Result, authenticated TestEvidence/DiffEvidence transport, MyEve durable custody and owner Proof readback. Its client and FactoryVersion differ from the future paid canary. A conservative unused V2 budget ceiling is not a paid-call or completion claim.

Migration008 adds immutable operator-installed Work envelopes. Runtime cannot create them. The exact request, owner, source, configuration, FactoryVersion, contract digest, candidate-input digest, environment, expiry and publication=false are checked under the existing serialized transaction before prepare, claim, queue reservation, heartbeat, paid spend and protected verifier admission/finish. Revocation is one-way. A validation envelope cannot authorize the paid client. The paid client additionally requires the exact manifest hash in its separately authorized server configuration.

The MyEve production path is server-only, pins one canonical Work/generation and repository, and does not reuse the old qualification conversation, source, model transport or owner. Owner-only same-origin POST queues the existing Cloud controller; it cannot select another Work, source, model or grant. The controller filters its exact Work before queue limits. General Work and synthetic conversation switches remain disabled. Result readback requires the current admitted receipt, signature, Work revision/generation, FactoryVersion/source/configuration and candidate digests. Both evidence kinds must survive independent durable readback. Live negative probes must return exact cross-owner/cross-Work denials from Factory and MyEve before the UI can show PASS.

## Cancellation, revocation and bounded recovery

The top-level paid-canary authorization guard remains. Explicit cleanup-only routing permits observation, stop, retained Result/Proof readback and the authenticated recovery queue for already admitted identities after withdrawal of the canary hash. This mode unconditionally rejects every new execution authority crossing, including prepare, claim, heartbeat, model operations and verifier execution. It does not admit replacement Work, producers or candidates.

Proof credentials and the active Result signer remain required; no authentication or signing validation was bypassed. Canonical production authority requires both expiries to be strictly later than the exact Work deadline plus20 minutes. This covers the deadline+30s recovery delivery,900s retention and bounded callback/provider operations. Near-expiry admission fails before grant consumption or allocation. If an outage exceeds that recovery envelope, an operator must equivalently renew the existing Proof credential/signing configuration before replaying cleanup for the same retained Run. Do not create another Run, reset UNKNOWN exposure, or treat an expired credential as proof of cleanup. Credential renewal cannot change Work/source/FactoryVersion/effects or resurrect a revoked grant. A provider allocation with uncertain outcome remains UNKNOWN until the original resource is reconciled.

Two proposed relaxations of cleanup guards were rejected by automatic approval review. The accepted implementation instead narrows admission with the credential recovery horizon, retains all credential/signer checks, and documents the operator renewal boundary.

## Remaining live release gate

Merge/deploy only after independent source review and release tests pass. Apply migrations only through the qualified operator path. Provision the production signer and distinct application/Proof credentials, install only the exact operator-validation envelope, run the hosted journey, verify zero model operations and publication effects, and record its current owner Proof plus isolation denials. Platform health alone does not satisfy this gate. The paid canary configuration/hash/grant must remain absent until the separate Section17 owner approval.

## Validation failure boundary — 2026-10-04

The owner approved one model-free validation with no automatic execution retry after ambiguity, expiry, authority loss or evidence-integrity failure. Preflight review found two gaps before any production grant or dispatch: ambiguous preparation could be retried, and an UNKNOWN queue send could admit a late first execution. The successor narrows validation behavior only. Missing-grant waiting now requires a fully validated static request and an exact denial; recorded UNKNOWN delivery atomically fences the attempt, while authenticated cleanup remains available. Normal producer/verifier work is reported as pending only while the original lease and exact custody bindings support that state.

MyEve retains a durable validation halt across controller ticks, repeated Start commands and process interruption. Evidence transport failures cannot become retryable waits. No candidate, model, publication policy or paid-canary authority is added. General Work stays disabled. This is a local release compatibility repair; it is not evidence of a completed live production journey. The production query console's write-mode confirmation remains a separate unresolved operator boundary.

The successor received independent read-only scoped PASS after all reported failure-path findings were resolved. Independent checks passed12 Factory unit cases and2 connected, verified-TLS disposable PostgreSQL cases; MyEve's independent related corpus passed50 cases, including18 validation halt cases. Local Factory regression passed500 cases with23 gated skips before the final readback refinements; the final focused authority/control cases and producer typecheck also passed. These counts describe local qualification, not live production execution. No production grant, validation dispatch, paid model call or generated publication was initiated during this repair.
