import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStorage } from "../../../packages/storage/src/index.ts";
import { performAction } from "../src/actions.ts";

function readyFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "factory-approval-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const storage = openStorage(join(directory, "factory.sqlite"));
  t.after(() => storage.close());
  const order = storage.createWorkOrder({
    title: "Preserve date filters",
    description: "Export must use the selected date range.",
    kind: "feature",
    repositoryPath: directory,
    baseRef: "main",
    acceptanceCriteria: ["Export uses the selected range"],
    reproductionCommand: null,
    expectedFailureText: null,
    checkCommands: ["npm test"],
    allowedPaths: ["src/"],
    workerProfile: "mac",
  }, "ready_for_review");
  const createdRun = storage.createRun({
    workOrderId: order.id, workerProfile: "mac", inputCommit: "a".repeat(40),
    workspacePath: directory,
  });
  const run = storage.saveRun({
    ...createdRun, state: "ready_for_review", candidateCommit: "b".repeat(40),
    finishedAt: new Date().toISOString(),
  });
  const logPath = join(directory, "verification.log");
  writeFileSync(logPath, "1 test passed\n");
  storage.insertCheck({
    runId: run.id, candidateCommit: run.candidateCommit, command: "npm test",
    status: "passed", exitCode: 0, startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(), logPath,
    logSha256: createHash("sha256").update("1 test passed\n").digest("hex"),
  });
  const events = [];
  const context = {
    storage,
    notify: (event) => events.push(event),
    startRun: async () => { throw new Error("startRun should not run"); },
    cancelRun: async () => { throw new Error("cancelRun should not run"); },
  };
  return { storage, order, run, logPath, context, events };
}

const human = { kind: "human", id: "reviewer" };
const agent = { kind: "agent", id: "factory-agent" };

test("agent note changes durable UI data but cannot grant publication approval", async (t) => {
  const { storage, order, context, events } = readyFixture(t);
  const note = await performAction(context, "workorder.note.add", {
    workOrderId: order.id, text: "The export test passes for the selected range.",
  }, agent);
  assert.equal(note.type, "workorder.note_added");
  assert.equal(note.payload.actorKind, "agent");
  assert.deepEqual(storage.listEvents(order.id), [note]);
  assert.deepEqual(events, [note]);

  const request = await performAction(context, "publication.request", {
    workOrderId: order.id, destination: "example/disposable",
  }, agent);
  await assert.rejects(() => performAction(context, "publication.approve", {
    requestId: request.id, candidateCommit: request.candidateCommit,
    evidenceDigest: request.evidenceDigest, policyRevision: request.policyRevision,
  }, agent), (error) => error.code === "forbidden");
});

test("candidate, evidence, and policy changes invalidate an approved draft request", async (t) => {
  const { storage, order, run, logPath, context } = readyFixture(t);
  const request = await performAction(context, "publication.request", {
    workOrderId: order.id, destination: "example/disposable",
  }, agent);
  const approval = await performAction(context, "publication.approve", {
    requestId: request.id, candidateCommit: request.candidateCommit,
    evidenceDigest: request.evidenceDigest, policyRevision: request.policyRevision,
  }, human);
  assert.equal(approval.requestId, request.id);
  await assert.rejects(() => performAction(context, "publication.publish_draft", {
    requestId: request.id,
  }, human), (error) => error.code === "publication_unavailable");

  storage.saveRun({ ...run, candidateCommit: "c".repeat(40) });
  await assert.rejects(() => performAction(context, "publication.publish_draft", {
    requestId: request.id,
  }, human), (error) => error.code === "candidate_stale");
  storage.saveRun(run);

  writeFileSync(logPath, "The log changed after review.\n");
  await assert.rejects(() => performAction(context, "publication.publish_draft", {
    requestId: request.id,
  }, human), (error) => error.code === "evidence_stale");
  writeFileSync(logPath, "1 test passed\n");

  const policy = storage.getPolicy();
  await performAction(context, "dispatch.set_paused", {
    paused: true, expectedRevision: policy.revision,
  }, human);
  await assert.rejects(() => performAction(context, "publication.publish_draft", {
    requestId: request.id,
  }, human), (error) => error.code === "policy_stale");
});
