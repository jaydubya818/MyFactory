import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSupervisor } from "../src/server.ts";
import { performAction } from "../src/actions.ts";

const order = { title: "Linear creation acceptance test", description: "A precise product request.",
  kind: "feature", repositoryPath: "/private/local-repo", baseRef: "main",
  acceptanceCriteria: ["Exactly one linked issue"], reproductionCommand: null, expectedFailureText: null,
  checkCommands: ["node --test"], allowedPaths: ["src/"], workerProfile: "mac", idempotencyKey: "linear-123" };
const actor = { kind: "agent", id: "test-agent" };

function provider() {
  let issue;
  let createCount = 0;
  let disconnectAfterCreate = false;
  let reject = false;
  return {
    get createCount() { return createCount; },
    set disconnectAfterCreate(value) { disconnectAfterCreate = value; },
    set reject(value) { reject = value; },
    fetch: async (url, request) => {
      assert.equal(url, "https://api.linear.app/graphql");
      assert.equal(request.headers.Authorization, "secret-test-key");
      const { query, variables } = JSON.parse(request.body);
      if (reject) return Response.json({ errors: [{ message: "Sensitive provider response secret-test-key" }] });
      if (query.includes("FactoryIssueCreate")) {
        createCount++;
        assert.equal(issue, undefined, "duplicate remote creation");
        assert.equal(variables.input.description.includes("/private/local-repo"), false);
        assert.equal(variables.input.description.includes("node --test"), false);
        issue = { id: variables.input.id, identifier: "FAC-101", url: "https://linear.app/test/issue/FAC-101", team: { id: variables.input.teamId } };
        if (disconnectAfterCreate) throw new Error("network lost after provider committed");
        return Response.json({ data: { issueCreate: { success: true, issue } } });
      }
      assert.equal(query.includes("includeArchived: true"), true);
      return Response.json({ data: { issues: { nodes: issue ? [issue] : [] } } });
    },
  };
}

async function fixture(t, mode = "manual") {
  const directory = mkdtempSync(join(tmpdir(), "factory-linear-"));
  const remote = provider();
  const options = { dataDir: directory, linear: { apiKey: "secret-test-key", teamId: "team-test", mode, fetch: remote.fetch } };
  let host = createSupervisor(options);
  t.after(async () => { await host.close(); rmSync(directory, { recursive: true, force: true }); });
  return { remote, get host() { return host; },
    restart: async () => { await host.close(); host = createSupervisor(options); },
    action: (name, input) => performAction(host.context, name, input, actor),
  };
}

test("manual and automatic Linear creation save durable links without duplicate issues", async (t) => {
  const f = await fixture(t);
  const created = await f.action("workorder.create", order);
  assert.equal(f.remote.createCount, 0);
  const [first, repeated] = await Promise.all([
    f.action("linear.sync", { workOrderId: created.id }), f.action("linear.sync", { workOrderId: created.id }),
  ]);
  assert.equal(first.state, "synced");
  assert.deepEqual(first, repeated);
  await f.restart();
  assert.equal((await f.action("linear.sync", { workOrderId: created.id })).url, first.url);
  assert.equal(f.remote.createCount, 1);
  assert.equal(f.host.storage.listEvents(created.id).at(-1).type, "linear.synced");
  const automatic = await fixture(t, "automatic");
  const autoOrder = await automatic.action("workorder.create", order);
  assert.equal(automatic.host.storage.getLinearLink(autoOrder.id).state, "synced");
  await automatic.action("workorder.create", { ...order, idempotencyKey: "opt-out", syncToLinear: false });
  assert.equal(automatic.remote.createCount, 1);
});

test("lost remote response reconciles the saved UUID after restart and keeps local creation successful", async (t) => {
  const f = await fixture(t);
  f.remote.disconnectAfterCreate = true;
  const created = await f.action("workorder.create", { ...order, syncToLinear: true });
  const unknown = f.host.storage.getLinearLink(created.id);
  assert.equal(unknown.state, "unknown");
  assert.equal(f.host.storage.listWorkOrders().length, 1);
  await f.restart();
  const linked = await f.action("linear.sync", { workOrderId: created.id });
  assert.equal(linked.issueId, unknown.issueId);
  assert.equal(linked.state, "synced");
  assert.equal(f.remote.createCount, 1);
});

test("GraphQL errors are not success, secrets are not recorded, and interrupted sync is recoverable", async (t) => {
  const f = await fixture(t);
  f.remote.reject = true;
  const created = await f.action("workorder.create", { ...order, syncToLinear: true });
  assert.equal(f.host.storage.getLinearLink(created.id).state, "unknown");
  assert.equal(JSON.stringify(f.host.storage.listEvents(created.id)).includes("secret-test-key"), false);
  f.host.storage.saveLinearLink({ ...f.host.storage.getLinearLink(created.id), state: "syncing" });
  await f.restart();
  assert.equal(f.host.storage.getLinearLink(created.id).state, "unknown");
  f.remote.reject = false;
  assert.equal((await f.action("linear.sync", { workOrderId: created.id })).state, "synced");
});
