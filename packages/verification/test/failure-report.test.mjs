import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildFailureReport, ProtectedFeedbackRefused, reportDigest, sanitize, MAX_REPORT_BYTES } from "../src/failure-report.ts";

const identity = { workOrderId: "w", runId: "r", step: 1, candidateTree: "a".repeat(40) };
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function logs(t, entries) {
  const dir = mkdtempSync(join(tmpdir(), "factory-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return entries.map(([command, status, exitCode, text, reason = null, extra = {}], index) => {
    const logPath = join(dir, `check-${index}.log`);
    writeFileSync(logPath, text);
    return { command, status, exitCode, reason, logPath, ...extra };
  });
}

test("real Playwright rehearsal failures become bounded structured browser failures", async t => {
  const checks = logs(t, [["npm test", "failed", 1, fixture("playwright-rehearsal-run-1.log")]]);
  const report = await buildFailureReport({ identity, checks });
  assert.equal(report.outcome, "FAILED");
  assert.equal(report.failures.length, 3);
  assert(report.failures.every(f => f.kind === "BROWSER_TEST_FAILED"));
  const first = report.failures[0];
  assert.match(first.title, /\[desktop\] default shows failures/);
  assert.equal(first.location, "test/dashboard.spec.ts:36");
  assert(first.detail.some(line => line.includes("getByLabel('Status', { exact: true })")));
  assert.equal(report.failures[2].expected !== null || report.failures[2].message.length > 0, true);
  assert(Buffer.byteLength(JSON.stringify(report)) <= MAX_REPORT_BYTES);
  // Host paths, trace attachments and usage text are not agent-visible facts.
  const text = JSON.stringify(report);
  assert(!text.includes("/private/tmp"), "host path leaked");
  assert(!text.includes("trace.zip") && !text.includes("show-trace"));
});

test("select-option iteration failure yields expected and received values", async t => {
  const report = await buildFailureReport({ identity, checks: logs(t, [["npm test", "failed", 1, fixture("playwright-rehearsal-run-2.log")]]) });
  const failure = report.failures[0];
  assert.equal(failure.expected, '"failed"');
  assert.equal(failure.received, '"all"');
  assert.match(failure.location, /test\/dashboard\.spec\.ts:36/);
});

test("report digest is stable and binds identity", async t => {
  const checks = logs(t, [["npm test", "failed", 1, fixture("playwright-rehearsal-run-2.log")]]);
  const a = await buildFailureReport({ identity, checks });
  const b = await buildFailureReport({ identity, checks });
  assert.equal(a.digest, b.digest);
  const other = await buildFailureReport({ identity: { ...identity, step: 2 }, checks });
  assert.notEqual(a.digest, other.digest);
  const { digest, ...shell } = a;
  assert.equal(reportDigest(shell), digest);
});

test("failed TypeScript build is classified BUILD_FAILED with file, line and code", async t => {
  const text = "> build\n> tsc --noEmit\n\nsrc/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/health.ts(3,1): error TS2304: Cannot find name 'x'.\n";
  const report = await buildFailureReport({ identity, checks: logs(t, [["npm run build", "failed", 2, text]]) });
  assert.equal(report.outcome, "FAILED");
  assert.deepEqual(report.failures.map(f => [f.kind, f.location, f.title]), [
    ["BUILD_FAILED", "src/App.tsx:12", "TS2322"], ["BUILD_FAILED", "src/health.ts:3", "TS2304"]]);
});

test("node:test failures keep expected and actual values", async t => {
  const text = "TAP version 13\nnot ok 1 - rejects zero\n  ---\n  error: 'Expected values to be strictly equal'\n  expected: 1\n  actual: 0\n  location: 'test/a.test.mjs:3:1'\n  ...\n";
  const report = await buildFailureReport({ identity, checks: logs(t, [["node --test", "failed", 1, text]]) });
  assert.equal(report.failures[0].kind, "TEST_FAILED");
  assert.equal(report.failures[0].expected, "1");
  assert.equal(report.failures[0].received, "0");
});

