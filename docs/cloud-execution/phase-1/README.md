# Cloud execution checkpoint: inventory and local provider seam

**Overall NOT_READY. Phase status PARTIAL. Local regression PASS; cloud NOT_RUN.**

Canonical main pins and target decisions are in the [architecture record](../../architecture/cloud-execution.md). The [machine-readable report](qualification.json) records the exact changed runtime/test hashes. The full supplied attachment archive and its gaps are preserved in [mission sources](../mission-sources.json) and [mission text](../mission-attachments.md).

## What changed

Factory dispatch now depends on an `ExecutionProvider` contract. The server wires `LocalExecutionProvider` around the existing JobManager. Host process-group/supervisor/Docker reconciliation moved into that local provider, scoped to the exact stored attempt. Admission, atomic dispatch, spending, protected completion, custody signatures and terminal fencing retain their existing owners.

Collection requires resource quiescence. Health fails closed on missing executor/verification prerequisites and returns a bounded error. Local teardown explicitly retains the candidate workspace required by existing publication and never reports it destroyed. No cloud route, provider credentials, database migration or live operation was enabled.

The change touches dispatch/server wiring, two provider files, two test files, governance fingerprints and documentation/evidence. The existing productive loop, model adapter, operation ledger, Git candidate construction and verifier implementation are unchanged. This small refactor is separate from the subsequent cloud feature.

## Verification

| Tier | Command/scope | Result |
| --- | --- | --- |
| DETERMINISTIC baseline | Canonical Factory `npm test` | 170 pass, 0 fail, 5 gated skips |
| DETERMINISTIC final | `npm test`, including 9 new provider cases | 179 pass, 0 fail, 5 gated skips |
| CONNECTED LOCAL | Installed CLI, cached offline Docker, synthetic Responses | 5 pass, 0 fail, 0 skips |
| Static/build | Producer types, producer governance, workspace types, build | PASS |
| CONNECTED CLOUD | Allocation, image, worker, custody, protected verifier | NOT_RUN |
| LIVE | Real OIDC/model/cloud Golden Journey | NOT_RUN |

The five ordinary-suite skips were separately executed in the CONNECTED LOCAL tier. This does not relabel the ordinary run or establish cloud success. An initial sandbox-restricted baseline could not open loopback test servers (`EPERM`); the retained baseline was rerun with loopback permission before the refactor.

Logs: [baseline](baseline-tests.log), [deterministic](deterministic-tests.log), [connected local](connected-local-tests.log), [types/governance/build](checks.log). No real model calls, production deployments or candidate publications were performed. Cloud security/local-dependency counters are unmeasured, not zero.

## Remaining work and staging decision

The contract still carries legacy local `Run` paths and trusted host gateway callbacks. It is not the final remote wire protocol. PostgreSQL Factory state/ledger, cloud command identity, provider adapter, immutable worker image, cloud custody, independent verifier, MyEve HTTPS integration, Mac-off/browser-off P0 and live canary remain unimplemented/unqualified.

A concrete [staging proposal](../staging-proposal.json) recommends a dedicated MyFactory Vercel project and separate staging PostgreSQL/private Blob scope. The alternative is explicitly isolated preview resources in the existing Sofie project. Resolve that scope before provisioning or migrating authority-bearing storage. No existing production owner database or unrelated project is assumed to be staging. Then continue the deterministic milestone from the architecture record.
