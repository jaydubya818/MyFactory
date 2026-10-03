# Harness neutrality — qualification addendum

**PARTIAL product capability; deterministic contract support PASS. CLOUD_COMPUTER runtime DEFERRED / NOT_QUALIFIED.**

Fabric baseline: `29a0d8a6f2dd95991bbd8627a82bb3dafdde119b`. Rechecked remote canonical MyFactory `c0b4c1155a6a98f91375163443938042e6a0be10` and cloud-owner checkpoint `faf93359a4c54daaf3e0b713a601366db02ba8d6`. No cloud-owner files or implementations were replaced.

Changes: two additive capabilities (`browser`, `appInteraction`), grouping with existing `desktop`/`screenshot`, explicit canonical-field projection during requirements derivation, provider-boundary documentation and 40 deterministic tests. No new environment type, agent identity, harness implementation, surface implementation or live computer access is introduced.

The environment descriptor and provider interface remain harness-neutral. The concrete legacy local runtime remains bound to its existing qualified Codex adapter; multi-harness runtime interchangeability is not claimed. The architecture records where that distinction belongs without refactoring the cloud owner's critical path.

[Contract evidence](evidence/harness-neutral-contracts.txt): **127 PASS, 0 FAIL**, including 40 new tests. The same specialist identity can route to each environment under corresponding resource policy; role/harness metadata is excluded from canonical requirements. Each future computer capability is independently optional and requires supported advertisement, qualification and Work authority. No cloud-to-Mac fallback is allowed.

Full regression: **314 PASS, 0 FAIL, 5 existing gated skips** (319 total), recorded in [Factory tests](evidence/harness-neutral-factory-tests.txt). Producer/workspace typechecks, governance and build **PASS** in [checks](evidence/harness-neutral-checks.txt). Connected CLOUD_COMPUTER, alternative harnesses and new specialist/environment journeys remain NOT_RUN. Prior HEADLESS/Mac-off evidence is not upgraded by these tests.

See [architecture and ownership](../architecture/harness-neutral-environments.md). Cloud Execution continues the existing harness → deterministic cloud execution → independent verifier → Mac-off Golden Journey sequence. Paid model calls, cloud allocations and publication effects initiated by this extension: **0**.

## Feature addendum: independent authority and multiple instances

Seven additional deterministic tests cover advertised desktop/browser/git/shell without Work permission; a new cloud sandbox's separate authorization and exact qualification; stable selection across candidate ordering; preservation of an existing binding after new registration; and two independently qualified owner computers with exact device pinning. [Combined contract evidence](evidence/extensibility-contracts.txt): **134 PASS, 0 FAIL**. No runtime code or Relay contract changed in this addendum. The prior full regression remains the runtime baseline; hosted CI runs all tests on the pushed checkpoint.

Cloud owner source rechecked at `449f6daca02036a6a800a088cd7389437b7f3705`; its new HarnessProvider documentation preserves the same critical path. CLOUD_COMPUTER and live session adapters remain deferred, and the full Mac-off journey is not inferred from these fixtures.