test("runner crash, timeout and unavailable runner are UNKNOWN, never FAILED", async t => {
  for (const [reason, kind] of [["Check was killed at the configured resource limit", "RUNNER_CRASHED"],
    ["Check exceeded 300000 ms; container removal attempted", "TIMED_OUT"], ["Docker unavailable: daemon down", "RUNNER_CRASHED"]]) {
    const report = await buildFailureReport({ identity, checks: logs(t, [["npm test", "unavailable", 137, "", reason]]) });
    assert.equal(report.outcome, "UNKNOWN");
    assert.equal(report.failures[0].kind, kind);
  }
});

test("a successful command that ran no tests is a failure, not a pass", async t => {
  const report = await buildFailureReport({ identity, checks: logs(t, [["npx playwright test", "passed", 0, "Error: No tests found\n"]]) });
  assert.equal(report.outcome, "FAILED");
  assert.equal(report.failures[0].kind, "NO_TESTS_RAN");
});

test("passing checks produce a PASSED report with no failures", async t => {
  const report = await buildFailureReport({ identity, checks: logs(t, [["npm run build", "passed", 0, "ok"], ["npm test", "passed", 0, "3 passed"]]) });
  assert.equal(report.outcome, "PASSED");
  assert.deepEqual(report.failures, []);
});

test("protected verifier output is refused outright", async t => {
  const checks = logs(t, [["verify", "failed", 1, "secret holdout", null, { visibility: "PROTECTED" }]]);
  await assert.rejects(buildFailureReport({ identity, checks }), ProtectedFeedbackRefused);
});

test("failures in restricted paths are opaque even when the agent could infer content", async t => {
  const text = "Running 1 test using 1 worker\n\n  1) [desktop] › protected/holdout.spec.ts:4:1 › hidden expectation ─────\n\n    Error: expect(received).toBe(expected)\n    Expected: \"SECRET-ANSWER\"\n    Received: \"x\"\n\n  1 failed\n";
  const report = await buildFailureReport({ identity, checks: logs(t, [["npm test", "failed", 1, text]]), restrictedPathPrefixes: ["protected/"] });
  const body = JSON.stringify(report);
  assert(!body.includes("SECRET-ANSWER") && !body.includes("hidden expectation") && !body.includes("holdout.spec"));
  assert.equal(report.failures[0].location, null);
});

test("secrets and control characters are redacted from feedback", () => {
  const value = sanitize("token=sk-abcdefghijklmnopqrstuvwxyz Bearer abcdefghijklmnop FACTORY_GATEWAY_TOKEN=deadbeef \u001b[31mred\u001b[0m /Users/me/proj/src/App.tsx:3", 500);
  assert(!/sk-abc|abcdefghijklmnop|deadbeef|\u001b/.test(value));
  assert(value.includes("src/App.tsx:3") && !value.includes("/Users/me"));
});

test("an oversized failure set is shrunk below the byte bound and flagged truncated", async t => {
  let text = "Running 40 tests using 1 worker\n\n";
  for (let i = 1; i <= 40; i++) text += `  ${i}) [desktop] › test/big.spec.ts:${i}:1 › case ${i} ${"x".repeat(150)} ─────\n\n    Error: expect(locator).toHaveText(expected) failed\n    Locator: ${"y".repeat(300)}\n    Expected: "${"e".repeat(300)}"\n    Received: "${"r".repeat(300)}"\n\n`;
  const report = await buildFailureReport({ identity, checks: logs(t, [["npm test", "failed", 1, text]]) });
  assert(Buffer.byteLength(JSON.stringify(report)) <= MAX_REPORT_BYTES);
  assert.equal(report.truncated, true);
  assert(report.failures.length >= 1);
});

test("a read-only or system-path failure of the environment is UNKNOWN, not a candidate defect", async t => {
  for (const text of ["error during build:\nError: ENOENT: no such file or directory, mkdir '/node_modules/.vite-temp'\n", "EROFS: read-only file system, open '/usr/x'\n", "Executable doesn't exist at /opt/q/browsers/ms-playwright/chromium-1/chrome\n"]) {
    const report = await buildFailureReport({ identity, checks: logs(t, [["npm run build && npm test", "failed", 1, text]]) });
    assert.equal(report.outcome, "UNKNOWN", text);
    assert.equal(report.failures[0].kind, "RUNNER_CRASHED");
  }
});

