# Environment Fabric qualification checkpoint

**Overall: PARTIAL. Not ready for a live cloud canary.**

This checkpoint extends the preserved cloud work with independently implemented T3-inspired environment contracts, pure routing and metadata adapters. Production routing is not yet connected. The genuine external blocker remains the existing staging image distribution prerequisite; no image upload was retried and no TLS policy was relaxed here.

## Evidence

- [Source manifest](source-manifest.json): canonical starting SHAs, preserved branch checkpoints, protocol/policy and unpromoted runtime fields.
- [T3 crosswalk](t3-crosswalk.md): exact upstream SHA, implementation review, adopt/adapt/reject decisions.
- [Full Factory regression](evidence/factory-tests.txt): 248 tests, **243 passed, 0 failed, 5 gated skips**. This includes 56 new environment contract/routing/metadata-adapter tests.
- [First run](evidence/first-run.txt): retained failures caused by sandbox `listen EPERM` on loopback fixtures. Rerun with authorized local HTTP access passed; no product defect was hidden.
- [Governance](evidence/governance.txt) and [types/build](evidence/checks.txt): PASS.
- [Existing staging image blocker](../cloud-execution/phase-2/image-blocker.md): last connected provider evidence. This report does not relabel it as a new provider probe.

## Capability and gate manifest

| Gate | Result | Exact limit |
| --- | --- | --- |
| T3 source review/crosswalk | PASS | Upstream `99e08526e5ec84f294940cba5929841518c52fec`; no copied code/dependency |
| Environment descriptor | PASS | Strict V1 parser and safe read projection tests |
| Capability negotiation | PARTIAL | Typed versions/mismatch tests PASS; no live advertisement consumption/UI yet |
| Environment registry | NOT_RUN | Durable owner-scoped registration/revocation/API remains to implement |
| Environment routing | PARTIAL | 53 contract/routing tests PASS; no production admission wiring |
| No silent fallback | PASS deterministic | Cloud offline/unqualified stays Waiting even when Mac/Local Factory are online |
| OWNER_COMPUTER | PARTIAL | Three metadata adapter tests include permission/offline mapping; real companion E2E not repeated |
| LOCAL_FACTORY | PARTIAL | Existing provider/lifecycle regressions PASS; durable environment registration/binding pending |
| CLOUD | NOT_QUALIFIED | Immutable staging runtime absent; allocation/lifecycle NOT_RUN |
| Remote environment protocol | PARTIAL | V1 compatibility model exists; authenticated remote command transport pending |
| Browser reconnect / multi-client Current Truth | NOT_RUN | No browser-based environment journey executed |
| Durable intent/effect | EXISTING_EQUIVALENT, PARTIAL cloud | Local claim/restart/publication regressions pass; cloud allocation reconciliation pending |
| UNKNOWN reconciliation | PASS existing deterministic | No new cloud UNKNOWN qualification |
| Hidden Git checkpoints | DEFERRED | Existing productive checks/custody retained; no successor-resume claim |
| Existing harness | PASS deterministic | Start-receipt output race repaired; live model and installed-CLI gated checks not forced |
| DeepAgent | NOT_QUALIFIED | Optional later harness qualification |
| Relay integration / federation | NOT_RUN | No Relay contract changes; existing Alpha history preserved; no Muse/GrokBots claims |
| Candidate custody / independent verifier | PASS existing deterministic, NOT_RUN cloud | No cloud upload/verdict/laptop-independence claim |
| Result / Proof / owner publication | PARTIAL | Existing implementations unchanged; environment provenance not wired; live owner effect NOT_RUN |
| Mac-off deterministic E2E / live E2E | NOT_RUN | No producer, cloud verifier or full Sofie journey executed |
| P0-A through P0-G Playwright | NOT_RUN | Natural prompt, routing, waiting, reconnect, decision and subsequent Work need integration |
| Desktop / 390px / keyboard / accessibility / visual snapshots | NOT_RUN | No owner UI changed |
| Cloud restart / cancellation / disconnect / ephemeral cleanup | NOT_RUN | Existing local regression is not cloud proof |
| Protocol mismatch | PASS deterministic | Incompatible protocol/capability never selects an environment |
| Spoofed capability / version / owner / scope | PASS deterministic | Independent qualification and Work authority are required |
| CI | PARTIAL | Workflow added; hosted run and required-check enforcement tracked at remote checkpoint |

## Safety accounting

Paid model operations initiated here: **0**. Production publication effects initiated here: **0**. Existing candidates and historical Proof were not changed.

Release-wide counts for unauthorized environment executions, duplicate authoritative cloud executions, cross-environment disclosures, cross-owner disclosures, stale environment mutations, unauthorized publications, protected holdout leaks, secret disclosures, false Ready, orphaned environments/processes and unrevoked grants are **NOT_OBSERVED**. The corresponding full end-to-end campaigns have not run. A passing routing denial test is not a fabricated release-wide zero.

## Resume boundary

An operator must restore authenticated VCR image upload or provide a compatible private Node 24 + Git linux/amd64 runtime by immutable digest in the approved staging project. Exact target and constraints are in the blocker evidence. This is an external configuration prerequisite, not a request to select a new architecture or run a paid canary.

After that prerequisite: complete owner-scoped registry and production admission/Work binding; connect existing Owner Computer and Local Factory adapters without changing their authority; add environment Current Truth/UI; implement durable allocation and remote execution in the existing dedicated staging stack; move candidate custody and independent verification; run deterministic Mac-off/browser-off, P0, fault/security and cleanup qualification. Only then prepare the separate bounded paid-cloud authorization envelope. Publication defaults disabled.

MyEve canonical Mac deterministic regressions: **46 PASS, 8 gated SQL skips**; [retained MyEve evidence](https://github.com/jaydubya818/MyEveBot/blob/codex/environment-fabric/docs/environment-fabric/mac-regressions.txt). Real companion E2E remains NOT_RUN.

[Hosted CI repair evidence](ci-repair.md): first fresh runner exposed the missing local verifier image and a reproduced fast-child output race; the harness correction preserves receipt-before-event authority. No paid operation or cloud allocation was used.
