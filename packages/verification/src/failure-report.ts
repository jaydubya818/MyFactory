import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

/**
 * Bounded, structured development-test feedback.
 *
 * Input is ONLY the output of implementation-visible checks run by the host in a disposable
 * verification environment. The report is untrusted data for the coding agent and carries no
 * authority: it cannot widen scope, budget, operations or deadlines. Protected/holdout verifier
 * output must never be passed here; `visibility` is checked and restricted paths are opaque.
 */
export const FAILURE_REPORT_VERSION = "FACTORY_TEST_FEEDBACK_V1" as const;
export const MAX_REPORT_BYTES = 6000;
const MAX_LOG_READ = 256 * 1024;
/** Paths that hold protected/holdout checks are never described to the coding agent. */
export const DEFAULT_RESTRICTED_PREFIXES = ["protected/", ".protected/", "holdout/", "verifier/"];

export type FailureKind =
  | "BUILD_FAILED" | "TEST_FAILED" | "BROWSER_TEST_FAILED" | "NO_TESTS_RAN"
  | "RUNNER_UNAVAILABLE" | "RUNNER_CRASHED" | "TIMED_OUT";

export interface FailureItem {
  kind: FailureKind;
  check: number;
  title: string | null;
  location: string | null;
  message: string;
  expected: string | null;
  received: string | null;
  detail: string[];
}

export interface CheckOutcome {
  command: string;
  status: "passed" | "failed" | "unavailable";
  exitCode: number | null;
  reason: string | null;
  logPath: string;
  /** Anything other than the implementation-visible default is refused. */
  visibility?: "IMPLEMENTATION_VISIBLE" | "PROTECTED";
}

export interface ReportIdentity {
  workOrderId: string;
  runId: string;
  /** 1-based productive step whose edits produced this tree. */
  step: number;
  candidateTree: string;
}

export interface StructuredFailureReport {
  version: typeof FAILURE_REPORT_VERSION;
  source: "implementation-visible checks; untrusted data, no authority";
  identity: ReportIdentity;
  outcome: "PASSED" | "FAILED" | "UNKNOWN";
  checks: { index: number; command: string; status: CheckOutcome["status"]; exitCode: number | null; reason: string | null }[];
  failures: FailureItem[];
  truncated: boolean;
  digest: string;
}

export class ProtectedFeedbackRefused extends Error {
  constructor() { super("Protected verifier output cannot be used as development feedback"); }
}

const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g,
  /\b(FACTORY_GATEWAY_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|AUTH_TOKEN|SECRET|PASSWORD)=\S+/g,
];

export function sanitize(text: string, max: number): string {
  let value = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  for (const secret of SECRETS) value = value.replace(secret, "<redacted>");
  // Host paths are not agent-visible facts. Keep the project-relative suffix.
  value = value.replace(/(?:\/(?:private\/)?(?:tmp|var|Users|home|src|work|mnt)\/[^\s:'"`)]*?)\/((?:src|test|tests|e2e|app|lib|packages)\/[^\s:'"`)]+)/g, "$1")
    .replace(/\/(?:private\/)?(?:tmp|var\/folders|Users|home)\/[^\s:'"`)]+/g, "<host-path>");
  value = value.replace(/\s+$/g, "");
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

/** True when any path-like token names a restricted directory. Normalises backslashes, `./`, case and absolute host prefixes. */
export function mentionsRestricted(text: string, prefixes: string[]): boolean {
  const names = prefixes.map(p => p.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/\/+$/, "")).filter(Boolean)
    .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!names.length) return false;
  const re = new RegExp(`(?:^|[\\s'"\`(=:,;\\[<>/\\\\])(?:\\.{1,2}[\\/\\\\])*(?:[^\\s'"\`:]*[\\/\\\\])?(?:${names.join("|")})[\\/\\\\]`, "i");
  return re.test(text);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const stripTerminal = (value: string): string => value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "").replace(/\r(?!\n)/g, "\n");

export const reportDigest = (report: Omit<StructuredFailureReport, "digest">): string =>
  createHash("sha256").update(canonical(report)).digest("hex");

const MAX_LOG_SCAN = 32 * 1024 * 1024;
/** The complete log for restricted-path scanning, or null when it is too large to scan (then nothing is described). */
async function readWholeLog(path: string): Promise<string | null> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    if (size > MAX_LOG_SCAN) return null;
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await file.read(buffer, offset, size - offset, offset);
      if (bytesRead <= 0) return null; // a short read is an incomplete scan: withhold
      offset += bytesRead;
    }
    return buffer.toString("utf8");
  } finally { await file.close(); }
}
/** The verifier marks capture it could not retain; anything it dropped may have named a restricted path. */
/** Only a bare build invocation is exempt from test-output proof; anything chained or named otherwise must prove its output. */
const BUILD_ONLY_COMMAND = /^(?:npm|pnpm|yarn)\s+(?:run\s+)?build$|^npx\s+(?:tsc|vite\s+build)(?:\s+[^;&|]*)?$/i;
const CAPTURE_TRUNCATED = "[verification log truncated]";

async function readLog(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const head = Buffer.alloc(Math.min(size, MAX_LOG_READ));
    await file.read(head, 0, head.length, 0);
    let text = head.toString("utf8");
    if (size > head.length) {
      // Test summaries and the final stack are at the end; keep both ends.
      const tail = Buffer.alloc(Math.min(size - head.length, 32 * 1024));
      await file.read(tail, 0, tail.length, size - tail.length);
      text += "\n" + tail.toString("utf8");
    }
    return text;
  } finally { await file.close(); }
}

