# Deterministic CLOUD Golden Journey — qualified and frozen

**DETERMINISTIC CLOUD GOLDEN JOURNEY: PASS.** Evidence class CONNECTED, model boundary DETERMINISTIC. [GitHub-hosted P0 run 37103458380](https://github.com/jaydubya818/MyEveBot/actions/runs/37103458380) passed one test, zero retries/skips/flaky tests, 237.704 seconds. This is the single authorized hosted P0 execution. Prior YAML launch validation failures had zero jobs and are preserved; the prior local P0 timeout remains FAIL.

| Gate | Result |
| --- | --- |
| OIDC exact Sofie PREVIEW → Factory PREVIEW | PASS |
| Natural Sofie browser request | PASS, fixed deterministic corpus |
| Canonical Work and EnvironmentRouter → CLOUD | PASS |
| Existing harness productive/checkpoint/completion | PASS |
| Private candidate custody | PASS |
| Separate independent verifier | PASS, 10 checks |
| Durable Result/Proof | PASS |
| Producer/verifier teardown | PASS |
| Browser disconnect and fresh-session recovery | PASS |
| Mac-off / no local execution dependencies | PASS |
| GitHub-hosted P0 Playwright | PASS |

Work `f42d8a79-7c2e-43e3-bd61-2ae1f2cf2cab`, generation 2; request `c7f224e0-f233-4da1-942f-b9c6bec42aea`; Factory run `eb8610d4-e06a-4f6d-a1d3-c6774e541953`; Result `e0ac3615-50c7-43e8-964f-5efe562911fd`; candidate `58be5d8b714441f12048d7c98db8be86846a7913`.

The GitHub browser closed at 06:35:17.736 UTC, before Factory preparation at 06:35:20.533. Producer was destroyed at 06:35:44.389; the distinct verifier started at 06:35:44.434 and was destroyed at 06:35:49.977. Sofie retained its Result at 06:36:00.327. A fresh authenticated browser recovered it at 06:38:48.803. No local controller, browser automation, Factory, verifier, Sofie Local or owner-computer service participated. Mac-off PASS means zero dependency on those local services, as authorized; physical Mac power state was not observed.

Producer `sbx_t1ycbO8rQp6EcxVouFgjK7BLOqaf` and verifier `sbx_MErRWMnXZwCm5oSClamAOS3lfs2b` are distinct resources. Private custody retained 5317 bytes, SHA-256 `b11bbcc1f510aa0a5408fe3db0a414b8dc86b60c56038fe103878b13557e0adc`, candidate tree `54b52827d3c96b97be575e603cca465380962d13`. The signed receipt traversed RECEIVED → AUTHENTICATED → ATTESTED → INTEGRITY_VERIFIED → ADMITTED. Proof remains PARTIAL deliberately: publication, CI, review and owner acceptance are not established. Passing the deterministic journey does not turn that candidate into an owner-approved publication.

| Count for this journey | Observed |
| --- | ---: |
| Canonical Works / Factory dispatches / candidate attempts | 1 / 1 / 1 |
| Peak legitimate writers / concurrent-writer violations | 1 / 0 |
| Active writers after completion | 0 |
| Duplicate executions / recorded UNKNOWN events | 0 / 0 |
| Stale mutations / false Ready states | 0 / 0 |
| Unauthorized publication effects / credential disclosures | 0 / 0 |
| Local dependencies / paid model calls / production effects | 0 / 0 / 0 |

Counts reconcile the browser report with retained staging database events, scoped receipt history, writer generation, spend ledger and publication records. They cover this positive journey, not an injected race/outage or unrelated account activity. Two synthetic Factory model operations used the normal accounting boundary; the ledger's legacy paidOperationsUsed slot counter is 2, while external paid calls, tokens and settled cost are 0. No operations were reset.

Workflow logs and downloaded evidence passed credential scanning (352 resources, including ZIP contents). Producer startup rejects credential-bearing environment keys; verifier launch uses an empty sandbox environment and a fixed child allowlist. Neither receives Factory OIDC or control-plane credentials. Browser traces contain no protection credential; login occurs before tracing and cookies/auth headers are redacted. Signed Result/Proof contains scope, hashes and verification receipts, no workload token. The existing exact-trust removal/restoration and unauthorized-source/application-denial evidence remains valid for these unchanged runtime deployments.

The complete sanitized browser report, decoded journey, runner identity, database projection and artifact hashes are retained under `hosted-p0/`. Trace ZIPs are private GitHub artifacts with three-day retention and were downloaded to the local private evidence directory; durable textual qualification/custody evidence is committed here. Runtime custody and Result remain in the dedicated staging databases/private artifact storage. No source credential or hidden verifier input is committed.

Runtime pins: Factory implementation `d84721cbb407db16598ee28e8f0dc5db27af6f5b`; Factory deployment `dpl_7T6LLm4VfhwiJUwHE7T5dtd3vwJM`; Sofie application implementation `074894f7080912dad667c2b0c98ec3db4cd75bce`; Sofie deployment `dpl_2PY8W7Apit5pXD22kUaCy2iD14N3`; hosted test source `0502e8b14ee283ed89760139cdf63a47ed4419cc`. FactoryVersion `da7b51a56a62980ee8f96a029b1a60fc84f495fd7897438fbb74ede3a0e161fe` pins CLOUD, Vercel Sandbox 3.5.1/iad1, myfactory-codex 0.157.0, model identity openai/gpt-5.4-mini with deterministic responses, tools, no skills, independent verification policy and HEADLESS.

Cloud feature development is frozen at this milestone. Production cloud admission and publication remain DISABLED. Real-model canary is NOT_RUN and requires separate authorization. DeepAgent, additional harnesses, CLOUD_COMPUTER and TMUX/CMUX remain deferred. Preserve Attempts 1–8 and incident checkpoint `0df0c37`; no history is rewritten.

GitHub credential lifecycle: **PASS**. After evidence checkpoints MyEve `03a607bc` and Factory `d558ab7` were pushed and remotely verified, both Environment secrets were deleted. Names-only readback at 2026-10-03T06:49:15.672Z returned **zero secrets**; see `hosted-p0/github-secret-revocation.json`. Staging-side credentials retain their existing lifecycle. No second hosted P0 or post-removal execution was attempted.
