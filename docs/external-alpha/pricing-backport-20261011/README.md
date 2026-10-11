# Frozen external-alpha pricing backport — preparation only

Base: MyFactory `18e59dbedbe04275858327ca47d2bd7ec01a407c`. Composed consumer: unchanged MyEve `4cceb253d21f28b17f645bd88d90a6b764ddc073`. This isolated successor is not adopted into either held MyEve PR or installed configuration.

The frozen deterministic `cloudHarnessPrice` expired October 9 UTC; the production `productionModelPrice` used by all six blocked integrations expired October 10 UTC. Both now reuse the canonical pricing owner's exact reviewed October 10 v2 values. The imported JSON evidence is byte-identical to `ff8d464e111e40bb81ad642b4c91ce2df7f33f03` (record SHA-256 `e3cfa939291ea235bdd6920f386459177de08deb266cee63c56717eba824e0bf`). Historical JSON remains byte-identical too; its sourceCommit describes the owner's original evidence, not this backport base. The original inline records match the exact 18e base.

Only the two inline pricing revisions/deadlines change in executable source. Rates, provider/model, routing, service tier, limits, reservations, operation counts, ceilings, accounting, admission, cleanup, authority and SQL remain unchanged. Runtime does not import JSON evidence. The source identity is recomputed using the canonical inventory tool. Exactly the two corresponding governance SHA fields are updated without classification/authority changes. Three frozen verification/Result governance fingerprints are already stale at 18e; this independent blocker is preserved and reported, not silently repaired.

Reviewed route: OpenAI `gpt-5.4-mini`, Gateway `openai/gpt-5.4-mini`, Responses/default service tier, OpenAI only, no fallback/BYOK/region/hosted paid tools. Rates remain $0.75 input and $4.50 output per million tokens. Production bounds 64,000/8,192; deterministic bounds 200,000/8,192. Reserves remain 84,864/186,864 micro-USD; two productive plus one completion slot; maximum three; $1 production ceiling. October 17 00:00 UTC is the existing owner's seven-day internal revalidation deadline, not a provider guarantee or unlimited extension. Expiry still fails closed.

Primary sources independently reread October 11 UTC:
- https://developers.openai.com/api/docs/models/gpt-5.4-mini.md — exact original source hash reproduced (`83625d2f3548c29379b3b2a44b183a26d266d2f5c3ffda7161dd19c9213a9058`).
- https://vercel.com/ai-gateway/models/gpt-5.4-mini — current page still confirms the same OpenAI route/rates; dynamic page bytes differ.
- https://vercel.com/docs/ai-gateway/pricing — provider pricing with no Gateway token markup; current dynamic page bytes differ.

## Identity and adoption boundary

`identity-impact.json` records the exact new source, unchanged production configuration and old/new execution contract/FactoryVersion. External-alpha FactoryVersions are installation-specific and must be recalculated with the same private workspace configuration plus the new source digest. The production canary FactoryVersion must not be substituted for them. No installed pin, approval, Work, private repository registry or FactoryVersion was overwritten. Old approvals cannot authorize the new contract. Original UNKNOWN operations retain their original rates/identity and can settle only through original evidence; accounting reconciliation never reopens execution.

No migrations are required by this patch. Rollback of an eventually authorized installation is a separate decision: the expired predecessor cannot authorize new execution. Preserve old accounting history and cleanup, withdraw successor admission, and require current pricing qualification before resuming. No new grant is created by source preparation.

## Retained qualification and limits

Local pricing/provider/ledger/installation-identity regressions: 35 PASS. MyEve exact-source full integration: 240 PASS, 3 explicit protected-custody NOT_RUN gates. All six original pricing-affected cases PASS. Factory local-compatible cloud/routing/storage corpus: 404 PASS, 43 gated skips; separate applicable local PostgreSQL authority/isolation corpus 35 PASS; verified-TLS ledger/dispatch/verifier/exact-authority corpus 24 PASS with zero skips. Typecheck and canonical source identity PASS. Initial attempts and environment errors are retained.

The initial missing-custody case hit `VERIFIER_CLEANUP_UNPROVEN` because the local Docker tag could not be resolved. Direct probing confirmed the missing tag. The already cached official immutable Linux image successfully allocated/deleted, and the complete unmodified integration corpus passed with its digest. No hidden custody was supplied, assertions changed or protected qualification claimed.

The dedicated hosted workflow pins unchanged MyEve/Relay, runs real disposable PostgreSQL with verified TLS, the complete cloud/routing/storage corpus and all six integrations. Hosted results and independent accounting/security review are tracked separately; no prior owner's different FactoryVersion CI result transfers automatically.

Still separate: the three private protected-custody gates; original first-attempt E1 and historical E2 stability disposition; three frozen verification/Result governance discrepancies; independent final release sign-off; actual installation qualification and explicit source/configuration/FactoryVersion adoption. PR #71/#75 remain DRAFT/HOLD. No merge, deployment, production migration, credential/tester change, paid operation, executable grant or Alpha Tasks activation.
