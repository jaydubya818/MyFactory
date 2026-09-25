# App connections and Linear

MyFactory accepts requests from approved app backends through the same actions used by its console. The host API, TypeScript client, and local command adapter are implemented. Registration authorizes an app identity; a hosted app still needs a configured transport to reach this local host.

## Linear setup and behavior

WorkOrders remain local by default. Set these variables in the supervisor environment, then restart it:

```sh
FACTORY_LINEAR_API_KEY=<personal API key>
FACTORY_LINEAR_TEAM_ID=<team UUID>
FACTORY_LINEAR_PROJECT_ID=<optional project UUID>
FACTORY_LINEAR_MODE=manual
```

### Reuse an existing Vercel Connect authorization

An API key is not required when the workspace already uses Vercel Connect. Set:

```sh
FACTORY_LINEAR_CONNECTOR=linear/existing-connector
FACTORY_VERCEL_PROJECT_ID=prj_existing_authorized_project
FACTORY_VERCEL_TEAM_ID=team_existing_vercel_team
FACTORY_LINEAR_WORKSPACE_ID=existing_linear_workspace_uuid
FACTORY_LINEAR_TEAM_ID=existing_linear_team_uuid
FACTORY_LINEAR_MODE=automatic
```

The official Vercel OIDC SDK uses the existing local CLI login to refresh the authorized project's development identity. Connect exchanges it for a Linear OAuth token scoped to `read` and `write`. Tokens stay in host memory and the SDK's existing credential cache; they are never returned by factory actions. Keep the Vercel login valid and the project's connector access enabled. The app subject must already be installed and authorized for that project. No new connector, delegate, or trigger is created.

**Verify Linear access** and the agent action `verify-factory-linear` check the exact configured workspace/team without creating issues. OAuth sync repeats the destination check before creation. Issue tracking does not delegate to Foreman or start another executor.

