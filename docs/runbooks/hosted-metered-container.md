# Hosted private beta: metered Codex in the qualified container, plus the outbound-only mailbox

Status: implemented on a branch; not deployed, not activated. Activating paid execution, deploying, or resetting tester accounts each
need Jay's final approval.

## Approval (Jay, 2026-11-05)
Use the outbound-only Mac worker architecture. Extend the qualified container worker to support metered OpenAI API execution. Native,
uncontained tester execution is not permitted. Limits: $1.30 maximum per Work, 4 Works per person, a $25 monthly OpenAI project budget,
and no automatic budget increases. Both the subscription credential and the API credential stay outside the agent container. Existing
tester accounts, conversations and accounting records are preserved.

## Execution path
1. The host spend gateway (`spend-gateway.ts`) is unchanged and stays on the Mac at `127.0.0.1`. It enforces WORK_LEDGER_V2,
   reserve-before-I/O and the pinned price card. It reads the OpenAI API key from the host config's `provider.credentialFile` (0600,
   operator uid, outside the repository, outside the container state directory and outside every client repository path).
2. `MeteredContainerExecutor` (`metered-container.ts`) runs the exact gateway argv through `owner-container-worker.mjs` in metered mode.
   Codex runs only inside the qualified image as a nonroot uid. It has `--network none` and then only the internal network, a read-only
   root, dropped capabilities, the seccomp profile, `--memory 2g --memory-swap 2g`, and the existing root PID 1 deadline guardian.
3. The broker container (`container/broker.mjs`, metered mode) gets its configuration on stdin only, held in memory and never on disk.
   That configuration contains the gateway's per-operation child token and the host gateway port, reached via
   `host.docker.internal:host-gateway`. The broker forwards only `POST /v1/responses` with the pinned model, and refuses `store: true`,
   `background`, `previous_response_id`, `conversation`, and every tool except `function`, `custom`, `local_shell` and client-side
   `tool_search`.
4. The Codex container receives only a fresh per-operation broker token (`FACTORY_GATEWAY_TOKEN` inside the container). It never receives
   the gateway child token or the API key. Nothing from `~/.codex` is mounted in metered mode.

## Refusals
- `requireContainer` defaults to true. Native metered execution is refused at host-config parse and again at supervisor composition. The
  only exception is an explicit `requireContainer: false` with a loopback fixture provider (`http://127.0.0.1:<port>`), which exists for
  synthetic qualification. The real origin `https://api.openai.com` always requires the container.
- The owner subscription route remains owner-only. Metered container options together with the subscription route refuse.

## Limits (`hosted-limits.ts`, durable `hosted-limits.sqlite` beside `factory.sqlite`)
- Per Work: 1,300,000 µUSD (`maxSpendUsd` × 10^6). Prepare refuses above it before any Work order or budget exists.
- Per person: 4 Works per (client id, owner scope). A replay of an admitted Work is not counted twice. A slot is never given back
  automatically, even if preparation later fails.
- Per calendar month (UTC): admission refuses when recorded metered exposure (settled actuals plus reserved, dispatched and UNKNOWN
  reservations this month) plus the new Work's ceiling would exceed 25,000,000 µUSD. Every gateway reservation is also checked
  synchronously before the ledger write. Subscription operation units never count.
- Host config `hostedLimits` may lower these values and can never raise them. Absent means the approved values.
- **The $25/month cap on the OpenAI project itself is set by Jay in the OpenAI dashboard. It is not in code.** The host guard above is an
  independent, earlier refusal. It does not replace the provider-side cap.
- Existing accounts, conversations and the spend ledger are not modified. The guard only reads `work_spend_operations`.

## Credential protection fixes (review 5d47955, P3s)
- `broker.json` no longer exists. Broker credentials go over stdin, for both the owner and metered modes. Any legacy `<op>/broker.json`
  is removed at every container entry and at startup recovery.
- The per-Work worker home is reset before and after every operation. Only `.codex/sessions` survives, and only for `exec resume`.
  `config.toml`, rules, hooks and dotfiles written by an operation are never loaded by the next one.
- Bind sources containing a comma are refused. Swap is bounded (`--memory-swap 2g`).

## Outbound-only mailbox (`scripts/mailbox-poller.mjs`)
This implements contract v1. Every envelope must carry `target` (`factory` or `verifier`), a `leaseId` and a base64 body. Each target
maps to exactly one configured `127.0.0.1` origin: `factoryOrigin`, or the optional `verifierOrigin`. The verifier allowlist is exactly
the existing qdev verifier host API: POST to `/qdev/v1/{handoff,evaluate,verdict,artifact/file,artifact/commit}`. Forwarding takes at most
30 s, which fits inside MyEve's ≥ 40 s per-call mailbox timeout. Artifact bodies stay within the 1 MiB envelope limit. See
`apps/supervisor/src/mailbox-poller.ts` and the hosted contract. There is no listener on the Mac. The poller long-polls the HTTPS
mailbox with a 0600 per-installation credential and forwards byte-for-byte to the exact `http://127.0.0.1:<port>` Factory. It records
each forwarded id durably first and never retries. Proposed contract amendments are in
`Myeve/output/private-beta-20261103/hosted/MAILBOX-CONTRACT-PROPOSALS.md`.

## Before activation (not done here)
Rebuild the qualified image with the new `POLICY_SHA` (broker and worker-init changed). Run a live egress/DNS probe from the worker and a
live metered probe against a loopback stand-in. Re-pin the MyEve template and cohorts to the new `factoryVersion`. Jay sets the OpenAI
project budget. Jay's final approval is required.
