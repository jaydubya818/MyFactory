import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openStorage } from "../../../packages/storage/src/index.ts";
import { buildFailureReport } from "../../../packages/verification/src/failure-report.ts";
import { JobManager } from "../src/jobs.ts";
import { FEEDBACK_HARD_CAP, decideFeedback, feedbackKey, pinnedSession, usesBrowserProfile } from "../src/feedback-loop.ts";

const THREAD = "01a199df-cca4-7581-950f-74e365544d31";
const playwrightFailure = readFileSync(new URL("../../../packages/verification/test/fixtures/playwright-rehearsal-run-2.log", import.meta.url), "utf8");
const tsFailure = "> build\n> tsc --noEmit\n\nsrc/state.txt(1,1): error TS1005: ';' expected.\n";

// ---------------------------------------------------------------- pure decision rules
const report = async (overrides = {}, outcomeLog = playwrightFailure) => {
  const dir = mkdtempSync(join(tmpdir(), "factory-decide-"));
  const logPath = join(dir, "c.log");
  writeFileSync(logPath, outcomeLog);
  const r = await buildFailureReport({ identity: { workOrderId: "w", runId: "run", step: 1, candidateTree: "t".repeat(40), ...overrides },
    checks: [{ command: "npm test", status: overrides.status ?? "failed", exitCode: 1, reason: overrides.reason ?? null, logPath }] });
  rmSync(dir, { recursive: true, force: true });
  return r;
};
const ev = (type, payload, runId = "run") => ({ id: Math.random(), workOrderId: "w", runId, type, payload });
const base = { runId: "run", step: 1, currentTree: "t".repeat(40), policy: { authorized: true, maxRounds: 3 } };

test("a failing report on the current tree is offered to the same session once", async () => {
  const r = await report();
  const d = decideFeedback({ ...base, events: [], report: r });
  assert.equal(d.action, "RESUME");
  assert.equal(d.key, feedbackKey("run", 1, "t".repeat(40), r.digest));
});

test("stale candidate results are never fed back", async () => {
  const r = await report({ candidateTree: "z".repeat(40) });
  assert.deepEqual(decideFeedback({ ...base, events: [], report: r }), { action: "STOP", reason: "STALE_RESULT" });
  assert.equal(decideFeedback({ ...base, events: [], report: await report({ runId: "other" }) }).reason, "STALE_RESULT");
  assert.equal(decideFeedback({ ...base, step: 2, events: [], report: await report({ step: 1 }) }).reason, "STALE_RESULT");
});

test("duplicate delivery of the same feedback is suppressed, settled or not", async () => {
  const r = await report();
  const key = feedbackKey("run", 1, "t".repeat(40), r.digest);
  const requested = ev("feedback.resume_requested", { key });
  assert.equal(decideFeedback({ ...base, events: [requested], report: r }).reason, "DUPLICATE_FEEDBACK");
  assert.equal(decideFeedback({ ...base, events: [requested, ev("feedback.resume_settled", { key })], report: r }).reason, "DUPLICATE_FEEDBACK");
});

test("an unsettled earlier resume (crash/UNKNOWN) blocks any further paid resume", async () => {
  const r = await report({ step: 2 });
  const d = decideFeedback({ ...base, step: 2, events: [ev("feedback.resume_requested", { key: "other-key" })], report: r });
  assert.equal(d.reason, "UNSETTLED_PRIOR_RESUME");
});

test("UNKNOWN runner outcomes are terminal and unauthorized retry is refused", async () => {
  const unknown = await report({ status: "unavailable", reason: "Check was killed at the configured resource limit" });
  assert.equal(decideFeedback({ ...base, events: [], report: unknown }).reason, "UNKNOWN_OUTCOME");
  assert.equal(decideFeedback({ ...base, events: [], report: await report(), policy: { authorized: false, maxRounds: 3 } }).reason, "UNAUTHORIZED_RETRY");
});

