# Session surfaces — qualification checkpoint

**Overall: PARTIAL. Contract and deterministic scope checks implemented; live adapters deferred behind the cloud owner's Mac-off milestone.**

Scope: Environment Fabric owns the contract/capability model. Cloud Execution owns CLOUD + HEADLESS and any optional CLOUD + TMUX qualification. No protected cloud checkout was edited, no cloud controller was duplicated, and no surface binary/runtime dependency was added.

## Reviewed source

- cmux upstream `23d3e8835d9b74bc6859af0e8d5f7ffffe9e27bd`, source marketing version `0.64.25`. No installed cmux executable on PATH; runtime qualification NOT_RUN.
- tmux installed `3.6a`; matching manual reviewed. Version probe only; attachment qualification NOT_RUN.
- Cloud owner's `faf93359a4c54daaf3e0b713a601366db02ba8d6` source/evidence read. Historical image-distribution blocker is superseded. Hosted canonical Work/harness/independent verifier/Mac-off/P0 remain unqualified in that report.
- Canonical SHAs and exact upstream references: [architecture](../architecture/session-surfaces.md).

## Deterministic evidence

[Contract suite](evidence/session-contracts.txt): **87 PASS, 0 FAIL**, comprising 31 session tests and 56 existing environment tests. Scope guard tests cover cross-Work/owner/business/environment, attempts, execution and Work generation drift, expiry/revocation, inactive execution and verifier denial. Parser rejects arbitrary target/command/credential fields. Routing succeeds with all six session capabilities absent and refuses surface-only software execution. Repeated scope resolution returns the same identity without mutating Current Truth; this is not operator reconnect E2E.

The [initial failing run](evidence/session-contract-first-run.txt) is retained. Its fixture reused one object for request/grant/current identity; `structuredClone` preserved those aliases, so negative mutations changed all three. The corrected fixture uses independent identity objects. No scope check was relaxed.

[Full Factory regression](evidence/session-factory-tests.txt): **274 PASS, 0 FAIL, 5 existing gated skips** (279 total). [Producer/workspace typechecks, governance and build](evidence/session-checks.txt): **PASS**, including the new exported contract in required CI typechecking. No MyEve runtime changed, so its earlier Mac regressions were not repeated for these documentation edits.

## Required report

| Item | Status / observed value |
| --- | --- |
| SessionSurfaceProvider | PARTIAL — exported narrow interface, parser and scope guard; no live implementation |
| HEADLESS | PASS contract independence; live CLOUD qualification NOT_RUN here |
| TMUX | DEFERRED |
| CMUX | DEFERRED |
| cmux upstream SHA/version reviewed | `23d3e8835d9b74bc6859af0e8d5f7ffffe9e27bd` / source `0.64.25` |
| tmux version | `3.6a`, version probe/manual only |
| OWNER_COMPUTER + CMUX | NOT_RUN |
| LOCAL_FACTORY + CMUX | NOT_RUN |
| LOCAL_FACTORY + TMUX | NOT_RUN |
| CLOUD + TMUX attach | DEFERRED — Cloud Execution owner |
| CMUX → remote CLOUD/tmux | DEFERRED — whole-server mirror requires Work isolation |
| Control Center Open in cmux | DEFERRED |
| Control Center Attach with tmux | DEFERRED |
| cmux-close / crash continuity | NOT_RUN |
| tmux-detach / operator disconnect continuity | NOT_RUN |
| operator reconnect / controller restart reconciliation | NOT_RUN |
| cross-Work attachment attempts | 2 deterministic scope attacks, 2 denied; live attempts 0 (NOT_RUN) |
| cross-owner attachment attempts | 1 deterministic scope attack, 1 denied; live attempts 0 (NOT_RUN) |
| session-surface-caused duplicate executions | 0 executions initiated by this contract-only checkpoint; live campaign NOT_OBSERVED |
| HEADLESS Golden Journey | NOT_RUN — belongs to active Cloud Execution milestone |
| cmux production dependency | 0 added/required by Fabric; full deployed journey unrun here |
| tmux production dependency | 0 added/required by Fabric; full deployed journey unrun here |
| paid model calls / publications | 0 / 0 |

NOT_RUN is used for unexecuted continuity/Golden Journey checks instead of inventing PASS or claiming a reproduced FAIL. The full cloud release gate remains closed until its owner provides the real evidence.

## Limitations and handoff

No durable attachment registry, authenticated attachment endpoint, native adapter, Control Center action, event dispatcher, browser bridge, live revocation channel or session crash campaign exists yet. The scope guard is necessary but insufficient authorization: adapters must additionally validate exact qualified capability, environment health/protocol, policy, effect-time lease/fence and current revocation. A plain TypeScript scope object is not an authenticated token.

The [architecture](../architecture/session-surfaces.md) and [runbook](../runbooks/session-surfaces.md) define the handoff and subsequent campaigns. Cloud Execution need not import, construct or await this interface to complete HEADLESS qualification. Keep its current productive lifecycle unchanged. Map existing canonical identities only when implementing optional observer attachment after the milestone.
