import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSupervisor } from "../src/server.ts";

const token = "1".repeat(64);
const input = { title: "Connection acceptance test", description: "Create once and show shared evidence.",
  kind: "feature", baseRef: "main", acceptanceCriteria: ["A duplicate request returns the same record"],
  reproductionCommand: null, expectedFailureText: null, checkCommands: ["node --test"],
  allowedPaths: ["src/"], workerProfile: "mac", idempotencyKey: "source-event-123" };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "factory-connections-"));
  const repositoryPath = join(directory, "repo");
  mkdirSync(repositoryPath);
  const configPath = join(directory, "connections.json");
  writeFileSync(configPath, JSON.stringify({ clients: [{ id: "myeve", name: "MyEve test client",
    tokenSha256: createHash("sha256").update(token).digest("hex"), repositoryPaths: [repositoryPath],
    actions: ["workorder.create", "workorder.note.add"] }] }));
  let host;
  let origin;
  async function start() {
    host = createSupervisor({ dataDir: directory, linear: {}, confirmHumanPresence: async () => false });
    await new Promise((resolve) => host.server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${host.server.address().port}`;
  }
  await start();
  t.after(async () => { await host.close(); rmSync(directory, { recursive: true, force: true }); });
  return { repositoryPath, configPath, get host() { return host; },
    restart: async () => { await host.close(); await start(); },
    get: (path, authorization = `Bearer ${token}`) => fetch(`${origin}${path}`, { headers: { Authorization: authorization } }),
    action: (action, data, headers = {}) => fetch(`${origin}/api/connect/v1/actions`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ action, input: { ...data } }),
    }),
  };
}

test("connected app intake is scoped, idempotent across restart, and uses the shared audit records", async (t) => {
  const f = await fixture(t);
  const payload = { ...input, repositoryPath: f.repositoryPath };
  const responses = await Promise.all([f.action("workorder.create", payload), f.action("workorder.create", payload)]);
  for (const response of responses) assert.equal(response.status, 200);
  const created = (await responses[0].json()).result;
  assert.equal((await responses[1].json()).result.id, created.id);
  await f.restart();
  assert.equal((await (await f.action("workorder.create", payload)).json()).result.id, created.id);
  assert.equal(f.host.storage.listWorkOrders().length, 1);
  assert.equal((await f.action("workorder.create", { ...payload, title: "Different task" })).status, 409);
  assert.equal((await f.action("workorder.note.add", { workOrderId: created.id, text: "MyEve attached context" })).status, 200);
  const detail = await (await f.get(`/api/connect/v1/work-orders/${created.id}`)).json();
  assert.equal(detail.events[0].payload.actor, "connection:myeve");
  assert.equal(detail.events.at(-1).payload.text, "MyEve attached context");
  const browserDetail = await (await f.get(`/api/work-orders/${created.id}`)).json();
  assert.deepEqual(browserDetail.events, detail.events);
});

test("connections cannot escape repository/action scope, impersonate humans, or survive revocation", async (t) => {
  const f = await fixture(t);
  const payload = { ...input, repositoryPath: f.repositoryPath };
  assert.equal((await f.get("/api/connect/v1/work-orders", "Bearer bad")).status, 401);
  assert.equal((await f.action("workorder.create", payload, { Origin: "https://example.com" })).status, 403);
  assert.equal((await f.action("workorder.create", { ...payload, repositoryPath: "/" })).status, 403);
  assert.equal((await f.action("workorder.create", { ...payload, idempotencyKey: undefined })).status, 400);
  assert.equal((await f.action("workorder.create", { ...payload, syncToLinear: true })).status, 403);
  for (const action of ["run.start", "publication.approve", "publication.publish_draft", "builder.create", "linear.sync"]) {
    assert.equal((await f.action(action, { actor: { kind: "human" } })).status, 403);
  }
  const foreign = f.host.storage.createWorkOrder({ ...payload, repositoryPath: "/" });
  assert.equal((await f.get(`/api/connect/v1/work-orders/${foreign.id}`)).status, 404);
  assert.equal((await f.action("workorder.note.add", { workOrderId: foreign.id, text: "forbidden" })).status, 403);
  assert.equal((await (await f.get("/api/connect/v1/work-orders")).json()).workOrders.length, 0);
  const status = await (await f.get("/api/connections")).text();
  assert.equal(status.includes("tokenSha256"), false);
  assert.equal(status.includes(token), false);
  writeFileSync(f.configPath, JSON.stringify({ clients: [] }));
  assert.equal((await f.get("/api/connect/v1/work-orders")).status, 401);
});
