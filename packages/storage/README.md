# Factory storage

`@factory/storage` persists the shared contract objects in a local SQLite file using Node 24's built-in `node:sqlite`. Open one `FactoryStorage` for the supervisor and call `close()` on shutdown.

```ts
import { openStorage } from "@factory/storage";

const storage = openStorage("/path/to/local-data/factory.sqlite");
const workOrder = storage.createWorkOrder(input);
const run = storage.createRun({
  workOrderId: workOrder.id,
  workerProfile: workOrder.workerProfile,
  inputCommit: "abc123",
  workspacePath: "/path/to/task-workspace",
});
storage.appendEvent({ workOrderId: workOrder.id, runId: run.id, type: "run.started", payload: {} });
storage.close();
```

The constructor creates the database directory, enables WAL and foreign keys, sets a 5 second busy timeout, and applies versioned migrations. It rejects database files with a newer schema version. Keep the file on local disk; SQLite WAL requires readers and writers on the same host. Use `transaction(() => { ... })` when a state change and its audit event must commit together.

Available methods are `createWorkOrder`, `getWorkOrder`, `listWorkOrders`, `saveWorkOrder`; `createRun`, `getRun`, `listRuns`, `saveRun`; `appendEvent`, `listEvents(workOrderId, afterId?)`; `insertCheck`, `listChecks(runId)`; and `createExternalAction`, `getExternalAction`, `listExternalActions`, `saveExternalAction`. Missing records return `null`; saving a missing record throws. Creation methods generate IDs and timestamps. Run attempt numbers are allocated inside a write transaction. External actions begin in `prepared` state.

Run `npm test --workspace @factory/storage` from the repository root. The tests use temporary database files and exercise restart persistence, event cursors, foreign keys, and a competing writer lock.

References: [Node 24.18.1 SQLite API](https://nodejs.org/download/release/v24.18.1/docs/api/sqlite.html), [SQLite WAL](https://www.sqlite.org/wal.html), [SQLite transactions](https://www.sqlite.org/lang_transaction.html).