Reference: [Vercel Connect authorization and token refresh](https://vercel.com/kb/guide/vercel-connect).

### This local workspace

Recovered from the existing MyEve/Foreman and Relay tasks on September 25, 2026:

| App | Existing repository or connection |
| --- | --- |
| MyEve / Sofie | `jaydubya818/MyEveBot`, checkout `/Users/jaywest/Myeve` |
| Relay / Atlas | `jaydubya818/relay`, checkout `/Users/jaywest/Documents/ChatGPT/New project/relay-protocol-canonical` |
| Linear | `MyEveBot` workspace, `MYE` team, `linear/myeve-foreman` |
| Authorized Vercel project | Existing `myeve-foreman` project |

The local host configuration is saved in ignored `data/connections.env`. Run `npm run start:connected` to restore the connected host at port 8788. This machine is configured for automatic Linear issue creation; each WorkOrder can opt out. No Linear project is selected because the existing Foreman configuration targets the team directly.

MyEve and Relay have separate host registrations limited to their respective checkouts, with create, note, and Linear sync scopes. Their private tokens are in `data/myeve-factory-token` and `data/relay-factory-token`. Local backends with an approved command bridge can call:

```sh
node scripts/app-client.mjs --id myeve --command list
node scripts/app-client.mjs --id relay --command list
node scripts/app-client.mjs --id myeve --command create --input /path/to/work-order.json
```

Run from the MyFactory checkout, or pass an absolute script path and `--data-dir`. The create input follows `CreateWorkOrderInput` and requires a stable `idempotencyKey`. The host enforces repository and action scopes. This command adapter does not install tools into hosted Sofie or Relay, and registration does not imply those hosted runtimes can reach localhost.

Keep the key in a local secret store or ignored environment file. The supervisor reads process environment and does not automatically load `.env`. Node 24 can load an explicit file with `node --env-file=/path/to/private.env apps/supervisor/src/server.ts`.

- **Manual:** choose **Create a Linear issue** on the creation form, or **Create Linear issue** on an existing WorkOrder.
- **Automatic:** new WorkOrders create issues by default. The form and action input can opt out with `syncToLinear: false`.
- App builder scaffolds require explicit sync after creation.
- Connected apps require the `linear.sync` action scope, including for automatic creation.

Linear receives the title, description, acceptance criteria, type, and WorkOrder ID. The adapter does not add repository paths, commands, logs, or diffs. Private material entered in the shared text fields will be sent as part of those fields.

This version creates and links an issue; it does not mirror later edits or workflow status in either direction. Execution, evidence, and publication decisions remain in MyFactory. “Configured” means host settings are present. Successful sync is shown only after a confirmed provider response or reconciliation.

The host persists an issue UUID and destination before making a request. Retries check that UUID, including archived issues, then reuse it if creation is needed. Lost responses and interrupted syncs show an unknown outcome with an explicit retry action. Changes to the configured destination cannot silently move an existing sync. Restarts preserve pending work; retries are explicit in this version.

Primary references: [Linear GraphQL guide](https://linear.app/developers/graphql) and [official schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql), including `IssueCreateInput.id`, `issues`, and `IDComparator`.

## Register an app backend

Use the actual approved repository and a new token file:

```sh
node scripts/register-client.mjs \
  --data-dir /path/to/factory-data \
  --id myeve --name MyEve \
  --repo /path/to/approved-repository \
  --token-file /path/to/private/myeve-factory-token
```

Defaults are `workorder.create` and `workorder.note.add`. Repeated `--action` flags specify the complete desired list; add `linear.sync` or `publication.request` only when authorized. Register Relay separately. Tokens are written with owner-only permissions and never printed. The host stores only token digests. The Connections page displays scopes without secrets.

Revoke immediately without restarting:

```sh
node scripts/register-client.mjs --data-dir /path/to/factory-data --id myeve --revoke
```

Clients read WorkOrders and evidence records only in their exact configured repositories. Identity comes from the token, never the request body. Client tokens cannot start execution, approve or publish drafts, merge, or deploy. Trusted local processes with direct filesystem/host access are outside this connection credential boundary.

The service stays on loopback. A cloud app requires a separately configured authenticated transport to this host; do not expose the local console port publicly.

## Backend client

`packages/client/src/index.ts` is a dependency-free TypeScript client. Node 24 imports it directly; an app build can compile it with its shared contract types. Keep the token in the app backend.

```ts
import { readFileSync } from "node:fs";
import { FactoryClient } from "./path/to/MyFactory/packages/client/src/index.ts";

const factory = new FactoryClient({
  origin: "http://127.0.0.1:8788",
  token: readFileSync(process.env.MY_FACTORY_TOKEN_FILE!, "utf8").trim(),
});
const work = await factory.createWorkOrder({
  idempotencyKey: "feedback:stable-source-event-id",
  title: "Preserve report date filters",
  description: "Export should use the selected date range.",
  kind: "feature",
  repositoryPath: "/path/to/approved-repository",
  baseRef: "main",
  acceptanceCriteria: ["Export includes only rows in the selected range"],
  reproductionCommand: null, expectedFailureText: null,
  checkCommands: ["npm test"],
  allowedPaths: ["src/reports/", "test/reports/"],
  workerProfile: "mac", syncToLinear: false,
});
const detail = await factory.getWorkOrder(work.id);
await factory.addNote(work.id, "Additional context from the originating app.");
```

Creation requires a stable key scoped to the authenticated actor. Equivalent retries return the same WorkOrder across restarts; changed input with the same key returns HTTP 409. Notes are separate audit entries and are not automatically retried. Creating work and starting execution remain separate actions.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/connect/v1/actions` | Discover permitted action contracts |
| GET | `/api/connect/v1/work-orders` | List accessible work |
| GET | `/api/connect/v1/work-orders/:id` | Read work, evidence records, decisions, and Linear link |
| POST | `/api/connect/v1/actions` | Execute `{ action, input }` |

All routes require `Authorization: Bearer <connection-token>`. Browser-origin requests to this backend API are rejected.

## Verification

Tests cover concurrent duplicate intake, conflicting payloads, restart persistence, repository/action scope, revocation, automatic/manual Linear creation, provider errors, lost responses, and approval boundaries.

To repeat the UI test, build the web app and run `node scripts/connection-ui-fixture.mjs`. Its isolated host at `http://127.0.0.1:8791` prints a disposable repository path. Create a feature WorkOrder with **Create a Linear issue** checked. The simulated provider loses its creation response. **Retry Linear sync** must then show **Open TEST-1**, while `provider-evidence.json` records `creations: 1`. This fixture never connects to Linear or executes coding attempts.