test("a missing package is a candidate defect the agent can fix, not an environment failure", async t => {
  const report = await buildFailureReport({ identity, checks: logs(t, [["npm run build", "failed", 1, "src/App.tsx(1,1): error TS2307: Cannot find module 'left-pad' or its corresponding type declarations.\n"]]) });
  assert.equal(report.outcome, "FAILED");
  assert.equal(report.failures[0].kind, "BUILD_FAILED");
});

// ---- independent review findings (protected output, redaction, bound)
const wholeReport = r => JSON.stringify(r);

test("protected TAP and generic output never reaches the report, whatever the spelling", async t => {
  const tap = "not ok 1 - holdout case\n  ---\n  location: 'protected/holdout.test.mjs:4'\n  error: 'boom'\n  expected: 'SECRET-ANSWER'\n  actual: 'x'\n  ...\n";
  const checks = logs(t, [["node --test", "failed", 1, tap]]);
  const report = await buildFailureReport({ identity, checks });
  assert(!wholeReport(report).includes("SECRET-ANSWER"));
  assert(!wholeReport(report).includes("holdout.test.mjs"));
  assert.match(report.failures[0].message, /withheld/);
  for (const spelling of ["./protected/h.spec.ts", "/Users/a/b/protected/h.spec.ts", "PROTECTED\\h.spec.ts", "src/../holdout/x.ts"]) {
    const generic = logs(t, [["npm run check", "failed", 1, `Error: failed at ${spelling}:3\nexpected SECRET-ANSWER\n`]]);
    const out = await buildFailureReport({ identity, checks: generic });
    assert(!wholeReport(out).includes("SECRET-ANSWER"), spelling);
  }
});

test("explicit non-implementation visibility is refused, not filtered", async t => {
  const checks = logs(t, [["npm test", "failed", 1, "x", null, { visibility: "PROTECTED" }]]);
  await assert.rejects(buildFailureReport({ identity, checks }), ProtectedFeedbackRefused);
});

test("absolute host paths in parsed locations are redacted", async t => {
  const log = "Running 1 test using 1 worker\n  1) [desktop] › /Users/alice/private/project/test/a.spec.ts:12:5 › shows rows ─────\n\n    Error: expect(locator).toBeVisible()\n";
  const report = await buildFailureReport({ identity, checks: logs(t, [["npx playwright test", "failed", 1, log]]) });
  assert(!wholeReport(report).includes("/Users/alice"));
  assert(report.failures[0].location.startsWith("test/a.spec.ts"));
  const ts = await buildFailureReport({ identity, checks: logs(t, [["npm run build", "failed", 1, "/Users/alice/p/src/app.ts(3,1): error TS1005: ';' expected.\n"]]) });
  assert(!wholeReport(ts).includes("/Users/alice"));
});

test("the complete serialized report, digest included, never exceeds the bound", async t => {
  const huge = `${"x".repeat(7000)}.ts`;
  const log = `Running 1 test using 1 worker\n  1) [desktop] › ${huge}:1:1 › ${"t".repeat(6000)} ─────\n\n    Error: ${"m".repeat(9000)}\n`;
  const report = await buildFailureReport({ identity, checks: logs(t, [["npx playwright test", "failed", 1, log]]) });
  assert(Buffer.byteLength(JSON.stringify(report)) <= MAX_REPORT_BYTES, String(Buffer.byteLength(JSON.stringify(report))));
  assert.equal(report.truncated, true);
  const many = await buildFailureReport({ identity, checks: logs(t, Array.from({ length: 40 }, (_, i) => [`cmd ${i} ${"c".repeat(300)}`, "failed", 1, "Error: " + "e".repeat(2000)])) });
  assert(Buffer.byteLength(JSON.stringify(many)) <= MAX_REPORT_BYTES);
});

