import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSupervisor } from "../src/server.ts";

async function listen(supervisor) {
  await new Promise((resolve) => supervisor.server.listen(0, "127.0.0.1", resolve));
  const address = supervisor.server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function createOrder(origin, input, token, overrideOrigin = origin) {
  return fetch(`${origin}/api/actions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Factory-Token": token,
      Origin: overrideOrigin,
    },
    body: JSON.stringify({ action: "workorder.create", input }),
  });
}

const validInput = {
  title: "Revenue zero displays as missing",
  description: "A seller reported zero annual revenue; buyers see missing data.",
  kind: "defect",
  repositoryPath: "/private/tmp/disposable-repo",
  baseRef: "main",
  acceptanceCriteria: ["A reported zero appears as $0"],
  reproductionCommand: "npm test",
  expectedFailureText: "reported zero",
  checkCommands: ["npm test"],
  allowedPaths: ["src/"],
  workerProfile: "mac",
};

test("shared create action persists its WorkOrder and event across a restart", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "sellerfi-supervisor-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const first = createSupervisor({ dataDir });
  const origin = await listen(first);
  const { token } = await (await fetch(`${origin}/api/session`)).json();

  const createdResponse = await createOrder(origin, validInput, token);
  assert.equal(createdResponse.status, 200);
  const { result: created } = await createdResponse.json();
  assert.equal(created.state, "queued");
  assert.match(created.id, /^[0-9a-f-]{36}$/);
  await first.close();

  const second = createSupervisor({ dataDir });
  const restartedOrigin = await listen(second);
  t.after(() => second.close());
  const queue = await (await fetch(`${restartedOrigin}/api/work-orders`)).json();
  assert.equal(queue.workOrders.length, 1);
  assert.equal(queue.workOrders[0].id, created.id);
  const detail = await (await fetch(`${restartedOrigin}/api/work-orders/${created.id}`)).json();
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0].type, "workorder.created");
  assert.equal(detail.events[0].payload.state, "queued");
});

test("state-changing actions require a local origin and session token", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "sellerfi-supervisor-auth-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const supervisor = createSupervisor({ dataDir });
  t.after(() => supervisor.close());
  const origin = await listen(supervisor);
  const { token } = await (await fetch(`${origin}/api/session`)).json();

  assert.equal((await createOrder(origin, validInput, "0".repeat(64))).status, 403);
  assert.equal((await createOrder(origin, validInput, token, "https://untrusted.example")).status, 403);
  assert.equal((await createOrder(origin, {
    ...validInput,
    allowedPaths: ["src/.git/config"],
  }, token)).status, 400);
  assert.equal((await createOrder(origin, {
    ...validInput,
    reproductionCommand: null,
  }, token)).status, 200);
  const queue = await (await fetch(`${origin}/api/work-orders`)).json();
  assert.equal(queue.workOrders.length, 1);
  assert.equal(queue.workOrders[0].state, "needs_investigation");
});

test("agent endpoint shares the action path and cannot impersonate human approval", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "sellerfi-supervisor-agent-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const supervisor = createSupervisor({ dataDir });
  t.after(() => supervisor.close());
  const origin = await listen(supervisor);
  const { token } = await (await fetch(`${origin}/api/session`)).json();
  const created = await (await createOrder(origin, validInput, token)).json();
  const invokeAgent = (action, input) => fetch(`${origin}/api/agent/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Factory-Token": token, Origin: origin },
    body: JSON.stringify({ action, input }),
  });
  const denied = await invokeAgent("workorder.create", validInput);
  assert.equal(denied.status, 403);
  const note = await invokeAgent("workorder.note.add", {
    workOrderId: created.result.id, text: "Evidence reviewed by the factory agent.",
  });
  assert.equal(note.status, 200);
  const detail = await (await fetch(`${origin}/api/work-orders/${created.result.id}`)).json();
  assert.equal(detail.events.at(-1).payload.actorKind, "agent");
});

test("app builder endpoint creates a linked scaffold without claiming verification", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "sellerfi-builder-api-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const supervisor = createSupervisor({ dataDir });
  t.after(() => supervisor.close());
  const origin = await listen(supervisor);
  const { token } = await (await fetch(`${origin}/api/session`)).json();
  const templatesResponse = await fetch(`${origin}/api/app-builder/templates`);
  assert.equal(templatesResponse.status, 200);
  const { templates } = await templatesResponse.json();
  assert.equal(templates[0].id, "feedback-hub");
  const response = await fetch(`${origin}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Factory-Token": token, Origin: origin },
    body: JSON.stringify({ action: "builder.create", input: {
      templateId: "feedback-hub", title: "Buyer feedback",
      brief: "Capture buyer concerns and decisions before deal review.",
    } }),
  });
  assert.equal(response.status, 200);
  const { result } = await response.json();
  const detail = await (await fetch(`${origin}/api/work-orders/${result.workOrder.id}`)).json();
  assert.equal(detail.workOrder.state, "awaiting_environment");
  assert.equal(detail.events.at(-1).type, "builder.scaffold_created");
  assert.equal(detail.checks.length, 0);
  const manifestResponse = await fetch(`${origin}/api/work-orders/${result.workOrder.id}/build-manifest`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.template.id, "feedback-hub");
  assert.ok(manifest.files.some((file) => file.path === "src/App.tsx"));
});

test("manual signals are deduplicated and releases stay empty until recorded", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "sellerfi-signal-api-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const supervisor = createSupervisor({ dataDir });
  t.after(() => supervisor.close());
  const origin = await listen(supervisor);
  const { token } = await (await fetch(`${origin}/api/session`)).json();
  const input = { sourceIdentity: "feedback-1", title: "Export date range", summary: "A buyer saw an unexpected range." };
  const record = () => fetch(`${origin}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Factory-Token": token, Origin: origin },
    body: JSON.stringify({ action: "signal.record", input }),
  });
  assert.equal((await record()).status, 200);
  assert.equal((await record()).status, 200);
  const signals = await (await fetch(`${origin}/api/signals`)).json();
  assert.equal(signals.signals.length, 1);
  assert.equal(signals.signals[0].coverage, "partial");
  const releases = await (await fetch(`${origin}/api/releases`)).json();
  assert.deepEqual(releases.releases, []);
});
