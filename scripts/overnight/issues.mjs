// Nightly governed loop: pick tonight's issue by label and turn it into a bounded Work input.
//
// Labeling an issue `factory:overnight` is the owner's evening authorization; only
// accounts with triage access can apply labels. Issues must also be authored by an
// allowlisted login, because the repository is public.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)\.git(?:\/|$))[A-Za-z0-9_.\/*@-]+$/;

function labelNames(issue) {
  return (issue.labels ?? []).map((label) => typeof label === "string" ? label : label?.name).filter(Boolean);
}

/** Issue numbers already attempted on any night (live or dry runs that claimed nothing are ignored). */
export function attemptedIssues(ledger) {
  return new Set(Object.values(ledger?.nights ?? {}).filter((entry) => entry?.mode === "live")
    .map((entry) => entry.issue).filter(Number.isSafeInteger));
}

/**
 * Choose at most one eligible issue, oldest first. Returns the chosen issue (or null)
 * and a reason for every issue that was skipped, so the morning summary can explain.
 */
export function selectIssue(issues, { label, holdLabel, authors, ledger }) {
  const attempted = attemptedIssues(ledger);
  const skipped = [];
  const eligible = [];
  for (const issue of issues) {
    const labels = labelNames(issue);
    let reason = null;
    if (issue.pull_request) reason = "is a pull request";
    else if (issue.state !== "open") reason = "is not open";
    else if (!labels.includes(label)) reason = `lacks ${label}`;
    else if (holdLabel && labels.includes(holdLabel)) reason = `has ${holdLabel}`;
    else if (!authors.includes(issue.user?.login)) reason = "author is not allowlisted";
    else if (attempted.has(issue.number)) reason = "was already attempted on an earlier night";
    if (reason) skipped.push({ number: issue.number, reason });
    else eligible.push(issue);
  }
  eligible.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number);
  return { issue: eligible[0] ?? null, skipped };
}

/** Split a Markdown body into `## Heading` sections (lower-cased heading → text). */
export function sections(body) {
  const result = {};
  let current = null;
  // HTML comments (issue-template hints) never count as content or headings.
  const text = String(body ?? "").replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  for (const line of text.split("\n")) {
    const heading = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { current = heading[1].toLowerCase(); result[current] = []; continue; }
    if (current) result[current].push(line);
  }
  return Object.fromEntries(Object.entries(result).map(([key, lines]) => [key, lines.join("\n").trim()]));
}

function pick(parts, names) {
  for (const name of names) if (parts[name] !== undefined) return parts[name];
  return "";
}

/** Bullet items, checkbox items, or lines inside a fenced code block. */
export function listItems(text) {
  const items = [];
  let fenced = false;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (!line) continue;
    if (fenced) { items.push(line); continue; }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (bullet) items.push(bullet[1].replace(/^`(.+)`$/, "$1").trim());
  }
  return items.filter(Boolean);
}

/**
 * Map an issue to the Work input FactoryDispatchControl.prepare admits. Returns
 * `missing` instead of guessing when scope, acceptance or checks are absent: an
 * underspecified issue is reported in the morning summary, never dispatched.
 */
export function issueToWork(issue, { repository, repositoryPath, baseSha }) {
  const parts = sections(issue.body);
  const acceptanceCriteria = listItems(pick(parts, ["acceptance criteria", "acceptance"]));
  const allowedPaths = listItems(pick(parts, ["allowed paths", "scope", "files"]));
  const checkCommands = listItems(pick(parts, ["checks", "check commands", "tests"]));
  const reproduction = listItems(pick(parts, ["reproduction", "reproduction command"]))[0] ?? null;
  const expectedFailure = pick(parts, ["expected failure", "expected failure text"]).replace(/^`+|`+$/g, "").trim() || null;
  const labels = labelNames(issue);
  const kind = labels.includes("bug") && reproduction && expectedFailure ? "defect" : "feature";
  const missing = [];
  if (!acceptanceCriteria.length) missing.push("## Acceptance criteria");
  if (!allowedPaths.length) missing.push("## Allowed paths");
  if (!checkCommands.length) missing.push("## Checks");
  const unsafe = allowedPaths.filter((path) => !SAFE_PATH.test(path));
  if (unsafe.length) missing.push(`safe relative allowed paths (rejected: ${unsafe.join(", ")})`);
  if (allowedPaths.length > 100) missing.push("at most 100 allowed paths");
  if (checkCommands.length > 20) missing.push("at most 20 check commands");
  if (!/^[a-f0-9]{40}$/.test(baseSha ?? "")) missing.push("a resolved 40-character base commit");
  const objective = pick(parts, ["objective", "summary", "description"]) ||
    String(issue.body ?? "").split(/\n#{2,3}\s/)[0].trim() || issue.title;
  const description = [
    objective,
    "",
    `Source issue: https://github.com/${repository}/issues/${issue.number}`,
    "Requested through the MyFactory overnight loop; publication still requires owner approval.",
  ].join("\n");
  const input = {
    title: `[#${issue.number}] ${issue.title}`.slice(0, 200),
    description,
    kind,
    repositoryPath,
    baseRef: baseSha,
    acceptanceCriteria,
    reproductionCommand: kind === "defect" ? reproduction : null,
    expectedFailureText: kind === "defect" ? expectedFailure : null,
    checkCommands,
    allowedPaths,
    workerProfile: "mac",
  };
  return { ok: missing.length === 0, input, missing };
}

/** Read open issues carrying the label through the host's `gh` login (read-only). */
export async function listLabeledIssues({ repository, label }, runner = defaultGh) {
  const result = await runner(["api", "--hostname", "github.com", "--method", "GET", `repos/${repository}/issues`,
    "-f", "state=open", "-f", `labels=${label}`, "-f", "sort=created", "-f", "direction=asc", "-f", "per_page=50"]);
  if (result.exitCode !== 0) throw new Error("Could not list labeled GitHub issues; check the host gh login");
  const issues = JSON.parse(result.stdout);
  if (!Array.isArray(issues)) throw new Error("GitHub returned an invalid issue list");
  return issues;
}

async function defaultGh(args) {
  try {
    const { stdout, stderr } = await execFileAsync("gh", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 5_000_000,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return { exitCode: typeof error.code === "number" ? error.code : -1, stdout: error.stdout ?? "", stderr: error.stderr ?? String(error) };
  }
}
