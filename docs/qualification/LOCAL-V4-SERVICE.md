# Explicit local V4 service composition

`createLocalV4Supervisor(options)` is a separate trusted host constructor. It requires an explicit canonical absolute data directory and signing options and refuses a real provider before loading it. There is no CLI, HTTP, environment or returned-payload selector. `createSupervisor()` remains the legacy default. No installed service is changed by these exports.

The V4 service passes one `LocalV4ServiceProducer` to the existing JobManager, local execution provider and dispatch control. Capture retains the original Work and expected snapshot atomically through `captureAdmitted`. Every later snapshot/read/finalize resolves that original admission. Missing, partial, duplicate, legacy or changed records refuse; no admission is reconstructed from a returned Result or current mutable Work.

The common producer interface exposes only shared execution identity/configuration and the existing signed Result response. Existing job/dispatch/resource runtime bodies retain their spending, writer claim, capability, stop, UNKNOWN, quiescence, durable terminal fence and no-blind-retry behavior. The codecs and both producer classes are unchanged. This interface is not an execution grant.

The authenticated V4 connected APIs require current owner scope and repository permission. Ordinary Result/list/detail/event reads require exactly one original owner/client binding; a different ordinary owner or client cannot read the Work even with the same repository. Current owner binding is rechecked for prepare replay, observe, dispatch and stop. A legitimately registered same-owner `myeve-proof` client with current `evidence.read` and a finite future credential expiry may inspect signed Results and filtered details; this creates no new role or approval. Ordinary connected GETs require current `factory.observe`; Proof credentials cannot use dispatch controls even if extra action strings are configured. Removed/expired read grants refuse before data exposure. Generic V4 connected action writes refuse so all connected execution stays on canonical dispatch controls. V4 preparation refuses any `repairWorkOrderId` field before preparation effects; a current repair owner/client and cost-parent chain requires separate qualification. Legacy repair behavior is unchanged. Legacy ordinary repository-scoped behavior remains unchanged. The independent evidence endpoint remains legacy-only. The V4 composition supplies no producer to that reader, so even an otherwise exact same-owner evidence request refuses. A producer-signed V4 Result is not an independent signed Proof.

Run portable contracts with:

```sh
node --test apps/supervisor/test/local-v4-service.test.mjs apps/supervisor/test/local-v4-admission.test.mjs apps/supervisor/test/producer-results.test.mjs apps/supervisor/test/server.test.mjs apps/supervisor/test/jobs.test.mjs
npm run typecheck:producer
npm run check:producer-governance
```

These use seeded ordinary SQLite records. They do not claim actual Git capture. The existing source-only workflow explicitly selects them.

Run actual local service qualification separately on the qualified pinned Mac Git host:

```sh
node --test apps/supervisor/qualification/local-v4-service.test.mjs
```

That suite creates owned repositories, ephemeral keys and authenticated loopback servers. It exercises actual pinned input capture, original-pair restart/replay, a synthetic failed execution, an ordinary regular-text candidate and signed Result, owner/token/binding refusals, paid-disabled dispatch, stop/UNKNOWN recovery and known/UNKNOWN synthetic ledger outcomes without retry. Worker/check functions and any loopback upstream are synthetic. No model, paid provider, Docker or protected acceptance verifier executes. An optional resource probe is restricted to explicit V4 synthetic mode with nondefault worker/verifier functions; all other uses refuse before storage effects. The fixture tracks active/completed synthetic verifier resources by exact run ID and real process absence. An unobserved verifier holds UNKNOWN until observed; readiness stays false. The candidate case proves only canonical synthetic resource fences and producer signed Result, not real Docker absence, independent Proof or MyApps delivery. Default native observation and resource reconciliation bodies are unchanged. Mac qualification is not selected or skipped as if it had executed on Ubuntu.

Release requirements remain separate: compatible bounded regular-text candidate export policy, installed FactoryVersion and capability/MC enrollment, original accounting continuity and current authorized pricing, protected acceptance/custody, independent signed Proof, actual multi-agent execution, MyApps delivery/rollback and both tester qualifications. The current producer can export candidate forms the consumer deliberately refuses; source plumbing does not establish arbitrary candidate compatibility. Live V4 provider composition remains refused until separately qualified. Both tester installations, paid Work and production activation remain unchanged.
