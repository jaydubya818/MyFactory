# Connection acceptance evidence — 2026-09-25

## Implemented and exercised

- The console and connected apps use `performAction` for WorkOrder creation, notes, publication proposals, and Linear sync.
- Authenticated app clients are restricted to configured actions and exact canonical repository paths.
- WorkOrder creation deduplicates by authenticated actor and input-bound key across restarts.
- Linear issue creation persists its UUID/destination before sending a request and reconciles that identity on retry.
- Manual and automatic Linear modes are available as host configuration. The default is manual; missing credentials leave the connection inactive.

## Browser and terminal acceptance

Used the real compiled React UI at `http://127.0.0.1:8791` with `scripts/connection-ui-fixture.mjs`. This host uses an isolated database and simulated Linear API. No real Linear issues, GitHub mutations, or coding attempts occurred in this test.

1. Filled the new WorkOrder form, chose Feature, and checked **Create a Linear issue**.
2. Submitted the form. WorkOrder `dd08bbaf-4a7b-44db-b914-3e0c18849baa` persisted. The simulated provider created its issue but lost the response. The detail screen showed **Linear sync needs attention** and **Retry Linear sync**.
3. Clicked retry. The same screen displayed **Open TEST-1**. Reloading retained the issue link.
4. Read the fixture provider evidence from the terminal: `creations: 1`.
5. Registered a disposable app client and used the actual `FactoryClient` from the terminal to read the browser-created WorkOrder and add a note. The note appeared in its Activity tab after refresh.
6. Ran the Agent-Native `get-factory-connections` action against the fixture; it returned the configured test team and registered app scope without secrets.
7. Opened the normal host at `http://127.0.0.1:8788/?view=connections`. It truthfully displayed **Not connected** for Linear and **No apps have been authorized on this host**. Visually inspected its rendered Connections page.

This completes the connection flow through issue linking and shared UI updates. It does not qualify a coding WorkOrder through GitHub publication or a live external integration.

## Automated verification

- `npm test`: 70 passed, 0 failed across supervisor, agents, app builder, storage, and verification workspaces.
- Web build and TypeScript check: passed.
- Explicit supervisor and client TypeScript check with Node types and ES2023: passed.
- Agent-Native console: TypeScript check passed, doctor reported no findings, build completed.
- The console's production build still reports missing deployment auth secret and persistent database configuration. This task did not deploy or qualify the console for production hosting.

Tests cover duplicate/conflicting intake, persistence, scope rejection, token revocation, human-only action boundaries, manual/automatic issue creation, HTTP-200 GraphQL errors, secret redaction, and restart/lost-response reconciliation. The fixture can be rerun using the setup guide.

## UI and agent capability map

| User outcome | Work desk | Factory agent / sibling app |
| --- | --- | --- |
| Inspect configured connections | Connections page | `get-factory-connections`; scoped `/api/connect/v1/actions` for clients |
| Create a WorkOrder | New WorkOrder form | `create-factory-work-order`; `FactoryClient.createWorkOrder` |
| Read work and evidence records | WorkOrder detail | `get-factory-work-order` / `view-screen`; `FactoryClient.getWorkOrder` |
| Create/reconcile Linear issue | Create checkbox / Linear detail panel | `sync-factory-linear`; `FactoryClient.syncToLinear` with scope |
| View resulting sync status | Linear panel / Activity | `linearLink` and durable events in the same WorkOrder detail |

## Remaining live setup

Select the Linear team/project and manual versus automatic behavior, configure the host API credential privately, and identify the actual MyEve/Relay backends and deployment locations. The host API is ready, but neither app is registered or wired in its own repository yet. A remote app requires an authenticated transport to the local host.
