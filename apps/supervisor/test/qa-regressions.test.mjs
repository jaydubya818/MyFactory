/**
 * Regression tests for QA findings: QA-06, QA-07, QA-37.
 *
 * QA-06: Pause dispatch fails silently — covered by the front-end test; here we verify
 *        the server returns a visible error and does not drop the action.
 * QA-07: On non-macOS the server must return 503 "human_confirmation_unavailable"
 *        rather than 403 "human_confirmation_denied".
 * QA-37: FACTORY_START_PAUSED / startPaused option pauses dispatch on a brand-new desk.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { performAction, ActionError } from "../src/actions.ts";
import { openStorage } from "../../../packages/storage/src/index.ts";
import { createSupervisor } from "../src/server.ts";

// ---------------------------------------------------------------------------
// QA-07: human_confirmation_unavailable (503) vs human_confirmation_denied (403)
// ---------------------------------------------------------------------------

test("requireHumanPresence throws 503 unavailable when confirmHumanPresence is absent (QA-07)", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "factory-qa07-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const storage = openStorage(join(dataDir, "factory.sqlite"));
  t.after(() => storage.close());

  const context = {
    storage,
    // confirmHumanPresence is deliberately absent, simulating a non-darwin host.
    notify: () => {},
    startRun: async () => { throw new Error("unexpected"); },
    cancelRun: async () => { throw new Error("unexpected"); },
  };
  const human = { kind: "human", id: "reviewer" };

  const err = await performAction(context, "dispatch.set_paused", {
    paused: true,
    expectedRevision: storage.getPolicy().revision,
  }, human).then(() => null, (e) => e);

  assert.ok(err instanceof ActionError, "Should throw an ActionError");
  assert.equal(err.code, "human_confirmation_unavailable", "code must be unavailable, not denied");
  assert.equal(err.status, 503, "HTTP status must be 503, not 403");
  assert.match(err.message, /macOS|Mac|platform/i, "Error message should mention platform context");
});

test("requireHumanPresence throws 403 denied when confirmHumanPresence returns false (QA-07)", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "factory-qa07b-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const storage = openStorage(join(dataDir, "factory.sqlite"));
  t.after(() => storage.close());

  const context = {
    storage,
    confirmHumanPresence: async () => false,
    notify: () => {},
    startRun: async () => { throw new Error("unexpected"); },
    cancelRun: async () => { throw new Error("unexpected"); },
  };
  const human = { kind: "human", id: "reviewer" };

  const err = await performAction(context, "dispatch.set_paused", {
    paused: true,
    expectedRevision: storage.getPolicy().revision,
  }, human).then(() => null, (e) => e);

  assert.ok(err instanceof ActionError, "Should throw an ActionError");
  assert.equal(err.code, "human_confirmation_denied", "code must be denied when function returns false");
  assert.equal(err.status, 403, "HTTP status must be 403");
});

// ---------------------------------------------------------------------------
// QA-37: FACTORY_START_PAUSED / startPaused option
// ---------------------------------------------------------------------------

test("startPaused option pauses dispatch on a brand-new desk (QA-37)", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "factory-qa37-"));
  const host = createSupervisor({ dataDir, startPaused: true, linear: {} });
  t.after(async () => { await host.close(); rmSync(dataDir, { recursive: true, force: true }); });

  const policy = host.storage.getPolicy();
  assert.equal(policy.dispatchPaused, true, "Policy should be paused on a fresh desk when startPaused is set");
  assert.equal(policy.revision, 2, "Revision should have been incremented from 1 to 2 by startPaused");
});

test("startPaused option has no effect on a desk that has already been used (QA-37)", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "factory-qa37b-"));

  // First boot without startPaused — desk is active.
  {
    const host = createSupervisor({ dataDir, linear: {} });
    // Manually advance revision so it's no longer at 1.
    host.storage.setDispatchPaused(false, 1, "system-test");
    await host.close();
  }

  // Second boot with startPaused — should NOT reset to paused because revision > 1.
  const host = createSupervisor({ dataDir, startPaused: true, linear: {} });
  t.after(async () => { await host.close(); rmSync(dataDir, { recursive: true, force: true }); });

  const policy = host.storage.getPolicy();
  assert.equal(policy.dispatchPaused, false, "startPaused must not change policy on a used desk");
  assert.equal(policy.revision, 2, "Revision should stay at 2");
});

// ---------------------------------------------------------------------------
// QA-06: dispatch.set_paused action error is surfaced — server-side contract
// ---------------------------------------------------------------------------

test("dispatch.set_paused returns a visible ActionError when confirmation is unavailable (QA-06 server side)", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "factory-qa06-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const storage = openStorage(join(dataDir, "factory.sqlite"));
  t.after(() => storage.close());

  const context = {
    storage,
    // No confirmHumanPresence — simulates non-darwin.
    notify: () => {},
    startRun: async () => { throw new Error("unexpected"); },
    cancelRun: async () => { throw new Error("unexpected"); },
  };

  const err = await performAction(context, "dispatch.set_paused", {
    paused: true,
    expectedRevision: 1,
  }, { kind: "human", id: "reviewer" }).then(() => null, (e) => e);

  assert.ok(err instanceof ActionError, "Must throw ActionError");
  assert.equal(err.code, "human_confirmation_unavailable");
  // Policy must be unchanged — action was rejected.
  assert.equal(storage.getPolicy().dispatchPaused, false, "Policy must remain unchanged after rejected action");
});