const PLAYWRIGHT_HEADER = /^\s*(\d+)\) (?:\[([^\]]+)\] › )?([^\s›]+\.[cm]?[tj]sx?):(\d+):(\d+) › (.*?)\s*─*\s*$/;
const PLAYWRIGHT_SIGNATURE = /Running \d+ tests? using|\bplaywright\b|\[(?:desktop|mobile|chromium|firefox|webkit|unit)\] ›|expect\(locator\)|Locator:/i;
/** Filesystem/system failures of the disposable environment itself. They say nothing about the candidate, so they are
 * UNKNOWN outcomes: never fed back to the agent and never a reason to spend. Missing packages are NOT listed here
 * (an unavailable dependency is a candidate defect the agent can fix). */
const ENVIRONMENT_FAILURE = /\bEROFS\b|read-only file system|\bENOSPC\b|ENOENT: no such file or directory, mkdir '\/(?:node_modules|usr|opt|etc|root|var)\b|EACCES: permission denied, (?:mkdir|open|mkdtemp|scandir) '\/(?:node_modules|usr|opt|etc|root|var)\b|Executable doesn't exist at \S*ms-playwright/;
const BUILD_COMMAND = /\b(build|tsc|typecheck|type-check|vite\s+build|next\s+build|webpack|esbuild|rollup)\b/i;

