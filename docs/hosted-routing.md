# Hosted Sofie and Relay routing

Hosted apps submit signed WorkOrder requests through the existing Linear connector. MyFactory polls its exact configured team every 15 seconds and creates work through the same scoped action used by local clients. The original issue becomes the WorkOrder's Linear link. No inbound connection to the Mac is required.

## Delivery contract

- An app client is bound to a registered local repository and allowed actions. The host owns base ref, worker profile and check commands.
- A stable request key produces one deterministic Linear issue ID. Retries reconcile the same issue and reject changed content.
- HMAC binds the app, team, repository, input and expiry. Unsigned issues cannot create work. New requests expire after seven days.
- The host signs receipts with a separate Ed25519 key. Hosted apps hold only its public key, so they cannot manufacture a local receipt.
- A receipt proves local admission and reports current WorkOrder state. It does not prove coding or publication completed. Existing execution, candidate verification and human approval gates remain in force.
- If the Mac is offline, the request waits in Linear. After restart the durable idempotency record prevents duplicate work, including when receipt delivery previously failed.

## Host configuration

Private files under ignored `data/`: `connections.env`, `connections.json`, `hosted-routing.json`, `hosted-receipt-key.pem`. Keep private keys and app client tokens out of Git. Set `FACTORY_HOSTED_INTAKE=true` and the existing Linear OAuth settings. Each route maps a client ID to `repository`, `repositoryPath`, `baseRef`, and `checkCommands`.

Run `npm run start:connected`. For login startup and crash recovery on macOS, stop a manually running supervisor, then run `node scripts/install-local-service.mjs`. This installs `~/Library/LaunchAgents/com.myfactory.supervisor.plist`. Logs are in `data/supervisor*.log`. The listener remains loopback only. Sleeping or shut-down Macs do not process requests.

## Hosted configuration

Set production-only `MYFACTORY_REPOSITORY`, `MYFACTORY_LINEAR_TEAM_ID`, `MYFACTORY_LINEAR_WORKSPACE_ID`, `MYFACTORY_LINEAR_CONNECTOR`, `MYFACTORY_CLIENT_TOKEN`, and `MYFACTORY_RECEIPT_PUBLIC_KEY`. Relay additionally binds `MYFACTORY_RELAY_ACCOUNT_ID`. Connector access must be explicitly attached to the hosting project; an environment variable cannot grant it.

Sofie exposes owner-chat `create_factory_work_order` and `get_factory_work_order` tools through ActionGateway. Relay exposes an owner form at `/factory` and MCP tools `relay_factory_workorder_create` / `relay_factory_workorder_read`, governed by `factory.workorder.create` / `factory.workorder.read` grants.

Protocol source lives in `packages/hosted-routing`. The sibling applications vendor the same protocol files to allow independent deployment; update both copies and run protocol tests when changing the wire format.

## Verification

`npm test` covers signature tampering, repository/team mismatch, expired requests, host-only receipts, response-loss retries, durable restart, revocation and shared action audit attribution. Live acceptance additionally requires a hosted UI/tool invocation, its Linear issue, local WorkOrder, and verified returned receipt to agree. Do not treat local adapter tests as hosted acceptance.
