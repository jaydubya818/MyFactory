import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStorage } from "../src/index.ts";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "factory-storage-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "factory.sqlite");
}

function workOrderInput(title = "Reproduce broken calculation") {
  return {
    title,
    description: "A saved report shows an incorrect total.",
    kind: "defect",
    repositoryPath: "/tmp/example-repo",
    baseRef: "origin/main",
    acceptanceCriteria: ["Show the correct total", "Preserve source data"],
    reproductionCommand: "npm test -- total",
    expectedFailureText: "Expected total 42, received 41",
    checkCommands: ["npm test", "npm run lint"],
    allowedPaths: ["src/**", "test/**"],
    workerProfile: "container",
  };
}

function runInput(workOrderId) {
  return {
    workOrderId,
    workerProfile: "container",
    inputCommit: "abc123",
    workspacePath: "/tmp/factory-run",
  };
}

function signalInput(sourceIdentity = "owner/repo#42") {
  return {
    source: "github-issues",
    sourceIdentity,
    sourceRevision: "2026-09-24T12:00:00Z",
    sourceUrl: "https://github.com/owner/repo/issues/42",
    title: "Feedback can be submitted twice",
    summary: "A double click creates two submissions.",
    provenance: { repository: "owner/repo", issue: 42 },
    evidence: { steps: ["Open form", "Double click Submit"] },
    coverage: "complete",
    coverageDetail: null,
  };
}

function releaseInput() {
  return {
    target: "demo-store",
    sourceCommit: "a1b2c3",
    artifactIdentity: "sha256:alpha",
    stage: "beta",
    status: "candidate",
    policyRevision: 7,
    previousKnownGoodArtifactIdentity: "sha256:stable",
  };
}

test("records survive close and reopen with contract shaped JSON and status", (t) => {
  const path = fixture(t);
  const storage = openStorage(path);
  const created = storage.createWorkOrder(workOrderInput());
  const workOrder = storage.saveWorkOrder({
    ...created,
    state: "ready_for_review",
    acceptanceCriteria: [...created.acceptanceCriteria, "Pass regression test"],
    expectedFailureText: "Expected total 42, received 40",
  });
  const createdRun = storage.createRun(runInput(workOrder.id));
  const run = storage.saveRun({
    ...createdRun,
    state: "ready_for_review",
    candidateCommit: "def456",
    finishedAt: new Date().toISOString(),
  });
  const check = storage.insertCheck({
    runId: run.id,
    candidateCommit: "def456",
    command: "npm test",
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    logPath: "/tmp/check.log",
  });
  const createdAction = storage.createExternalAction({
    workOrderId: workOrder.id,
    runId: run.id,
    kind: "draft_pr",
    candidateCommit: "def456",
  });
  const action = storage.saveExternalAction({
    ...createdAction,
    state: "succeeded",
    remoteIdentity: "owner/repo#42",
  });
  storage.close();

  const reopened = openStorage(path);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getWorkOrder(workOrder.id), workOrder);
  assert.deepEqual(reopened.listWorkOrders(), [workOrder]);
  assert.deepEqual(reopened.getRun(run.id), run);
  assert.deepEqual(reopened.listRuns(workOrder.id), [run]);
  assert.deepEqual(reopened.listChecks(run.id), [check]);
  assert.deepEqual(reopened.getExternalAction(action.id), action);
  assert.deepEqual(reopened.listExternalActions(workOrder.id), [action]);

  const database = new DatabaseSync(path);
  assert.equal(database.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 4);
  database.close();
});