function parsePlaywright(text: string, check: number, protectedPrefixes: string[]): FailureItem[] {
  const lines = text.split(/\r?\n/);
  const items: FailureItem[] = [];
  let current: { header: RegExpExecArray; body: string[] } | null = null;
  const flush = (): void => {
    if (!current) return;
    const [, , project, file, line, , title] = current.header;
    const location = `${file}:${line}`;
    if (protectedPrefixes.some(prefix => file.startsWith(prefix))) {
      items.push({ kind: "BROWSER_TEST_FAILED", check, title: null, location: null, message: "A restricted check failed; details are withheld.", expected: null, received: null, detail: [] });
      current = null; return;
    }
    const body = current.body;
    const pick = (re: RegExp): string | null => {
      const hit = body.find(l => re.test(l));
      return hit ? sanitize(hit.replace(re, "").trim(), 400) : null;
    };
    const errorLine = body.find(l => /^\s*(?:Error:|Test timeout|TimeoutError|expect\()/i.test(l)) ?? body.find(l => l.trim()) ?? "Test failed";
    const detail: string[] = [];
    const locator = pick(/^\s*Locator:\s*/);
    if (locator) detail.push(`Locator: ${locator}`);
    const timeout = pick(/^\s*Timeout:\s*/);
    if (timeout) detail.push(`Timeout: ${timeout}`);
    const callIndex = body.findIndex(l => /^\s*Call log:/.test(l));
    if (callIndex >= 0) for (const l of body.slice(callIndex + 1).filter(x => x.trim()).slice(0, 3)) detail.push(sanitize(l.trim(), 200));
    const frame = body.find(l => /^\s*>\s*\d+\s*\|/.test(l));
    if (frame) detail.push(`Source: ${sanitize(frame.trim(), 200)}`);
    items.push({
      kind: "BROWSER_TEST_FAILED", check,
      title: sanitize(`${project ? `[${project}] ` : ""}${title}`, 240), location,
      message: sanitize(errorLine.trim(), 400),
      expected: pick(/^\s*Expected(?: string| value)?:\s*/), received: pick(/^\s*Received(?: string| value)?:\s*/),
      detail: detail.slice(0, 7),
    });
    current = null;
  };
  for (const raw of lines) {
    const header = PLAYWRIGHT_HEADER.exec(raw);
    if (header) { flush(); current = { header, body: [] }; continue; }
    if (current && /^\s*\d+ (?:failed|passed|flaky|skipped|did not run)\b/.test(raw)) { flush(); continue; }
    if (current && !/attachment #|trace\.zip|show-trace|^\s*Usage:|test-results\/|Error Context:|^\s*[─-]{20,}\s*$/.test(raw)) current.body.push(raw);
  }
  flush();
  return items;
}

function parseNodeTest(text: string, check: number): FailureItem[] {
  const items: FailureItem[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*not ok \d+ - (.+)$/.exec(lines[i]) ?? /^\s*✖ (.+?)(?: \([\d.]+ms\))?$/.exec(lines[i]);
    if (!m) continue;
    const window = lines.slice(i + 1, i + 25);
    const grab = (re: RegExp): string | null => { const l = window.find(x => re.test(x)); return l ? sanitize(l.replace(re, "").trim(), 300) : null; };
    items.push({ kind: "TEST_FAILED", check, title: sanitize(m[1], 240), location: grab(/^\s*location:\s*/)?.replace(/['"]/g, "") ?? null,
      message: grab(/^\s*error:\s*/) ?? "Test failed", expected: grab(/^\s*expected:\s*/), received: grab(/^\s*actual:\s*/), detail: [] });
    if (items.length >= 12) break;
  }
  return items;
}

function parseBuild(text: string, check: number): FailureItem[] {
  const items: FailureItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const ts = /^(?:\.\/)?([^\s(:]+)(?:\((\d+),(\d+)\)|:(\d+):(\d+))\s*[:-]\s*error (TS\d+): (.+)$/.exec(line);
    if (ts) {
      items.push({ kind: "BUILD_FAILED", check, title: ts[6], location: `${ts[1]}:${ts[2] ?? ts[4]}`, message: sanitize(ts[7], 300), expected: null, received: null, detail: [] });
    } else if (/(?:✘ \[ERROR\]|\bERROR\b|error during build:|Error: )/.test(line) && items.length < 8 && !items.some(i => i.message === sanitize(line.trim(), 300))) {
      items.push({ kind: "BUILD_FAILED", check, title: null, location: null, message: sanitize(line.trim(), 300), expected: null, received: null, detail: [] });
    }
    if (items.length >= 12) break;
  }
  return items;
}

/** Deterministic classification and extraction. No model, no network, no shell. */
export async function buildFailureReport(input: {
  identity: ReportIdentity;
  checks: CheckOutcome[];
  /** Path prefixes whose failures are reported only as opaque, detail-free items. */
  restrictedPathPrefixes?: string[];
}): Promise<StructuredFailureReport> {
  if (input.checks.some(check => (check.visibility ?? "IMPLEMENTATION_VISIBLE") !== "IMPLEMENTATION_VISIBLE")) throw new ProtectedFeedbackRefused();
  const restricted = [...DEFAULT_RESTRICTED_PREFIXES, ...(input.restrictedPathPrefixes ?? [])];
  const failures: FailureItem[] = [];
  let environmental = false;
  const checks: StructuredFailureReport["checks"] = [];
  for (const [index, check] of input.checks.entries()) {
    checks.push({ index, command: sanitize(check.command, 200), status: check.status, exitCode: check.exitCode, reason: check.reason ? sanitize(check.reason, 200) : null });
    if (check.status === "passed") {
      const rawWhole = await readWholeLog(check.logPath).catch(() => null);
      // Every passing check other than a pure build must prove its output; script names are not trusted to classify it.
      const isTestCommand = !BUILD_ONLY_COMMAND.test(check.command.trim());
      // Completeness is judged on the RAW capture, before terminal normalization can consume the trusted marker.
      if (rawWhole === null || rawWhole.includes(CAPTURE_TRUNCATED)) {
        // A passing test command whose complete output could not be inspected cannot prove that tests ran: UNKNOWN, never PASS.
        if (isTestCommand) {
          environmental = true;
          failures.push({ kind: "RUNNER_UNAVAILABLE", check: index, title: null, location: null, message: "The complete test output could not be inspected; the pass is unproven.", expected: null, received: null, detail: [] });
        }
        continue;
      }
      const text = stripTerminal(rawWhole);
      if (/No tests found|No test files found|No test suites found|Running 0 tests?\b|^\s*0 passed\b|^\s*1\.\.0\b|^\s*#\s*tests\s+0\b|^\s*ℹ\s+tests\s+0\b/im.test(text) && isTestCommand)
        failures.push({ kind: "NO_TESTS_RAN", check: index, title: null, location: null, message: "The test command exited successfully but ran no tests.", expected: null, received: null, detail: [] });
      continue;
    }
    if (check.status === "unavailable") {
      const reason = check.reason ?? "Check could not run";
      const kind: FailureKind = /exceeded|timeout/i.test(reason) ? "TIMED_OUT" : /killed|resource limit|executable is unavailable|read-only|docker/i.test(reason) ? "RUNNER_CRASHED" : "RUNNER_UNAVAILABLE";
      failures.push({ kind, check: index, title: null, location: null, message: sanitize(reason, 300), expected: null, received: null, detail: [] });
      continue;
    }
    // Terminal control sequences are removed BEFORE any path or diagnostic detection (colour codes can split a restricted path).
    const text = stripTerminal(await readLog(check.logPath).catch(() => ""));
    // The restricted-path scan covers the COMPLETE captured log, not the sampled excerpt; a log too large to scan is withheld.
    const wholeRaw = await readWholeLog(check.logPath).catch(() => null);
    const whole = wholeRaw === null ? null : stripTerminal(wholeRaw);
    // An environment failure is UNKNOWN whatever else the log contains (withholding below never downgrades it to repairable).
    const environmentFirst = whole === null ? null : ENVIRONMENT_FAILURE.exec(whole);
    if (environmentFirst) {
      environmental = true;
      failures.push({ kind: "RUNNER_CRASHED", check: index, title: null, location: null, message: "The test environment failed, not the candidate.", expected: null, received: null, detail: [] });
      continue;
    }
    // Withhold every detail unless the COMPLETE capture was scanned: an unreadable, short-read, oversized or verifier-truncated
    // log may hide a restricted path (the marker is checked on the RAW bytes). Any mention of a restricted path taints the log.
    if (whole === null || wholeRaw === null || wholeRaw.includes(CAPTURE_TRUNCATED) || whole.includes(CAPTURE_TRUNCATED) ||
        mentionsRestricted(wholeRaw, restricted) || mentionsRestricted(wholeRaw.replace(/[\u0000-\u001f\u007f]/g, ""), restricted) || mentionsRestricted(whole, restricted) || mentionsRestricted(text, restricted) || mentionsRestricted(check.command, restricted)) {
      failures.push({ kind: BUILD_COMMAND.test(check.command) ? "BUILD_FAILED" : "TEST_FAILED", check: index, title: null, location: null,
        message: "A restricted check failed; details are withheld.", expected: null, received: null, detail: [] });
      continue;
    }
    // Environment failures are classified from the complete log, never from the sample.
    const environment = ENVIRONMENT_FAILURE.exec(whole);
    if (environment) {
      environmental = true;
      failures.push({ kind: "RUNNER_CRASHED", check: index, title: null, location: null,
        message: sanitize(`The test environment failed, not the candidate: ${environment[0]}`, 300), expected: null, received: null, detail: [] });
      continue;
    }
    let found: FailureItem[] = [];
    if (PLAYWRIGHT_SIGNATURE.test(text)) found = parsePlaywright(text, index, restricted);
    if (!found.length) found = parseNodeTest(text, index);
    if (!found.length && BUILD_COMMAND.test(check.command)) found = parseBuild(text, index);
    if (!found.length) {
      const lines = text.split(/\r?\n/).filter(l => /error|fail|expected|received|cannot|unexpected/i.test(l)).slice(0, 8).map(l => sanitize(l.trim(), 240));
      found = [{ kind: BUILD_COMMAND.test(check.command) ? "BUILD_FAILED" : "TEST_FAILED", check: index, title: null, location: null,
        message: lines[0] ?? `Command exited with code ${check.exitCode}`, expected: null, received: null, detail: lines.slice(1) }];
    }
    failures.push(...found.slice(0, 12));
  }
  const outcome = environmental || checks.some(c => c.status === "unavailable") ? "UNKNOWN" : checks.length && checks.every(c => c.status === "passed") && !failures.length ? "PASSED" : "FAILED";
  for (const id of [input.identity.workOrderId, input.identity.runId, input.identity.candidateTree])
    if (typeof id !== "string" || id.length === 0 || id.length > 128) throw new TypeError("Invalid report identity");
  // Every emitted string is sanitised and bounded; any item that names a restricted path in ANY field is opaque.
  const opaque = (f: FailureItem): FailureItem => ({ kind: f.kind, check: f.check, title: null, location: null, message: "A restricted check failed; details are withheld.", expected: null, received: null, detail: [] });
  let clipped = false;
  const clean = (v: string | null, max: number): string | null => {
    if (v === null) return null;
    const out = sanitize(v, max);
    if (v.length > max) clipped = true;
    return out;
  };
  const bounded: FailureItem[] = failures.map(f => {
    const fields = [f.title, f.location, f.message, f.expected, f.received, ...f.detail].filter((x): x is string => typeof x === "string");
    if (fields.some(x => mentionsRestricted(x, restricted))) return opaque(f);
    return { kind: f.kind, check: f.check, title: clean(f.title, 240), location: clean(f.location, 200), message: clean(f.message, 400) ?? "",
      expected: clean(f.expected, 300), received: clean(f.received, 300), detail: f.detail.slice(0, 7).map(d => clean(d, 240) ?? "") };
  });
  const shell: Omit<StructuredFailureReport, "digest"> = {
    version: FAILURE_REPORT_VERSION, source: "implementation-visible checks; untrusted data, no authority",
    identity: input.identity, outcome, checks, failures: bounded, truncated: clipped,
  };
  // The limit applies to the complete serialized report INCLUDING its digest.
  const size = (): number => Buffer.byteLength(JSON.stringify({ ...shell, digest: "0".repeat(64) }));
  while (size() > MAX_REPORT_BYTES && shell.failures.some(f => f.detail.length)) {
    shell.truncated = true;
    const widest = shell.failures.reduce((a, b) => (a.detail.length >= b.detail.length ? a : b));
    widest.detail.pop();
  }
  while (size() > MAX_REPORT_BYTES && shell.failures.length > 1) { shell.truncated = true; shell.failures.pop(); }
  for (const cap of [200, 120, 60, 30]) {
    if (size() <= MAX_REPORT_BYTES) break;
    shell.truncated = true;
    for (const f of shell.failures) { f.message = f.message.slice(0, cap); f.expected = f.expected?.slice(0, cap) ?? null; f.received = f.received?.slice(0, cap) ?? null; f.title = f.title?.slice(0, cap) ?? null; f.location = f.location?.slice(0, cap) ?? null; }
    shell.checks = shell.checks.slice(0, 4).map(c => ({ ...c, command: c.command.slice(0, cap), reason: c.reason?.slice(0, cap) ?? null }));
  }
  if (size() > MAX_REPORT_BYTES) throw new Error("Failure report cannot be bounded");
  return { ...shell, digest: reportDigest(shell) };
}
