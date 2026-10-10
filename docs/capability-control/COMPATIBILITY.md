# MyFactory admission compatibility

Isolated source base: 030b1a51017f3159436b93817ed2d5bf6ae18288.

Cloud `PostgresDispatchStore.prepare` independently enforces canonical MyEve preferences before creating WorkOrder/run/intake records. It rechecks after its writes and stores `factory.capability_admitted` evidence in the existing event ledger. The caller must inject trusted `capabilityBindings` keyed by authenticated client ID; each scope includes owner, organization, installation, environment and agent. A CloudPrepare request cannot carry or substitute those identities. Missing bindings fail closed, including direct calls that bypass MyEve.

Exact prior preparation replay is observational and survives disable. It must still match the retained owner-scope event and input digest. New Work remains subject to the original production authority callback, source envelope, generation rules, resource custody, Work count limits and snapshot validation. Dispatch/claim, accounting, UNKNOWN exposure, cleanup and production credentials are unchanged.

The shared canonical policy schema must reside in the same PostgreSQL transaction as Factory admission for this qualification contract. The SQL under this directory is an exact qualification fixture sourced from MyEve; it is NOT an instruction to create a separate production copy of owner preferences. Vendored registry/resolver source stays pinned to MissionControl 04770b83844b036080e59c9e6ea8ebb565383534. Enforcement source provenance is recorded in source-lock.json.

Runtime constructors have NOT been provisioned with real-owner installation bindings. Therefore this branch is not promotion-ready: existing hosted preparation would deny new admission. Neither the production nor external-alpha installation has been changed or deployed. Local supervisor admission is outside this cloud compatibility checkpoint.

Relay live policy import and cross-database revocation ordering remain unqualified. Synthetic evidence in the disposable test is not a real authorization record. Pause/revoke requests block new preparation through policy controls, but this checkpoint does not acknowledge remote resource termination or clear UNKNOWN spend.

Run `node scripts/qualify-capability-enforcement.mjs`. It uses a disposable PostgreSQL instance and a restricted application role, executes real Factory preparation transactions, and performs no model, queue, sandbox, provider, publication or deployment operation.