test("authorized rounds and the hard cap bound the loop", async () => {
  const done = [1, 2, 3].flatMap(n => [ev("feedback.resume_requested", { key: `k${n}` }), ev("feedback.resume_settled", { key: `k${n}` })]);
  assert.equal(decideFeedback({ ...base, step: 4, events: done, report: await report({ step: 4 }) }).reason, "ROUNDS_EXHAUSTED");
  const many = Array.from({ length: FEEDBACK_HARD_CAP }, (_, n) => [ev("feedback.resume_requested", { key: `k${n}` }), ev("feedback.resume_settled", { key: `k${n}` })]).flat();
  assert.equal(decideFeedback({ ...base, step: 9, events: many, report: await report({ step: 9 }), policy: { authorized: true, maxRounds: 99 } }).reason, "ROUNDS_EXHAUSTED");
});

test("session is pinned once and a second identity is a conflict", () => {
  assert.equal(pinnedSession([], "run"), null);
  assert.equal(pinnedSession([ev("feedback.session_pinned", { threadId: THREAD })], "run"), THREAD);
  assert.equal(pinnedSession([ev("feedback.session_pinned", { threadId: THREAD }), ev("feedback.session_pinned", { threadId: "x" })], "run"), null);
  assert.equal(pinnedSession([ev("feedback.session_pinned", { threadId: THREAD }, "elsewhere")], "run"), null);
});

test("browser profile is selected only for browser suites", () => {
  assert(usesBrowserProfile(["npm run build", "npx playwright test"]));
  assert(usesBrowserProfile(["npm run test:browser"]));
  assert(!usesBrowserProfile(["node --test", "npm run build"]));
});

// ---------------------------------------------------------------- JobManager integration
function git(repo, ...args) { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim(); }

