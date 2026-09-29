# MyFactory private-alpha producer reconstruction

## Source and status

The accepted producer V2 commit `efe9e856f8fffbdb785497444a08d39e54d8f78d` was lost and was not recovered. This is a **new implementation** from durable `8f5e3774129b5f9f4b1c9655ffbbb531cd20fa0f` on `codex/private-alpha-myfactory`, not a byte-equivalent recovery. Prior V2 reports were used only as specification and negative-test definitions. This dossier records new tests on this source.

Migration 8 extends the existing SQLite Work spend tables without changing migration 7. SHA-256 of the exact migration 8 SQL string: `0994004a2a89c2264423e969fc3b97ef609f8d0fb437e9dcf6ea6203309cbeb3`. Active MyFactory worktrees were checked before assigning version 8; no competing MyFactory migration 8 was found. Runtime source fingerprints and authority classifications are in [source-inventory.json](source-inventory.json).

## Controls rebuilt

The producer now requires an immutable complete operation plan before paid dispatch. Productive reservations cannot take the protected completion reserve. Paid operation slots count model requests across attempts and restarts. A retained UNKNOWN blocks all new paid operations for that Work. `BEGIN IMMEDIATE` serializes reservations across processes; the ledger checks exact current writer, generation, request, FactoryVersion, cancellation, deadline, pricing expiry, phase, ceiling, reserve and slots. The host rotates the child token for mandatory read-only completion, checks settled accounting before candidate custody, and reconciles both worker process groups before terminal fencing.

Authenticated connected READ returns the Work ceiling, settled/retained/UNKNOWN exposure, productive allowance, completion reserve and remaining capacity, paid operation counts, phase, pricing state and accounting completeness. The gateway permits only installed-CLI client-executed tool search; hosted/unspecified tools remain denied. Every subsequent model request remains metered.

The explicit private-alpha loader pins `https://api.openai.com/v1/responses`, `gpt-5.4-mini-2026-03-17`, and `keychain://com.myeve.myfactory.q37/openai-provider`. Its tests inject a synthetic secret. It is **not activated by default supervisor startup**. No real key was read or created.

## Fresh local qualification

- V2 ledger and process matrix: pass, including dollars/slot/UNKNOWN/cancel races and abrupt process loss.
- Connected PREPARE/START/READ/STOP and mandatory productive-to-completion flow with a fake provider: pass.
- Installed Codex CLI to local metered Responses boundary with a fake provider returning 503: pass; no real provider request.
- Client tool search and hosted-tool denial: pass.
- Private-alpha loader absent/inaccessible/malformed secret, wrong endpoint/model/reference, expired config, and intercepted synthetic Responses transport: pass.
- Negative probes: [machine output](negative-probes.json) shows post-UNKNOWN calls 0, completion starvation 0, calls beyond operation limit 0, reserve theft 0. Its `providerCalls` are local fake-provider calls; `paidProviderCalls` is 0.
- [Full regression](full-regression.log): **134 passed, 0 failed, 1 skipped** across all workspaces. The skipped installed-CLI test was [run separately](installed-cli.log): **1 passed, 0 failed**.
- [Producer typecheck](typecheck.log), [governance](governance.log), and [production build](build.log): pass.

Controlled local counters: post-UNKNOWN paid calls **0**; completion starvation **0**; calls beyond operation limit **0**; Work ceiling violations **0**; completion-reserve theft **0**; concurrent oversubscription **0**; duplicate dispatches **0**; unaccounted completed paid calls **0**; incorrect UNKNOWN releases **0**; retry budget resets **0**; cross-Work budget use **0**; post-cancel paid starts **0**; false Ready from incomplete paid accounting **0**. These are fixture-scoped outcomes, not real-provider qualification.

**Limits:** No real paid/model call, commercial price approval, production Keychain retrieval, deployment or MyEve consumer integration was run. The loader is prepared but not connected to the default service. Live MyFactory remains NOT_RUN. This branch gives no Ready, approval, publication or writer authority to MyEve.