test("a zero-test run that exits 0 is not a pass", async t => {
  const report = await buildFailureReport({ identity, checks: logs(t, [["npx playwright test", "passed", 0, "Running 0 tests using 1 worker\n"]]) });
  assert.equal(report.outcome, "FAILED");
  assert.equal(report.failures[0].kind, "NO_TESTS_RAN");
});

test("colour codes around a restricted path never hide it", async t => {
  const log = "Running 1 test using 1 worker\n\n  1) [desktop] › \x1b[2mprotected/hidden.spec.ts\x1b[22m:4:1 › hidden ─────\n\n    Error: expect(received).toBe(expected)\n    Expected: \"SECRET-ANSWER\"\n    Received: \"x\"\n\n  1 failed\n";
  const report = await buildFailureReport({ identity, checks: logs(t, [["npx playwright test", "failed", 1, log]]) });
  assert(!JSON.stringify(report).includes("SECRET-ANSWER"));
  assert(!JSON.stringify(report).includes("hidden.spec"));
});

test("TAP and node:test zero-test passes are failures", async t => {
  for (const out of ["TAP version 13\n1..0\n# tests 0\n# pass 0\n", "ℹ tests 0\nℹ pass 0\nℹ fail 0\n"]) {
    const report = await buildFailureReport({ identity, checks: logs(t, [["node --test", "passed", 0, out]]) });
    assert.equal(report.outcome, "FAILED");
    assert.equal(report.failures[0].kind, "NO_TESTS_RAN");
  }
});

test("a restricted path anywhere in a large log withholds every detail, including the sampled tail", async t => {
  const middle = "x".repeat(300 * 1024);
  const log = "Running 1 test using 1 worker\n" + "a".repeat(260 * 1024) + "\n  at protected/hidden.spec.ts:4:1\n" + middle + "\n    Error: expect(received).toBe(expected)\n    Expected: \"SECRET-ANSWER\"\n    Received: \"x\"\n  1 failed\n";
  const report = await buildFailureReport({ identity, checks: logs(t, [["npx playwright test", "failed", 1, log]]) });
  assert(!JSON.stringify(report).includes("SECRET-ANSWER"));
});

test("Vitest/Jest permissive zero-test messages are not passes", async t => {
  for (const out of ["No test files found, exiting with code 0\n", "No test suites found.\n"]) {
    const report = await buildFailureReport({ identity, checks: logs(t, [["npm test", "passed", 0, out]]) });
    assert.equal(report.outcome, "FAILED", out);
  }
});

test("a verifier-truncated capture withholds every detail", async t => {
  const log = "Running 1 test using 1 worker\n" + "a".repeat(1000) + "\n[verification log truncated]\n\n[tail]\n    Error: expect(received).toBe(expected)\n    Expected: \"SECRET-ANSWER\"\n";
  const report = await buildFailureReport({ identity, checks: logs(t, [["npx playwright test", "failed", 1, log]]) });
  assert(!JSON.stringify(report).includes("SECRET-ANSWER"));
});

test("an environment failure anywhere in the complete log is UNKNOWN, not repairable", async t => {
  const log = "a".repeat(270 * 1024) + "\nENOENT: no such file or directory, mkdir '/node_modules/.vite-temp'\n" + "b".repeat(40 * 1024) + "\nError: build failed\n";
  const report = await buildFailureReport({ identity, checks: logs(t, [["npm run build", "failed", 1, log]]) });
  assert.equal(report.outcome, "UNKNOWN");
});

test("direct vitest/jest commands with permissive zero-test output are not passes", async t => {
  for (const [cmd, out] of [["npx vitest run --passWithNoTests", "No test files found, exiting with code 0\n"], ["npx jest --passWithNoTests", "No tests found, exiting with code 0\n"]]) {
    const report = await buildFailureReport({ identity, checks: logs(t, [[cmd, "passed", 0, out]]) });
    assert.equal(report.outcome, "FAILED", cmd);
  }
});