/** scenario: { verify(content, call) -> [{status, log, reason}], edits: [contentPerProductiveStep], threads, admit(n)->bool } */
async function run(t, scenario) {
  const reuse = scenario.reuse;
  const dir = reuse?.dir ?? mkdtempSync(join(tmpdir(), "factory-feedback-"));
  const repo = reuse?.repo ?? join(dir, "repo"), data = reuse?.data ?? join(dir, "data");
  let head = reuse?.head, storage = reuse?.storage;
  if (!reuse) {
    mkdirSync(join(repo, "src"), { recursive: true }); mkdirSync(data);
    execFileSync("git", ["init", "-q", repo]);
    git(repo, "config", "user.name", "Fixture"); git(repo, "config", "user.email", "f@example.invalid");
    writeFileSync(join(repo, "src/state.txt"), "initial\n");
    git(repo, "add", "."); git(repo, "commit", "-qm", "base");
    head = git(repo, "rev-parse", "HEAD");
    storage = openStorage(join(data, "factory.sqlite"));
  }
  const calls = { productive: [], completion: 0, verify: [], final: [], admit: 0 };
  const commands = scenario.commands ?? ["npm run build", "npm run test:browser"];
  const producer = {
    capture: () => ({}), finalize: () => ({}),
    snapshot: () => ({ version: 3, configuration: { model: "openai/gpt-5.4-mini", executorVersion: "fixture-1", timeoutMs: 60000, commands, verificationImage: "fixture:image", allowedPaths: ["src/**"] }, factoryVersion: "f".repeat(64) }),
  };
  const jobs = new JobManager(storage, data, event => scenario.onEvent?.(event), {
    resolveCommit: async () => head,
    createTaskWorktree: async () => repo,
    removeTaskWorktree: async () => {},
    preflightCodex: async () => ({ binaryAvailable: true, authenticated: true, version: "fixture-1", error: null }),
    runCodex: async input => {
      if (input.sandbox === "read-only") { calls.completion++; return { success: true, status: "completed", threadId: null, usage: null, eventsPath: "/tmp/e" }; }
      const n = calls.productive.length;
      calls.productive.push({ resume: input.resumeThreadId ?? null, prompt: input.prompt });
      if (scenario.interrupt?.(n)) throw new Error("agent process lost");
      const content = scenario.edits[Math.min(n, scenario.edits.length - 1)];
      writeFileSync(join(input.workspacePath, "src/state.txt"), content + "\n");
      return { success: true, status: "completed", threadId: scenario.threads && n < scenario.threads.length ? scenario.threads[n] : THREAD, usage: null, eventsPath: "/tmp/e" };
    },
    verifyWorkspaceTree: async input => {
      const content = git(repo, "show", `${input.tree}:src/state.txt`).trim();
      calls.verify.push({ content, profile: input.profile ?? "standard", image: input.image });
      if (scenario.mutateDuringCheck) writeFileSync(join(repo, "src/state.txt"), "mutated by someone else\n");
      const outcomes = scenario.verify(content, calls.verify.length);
      mkdirSync(input.artifactDir, { recursive: true });
      const checks = outcomes.map((o, i) => {
        const logPath = join(input.artifactDir, `check-${calls.verify.length}-${i}.log`);
        writeFileSync(logPath, o.log ?? "");
        return { candidateCommit: input.tree, candidateTree: input.tree, command: input.commands[i], status: o.status, exitCode: o.status === "passed" ? 0 : (o.exitCode ?? 1),
          startedAt: "2026-11-01T00:00:00Z", finishedAt: "2026-11-01T00:00:01Z", logPath, reason: o.reason ?? null };
      });
      return { candidateCommit: input.tree, candidateTree: input.tree, image: "fixture:image", checks, manifestPath: join(input.artifactDir, "m.json"), exportStatus: scenario.exportStatus ?? "ready", reason: null };
    },
    verifyCandidate: async input => {
      calls.final.push({ profile: input.profile ?? "standard" });
      mkdirSync(input.artifactDir, { recursive: true });
      const checks = input.commands.map((c, i) => { const logPath = join(input.artifactDir, `final-${i}.log`); writeFileSync(logPath, "ok"); return { candidateCommit: input.candidateSha, candidateTree: null, command: c, status: "passed", exitCode: 0, startedAt: "2026-11-01T00:00:00Z", finishedAt: "2026-11-01T00:00:01Z", logPath, reason: null }; });
      return { candidateCommit: input.candidateSha, candidateTree: null, image: "fixture:image", checks, manifestPath: join(input.artifactDir, "m.json"), exportStatus: "ready", reason: null };
    },
    ...(scenario.commitCandidate ? { commitCandidate: scenario.commitCandidate } : {}),
  }, producer, undefined, 1, !!scenario.retainCheckpoints);
  const order = reuse?.order ?? storage.createWorkOrder({ title: "Dashboard", description: "Make src/state.txt say good.", kind: "feature", repositoryPath: repo, baseRef: "HEAD",
    acceptanceCriteria: ["state is good"], reproductionCommand: null, expectedFailureText: null, checkCommands: commands, allowedPaths: ["src/**"], workerProfile: "mac" });
  const prepared = reuse?.prepared ?? await jobs.prepareRun(order);
  if (!reuse) storage.appendEvent({ workOrderId: order.id, runId: prepared.id, type: "factory.writer_bound", payload: { deadline: new Date(Date.now() + 600000).toISOString() } });
  const signal = new AbortController();
  const gateway = {
    baseUrl: "http://127.0.0.1:1/v1", childToken: "a".repeat(64), productiveEndSignal: signal.signal, close: async () => {},
    ...(scenario.noAdmission ? {} : { nextProductive: async () => { calls.admit++; if (scenario.admit && !scenario.admit(calls.admit)) throw new Error("Work ledger refused a further productive operation"); return { baseUrl: "http://127.0.0.1:1/v1", childToken: "b".repeat(64), productiveEndSignal: signal.signal }; } }),
    beginCompletion: async () => ({ baseUrl: "http://127.0.0.1:1/v1", childToken: "c".repeat(64) }), assertCompleted: () => {}, fenceAuthority: () => {},
  };
  const settledBefore = storage.listEvents(order.id).filter(e => e.type === "factory.execution_settled").length;
  assert.equal(jobs.executePrepared(order, prepared, () => true, gateway), true);
  const deadline = Date.now() + 20000;
  let events;
  while (Date.now() < deadline) { events = storage.listEvents(order.id); if (events.filter(e => e.type === "factory.execution_settled").length > settledBefore) break; await new Promise(r => setTimeout(r, 10)); }
  if (!reuse) t.after(async () => { await jobs.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  const type = name => events.filter(e => e.type === name);
  return { storage, order, run: storage.getRun(prepared.id), events, type, calls, jobs, world: { dir, repo, data, head, storage, order, prepared } };
}

const good = (content) => content === "good";
const buildFails = (content) => content === "good" ? [{ status: "passed" }, { status: "passed" }]
  : [{ status: "failed", log: tsFailure }, { status: "failed", log: playwrightFailure }];
const browserFails = (content) => content === "good" ? [{ status: "passed" }, { status: "passed" }]
  : [{ status: "passed" }, { status: "failed", log: playwrightFailure }];

test("failed browser test: structured feedback resumes the SAME session and the fix passes without a human", async t => {
  const r = await run(t, { edits: ["bad", "good"], verify: browserFails });
  assert.equal(r.run.state, "ready_for_review", JSON.stringify(r.type("run.failed")));
  assert.equal(r.calls.productive.length, 2);
  assert.equal(r.calls.productive[0].resume, null);
  assert.equal(r.calls.productive[1].resume, THREAD, "resumed the pinned coding session");
  assert.match(r.calls.productive[1].prompt, /HOST_IMPLEMENTATION_FEEDBACK/);
  assert.match(r.calls.productive[1].prompt, /BROWSER_TEST_FAILED/);
  assert.match(r.calls.productive[1].prompt, /Expected: .*|"failed"/);
  assert.equal(r.calls.admit, 1);
  assert.equal(r.calls.completion, 1);
  assert.deepEqual(r.calls.verify.map(v => v.profile), ["browser", "browser"]);
  assert.deepEqual(r.calls.final, [{ profile: "browser" }]);
  const [requested] = r.type("feedback.resume_requested");
  assert.equal(requested.payload.mode, "RESUME_SAME_SESSION");
  assert.equal(r.type("feedback.resume_settled").length, 1);
  assert.equal(r.type("feedback.stopped").length, 0);
  assert.equal(r.type("run.implementation_checkpoint").map(e => e.payload.passed).join(), "false,true");
});

test("failed build is detected and corrected through the same path", async t => {
  const r = await run(t, { edits: ["bad", "good"], verify: buildFails });
  assert.equal(r.run.state, "ready_for_review", String(r.run.failure));
  assert.match(r.calls.productive[1].prompt, /BUILD_FAILED/);
  assert.match(r.calls.productive[1].prompt, /TS1005/);
});

test("a first-pass candidate that passes never triggers feedback or a second paid operation", async t => {
  const r = await run(t, { edits: ["good"], verify: browserFails });
  assert.equal(r.run.state, "ready_for_review", String(r.run.failure));
  assert.equal(r.calls.productive.length, 1);
  assert.equal(r.calls.admit, 0);
  assert.equal(r.type("feedback.report_issued").length, 0);
});

test("budget exhaustion stops the loop; the ledger refusal is terminal and nothing is resent", async t => {
  const r = await run(t, { edits: ["bad"], verify: browserFails, admit: n => n <= 2 });
  assert.equal(r.run.state, "failed");
  assert.equal(r.calls.productive.length, 3, "two admitted resumes after the first response");
  assert.equal(r.calls.admit, 3);
  assert.equal(r.type("feedback.stopped").at(-1).payload.reason, "BUDGET_EXHAUSTED");
  assert.equal(r.calls.completion, 0);
  assert.equal(r.run.candidateCommit, null);
});

test("an unauthorized retry (no admission to fund another operation) is refused", async t => {
  const r = await run(t, { edits: ["bad"], verify: browserFails, noAdmission: true });
  assert.equal(r.run.state, "failed");
  assert.equal(r.calls.productive.length, 1);
  assert.equal(r.type("feedback.stopped")[0].payload.reason, "UNAUTHORIZED_RETRY");
});

test("test-runner crash or unavailable export is UNKNOWN: no feedback, no paid retry", async t => {
  const crash = await run(t, { edits: ["bad"], verify: () => [{ status: "passed" }, { status: "unavailable", exitCode: 137, reason: "Check was killed at the configured resource limit" }] });
  assert.equal(crash.run.state, "failed");
  assert.equal(crash.calls.productive.length, 1);
  assert.equal(crash.calls.admit, 0);
  assert.equal(crash.type("feedback.stopped")[0].payload.reason, "UNKNOWN_OUTCOME");
  const noExport = await run(t, { edits: ["bad"], verify: browserFails, exportStatus: "unavailable" });
  assert.equal(noExport.calls.productive.length, 1);
  assert.equal(noExport.type("feedback.stopped")[0].payload.reason, "UNKNOWN_OUTCOME");
});

test("workspace changed during the check is stale: no feedback is built from it", async t => {
  const r = await run(t, { edits: ["bad", "good"], verify: browserFails, mutateDuringCheck: true });
  assert.equal(r.run.state, "failed");
  assert.equal(r.calls.productive.length, 1);
  assert.equal(r.calls.admit, 0);
});

test("a resumed process that reports a different session is a SESSION_MISMATCH failure", async t => {
  const r = await run(t, { edits: ["bad", "good"], verify: browserFails, threads: [THREAD, "11111111-2222-4333-8444-555555555555"] });
  assert.equal(r.run.state, "failed");
  assert.equal(r.type("feedback.stopped").at(-1).payload.reason, "SESSION_MISMATCH");
  assert.equal(r.type("feedback.resume_settled").length, 1);
});

test("agent interruption during a resume leaves an UNSETTLED paid request that is never re-sent", async t => {
  const r = await run(t, { edits: ["bad", "good"], verify: browserFails, interrupt: n => n === 1 });
  assert.equal(r.run.state === "failed" || r.run.state === "interrupted", true, r.run.state);
  assert.equal(r.calls.productive.length, 2);
  assert.equal(r.type("feedback.resume_requested").length, 1);
  assert.equal(r.type("feedback.resume_settled").length, 0, "no settlement without a model result");
  // A restarted decider sees the unsettled request and refuses any new resume, for this or any other report.
  const stale = await report({ runId: r.run.id, step: 2, candidateTree: "q".repeat(40) });
  const d = decideFeedback({ events: r.events, runId: r.run.id, step: 2, currentTree: "q".repeat(40), report: stale, policy: { authorized: true, maxRounds: 3 } });
  assert.equal(d.action, "STOP");
  assert.match(d.reason, /UNSETTLED_PRIOR_RESUME|DUPLICATE_FEEDBACK/);
});

test("the same feedback report persisted twice resumes only once (idempotent by identity)", async t => {
  const r = await run(t, { edits: ["bad", "good"], verify: browserFails });
  const [issued] = r.type("feedback.report_issued");
  const [requested] = r.type("feedback.resume_requested");
  assert.equal(requested.payload.key, feedbackKey(r.run.id, 1, issued.payload.tree, issued.payload.digest));
  const again = decideFeedback({ events: r.events, runId: r.run.id, step: 1, currentTree: issued.payload.tree, report: issued.payload.report, policy: { authorized: true, maxRounds: 3 } });
  assert.deepEqual([again.action, again.reason], ["STOP", "DUPLICATE_FEEDBACK"]);
});

test("protected verifier checks never reach a feedback prompt", async t => {
  const holdout = "Running 1 test using 1 worker\n\n  1) [desktop] › protected/holdout.spec.ts:4:1 › hidden expectation ─────\n\n    Error: expect(received).toBe(expected)\n    Expected: \"SECRET-ANSWER\"\n    Received: \"x\"\n\n  1 failed\n";
  const r = await run(t, { edits: ["bad", "good"], verify: c => c === "good" ? [{ status: "passed" }, { status: "passed" }] : [{ status: "passed" }, { status: "failed", log: holdout }] });
  assert.equal(r.run.state, "ready_for_review", String(r.run.failure));
  assert(!r.calls.productive[1].prompt.includes("SECRET-ANSWER"));
  assert(!r.calls.productive[1].prompt.includes("hidden expectation"));
});

test("crash after the report but before admission: re-entry repeats only the free checkpoint and resumes the same session", async t => {
  let crashed = false;
  const first = await run(t, { edits: ["bad", "good"], verify: browserFails, onEvent: event => { if (event.type === "feedback.report_issued" && !crashed) { crashed = true; throw new Error("simulated host crash"); } } });
  assert.equal(first.calls.productive.length, 1);
  assert.equal(first.calls.admit, 0, "crash happened before any admission");
  assert.equal(first.type("feedback.resume_requested").length, 0);
  const second = await run(t, { edits: ["good"], verify: browserFails, reuse: first.world });
  assert.equal(second.run.state, "ready_for_review", String(second.run.failure));
  assert.equal(second.run.id, first.run.id, "same Work, same attempt");
  assert.equal(second.calls.productive.length, 1, "exactly one agent response after recovery");
  assert.equal(second.calls.productive[0].resume, THREAD);
  assert.equal(second.calls.admit, 1);
  assert.equal(second.type("run.agent_result").length, 2);
  assert.equal(second.type("feedback.resume_requested").length, 1);
});

test("re-entry with an unsettled paid resume is refused and nothing is sent", async t => {
  const first = await run(t, { edits: ["bad", "good"], verify: browserFails, interrupt: n => n === 1 });
  assert.equal(first.type("feedback.resume_requested").length, 1);
  assert.equal(first.type("feedback.resume_settled").length, 0);
  const second = await run(t, { edits: ["good"], verify: browserFails, reuse: first.world });
  assert.equal(second.calls.productive.length, 0, "no second paid send");
  assert.equal(second.calls.admit, 0);
  assert.equal(second.type("feedback.stopped").at(-1).payload.reason, "UNSETTLED_PRIOR_RESUME");
  assert.notEqual(second.run.state, "ready_for_review");
});

test("a loop that already stopped cannot be restarted into more spend", async t => {
  const first = await run(t, { edits: ["bad"], verify: browserFails, admit: n => n <= 1 });
  assert.equal(first.type("feedback.stopped").at(-1).payload.reason, "BUDGET_EXHAUSTED");
  const second = await run(t, { edits: ["good"], verify: browserFails, reuse: first.world });
  assert.equal(second.calls.productive.length, 0);
  assert.equal(second.calls.admit, 0);
  assert.notEqual(second.run.state, "ready_for_review");
});

test("a first response without a session identity cannot be resumed: SESSION_MISMATCH and zero admissions", async t => {
  const r = await run(t, { edits: ["bad", "good"], verify: browserFails, threads: [null, null] });
  assert.equal(r.run.state, "failed");
  assert.equal(r.calls.admit, 0, "no paid operation is funded without a pinned session");
  assert.equal(r.calls.productive.length, 1);
  assert.equal(r.type("feedback.stopped").at(-1).payload.reason, "SESSION_MISMATCH");
});

test("a zero-test run that exits 0 is a failure fed back, not a pass", async t => {
  const zero = { status: "passed", log: "Running 0 tests using 1 worker\n" };
  const r = await run(t, { edits: ["bad", "good"], verify: c => c === "good" ? [{ status: "passed" }, { status: "passed", log: "Running 1 test using 1 worker\n  1 passed\n" }] : [{ status: "passed" }, zero] });
  assert.equal(r.run.state, "ready_for_review", String(r.run.failure));
  assert.equal(r.calls.productive.length, 2);
  assert.match(r.calls.productive[1].prompt, /NO_TESTS_RAN/);
});

test("UNKNOWN outcome followed by a host restart stays stopped and sends nothing", async t => {
  const first = await run(t, { edits: ["bad"], verify: () => [{ status: "passed" }, { status: "unavailable", exitCode: 137, reason: "killed at the resource limit" }] });
  assert.equal(first.type("feedback.stopped")[0].payload.reason, "UNKNOWN_OUTCOME");
  const second = await run(t, { edits: ["good"], verify: browserFails, reuse: first.world });
  assert.equal(second.calls.productive.length, 0);
  assert.equal(second.calls.admit, 0);
  assert.notEqual(second.run.state, "ready_for_review");
});

test("checkpoint creation never overwrites a candidate assigned concurrently and reports only what it wrote", async t => {
  let storageRef, runIdRef;
  const diff = join(mkdtempSync(join(tmpdir(), "factory-ckpt-")), "d.patch"); writeFileSync(diff, "diff\n");
  const r = await run(t, { edits: ["bad"], verify: browserFails, interrupt: n => n === 1, retainCheckpoints: true,
    commitCandidate: async () => {
      storageRef.saveRun({ ...storageRef.getRun(runIdRef), candidateCommit: "c".repeat(40) });
      return { commit: "b".repeat(40), tree: "t".repeat(40), diffPath: diff, changedPaths: [] };
    } });
  storageRef = r.storage; runIdRef = r.run.id;
  storageRef.saveRun({ ...r.storage.getRun(r.run.id), state: "interrupted", candidateCommit: null });
  const receipt = await r.jobs.checkpointForRecovery(r.run.id);
  assert.equal(storageRef.getRun(r.run.id).candidateCommit, "c".repeat(40), "the concurrent candidate survives");
  assert.equal(receipt.candidateCommit, null);
  assert.equal(receipt.events.length, 1);
  const rows = storageRef.listEvents(r.order.id).filter(e => receipt.eventIds.includes(e.id));
  assert.deepEqual(rows.map(e => e.type), ["run.checkpoint_unavailable"]);
  assert.equal(rows[0] && receipt.events[0].digest.length, 64);
  assert.equal(storageRef.listEvents(r.order.id).filter(e => e.type === "run.candidate_committed").length, 0, "the aborted write left no candidate event");
});

test("an unavailable checkpoint persisted before a crash stays UNKNOWN on re-entry even if the next check merely fails", async t => {
  let crashed = false;
  const first = await run(t, { edits: ["bad", "good"], verify: () => [{ status: "passed" }, { status: "unavailable", exitCode: 137, reason: "killed" }],
    onEvent: event => { if (event.type === "run.implementation_checkpoint" && !crashed) { crashed = true; throw new Error("simulated host crash"); } } });
  assert.equal(first.type("run.implementation_checkpoint").length, 1, "crash landed at the checkpoint");
  const second = await run(t, { edits: ["good"], verify: browserFails, reuse: first.world });
  assert.equal(second.calls.productive.length, 0);
  assert.equal(second.calls.admit, 0);
  assert.equal(second.type("feedback.stopped").at(-1).payload.reason, "UNKNOWN_OUTCOME");
  assert.notEqual(second.run.state, "ready_for_review");
});

test("a resumed response that carries no session identity is a SESSION_MISMATCH, never accepted", async t => {
  const r = await run(t, { edits: ["bad", "good"], verify: browserFails, threads: [THREAD, null] });
  assert.equal(r.run.state, "failed");
  assert.equal(r.type("feedback.stopped").at(-1).payload.reason, "SESSION_MISMATCH");
  assert.equal(r.calls.completion, 0);
});

test("an environment-level UNKNOWN recorded before a crash stays terminal on re-entry", async t => {
  let crashed = false;
  const envFail = "ENOENT: no such file or directory, mkdir '/node_modules/.vite-temp'\n";
  const first = await run(t, { edits: ["bad", "good"], verify: () => [{ status: "failed", log: envFail }, { status: "passed" }],
    onEvent: event => { if (event.type === "run.implementation_checkpoint" && !crashed) { crashed = true; throw new Error("simulated host crash"); } } });
  assert.equal(first.type("feedback.report_issued").filter(e => e.payload.outcome === "UNKNOWN").length, 1, "UNKNOWN made durable before the checkpoint");
  const second = await run(t, { edits: ["good"], verify: browserFails, reuse: first.world });
  assert.equal(second.calls.productive.length, 0);
  assert.equal(second.calls.admit, 0);
  assert.equal(second.type("feedback.stopped").at(-1).payload.reason, "UNKNOWN_OUTCOME");
});

test("re-entry after a process started but before its result never starts a fresh session", async t => {
  const first = await run(t, { edits: ["bad", "good"], verify: browserFails, interrupt: n => n === 0 });
  assert.equal(first.type("run.agent_result").length, 0);
  // The real adapter writes this durable row when the coding process starts; the crash landed before its result.
  first.storage.appendEvent({ workOrderId: first.order.id, runId: first.run.id, type: "agent.process_started", payload: { pid: 999999 } });
  const second = await run(t, { edits: ["good"], verify: browserFails, reuse: first.world });
  assert.equal(second.calls.productive.length, 0, "no fresh, unadmitted session");
  assert.equal(second.calls.admit, 0);
  const stop = second.type("feedback.stopped").at(-1);
  assert.equal(stop.payload.reason, "UNSETTLED_PRIOR_RESUME");
  assert.equal(stop.payload.unmatchedProcesses, 1);
});
