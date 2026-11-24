import assert from "node:assert/strict";
import test from "node:test";
import { issueToWork, listItems, listLabeledIssues, sections, selectIssue } from "../../../scripts/overnight/issues.mjs";

const options = { label: "factory:overnight", holdLabel: "factory:hold", authors: ["jaydubya818"], ledger: {} };
const issue = (number, extra = {}) => ({
  number, state: "open", title: `Issue ${number}`, created_at: `2026-11-1${number % 10}T00:00:00Z`,
  user: { login: "jaydubya818" }, labels: [{ name: "factory:overnight" }], body: "", ...extra,
});
const sha = "a".repeat(40);
const body = `Make the overnight runbook easier to follow.

## Acceptance criteria
- [ ] The runbook lists every environment variable
- Each variable has a default

## Allowed paths
- \`docs/OVERNIGHT.md\`

## Checks
\`\`\`
node --test apps/supervisor/test/overnight-config.test.mjs
\`\`\`
`;

test("selects the oldest eligible issue and explains every skip", () => {
  const issues = [
    issue(3), issue(2),
    issue(4, { user: { login: "stranger" } }),
    issue(5, { labels: [{ name: "factory:overnight" }, { name: "factory:hold" }] }),
    issue(6, { pull_request: {} }),
    issue(7, { labels: [] }),
    issue(8, { state: "closed" }),
  ];
  const { issue: chosen, skipped } = selectIssue(issues, options);
  assert.equal(chosen.number, 2);
  assert.deepEqual(skipped.map((s) => s.number).sort(), [4, 5, 6, 7, 8]);
  assert.match(skipped.find((s) => s.number === 4).reason, /allowlisted/);
});

test("never re-attempts an issue a live night already consumed", () => {
  const ledger = { nights: { "2026-11-14": { mode: "live", issue: 2 }, "2026-11-13": { mode: "dry-run", issue: 3 } } };
  const { issue: chosen } = selectIssue([issue(2), issue(3)], { ...options, ledger });
  assert.equal(chosen.number, 3);
  assert.equal(selectIssue([issue(2)], { ...options, ledger }).issue, null);
});

test("parses sections and list items, including fenced commands", () => {
  const parts = sections(body);
  assert.deepEqual(Object.keys(parts), ["acceptance criteria", "allowed paths", "checks"]);
  assert.deepEqual(listItems(parts.checks), ["node --test apps/supervisor/test/overnight-config.test.mjs"]);
  assert.deepEqual(listItems(parts["allowed paths"]), ["docs/OVERNIGHT.md"]);
});

test("maps a complete issue to a bounded mac Work input", () => {
  const result = issueToWork(issue(9, { body }), { repository: "jaydubya818/MyFactory", repositoryPath: "/repo", baseSha: sha });
  assert.equal(result.ok, true);
  assert.equal(result.input.kind, "feature");
  assert.equal(result.input.workerProfile, "mac");
  assert.equal(result.input.baseRef, sha);
  assert.equal(result.input.title, "[#9] Issue 9");
  assert.deepEqual(result.input.acceptanceCriteria, ["The runbook lists every environment variable", "Each variable has a default"]);
  assert.match(result.input.description, /issues\/9/);
});

test("reports missing scope instead of guessing", () => {
  const result = issueToWork(issue(1, { body: "Please fix things." }), { repository: "a/b", repositoryPath: "/repo", baseSha: "main" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["## Acceptance criteria", "## Allowed paths", "## Checks", "a resolved 40-character base commit"]);
  const unsafe = issueToWork(issue(1, { body: body.replace("docs/OVERNIGHT.md", "../etc/passwd") }), { repository: "a/b", repositoryPath: "/repo", baseSha: sha });
  assert.equal(unsafe.ok, false);
  assert.match(unsafe.missing.join(" "), /rejected: \.\.\/etc\/passwd/);
});

test("a bug with reproduction and expected failure becomes a defect", () => {
  const bug = `${body}\n## Reproduction\n- npm test\n\n## Expected failure\n\`ENOENT\`\n`;
  const result = issueToWork(issue(1, { body: bug, labels: [{ name: "factory:overnight" }, { name: "bug" }] }), { repository: "a/b", repositoryPath: "/repo", baseSha: sha });
  assert.equal(result.input.kind, "defect");
  assert.equal(result.input.reproductionCommand, "npm test");
  assert.equal(result.input.expectedFailureText, "ENOENT");
});

test("lists labeled issues through a read-only gh call", async () => {
  let seen;
  const issues = await listLabeledIssues({ repository: "a/b", label: "factory:overnight" }, async (args) => {
    seen = args; return { exitCode: 0, stdout: JSON.stringify([issue(1)]), stderr: "" };
  });
  assert.equal(issues.length, 1);
  assert.ok(seen.includes("GET") && seen.includes("labels=factory:overnight"));
  await assert.rejects(listLabeledIssues({ repository: "a/b", label: "x" }, async () => ({ exitCode: 1, stdout: "", stderr: "" })), /gh login/);
});

test("the issue template's comments and empty bullets are ignored", async () => {
  const { readFileSync } = await import("node:fs");
  const template = readFileSync(new URL("../../../.github/ISSUE_TEMPLATE/factory-overnight.md", import.meta.url), "utf8")
    .split(/^---$/m).slice(2).join("---");
  const blank = issueToWork(issue(1, { body: template, labels: [{ name: "factory:overnight" }, { name: "bug" }] }), { repository: "a/b", repositoryPath: "/repo", baseSha: sha });
  assert.deepEqual(blank.missing, ["## Acceptance criteria", "## Allowed paths", "## Checks"]);
  assert.equal(blank.input.kind, "feature");
  const filled = template.replace("## Acceptance criteria\n- ", "## Acceptance criteria\n- Works")
    .replace("## Allowed paths\n<!-- Relative paths or globs the producer may change. Keep it to a few files. -->\n- ", "## Allowed paths\n- docs/x.md")
    .replace("## Checks\n<!-- Commands the independent verifier runs. They should finish in a few minutes. -->\n- ", "## Checks\n- npm test");
  const result = issueToWork(issue(1, { body: filled }), { repository: "a/b", repositoryPath: "/repo", baseSha: sha });
  assert.equal(result.ok, true, result.missing.join(", "));
  assert.deepEqual(result.input.allowedPaths, ["docs/x.md"]);
});

test("selection breaks created_at ties by issue number, accepts string labels and ignores bad ledger entries", () => {
  const same = "2026-11-10T00:00:00Z";
  const issues = [issue(12, { created_at: same }), issue(11, { created_at: same, labels: ["factory:overnight"] })];
  assert.equal(selectIssue(issues, options).issue.number, 11);
  const ledger = { nights: { a: { mode: "live", issue: "11" }, b: { mode: "live", issue: 1.5 }, c: null, d: { mode: "live" } } };
  assert.equal(selectIssue(issues, { ...options, ledger }).issue.number, 11);
  assert.equal(selectIssue([], options).issue, null);
});
