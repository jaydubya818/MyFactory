import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { actionNames, capabilities, parseAction, type FeedbackDetail } from "../src/shared/actions.ts";
import { runAgentAction } from "../scripts/agent.ts";
import { executeBrowserAction } from "../server/actions.ts";
import { FeedbackStore } from "../server/store.ts";

function tempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "feedback-hub-test-"));
  return { path: join(directory, "feedback.sqlite"), clean: () => rmSync(directory, { recursive: true, force: true }) };
}

test("browser action path and agent CLI achieve the same feedback outcomes", () => {
  const temporary = tempDatabase();
  const browserStore = new FeedbackStore(temporary.path);
  const action = (type: string, input: unknown) => executeBrowserAction(browserStore, { type, input });

  try {
    const created = action("create_feedback", {
      title: "Confusing invoice", description: "A buyer could not tell which fee was due today.",
      source: "interview", customer: "North team",
    }) as FeedbackDetail;
    assert.equal(created.status, "new");
    assert.equal(created.version, 1);
    assert.equal(created.events[0]?.actor, "user");

    const agentList = runAgentAction("list_feedback", { search: "invoice", status: "new" }, temporary.path) as FeedbackDetail[];
    assert.equal(agentList.length, 1);
    assert.equal(agentList[0]?.id, created.id);
    const agentDetail = runAgentAction("get_feedback", { id: created.id }, temporary.path) as FeedbackDetail;
    assert.equal(agentDetail.description, created.description);

    const changed = runAgentAction("update_feedback", {
      id: created.id, expectedVersion: created.version, changes: { status: "reviewing", priority: "high" },
    }, temporary.path) as FeedbackDetail;
    assert.equal(changed.version, 2);
    assert.equal(changed.events[0]?.actor, "agent");

    const noted = action("add_note", { id: created.id, body: "Ask for a screenshot of the fee summary." }) as FeedbackDetail;
    assert.equal(noted.version, 3);
    assert.equal(noted.notes[0]?.actor, "user");

    const context = runAgentAction("get_agent_context", { id: created.id }, temporary.path) as { brief: string };
    assert.match(context.brief, /high/);
    assert.match(context.brief, /Ask for a screenshot/);
    const browserDetail = action("get_feedback", { id: created.id }) as FeedbackDetail;
    assert.equal(browserDetail.events.length, 3);

    assert.throws(() => action("update_feedback", {
      id: created.id, expectedVersion: 1, changes: { status: "planned" },
    }), /Refresh/);
    assert.equal((action("get_feedback", { id: created.id }) as FeedbackDetail).status, "reviewing");
  } finally { browserStore.close(); temporary.clean(); }
});

test("feedback survives reopening and validates all write paths", () => {
  const temporary = tempDatabase();
  try {
    const first = new FeedbackStore(temporary.path);
    const created = first.create({ title: "A request", description: "Need an export.", source: "support" }, "user");
    first.close();
    const reopened = new FeedbackStore(temporary.path);
    assert.equal(reopened.get(created.id).title, "A request");
    reopened.close();

    assert.throws(() => parseAction({ type: "create_feedback", input: { title: "", description: "x", source: "manual" } }), /title is required/);
    assert.throws(() => parseAction({ type: "update_feedback", input: { id: created.id, expectedVersion: 1, changes: { unknown: "x" } } }), /not supported/);
    assert.throws(() => runAgentAction("add_note", { id: created.id, body: "   " }, temporary.path), /body is required/);
  } finally { temporary.clean(); }
});

test("every exposed UI capability has a CLI action and agent instructions", () => {
  const instructions = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  assert.equal(new Set(capabilities.map((entry) => entry.uiAction)).size, capabilities.length);
  assert.deepEqual(new Set(capabilities.map((entry) => entry.action)), new Set(actionNames));
  for (const capability of capabilities) {
    assert.ok(actionNames.includes(capability.action), capability.uiAction);
    assert.match(instructions, new RegExp(`\\b${capability.action}\\b`));
  }
});