test("migrates an existing v1 WorkOrder and preserves the new failure oracle", (t) => {
  const path = fixture(t);
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE work_orders (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    kind TEXT NOT NULL, repository_path TEXT NOT NULL, base_ref TEXT NOT NULL,
    acceptance_criteria_json TEXT NOT NULL, reproduction_command TEXT,
    check_commands_json TEXT NOT NULL, allowed_paths_json TEXT NOT NULL,
    worker_profile TEXT NOT NULL, state TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE checks (id TEXT PRIMARY KEY) STRICT;
  PRAGMA user_version = 1;`);
  const id = "00000000-0000-4000-8000-000000000001";
  legacy.prepare(`INSERT INTO work_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, "Known defect", "Zero appears missing", "defect", "/tmp/repo", "main",
      '["Show $0"]', "npm test", '["npm test"]', '["src/**"]', "mac", "queued",
      "2026-09-24T00:00:00.000Z", "2026-09-24T00:00:00.000Z");
  legacy.close();

  const storage = openStorage(path);
  const migrated = storage.getWorkOrder(id);
  assert.ok(migrated);
  assert.equal(migrated.expectedFailureText, null);
  storage.saveWorkOrder({ ...migrated, expectedFailureText: "Expected '$0'" });
  storage.close();

  const reopened = openStorage(path);
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkOrder(id)?.expectedFailureText, "Expected '$0'");
  const database = new DatabaseSync(path);
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 4);
  database.close();
});

test("events retain append order and nested payload after restart", (t) => {
  const path = fixture(t);
  const storage = openStorage(path);
  const order = storage.createWorkOrder(workOrderInput());
  const run = storage.createRun(runInput(order.id));
  const first = storage.appendEvent({
    workOrderId: order.id,
    runId: null,
    type: "work.created",
    payload: { source: { kind: "manual", labels: ["bug", "priority"] } },
  });
  const second = storage.appendEvent({
    workOrderId: order.id,
    runId: run.id,
    type: "run.started",
    payload: { attempt: 1, observations: [true, null, 3] },
  });
  const third = storage.appendEvent({
    workOrderId: order.id,
    runId: run.id,
    type: "run.completed",
    payload: {},
  });
  storage.close();

  const reopened = openStorage(path);
  t.after(() => reopened.close());
  assert.ok(first.id < second.id && second.id < third.id);
  assert.deepEqual(reopened.listEvents(order.id), [first, second, third]);
  assert.deepEqual(reopened.listEvents(order.id, first.id), [second, third]);
});

test("separate connections serialize attempt allocation and reject bad foreign keys", (t) => {
  const path = fixture(t);
  const firstStorage = openStorage(path);
  const secondStorage = openStorage(path, { busyTimeoutMs: 40 });
  t.after(() => firstStorage.close());
  t.after(() => secondStorage.close());
  const order = firstStorage.createWorkOrder(workOrderInput());
  const otherOrder = firstStorage.createWorkOrder(workOrderInput("Another defect"));

  const first = firstStorage.createRun(runInput(order.id));
  const second = secondStorage.createRun(runInput(order.id));
  const third = firstStorage.createRun(runInput(order.id));
  assert.deepEqual([first.attemptNumber, second.attemptNumber, third.attemptNumber], [1, 2, 3]);
  assert.deepEqual(secondStorage.listRuns(order.id).map((run) => run.id), [first.id, second.id, third.id]);

  const unrelatedRun = firstStorage.createRun(runInput(otherOrder.id));
  assert.throws(() => firstStorage.appendEvent({
    workOrderId: order.id,
    runId: unrelatedRun.id,
    type: "wrong.run",
    payload: {},
  }), /FOREIGN KEY constraint failed/);
  assert.equal(firstStorage.listEvents(order.id).length, 0);

  const lockHolder = new DatabaseSync(path);
  lockHolder.exec("BEGIN IMMEDIATE");
  try {
    assert.throws(() => secondStorage.createRun(runInput(order.id)), /database is locked/);
  } finally {
    lockHolder.exec("ROLLBACK");
    lockHolder.close();
  }
  assert.equal(secondStorage.createRun(runInput(order.id)).attemptNumber, 4);
});

test("a state change and audit event roll back together", (t) => {
  const path = fixture(t);
  const storage = openStorage(path);
  t.after(() => storage.close());

  assert.throws(() => storage.transaction(() => {
    const order = storage.createWorkOrder(workOrderInput());
    storage.appendEvent({
      workOrderId: order.id,
      runId: "not-a-run",
      type: "work.created",
      payload: {},
    });
  }), /FOREIGN KEY constraint failed/);
  assert.deepEqual(storage.listWorkOrders(), []);
});

