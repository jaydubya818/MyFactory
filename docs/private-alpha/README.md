# Private-alpha OIDC provider

MyFactory's explicit private-alpha entry point now uses the same project-scoped `@vercel/oidc` acquisition mechanism as MyEve's qualified owner runtime. Default `npm start` still grants no paid execution. Provider availability does not authorize a Work, writer, publication, or Result Ready state. The first substantive Sofie → MyFactory journey remains owner-gated.

## Authentication and route

The reviewed nonsecret [provider configuration](provider.json) selects `VERCEL_OIDC_GATEWAY_PRIVATE_ALPHA`, Responses endpoint `https://ai-gateway.vercel.sh/v1/responses`, and exact Gateway model ID `openai/gpt-5.4-mini`. Requests explicitly restrict routing to `openai`; client routing overrides, alternate models and redirects are rejected. No static provider key or fallback is used. The dated OpenAI snapshot ID is not listed in the Gateway catalog: this pins the Gateway identifier, not an immutable upstream weights snapshot.

The provider adapter calls the existing SDK with MyEve project `prj_L6faw25wnFGUZtrLKBIccg8gIDLR` and team `team_p8z8exJRTGfOPk1GC9vUOpv3`. It verifies RS256 signature, exact project/owner, issuer `https://oidc.vercel.com/jaydubya818`, audience `https://vercel.com/jaydubya818`, development environment and expiry. This is the already-qualified local runtime identity, not a claim that the Mac runs inside a production Vercel function. Acquisition and refresh use the existing SDK/CLI authentication and SDK-managed cache. No new secret store is introduced. Tokens are cached in runtime memory, refreshed with two minutes remaining, and never sent to the Codex child. The child receives only its scoped loopback gateway token through the existing isolated environment.

Missing, expired, wrongly scoped or unverifiable identity fails closed before paid admission. Refresh is deduplicated and bounded to 20 seconds per caller. Provider exceptions and bodies are not returned as diagnostic errors. The legacy Keychain implementation remains unused; no item, ACL, partition list or password was changed for OIDC. There is no Keychain fallback. If the existing Vercel login expires, human reauthentication through that existing mechanism is required.

## Startup and read-only preflight

Use an absolute `FACTORY_REAL_PROVIDER_CONFIG` pointing at the reviewed configuration in the existing private configuration directory. `FACTORY_DATA_DIR` must point at the dedicated persistent Factory directory containing existing signing/control configuration. `FACTORY_PORT` defaults to 8789 and binds loopback.

```sh
FACTORY_REAL_PROVIDER_CONFIG=/absolute/provider.json node apps/supervisor/src/private-alpha.ts --check
FACTORY_REAL_PROVIDER_CONFIG=/absolute/provider.json node apps/supervisor/src/private-alpha.ts --preflight
FACTORY_REAL_PROVIDER_CONFIG=/absolute/provider.json FACTORY_DATA_DIR=/absolute/factory node apps/supervisor/src/private-alpha.ts
```

`--check` is offline. `--preflight` resolves the canonical OIDC identity and performs authenticated GET `/v1/models?include_availability`, requiring exact-model HTTP eligibility and available account admission, then verifies the active OpenAI endpoint, tool support, limits and prices. It makes zero model operations and emits only fixed safe metadata. Catalog availability does not demonstrate an executed generation or client tool-search round trip. Startup verifies identity before listening; no queued Work is dispatched merely by listening.

## Resource and authority boundaries

The existing SpendLedger and Responses gateway still reserve before every upstream request. Refresh happens before admission, followed by fresh price/deadline/cancellation checks. Productive and read-only completion execution share the canonical Work/FactoryVersion binding. UNKNOWN retains exposure across restarts and blocks later operations. No automatic retry, model fallback, additional execution path or permission bypass is added.

Gateway's reviewed standard rates are $0.75/M input and $4.50/M output. Full context reservation remains 400,000 input plus 8,192 output tokens: $0.336864 per Factory operation. Hosted paid tools remain disabled. Client tool-search results execute locally; each subsequent model request is separately admitted and counted. The selected-Work launch profile partitions $1.35 into at most two Sofie calls ($0.30) and three Factory calls ($1.05: two productive plus one completion). Protected completion capacity is $0.336864 Factory plus $0.15 Sofie explanation. One original 600-second deadline is shared; attempts cannot reset it or the allowance. The operator must bind the exact Work/revision before approving execution.

No publication action is granted to the scoped MyEve client. Gate B/C, exclusive writer, exact dispatch, signed provenance, candidate custody, independent protected verification, cancellation and recovery remain unchanged. A slash-qualified model is retained verbatim in the signed execution configuration and therefore the FactoryVersion.

## Qualification and limitations

[OIDC qualification evidence](oidc-qualification.json) records focused tests, Factory regression, MyEve regression, connected safeguards, typechecks, governance and build. Synthetic provider tests cover identity acquisition/refresh/scope, denial, pinning, no fallback, admission, reserve, count, UNKNOWN, cancellation, restart, client search, signed provenance and token exclusion from child processes, SQLite and error output. Connected qualification uses real HTTP/SQLite/Git/PostgreSQL custody and independent Docker verification with synthetic model replies; it is not a real Golden Journey.

Live preflight qualifies authentication and current model eligibility only. Generation, real tool-search behavior, real candidate production and Result completion remain unexecuted until the explicit first-Work approval. Provider eligibility can change; rerun preflight immediately before an approved journey and fail closed on expiry or changed rates. Billing classification is non-blocking, while existing hard accounting invariants remain enforced.

Primary references: [Vercel OIDC](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc), [Responses API](https://vercel.com/docs/ai-gateway/sdks-and-apis/responses), [provider routing](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options), [authenticated model availability](https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api). Cross-system deployment and exact Work evidence live in MyEve's `docs/private-alpha/live-2026-09-30/` dossier.
