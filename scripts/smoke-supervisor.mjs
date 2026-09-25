import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openStorage } from "../packages/storage/src/index.ts";
import { JobManager } from "../apps/supervisor/src/jobs.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = join(projectRoot, "evals", "phase-0-defect");
const root = await mkdtemp(join(tmpdir(), "factory-supervisor-smoke-"));
const repositoryPath = join(root, "repository");
const dataDir = join(root, "data");
await cp(fixturePath, repositoryPath, { recursive: true });

function git(...args) {
  return execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8" }).trim();
}

git("init", "-b", "main");
git("add", ".");
git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Defect fixture");
const inputCommit = git("rev-parse", "HEAD");

const storage = openStorage(join(dataDir, "factory.sqlite"));
const order = storage.createWorkOrder({
  title: "Zero revenue appears missing",
  description: "The buyer view must show a reported zero as $0.",
  kind: "defect",
  repositoryPath,
  baseRef: "main",
  acceptanceCriteria: ["Zero formats as $0", "Missing revenue remains Not provided"],
  reproductionCommand: "npm test",
  expectedFailureText: "shows a reported zero instead of treating it as missing",
  checkCommands: ["npm test"],
  allowedPaths: ["src/formatAnnualRevenue.js"],
  workerProfile: "mac",
}, "queued");

const jobs = new JobManager(storage, dataDir, () => {}, {
  preflightCodex: async () => ({
    workerProfile: "mac",
    binaryAvailable: true,
    authenticated: true,
    version: "simulated-coding-step",
    error: null,
  }),
  runCodex: async ({ workspacePath }) => {
    const sourcePath = join(workspacePath, "src", "formatAnnualRevenue.js");
    const source = await readFile(sourcePath, "utf8");
    assert.match(source, /if \(!annualRevenue\)/);
    await writeFile(sourcePath, source.replace("if (!annualRevenue)", "if (annualRevenue == null)"));
    return {
      workerProfile: "mac",
      status: "completed",
      success: true,
      exitCode: 0,
      exitSignal: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      eventsPath: "simulated",
      stderrPath: "simulated",
      finalMessagePath: "simulated",
      finalMessageAvailable: true,
      threadId: "simulated",
      usage: null,
      completionEventSeen: true,
      error: null,
    };
  },
});

try {
  const run = await jobs.startRun(order);
  let final = storage.getRun(run.id);
  for (let index = 0; index < 400 && final && !["ready_for_review", "failed", "interrupted", "cancelled"].includes(final.state); index += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    final = storage.getRun(run.id);
  }
  assert.ok(final, "Run must remain persisted");
  const checks = storage.listChecks(run.id);
  const events = storage.listEvents(order.id);
  const summary = {
    evidenceRoot: root,
    inputCommit,
    runId: run.id,
    runState: final.state,
    workOrderState: storage.getWorkOrder(order.id)?.state,
    candidateCommit: final.candidateCommit,
    checks: checks.map((check) => ({
      command: check.command,
      status: check.status,
      candidateCommit: check.candidateCommit,
      logPath: check.logPath,
    })),
    eventTypes: events.map((event) => event.type),
  };
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(final.state, "ready_for_review");
  assert.equal(summary.workOrderState, "ready_for_review");
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "passed");
  assert.equal(checks[0].candidateCommit, final.candidateCommit);
} finally {
  await jobs.close();
  storage.close();
}