test("signal ingestion is idempotent by source identity and preserves its WorkOrder link", (t) => {
  const path = fixture(t);
  const storage = openStorage(path);
  const otherConnection = openStorage(path);
  t.after(() => storage.close());
  t.after(() => otherConnection.close());

  const initial = storage.upsertSignal(signalInput());
  assert.deepEqual(otherConnection.upsertSignal(signalInput()), initial);
  const order = storage.createWorkOrder(workOrderInput());
  const linked = storage.linkSignalToWorkOrder(initial.id, order.id);
  assert.equal(linked.workOrderId, order.id);

  const changed = otherConnection.upsertSignal({
    ...signalInput(),
    sourceRevision: "2026-09-25T12:00:00Z",
    evidence: { steps: ["Open form", "Double click Submit"], affectedUsers: 3 },
    coverage: "partial",
    coverageDetail: "One page of comments was unavailable",
  });
  assert.equal(changed.id, initial.id);
  assert.equal(changed.firstSeenAt, initial.firstSeenAt);
  assert.equal(changed.workOrderId, order.id);
  assert.deepEqual(storage.listSignals(order.id), [changed]);
  assert.deepEqual(storage.upsertSignal({
    ...signalInput(),
    sourceRevision: "2026-09-25T12:00:00Z",
    evidence: { steps: ["Open form", "Double click Submit"], affectedUsers: 3 },
    coverage: "partial",
    coverageDetail: "One page of comments was unavailable",
  }), changed);

  const differentIdentity = storage.upsertSignal(signalInput("owner/repo#43"));
  const differentSource = storage.upsertSignal({ ...signalInput(), source: "support" });
  assert.equal(new Set(storage.listSignals().map((signal) => signal.id)).size, 3);
  assert.notEqual(differentIdentity.id, initial.id);
  assert.notEqual(differentSource.id, initial.id);

  const otherOrder = storage.createWorkOrder(workOrderInput("Another WorkOrder"));
  assert.throws(() => storage.linkSignalToWorkOrder(initial.id, otherOrder.id), /already linked/);
  assert.throws(() => storage.linkSignalToWorkOrder(differentIdentity.id, "missing-order"),
    /FOREIGN KEY constraint failed/);
  assert.equal(storage.getSignal(differentIdentity.id)?.workOrderId, null);
  assert.throws(() => storage.upsertSignal({ ...signalInput("bad"), coverage: "unknown" }),
    /CHECK constraint failed/);
});

test("release records retain artifact and prior known-good identity across restart", (t) => {
  const path = fixture(t);
  const storage = openStorage(path);
  const beta = storage.createRelease(releaseInput());
  const deployed = storage.setReleaseStatus(beta.id, "deployed");
  assert.deepEqual(storage.setReleaseStatus(beta.id, "deployed"), deployed);
  const production = storage.createRelease({
    ...releaseInput(),
    stage: "production",
    status: "candidate",
    previousKnownGoodArtifactIdentity: "sha256:production-stable",
  });
  storage.close();

  const reopened = openStorage(path);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getRelease(beta.id), deployed);
  assert.deepEqual(reopened.listReleases("demo-store").map((release) => release.id).sort(),
    [beta.id, production.id].sort());
  assert.equal(reopened.getRelease(production.id)?.previousKnownGoodArtifactIdentity,
    "sha256:production-stable");
  assert.equal(reopened.getRelease(production.id)?.policyRevision, 7);
  assert.throws(() => reopened.createRelease({ ...releaseInput(), policyRevision: 0 }),
    /CHECK constraint failed/);
  assert.throws(() => reopened.setReleaseStatus(beta.id, "unknown"),
    /CHECK constraint failed/);
  assert.deepEqual(reopened.getRelease(beta.id), deployed);
});
