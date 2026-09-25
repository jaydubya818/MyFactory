# Factory Console

This is the standalone Agent-Native workspace for the local software factory. It reads durable WorkOrders, runs, checks, events, and publication records from the loopback supervisor. The agent and UI call the same supervisor actions; the console does not keep a second copy of factory state.

## Local development

Start the supervisor from the repository root, then run this app:

```sh
cd factory-console
corepack pnpm install --frozen-lockfile
FACTORY_SUPERVISOR_URL=http://127.0.0.1:8787 corepack pnpm dev
```

Open the local URL shown by the development server. The root page opens `/factory`. Select a WorkOrder to inspect activity, candidate changes, verification, and decisions. The agent receives the current view, WorkOrder, tab, and selected evidence through `view-screen`. Its write tools can create a WorkOrder, pause dispatch, add a note, or request publication. They cannot resume dispatch, approve publication, or publish a draft PR.

The bundled provider chat requires a configured model provider before natural-language prompts can run. Local action and screen-reading tools work without a model. Set production `BETTER_AUTH_SECRET` and a persistent Postgres `DATABASE_URL` before deployment; local PGlite is for development only.

## Checks

```sh
corepack pnpm exec tsc --noEmit
corepack pnpm agent-native:doctor
corepack pnpm build
```
