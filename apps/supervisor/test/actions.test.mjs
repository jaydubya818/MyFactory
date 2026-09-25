import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStorage } from "../../../packages/storage/src/index.ts";
import { performAction } from "../src/actions.ts";
import { PublicationAdapterError } from "../src/github.ts";

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
  const diffPath = join(directory, "candidate.patch");
  const diffText = "diff --git a/src/report.ts b/src/report.ts\n+selectedRange=true\n";
  writeFileSync(diffPath, diffText);
  storage.appendEvent({
    workOrderId: order.id, runId: run.id, type: "run.candidate_committed",
    payload: {
      candidateCommit: run.candidateCommit, diffPath,
      diffSha256: createHash("sha256").update(diffText).digest("hex"),
    },
  });
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
    confirmHumanPresence: async () => true,
    notify: (event) => events.push(event),
    startRun: async () => { throw new Error("startRun should not run"); },
    cancelRun: async () => { throw new Error("cancelRun should not run"); },
  };
  return { storage, order, run, logPath, diffPath, context, events };
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
  assert.equal(storage.listEvents(order.id).at(-1).id, note.id);
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
  const { storage, order, run, logPath, diffPath, context } = readyFixture(t);
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

  writeFileSync(diffPath, "The displayed candidate patch changed after review.\n");
  await assert.rejects(() => performAction(context, "publication.publish_draft", {
    requestId: request.id,
  }, human), (error) => error.code === "evidence_stale");
  writeFileSync(diffPath, "diff --git a/src/report.ts b/src/report.ts\n+selectedRange=true\n");

  const policy = storage.getPolicy();
  await performAction(context, "dispatch.set_paused", {
    paused: true, expectedRevision: policy.revision,
  }, human);
  await assert.rejects(() => performAction(context, "publication.publish_draft", {
    requestId: request.id,
  }, human), (error) => error.code === "policy_stale");
});

test("human approval requires a fresh device-owner confirmation", async (t) => {
  const { storage, order, context } = readyFixture(t);
  const request = await performAction(context, "publication.request", {
    workOrderId: order.id, destination: "example/disposable",
  }, agent);
  context.confirmHumanPresence = async () => false;
  await assert.rejects(() => performAction(context, "publication.approve", {
    requestId: request.id, candidateCommit: request.candidateCommit,
    evidenceDigest: request.evidenceDigest, policyRevision: request.policyRevision,
  }, human), (error) => error.code === "human_confirmation_denied");
  assert.equal(storage.getPublicationApproval(request.id), null);
});

test("an exact approved candidate records one draft PR and repeated calls stay local", async (t) => {
  const { storage, order, context } = readyFixture(t);
  const calls = [];
  context.publishDraft = async (input, options) => {
    calls.push({ input, options });
    return {
      destination: input.destination, branch: `codex/factory/wo-${order.id}`,
      candidateCommit: input.candidateCommit, pullRequestNumber: 7,
      url: "https://github.com/example/disposable/pull/7",
      remoteIdentity: "example/disposable#7", reconciled: false,
    };
  };
  const request = await performAction(context, "publication.request", {
    workOrderId: order.id, destination: "example/disposable",
  }, agent);
  await performAction(context, "publication.approve", {
    requestId: request.id, candidateCommit: request.candidateCommit,
    evidenceDigest: request.evidenceDigest, policyRevision: request.policyRevision,
  }, human);
  const first = await performAction(context, "publication.publish_draft", { requestId: request.id }, human);
  const repeated = await performAction(context, "publication.publish_draft", { requestId: request.id }, human);
  assert.equal(first.state, "succeeded");
  assert.equal(first.remoteIdentity, "https://github.com/example/disposable/pull/7");
  assert.deepEqual(repeated, first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.candidateCommit, request.candidateCommit);
  assert.equal(calls[0].options.reconcileOnly, false);
  assert.equal(storage.getExternalActionForRequest(request.id, "draft_pr").id, first.id);
  assert.equal(storage.listEvents(order.id).at(-1).type, "publication.succeeded");
});

test("a changed candidate blocks draft publication before the adapter is called", async (t) => {
  const { storage, order, run, context } = readyFixture(t);
  let called = false;
  context.publishDraft = async () => { called = true; throw new Error("unexpected publication"); };
  const request = await performAction(context, "publication.request", {
    workOrderId: order.id, destination: "example/disposable",
  }, agent);
  await performAction(context, "publication.approve", {
    requestId: request.id, candidateCommit: request.candidateCommit,
    evidenceDigest: request.evidenceDigest, policyRevision: request.policyRevision,
  }, human);
  storage.saveRun({ ...run, candidateCommit: "c".repeat(40) });
  await assert.rejects(() => performAction(context, "publication.publish_draft", {
    requestId: request.id,
  }, human), (error) => error.code === "candidate_stale");
  assert.equal(called, false);
  assert.equal(storage.getExternalActionForRequest(request.id, "draft_pr"), null);
});

test("an uncertain draft outcome only reconciles remote state on retry", async (t) => {
  const { storage, order, run, context } = readyFixture(t);
  const modes = [];
  context.publishDraft = async (input, options) => {
    modes.push(options.reconcileOnly);
    if (!options.reconcileOnly) throw new PublicationAdapterError("uncertain", "Response lost after dispatch");
    return {
      destination: input.destination, branch: `codex/factory/wo-${order.id}`,
      candidateCommit: input.candidateCommit, pullRequestNumber: 8,
      url: "https://github.com/example/disposable/pull/8",
      remoteIdentity: "example/disposable#8", reconciled: true,
    };
  };
  const request = await performAction(context, "publication.request", {
    workOrderId: order.id, destination: "example/disposable",
  }, agent);
  await performAction(context, "publication.approve", {
    requestId: request.id, candidateCommit: request.candidateCommit,
    evidenceDigest: request.evidenceDigest, policyRevision: request.policyRevision,
  }, human);
  await assert.rejects(() => performAction(context, "publication.publish_draft", {
    requestId: request.id,
  }, human), (error) => error.code === "publication_uncertain");
  assert.equal(storage.getExternalActionForRequest(request.id, "draft_pr").state, "unknown");
  storage.saveRun({ ...run, candidateCommit: "c".repeat(40) });
  const result = await performAction(context, "publication.publish_draft", { requestId: request.id }, human);
  assert.equal(result.state, "succeeded");
  assert.deepEqual(modes, [false, true]);
});

test("app builder creates a durable WorkOrder linked to a versioned scaffold", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "factory-builder-action-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const storage = openStorage(join(directory, "factory.sqlite"));
  t.after(() => storage.close());
  const context = {
    storage, appBuildDirectory: join(directory, "app-builds"), notify: () => {},
    startRun: async () => { throw new Error("unexpected start"); },
    cancelRun: async () => { throw new Error("unexpected cancel"); },
  };
  const result = await performAction(context, "builder.create", {
    templateId: "feedback-hub", title: "SellerFi Feedback",
    brief: "Capture buyer and seller feedback with one clear triage inbox.",
  }, human);
  assert.equal(result.workOrder.state, "awaiting_environment");
  assert.equal(result.workOrder.repositoryPath, result.artifactPath);
  assert.equal(result.templateVersion, "1.0.0");
  assert.equal(JSON.parse(readFileSync(result.manifestPath, "utf8")).template.version, "1.0.0");
  assert.equal(storage.getWorkOrder(result.workOrder.id)?.id, result.workOrder.id);
  assert.equal(storage.listEvents(result.workOrder.id).at(-1).type, "builder.scaffold_created");
});
