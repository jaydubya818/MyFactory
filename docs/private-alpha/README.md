# Private-alpha real-provider activation

Status: prepared release candidate; real provider NOT_RUN. Default `npm start` remains disabled for paid execution. No fixture run qualifies a live Result.

Use `apps/supervisor/src/private-alpha.ts` only after the exact source/configuration is qualified and Jay approves the first real operation. `FACTORY_REAL_PROVIDER_CONFIG` must name an absolute path to `provider.json`. `FACTORY_DATA_DIR` must name a dedicated persistent private directory; the default existing Factory database is not reused. The optional `FACTORY_PORT` defaults to 8789 and binds loopback only.

```sh
FACTORY_REAL_PROVIDER_CONFIG=/absolute/provider.json node apps/supervisor/src/private-alpha.ts --check
```

Check mode validates non-secret configuration and does not read Keychain, start a supervisor, or contact a provider. Actual startup requires provisioned result signing and the canonical Keychain reference. Do not copy the provider value into the JSON, shell command, source, chat or evidence.

Provider: OpenAI Responses, `gpt-5.4-mini-2026-03-17`, exact `https://api.openai.com/v1/responses`. Secret: `keychain://com.myeve.myfactory.q37/openai-provider`. The 2026-09-29 metadata check found no matching Keychain item; credential value was not read. Jay can provision this in macOS Keychain Access: create a Password Item named `com.myeve.myfactory.q37`, account `openai-provider`, and enter the OpenAI project key in its password field. This is credential provisioning, not model-operation approval.

The price card was checked against https://developers.openai.com/api/docs/models/gpt-5.4-mini on 2026-09-29: standard input $0.75/M and output $4.50/M, no cached-input discount. The application caps output at 8,192 and reserves the full 400,000-token input bound. Each operation reserves $0.336864. One Work permits at most $1.35, 600 seconds, three productive operations and one separate read-only completion, protected by a $0.336864 reserve. The card expires at the time in provider.json; refresh before admission if expired, never change an admitted Work's card. Four calls reserve $1.347456. Hosted tools are rejected by the existing gateway.

Startup excludes fixture workers/verifiers and authority overrides. The exact model is passed into JobManager so an ambient model default cannot select another model. Existing V2 UNKNOWN retention, cancellation, operation slots, writer fencing, candidate custody and protected completion are unchanged. Enabling the supervisor does not grant consumer admission, owner publication approval or Result Ready authority.

Qualification: 138 tests PASS, one opt-in installed-CLI test SKIPPED; producer typecheck/governance and build PASS. Tests include synthetic gateway settlement, default disabled execution, rejection of mixed fixture/live activation, missing signing, inline secret fields, oversized Work limits and preserved dispatch/recovery controls. These are local checks only. No real credential, model, candidate or external effect was used.

Remaining before launch: secure signing/client provisioning, real credential and model-access preflight, deployed MyEve worker composition, canonical database backup/migrations, remote source verification, and explicit first-model approval. The MyEve live dossier is the cross-system authority. Do not expose the loopback supervisor publicly or label existing Linear intake as the signed V2 execution path.
