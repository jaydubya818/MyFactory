# Feedback Hub starter

A local feedback inbox with a detail view, triage decisions, internal notes, and a contextual agent brief. The browser and agent CLI use the same typed actions and SQLite records. The starter opens with an empty inbox; no feedback or agent activity is simulated.

`template.json` is the sole template version source. `app.json` contains the display `name` and `description`; a builder can replace those JSON fields safely. Generated apps may add `product-brief.json` for agent context.

## Run

Requires Node 24.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. The server binds to loopback. The SQLite file lives at `.data/feedback-hub.sqlite` unless `FEEDBACK_HUB_DB` names another path. `FEEDBACK_HUB_PORT` changes the port.

For a production build and local serving:

```sh
npm run build
npm start
```

## Use from an agent

From this directory, run:

```sh
npm run agent -- list_feedback '{}'
npm run agent -- create_feedback '{"title":"Checkout concern","description":"A buyer said the fee was unclear before payment.","source":"interview","customer":""}'
```

Use `get_feedback` to read a record and its `version`, `update_feedback` to change details/status/priority, `add_note` to preserve the reason, and `get_agent_context` to retrieve the same contextual brief shown in the UI. See [AGENTS.md](AGENTS.md) for exact commands and agent guidance. The template does not start an agent automatically or send data to a model.

## Actions and data

The [shared action contract](src/shared/actions.ts) defines input and output types. The UI posts each action to `/api/actions`; the CLI executes the same service directly. Both paths validate inputs and write to the same SQLite database. Records include source, optional person/team, status, priority, revision number, notes, and an activity trail with actor provenance. Updates require the current revision to prevent an old editor from silently overwriting a newer decision.

Run `npm test`, `npm run typecheck`, and `npm run build` to verify the template. The tests exercise browser transport and agent CLI actions against one database, persistence after reopening, conflict handling, and the capability map.
