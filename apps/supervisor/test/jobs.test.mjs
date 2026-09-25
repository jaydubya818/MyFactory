import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStorage } from "../../../packages/storage/src/index.ts";
import { JobManager } from "../src/jobs.ts";

const INPUT_COMMIT = "a".repeat(40);
const CANDIDATE_COMMIT = "b".repeat(40);
const EXPECTED_FAILURE = "Expected '$0'";

function orderInput(overrides = {}) {
  return {
    title: "Zero revenue appears missing",
    description: "The buyer view displays an absent value for a reported zero.",
    kind: "defect",
    repositoryPath: "/tmp/disposable-repo",
    baseRef: "main",
    acceptanceCriteria: ["Show a reported zero as $0"],
    reproductionCommand: "npm test",
    expectedFailureText: EXPECTED_FAILURE,
    checkCommands: ["npm run lint"],
    allowedPaths: ["src/**", "test/**"],
    workerProfile: "mac",
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForRun(storage, runId, state) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = storage.getRun(runId);
    if (run?.state === state) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run ${runId} did not reach ${state}`);
}

async function verification(input, statuses, logs) {
  await mkdir(input.artifactDir, { recursive: true });
  const checks = [];
  for (const [index, command] of input.commands.entries()) {
    const logPath = join(input.artifactDir, `check-${index}.log`);
    await writeFile(logPath, logs[index] ?? "", "utf8");
    checks.push({
      candidateCommit: input.candidateSha,
      candidateTree: "c".repeat(40),
      command,
      status: statuses[index],
      exitCode: statuses[index] === "passed" ? 0 : 1,
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T00:00:01.000Z",
      logPath,
      reason: null,
    });
  }
  return { checks, reason: null };
}

async function harness(t, dependencies) {
  const dataDir = await mkdtemp(join(tmpdir(), "factory-jobs-"));
  const storage = openStorage(join(dataDir, "factory.sqlite"));
  const events = [];
  const jobs = new JobManager(storage, dataDir, (event) => events.push(event), dependencies);
  t.after(async () => {
    await jobs.close();
    storage.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { dataDir, storage, events, jobs };
}

test("wrong baseline failure text blocks Codex before implementation", async (t) => {
  let codexCalls = 0;
  const work = await harness(t, {
    resolveCommit: async () => INPUT_COMMIT,
    createTaskWorktree: async () => join(tmpdir(), "fake-worktree"),
    verifyCandidate: async (input) => verification(input, ["failed"], ["Unrelated syntax error"]),
    preflightCodex: async () => { throw new Error("Preflight must not run"); },
    runCodex: async () => { codexCalls += 1; throw new Error("Codex must not run"); },
  });
  const order = work.storage.createWorkOrder(orderInput());
  const started = await work.jobs.startRun(order);
  const finished = await waitForRun(work.storage, started.id, "failed");

  assert.equal(codexCalls, 0);
  assert.equal(work.storage.getWorkOrder(order.id).state, "needs_investigation");
  assert.match(finished.failure, /expected failure/i);
  assert.ok(work.events.some((event) => event.type === "run.reproduction_mismatch"));
});

test("post-fix reproduction failure blocks ready for review despite another passing check", async (t) => {
  const verificationCommands = [];
  let codexCalls = 0;
  const work = await harness(t, {
    resolveCommit: async () => INPUT_COMMIT,
    createTaskWorktree: async () => join(tmpdir(), "fake-worktree"),
    verifyCandidate: async (input) => {
      verificationCommands.push([...input.commands]);
      return input.candidateSha === INPUT_COMMIT
        ? verification(input, ["failed"], [`AssertionError: ${EXPECTED_FAILURE}`])
        : verification(input, ["failed", "passed"], ["Regression still fails", "Lint passed"]);
    },
    preflightCodex: async () => ({ binaryAvailable: true, authenticated: true, version: "fixture", error: null }),
    runCodex: async () => {
      codexCalls += 1;
      return { success: true, status: "completed", threadId: "fixture-thread", usage: null,
        eventsPath: "/tmp/fixture-events.jsonl" };
    },
    commitCandidate: async () => ({
      commit: CANDIDATE_COMMIT,
      tree: "c".repeat(40),
      changedPaths: ["src/revenue.js"],
      diffPath: "/tmp/fixture.patch",
    }),
  });
  const order = work.storage.createWorkOrder(orderInput());
  const started = await work.jobs.startRun(order);
  const finished = await waitForRun(work.storage, started.id, "failed");

  assert.equal(codexCalls, 1);
  assert.deepEqual(verificationCommands, [["npm test"], ["npm test", "npm run lint"]]);
  assert.equal(finished.candidateCommit, CANDIDATE_COMMIT);
  assert.deepEqual(work.storage.listChecks(started.id).map((check) => check.status), ["failed", "passed"]);
  assert.equal(work.storage.getWorkOrder(order.id).state, "failed");
  assert.ok(!work.events.some((event) => event.type === "run.ready_for_review"));
});

test("cancel during worktree creation removes the workspace and frees the active slot", async (t) => {
  const entered = deferred();
  const release = deferred();
  const removed = [];
  let creates = 0;
  const work = await harness(t, {
    resolveCommit: async () => INPUT_COMMIT,
    createTaskWorktree: async () => {
      creates += 1;
      if (creates === 1) {
        entered.resolve();
        await release.promise;
      }
      return join(tmpdir(), `fake-worktree-${creates}`);
    },
    removeTaskWorktree: async (_repositoryPath, workspacePath) => { removed.push(workspacePath); },
    verifyCandidate: async (input) => verification(input, ["passed"], ["No defect reproduced"]),
    preflightCodex: async () => { throw new Error("Preflight must not run"); },
  });
  const order = work.storage.createWorkOrder(orderInput());
  const firstStart = work.jobs.startRun(order);
  const firstRejected = assert.rejects(firstStart, /Start was cancelled/);
  await entered.promise;
  assert.equal(await work.jobs.cancelRun(order), null);
  release.resolve();
  await firstRejected;
  await work.jobs.close();

  assert.deepEqual(removed, [join(tmpdir(), "fake-worktree-1")]);
  assert.deepEqual(work.storage.listRuns(order.id), []);
  assert.equal(work.storage.getWorkOrder(order.id).state, "queued");

  const second = await work.jobs.startRun(order);
  await waitForRun(work.storage, second.id, "failed");
  assert.equal(creates, 2);
  assert.equal(work.storage.getWorkOrder(order.id).state, "needs_investigation");
});

test("restart holds an untracked worker and preserves completed history", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "factory-jobs-restart-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const path = join(dataDir, "factory.sqlite");
  const before = openStorage(path);
  const activeOrder = before.createWorkOrder(orderInput(), "implementing");
  const activeRun = before.createRun({
    workOrderId: activeOrder.id,
    workerProfile: "mac",
    inputCommit: INPUT_COMMIT,
    workspacePath: "/tmp/active-worktree",
    state: "implementing",
  });
  const completedOrder = before.createWorkOrder(orderInput({ title: "Already reviewed" }), "ready_for_review");
  const completedRun = before.createRun({
    workOrderId: completedOrder.id,
    workerProfile: "mac",
    inputCommit: INPUT_COMMIT,
    workspacePath: "/tmp/completed-worktree",
    state: "ready_for_review",
  });
  before.close();

  const after = openStorage(path);
  t.after(() => after.close());
  const notified = [];
  const jobs = new JobManager(after, dataDir, (event) => notified.push(event));
  assert.equal(after.getRun(activeRun.id).state, "interrupted");
  assert.equal(after.getRun(activeRun.id).failure, "Supervisor restart interrupted the attempt");
  assert.equal(after.getWorkOrder(activeOrder.id).state, "awaiting_environment");
  assert.equal(after.listEvents(activeOrder.id).at(-1).type, "run.recovery_hold");
  assert.equal(after.getRun(completedRun.id).state, "ready_for_review");
  assert.equal(after.getWorkOrder(completedOrder.id).state, "ready_for_review");
  assert.deepEqual(notified.map((event) => event.type), ["run.recovery_hold"]);
  await assert.rejects(jobs.startRun(after.getWorkOrder(activeOrder.id)), /Retry is held/);
  await jobs.close();
});

test("restart allows retry after the recorded host process group is absent", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "factory-jobs-restart-cleared-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const storage = openStorage(join(dataDir, "factory.sqlite"));
  t.after(() => storage.close());
  const order = storage.createWorkOrder(orderInput(), "implementing");
  const run = storage.createRun({
    workOrderId: order.id,
    workerProfile: "mac",
    inputCommit: INPUT_COMMIT,
    workspacePath: "/tmp/old-worktree",
    state: "implementing",
  });
  storage.appendEvent({
    workOrderId: order.id,
    runId: run.id,
    type: "agent.process_started",
    payload: { pid: 2147483647, workspacePath: run.workspacePath },
  });
  const jobs = new JobManager(storage, dataDir, () => {});
  t.after(() => jobs.close());
  assert.equal(storage.getWorkOrder(order.id).state, "interrupted");
  assert.equal(storage.listEvents(order.id).at(-1).type, "run.interrupted");
});
