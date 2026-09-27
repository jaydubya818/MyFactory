# Hosted Sofie and Relay routing

Hosted apps submit signed WorkOrder requests through the existing Linear connector. MyFactory polls its exact configured team every 15 seconds and creates work through the same scoped action used by local clients. The original issue becomes the WorkOrder's Linear link. No inbound connection to the Mac is required.

## Delivery contract

- An app client is bound to a registered local repository and allowed actions. The host owns base ref, worker profile and check commands.
- A stable request key produces one deterministic Linear issue ID. Retries reconcile the same issue and reject changed content.
- HMAC binds the app, team, repository, input and expiry. Unsigned issues cannot create work. New requests expire after seven days.
- The host signs receipts with a separate Ed25519 key. Hosted apps hold only its public key, so they cannot manufacture a local receipt.
- A receipt proves local admission and reports current WorkOrder state. It does not prove coding or publication completed. Existing execution, candidate verification and human approval gates remain in force.
- If the Mac is offline, the request waits in Linear. After restart the durable idempotency record prevents duplicate work, including when receipt delivery previously failed.

### Q37 bounded candidate return (offline prototype)

An optional `factoryBinding` inside the signed request pins owner/Agent/Work/version/generation, submission digest, expected Factory ID and expected FactoryVersion. The local host stores that binding with the WorkOrder. Before a hosted run performs work, it records its clean source commit/tree and a digest of the effective model, agent/skill version, worker/verifier configuration, checks, scope and input commit. A mismatch with the authenticated pin stops the run.

For one completed bound Run, the host freezes the exact candidate commit object, patch, check records and logs into a size-limited manifest. It verifies the patch reconstructs the candidate tree, hashes artifact bytes, persists the result, and adds a separate Ed25519-signed `MYFACTORY_RESULT_V1` block to the original Linear issue. A hosted caller rereads the same issue/request ID to reconcile a lost response. The loopback connected result route also requires the originating client ID and exact WorkOrder/Run IDs; it is not a cloud callback. Existing requests without `factoryBinding` retain admission/status behavior.

The signed result remains bounded to 36 KB JSON / 48 KB encoded and a 60 KB issue description. Artifact bytes move through authenticated Linear comment chunks, up to 128 KB each and 256 KB per result, with 24-hour signed reference expiry. The manifest binds exact WorkOrder, Run, attempt, artifact ID, size and SHA-256. The hosted consumer retrieves through its configured Linear connector and rejects missing, expired, substituted or cross-Work chunks. No public reusable artifact URL is issued.

A versioned Ed25519 keyring signs new results with only the active key. Rotation preserves historical verification; revocation blocks new admission while retained receipts preserve key identity, signature validity and revocation status. A frozen result is not re-signed during rotation. MyEve 0054 stores durable Work-scoped receipt/admission stages, exact replay, conflict observations and stale history; it never imports into native DIRECT writer custody. This branch passes one complete offline JobManager-to-MyEve fixture, but Gate C is **PARTIAL**: the separately qualified `q37-producer-attestation` branch uses a different signed envelope and artifact transport. These results cannot be claimed as that producer’s admission. Gate B and live MyFactory execution remain **NOT_RUN**.

## Host configuration

Private files under ignored `data/`: `connections.env`, `connections.json`, `hosted-routing.json`, `hosted-signing-keyring.json` (or one-time legacy `hosted-receipt-key.pem`). Keep private keys and app client tokens out of Git. Set `FACTORY_HOSTED_INTAKE=true` and the existing Linear OAuth settings. Each route maps a client ID to `repository`, `repositoryPath`, `baseRef`, and `checkCommands`.

Run `npm run start:connected`. For login startup and crash recovery on macOS, stop a manually running supervisor, then run `node scripts/install-local-service.mjs`. This installs `~/Library/LaunchAgents/com.myfactory.supervisor.plist`. Logs are in `data/supervisor*.log`. The listener remains loopback only. Sleeping or shut-down Macs do not process requests.

## Hosted configuration

Export the public-only trust bundle from the host keyring and set `MYFACTORY_SIGNING_TRUST_BUNDLE` on MyEve for key-ID rotation/revocation status. Keep the legacy public PEM only for compatibility with earlier receipts. Set production-only `MYFACTORY_REPOSITORY`, `MYFACTORY_LINEAR_TEAM_ID`, `MYFACTORY_LINEAR_WORKSPACE_ID`, `MYFACTORY_LINEAR_CONNECTOR`, `MYFACTORY_CLIENT_TOKEN`, and `MYFACTORY_RECEIPT_PUBLIC_KEY`. Relay additionally binds `MYFACTORY_RELAY_ACCOUNT_ID`. Connector access must be explicitly attached to the hosting project; an environment variable cannot grant it.

Sofie exposes owner-chat `create_factory_work_order` and `get_factory_work_order` tools through ActionGateway. Relay exposes an owner form at `/factory` and MCP tools `relay_factory_workorder_create` / `relay_factory_workorder_read`, governed by `factory.workorder.create` / `factory.workorder.read` grants.

Protocol source lives in `packages/hosted-routing`. The sibling applications vendor the same protocol files to allow independent deployment; update both copies and run protocol tests when changing the wire format.

## Verification

`npm test` covers signature tampering, repository/team mismatch, expired requests, host-only receipts, response-loss retries, durable restart, revocation and shared action audit attribution. Live acceptance additionally requires a hosted UI/tool invocation, its Linear issue, local WorkOrder, and verified returned receipt to agree. Do not treat local adapter tests as hosted acceptance.
