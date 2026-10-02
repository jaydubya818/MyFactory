# T3 Code review and Environment Fabric crosswalk

Reviewed 2026-10-02 UTC, upstream `pingdotgg/t3code` at `99e08526e5ec84f294940cba5929841518c52fec`. Read-only source clone; no fork, copied code, or runtime dependency. Source links below are pinned to the reviewed revision.

## Starting source and preserved work

| Repository | Fetched canonical main |
| --- | --- |
| MyEveBot | `2b22e387c053ba0631efc27c2e8f8a99fff1055e` |
| Relay | `a61f0ef697b02cf22da72ff2904c584d7faa026a` |
| MyFactory | `c0b4c1155a6a98f91375163443938042e6a0be10` |

MyFactory branch `codex/environment-fabric` starts from canonical main and fast-forwards the existing cloud checkpoint `7a69c472f05d540f490a41e33014b978f1165e82`. The existing `ExecutionProvider`, local lifecycle, dedicated staging, architecture, runbook and qualification are retained. They were not yet on main. The dirty MyEve checkout and other tasks' branches are untouched.

Attempt-8 publication is present in MyEve main. Another task has an unpushed presentation/readback repair at `d75091eb333a531fa91ed9d39e273948aa9d0eaf`; it remains owned by that task, not silently adopted here. Preserve its eventual canonical integration. Current publication/readback is not owner acceptance. Historical Proof and candidate remain immutable.

## Pattern decisions (design decisions, not qualification claims)

| T3 Code pattern | Existing MyEve/MyFactory equivalent | Decision | Reason |
| --- | --- | --- | --- |
| Environment owns workspace, processes, Git and provider credentials | LocalExecutionProvider owns host processes; Sofie Local owns explicit roots | ADAPT | Add a typed descriptor while keeping lifecycle operations behind the existing provider. An owner client must never substitute its machine for an unavailable environment. |
| Persistent environment identity independent of endpoint | Paired device ID; configured Factory identity | ADOPT | Endpoints are reachability hints, never identity or authority. Historical attempts retain their environment identity. |
| Shared environment descriptor with absent capability meaning unsupported | Existing explicit local operation scopes and Factory qualification | ADAPT | Version capabilities and require an independently trusted qualification record. An advertisement is insufficient for execution. |
| Provider adapter normalizes native commands/events | ExecutionProvider plus Codex harness and metered gateway | EXISTING_EQUIVALENT | Keep Environment, execution provider, harness, model and authorization separate. No second provider framework. |
| Commands commit events, projections and receipts before reactors perform I/O | Factory transactional intake/dispatch claim; MyEve writer and publisher effect ledger | EXISTING_EQUIVALENT / ADAPT | Preserve existing transactions. Cloud allocation will need durable intent and exact-resource reconciliation; no event-sourcing rewrite. |
| Environment-scoped connection supervisor and snapshot/cursor cache | Canonical Work/Result readback and owner projections | ADAPT | Browser reconnect must fetch durable truth; never replay mutation just because transport reconnects. Qualification is still pending. |
| Same runtime used by web, desktop and mobile | MyEve owner UI/API | ADAPT | Clients observe Work; neither a browser nor phone owns execution. No native mobile implementation is required for this mission. |
| Authenticated socket plus per-RPC scopes; pairing may narrow grants | Action Gateway, Work writer authority and Relay leases | ADOPT principle | Registration/advertisement never grants Work or publication authority. Keep owner/business and environment boundaries explicit. |
| Environment filesystem readable under broad orchestration scope | Explicit local roots, repository allowlists, protected verifier separation | REJECT | T3 projects are organizational boundaries, not filesystem sandboxes. MyFactory must not inherit this broader trust assumption. |
| Thread belongs to its environment | Work survives attempt/environment loss | REJECT for Work | MyEve owns Work, Factory owns execution attempts. Destruction cannot erase Work, custody or Result. |
| Hidden refs under refs/t3/checkpoints scoped by thread/turn | Productive visible-check checkpoints and immutable candidate custody | DEFER | Useful recovery evidence, but no qualified successor-resume path yet. Adding refs cannot establish verification or acceptance and does not unblock cloud. |
| Interactive coding harness control surface and host-installed subscriptions | Autonomous bounded Work with independent verifier | REJECT as product model | Preserve persistent Sofie relationship, spend accounting, Result/Proof and separately authorized effects. |
| Live provider/session changes | Immutable FactoryVersion/attempt pinning | REJECT unbounded switching | No implicit environment, harness or model fallback; waiting and UNKNOWN preserve authority. |

## Source reviewed

At the exact revision above: README; `docs/internals/{overview,remote,environment-auth,providers,connection-runtime}.md`; `packages/contracts/src/{environment,rpc}.ts`; `apps/server/src/provider/Services/ProviderAdapter.ts`; `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`; `apps/server/src/auth/RpcAuthorization.ts`; `apps/server/src/checkpointing/{CheckpointStore,Utils}.ts`; `packages/client-runtime/src/{connection/supervisor,state/threads}.ts`.

Implementation confirms: command receipts reject cross-aggregate reuse, event/projection/receipt persistence shares a transaction, notification follows commit; required RPC scopes are tied to the RPC union; environment capability fields support absence/older versions; reconnect retains state and cursor only after applied updates; checkpoint refs encode thread identity without modifying the user's branch. These are architectural observations, not claims that T3 meets MyFactory qualification.

[Upstream architecture](https://github.com/pingdotgg/t3code/blob/99e08526e5ec84f294940cba5929841518c52fec/docs/internals/overview.md) · [environment/auth trust boundary](https://github.com/pingdotgg/t3code/blob/99e08526e5ec84f294940cba5929841518c52fec/docs/internals/environment-auth.md) · [implementation](https://github.com/pingdotgg/t3code/blob/99e08526e5ec84f294940cba5929841518c52fec/apps/server/src/orchestration/Layers/OrchestrationEngine.ts).

## Honest qualification boundary

Current staging cannot allocate a qualified runtime: [existing image distribution blocker](../cloud-execution/phase-2/image-blocker.md). Do not repeat failed uploads, weaken TLS or select an unreviewed provider. Contracts/routing and local regressions can progress independently. Cloud allocation, custody, independent cloud verifier, Mac-off/browser-off P0 and live canary remain NOT_RUN. No zero-count end-to-end safety claim follows from unit tests.
