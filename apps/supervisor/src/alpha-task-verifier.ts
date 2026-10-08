import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VerifierRunner, Workspace, RunResult } from "./alpha-task-runner.ts";

/*
 * Independent acceptance policy for the "Alpha Tasks / Priority" external-alpha task.
 *
 * Separation of duties:
 *  - the HOST (jobs.ts) runs the bounded repository checks it always ran;
 *  - this policy is the protected, independent verifier. It receives only exact,
 *    digest-bound source and candidate trees plus the verifier's own custody
 *    material. The producer's report is hashed for audit and NEVER consulted.
 *  - hidden acceptance material (probe + suite) lives in verifier custody, is
 *    loaded once from bytes whose digest is pinned in this file, and is never
 *    given to the producer or printed in producer-visible output.
 *  - candidate code only ever runs inside a VerifierRunner (separate process,
 *    permission-confined); expectations are evaluated here, not in that process.
 *  - a green build is never a PASS. Anything unsupported or unproven is PARTIAL.
 */

export type Verdict = "PASS" | "FAIL" | "PARTIAL";
export type CheckStatus = "PASS" | "FAIL" | "INCONCLUSIVE" | "NOT_APPLICABLE" | "NOT_RUN";
export interface Tree { commit: string; tree: string; files: Record<string, string> }
export interface CheckResult { id: string; criteria: number[]; status: CheckStatus; code: string; evidence?: Record<string, unknown> }
export interface CriterionResult { id: number; title: string; status: "PASS" | "FAIL" | "NOT_VERIFIED"; checks: string[] }
export interface AcceptanceReport {
  policyId: string; policySha256: string; hiddenSuiteSha256: string; verdict: Verdict;
  criteria: CriterionResult[]; checks: CheckResult[];
  identities: { sourceCommit: string; sourceTree: string; candidateCommit: string; candidateTree: string; runner: string };
  separation: { producerEnvironmentId: string; verifierEnvironmentId: string; producerReportConsulted: false; producerReportSha256: string | null };
  notApplicable: string[]; inconclusive: { check: string; code: string }[];
}
export interface AlphaTaskInput {
  source: Tree; candidate: Tree & { parent: string };
  /** Identities the HOST recorded independently of the producer. */
  expected: { sourceCommit: string; sourceTree: string; candidateCommit: string; candidateTree: string };
  producer: { environmentId: string; report?: unknown };
  verifier: { environmentId: string };
  /** Effects the host observed (not the producer's claim). */
  observedEffects?: string[];
  runner: VerifierRunner;
  hidden: HiddenSuite;
  /** Upper bound for any single candidate process (tests use small values to prove timeout handling). */
  limits?: { runMs?: number };
  /**
   * 'production' (the cloud verifier) NEVER trusts the runner's own self-test: it requires a host-built isolation
   * attestation for a runner on the production allow-list. Without one the verdict is PARTIAL. 'local' (default) is the
   * developer/CI mode that relies on the live self-test of the local permission-model runner.
   */
  mode?: "local" | "production";
  isolationAttestation?: IsolationAttestation;
  /** Host deployment profile. Never supplied by a Work or candidate. Exact private tree is pinned outside this repository. */
  productionProfile?: { id: "alpha-tasks-node-json-v1"; kind: "PRODUCT"; tree: string };
  /** Test seam only; production uses the module-level profile tables. */
  profiles?: { supported?: typeof supportedBaseTrees; unsupported?: typeof unsupportedBaseTrees };
}

export const policyId = "alpha-tasks-priority-acceptance-v1";
export const CRITERIA: Record<number, string> = {
  1: "Existing tasks still display and function", 2: "Create/edit supports Low, Medium, High", 3: "Priority persists after reload",
  4: "Task list displays each task's priority", 5: "Invalid priority values are rejected", 6: "Existing tests continue to pass",
  7: "Focused automated tests cover creation, editing, persistence, display and invalid input", 8: "No unrelated product or UI changes",
  9: "No production deployment or external publication", 10: "Independent verifier checks the exact resulting source/artifact",
};

// ---- production runner isolation ------------------------------------------------------------------
/**
 * What a production runner must provide (see docs/private-alpha/external-alpha-verifier-isolation.md):
 *  - a DISPOSABLE sandbox/microVM separate from the producer's, created with a platform-enforced deny-all egress policy
 *    that the host reads back after creation (process-level or sandbox-exec network denial is not sufficient);
 *  - candidate code runs as an unprivileged uid with only the workspace readable and a scratch directory writable,
 *    with the Node permission model on, and no visibility of other processes' argv/env (the hidden probe and scenarios
 *    never exist in a file or process argument the candidate can read);
 *  - scrubbed environment (no credential names/values), bounded wall clock, output and process count;
 *  - destroyed after the verdict, cleanup confirmed by the host.
 * The host (not the runner, not the candidate) builds this attestation from what it created and read back.
 */
export interface IsolationAttestation {
  runnerId: string; kind: "SANDBOX_DENY_ALL_V1"; networkPolicy: "deny-all"; filesystem: "UNPRIVILEGED_UID_WORKSPACE_READ_SCRATCH_WRITE";
  environment: "SCRUBBED"; hiddenMaterialVisibleToCandidate: false; disposable: true; image: string; sessionId: string; attestedBy: "factory-host";
}
/** The only runner ids accepted in production mode. The local macOS/permission-model runner is deliberately absent. */
export const productionRunnerIds: readonly string[] = ["vercel-sandbox-verifier-v1"];
export function attestationValid(a: unknown, runner: { id: string } | undefined): a is IsolationAttestation {
  const x = a as Partial<IsolationAttestation> | undefined;
  return !!x && typeof x === "object" && Object.keys(x).sort().join(",") === "attestedBy,disposable,environment,filesystem,hiddenMaterialVisibleToCandidate,image,kind,networkPolicy,runnerId,sessionId" &&
    x.kind === "SANDBOX_DENY_ALL_V1" && x.networkPolicy === "deny-all" && x.filesystem === "UNPRIVILEGED_UID_WORKSPACE_READ_SCRATCH_WRITE" && x.environment === "SCRUBBED" &&
    x.hiddenMaterialVisibleToCandidate === false && x.disposable === true && x.attestedBy === "factory-host" &&
    typeof x.image === "string" && /^[A-Za-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(x.image) && typeof x.sessionId === "string" && /^sbx_[A-Za-z0-9_-]+$/.test(x.sessionId) &&
    !!runner && x.runnerId === runner.id && productionRunnerIds.includes(runner.id);
}

// ---- supported base trees ------------------------------------------------------------------------
/**
 * The verifier supports exactly the base trees it has a profile for (stack: Node ESM, JSON file store,
 * node:test; evidence in docs). Private product trees use an exact host deployment profile. Unprofiled trees are PARTIAL.
 */
export const supportedBaseTrees: Record<string, { id: string; kind: "QUALIFICATION_FIXTURE" | "PRODUCT" }> = {
  // Synthetic reference "Alpha Tasks" base used to qualify this verifier (apps/supervisor/test/fixtures/alpha-tasks).
  "5f354fb5032259dda67abddf5e4164c918dddaed": { id: "alpha-tasks-reference-fixture-v1", kind: "QUALIFICATION_FIXTURE" },
};
/**
 * Known-unsupported base trees with a precise reason. This public repository intentionally lists none: the real
 * alpha workspace trees are deploy-time identities, and ANY tree without a supported profile is PARTIAL
 * (UNSUPPORTED_BASE_TREE) regardless of whether it is listed here.
 */
export const unsupportedBaseTrees: Record<string, string> = {};

// ---- helpers --------------------------------------------------------------------------------------
const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const objectId = (kind: string, bytes: Buffer): string => createHash("sha1").update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
/** Git tree id of a regular-file tree (same algorithm as git; verified against git in tests). */
export function gitTreeId(files: Record<string, string>): string {
  const level = (prefix: string): { sha: string; bytes: Buffer } => {
    const children = new Map<string, boolean>();
    for (const path of Object.keys(files).filter((p) => p.startsWith(prefix))) { const rest = path.slice(prefix.length); children.set(rest.split("/")[0]!, rest.includes("/")); }
    const entries = [...children].sort(([a, ad], [b, bd]) => Buffer.compare(Buffer.from(a + (ad ? "/" : "")), Buffer.from(b + (bd ? "/" : ""))));
    const bytes = Buffer.concat(entries.flatMap(([name, dir]) => [Buffer.from(`${dir ? "40000" : "100644"} ${name}\0`),
      Buffer.from(dir ? level(prefix + name + "/").sha : objectId("blob", Buffer.from(files[prefix + name]!)), "hex")]));
    return { sha: objectId("tree", bytes), bytes };
  };
  return level("").sha;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
const validTree = (t: Tree): boolean => !!t && /^[0-9a-f]{40}$/.test(t.commit) && /^[0-9a-f]{40}$/.test(t.tree) && !!t.files && typeof t.files === "object" &&
  Object.entries(t.files).every(([p, c]) => typeof c === "string" && p.length > 0 && p.length < 200 && !p.startsWith("/") && !p.includes("\\") && !p.includes("\0") &&
    p.split("/").every((x) => x !== "" && x !== "." && x !== ".." && x.toLowerCase() !== ".git")) && Object.keys(t.files).length <= 200;

// ---- hidden suite custody -------------------------------------------------------------------------
export interface HiddenSuite {
  sha256: string; probeSource: string;
  scenarios: Record<string, unknown[]>;
  evaluators: Record<string, (r: ({ ok: boolean; value?: unknown } | undefined)[]) => { pass: boolean; inconclusive?: boolean; code: string }>;
  uiEvaluators: Record<string, (b: ({ ok: boolean; value?: unknown } | undefined)[], c: ({ ok: boolean; value?: unknown } | undefined)[]) => { pass: boolean; code: string }>;
}
export const HIDDEN_SUITE_SHA256 = "690974d8af56581a94807c202545957806f19f030c4fefeb519dcba47e35b4f6";
/** Custody lives OUTSIDE this (public) repository: a control-plane-only directory or private blob materialization. */
export const hiddenSuiteDirectory = (): string | undefined => {
  const base = process.env.FACTORY_VERIFIER_CUSTODY_DIR;
  return base ? join(base, "alpha-tasks-v1") : undefined;
};
/** Reads each custody file ONCE, checks the pinned digest on those exact bytes, and imports from those same bytes. */
export async function loadHiddenSuite(directory = hiddenSuiteDirectory(), pinned = HIDDEN_SUITE_SHA256): Promise<HiddenSuite> {
  if (!directory && process.env.FACTORY_EXTERNAL_ALPHA_VERIFIER_CUSTODY_JSON) return loadHiddenSuiteSecret(process.env.FACTORY_EXTERNAL_ALPHA_VERIFIER_CUSTODY_JSON, pinned);
  if (!directory) throw new Error("VERIFIER_CUSTODY_UNAVAILABLE");
  const probe = await readFile(join(directory, "probe.mjs")), suite = await readFile(join(directory, "suite.mjs"));
  return loadHiddenSuiteBytes(probe, suite, pinned);
}
/** Hosted control-plane secret only. It is never passed to sandbox allocation, source, prompts, or candidate commands. */
export async function loadHiddenSuiteSecret(text: string, pinned = HIDDEN_SUITE_SHA256): Promise<HiddenSuite> {
  if (typeof text !== "string" || Buffer.byteLength(text) > 65536) throw Error("VERIFIER_CUSTODY_DIGEST_MISMATCH");
  let value: { probeBase64?: string; suiteBase64?: string }; try { value = JSON.parse(text); } catch { throw Error("VERIFIER_CUSTODY_DIGEST_MISMATCH"); }
  if (!value || Object.keys(value).sort().join(",") !== "probeBase64,suiteBase64" || typeof value.probeBase64 !== "string" || typeof value.suiteBase64 !== "string") throw Error("VERIFIER_CUSTODY_DIGEST_MISMATCH");
  const probe = Buffer.from(value.probeBase64, "base64"), suite = Buffer.from(value.suiteBase64, "base64");
  if (probe.toString("base64") !== value.probeBase64 || suite.toString("base64") !== value.suiteBase64) throw Error("VERIFIER_CUSTODY_DIGEST_MISMATCH");
  return loadHiddenSuiteBytes(probe, suite, pinned);
}
async function loadHiddenSuiteBytes(probe: Buffer, suite: Buffer, pinned: string): Promise<HiddenSuite> {
  const digest = sha256(JSON.stringify({ probe: sha256(probe), suite: sha256(suite) }));
  if (digest !== pinned) throw new Error("VERIFIER_CUSTODY_DIGEST_MISMATCH");
  const mod = await import("data:text/javascript;base64," + suite.toString("base64"));
  return { sha256: digest, probeSource: probe.toString("utf8"), scenarios: mod.scenarios, evaluators: mod.evaluators, uiEvaluators: mod.uiEvaluators };
}

// ---- path and content policy ----------------------------------------------------------------------
export const allowedPathPattern = /^(src\/[A-Za-z0-9_-]+\.js|test\/[A-Za-z0-9_.-]+\.test\.mjs)$/;
const prohibitedPatterns: RegExp[] = [
  /(^|\/)package(-lock)?\.json$/i, /(^|\/)(npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|\.npmrc|\.yarnrc.*|\.nvmrc|tsconfig.*\.json)$/i,
  /(^|\/)\.github\//i, /\.ya?ml$/i, /(^|\/)(Dockerfile.*|docker-compose.*|Procfile|vercel\.json|netlify\.toml|fly\.toml|render\.yaml)$/i,
  /(^|\/)\.env.*$/i, /\.(pem|key|crt|p12)$/i, /deploy|publish|release/i, /(^|\/)\.verifier/i, /verifier-custody|alpha-tasks-v1|(^|\/)(suite|probe)\.mjs$/i,
  /(^|\/)(scripts|bin|\.husky)\//i,
];
const secretPattern = /(ghp_|ghs_|github_pat_|gho_)[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abp]-[A-Za-z0-9-]{10,}/;
const egressPattern = /node:(net|http|https|http2|dgram|dns|tls|cluster|vm|worker_threads|child_process|inspector|repl)\b|\b(child_process|worker_threads)\b|\bfetch\s*\(|XMLHttpRequest|WebSocket|\bhttps?:\/\/(?!localhost|127\.0\.0\.1)/;
const srcStrictPattern = /process\s*\.\s*(argv|exit|stdout|stderr|stdin|env|binding|on|kill|abort|dlopen|chdir)\b|globalThis|\brequire\s*\(|\bimport\s*\(|\beval\s*\(|new\s+Function|Reflect\.|Proxy\b|VERIFIER_|verifier-custody|alpha-tasks-v1/;
const testStrictPattern = /verifier-custody|alpha-tasks-v1|VERIFIER_|process\s*\.\s*(exit|abort|kill|dlopen)\b/;

function changedPaths(base: Record<string, string>, cand: Record<string, string>): { added: string[]; modified: string[]; deleted: string[] } {
  const added = Object.keys(cand).filter((p) => !(p in base)).sort(), deleted = Object.keys(base).filter((p) => !(p in cand)).sort();
  const modified = Object.keys(cand).filter((p) => p in base && base[p] !== cand[p]).sort();
  return { added, modified, deleted };
}
function addedLines(base: string | undefined, cand: string): string[] {
  const existing = new Set((base ?? "").split("\n"));
  return cand.split("\n").filter((l) => !existing.has(l));
}

// ---- test-output parsing (candidate output is untrusted; used only with exit codes) ------------------
const tapCount = (out: string, key: string): number => Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(out)?.[1] ?? NaN);
const TAP = ["--test-reporter=tap"];
const topics: { id: string; pattern: string }[] = [
  { id: "creation", pattern: "/creat|add|new/i" }, { id: "editing", pattern: "/edit|updat|chang/i" }, { id: "persistence", pattern: "/persist|reload|restart|saved/i" },
  { id: "display", pattern: "/display|render|show|list/i" }, { id: "invalid", pattern: "/invalid|reject|unknown|illegal|bad|refus/i" },
];

const mapping: Record<string, number[]> = {
  "identity.source": [10], "identity.candidate": [10], "profile.supported": [10], "hidden.custody": [10], "separation": [10], "runner.isolation": [10],
  "paths.allowed": [8], "paths.prohibited": [9], "content.scan": [9], "effects": [9],
  "build": [1, 6], "typecheck": [6], "existing.tests": [1, 6],
  "hidden.C1": [1], "hidden.C2": [2], "hidden.C3": [3], "hidden.C4": [4], "hidden.C5": [5],
  "candidate.tests": [7], "ui.unrelated": [8],
};
const forbiddenEffects = ["PUBLICATION", "PULL_REQUEST_CREATE", "BRANCH_PUSH", "MERGE", "DEPLOYMENT", "SOURCE_WRITE", "PACKAGE_PUBLISH", "EXTERNAL_NETWORK_WRITE"];

export const policySha256 = sha256(canonical({ policyId, productionProfile: "host-pinned-node-json-v1", productionProbe: "single-operation-stdin-v1", deadline: "shared-wall-clock-v1", allowedPathPattern: allowedPathPattern.source, prohibited: prohibitedPatterns.map((p) => p.source), topics, mapping, forbiddenEffects, productionRunnerIds,
  patterns: [secretPattern.source, egressPattern.source, srcStrictPattern.source, testStrictPattern.source] }));

// ---- the verifier ---------------------------------------------------------------------------------
export async function verifyAlphaTask(input: AlphaTaskInput): Promise<AcceptanceReport> {
  const checks: CheckResult[] = [];
  const add = (id: string, status: CheckStatus, code: string, evidence?: Record<string, unknown>) => { checks.push({ id, criteria: mapping[id] ?? [], status, code, ...(evidence ? { evidence } : {}) }); };
  const { source, candidate, expected } = input;
  const bound = (): boolean => !!source && !!candidate && !!expected && validTree(source) && validTree(candidate) && /^[0-9a-f]{40}$/.test(candidate.parent ?? "");
  const report = (): AcceptanceReport => assemble(input, checks);
  if (!bound()) { add("identity.source", "FAIL", "TREE_MALFORMED"); return report(); }

  // 1. exact identities, recomputed from the bytes that will be executed (no trust in labels)
  const sourceTree = gitTreeId(source.files), candidateTree = gitTreeId(candidate.files);
  add("identity.source", sourceTree === source.tree && source.tree === expected.sourceTree && source.commit === expected.sourceCommit ? "PASS" : "FAIL",
    sourceTree !== source.tree ? "SOURCE_TREE_NOT_BYTES" : sourceTree === source.tree && source.tree === expected.sourceTree && source.commit === expected.sourceCommit ? "SOURCE_IDENTITY_BOUND" : "SOURCE_IDENTITY_MISMATCH", { tree: sourceTree });
  add("identity.candidate", candidateTree === candidate.tree && candidate.tree === expected.candidateTree && candidate.commit === expected.candidateCommit && candidate.parent === source.commit ? "PASS" : "FAIL",
    candidateTree !== candidate.tree ? "CANDIDATE_TREE_NOT_BYTES" : candidate.tree === expected.candidateTree && candidate.commit === expected.candidateCommit && candidate.parent === source.commit ? "CANDIDATE_IDENTITY_BOUND" : "CANDIDATE_IDENTITY_MISMATCH", { tree: candidateTree });

  // 2. supported project
  const productProfile = input.productionProfile;
  const validProduct = productProfile?.id === "alpha-tasks-node-json-v1" && productProfile.kind === "PRODUCT" && productProfile.tree === source.tree &&
    Object.keys(productProfile).sort().join(",") === "id,kind,tree" && !!source.files["src/tasks.js"] && !!source.files["src/render.js"] &&
    !!source.files["test/tasks.test.mjs"] && !!source.files["test/render.test.mjs"] && (() => { try { return JSON.parse(source.files["package.json"] ?? "").type === "module"; } catch { return false; } })();
  const profile = input.mode === "production" ? (validProduct ? productProfile : undefined) : (input.profiles?.supported ?? supportedBaseTrees)[source.tree];
  if (profile) add("profile.supported", "PASS", profile.id);
  else add("profile.supported", "INCONCLUSIVE", (input.profiles?.unsupported ?? unsupportedBaseTrees)[source.tree] ?? "UNSUPPORTED_BASE_TREE");

  // 3. separation + custody (a verifier misconfiguration is never a candidate FAIL, and never a PASS)
  const sep = !!input.producer?.environmentId && !!input.verifier?.environmentId && input.producer.environmentId !== input.verifier.environmentId;
  add("separation", sep ? "PASS" : "INCONCLUSIVE", sep ? "SEPARATE_ENVIRONMENTS" : "SEPARATION_NOT_PROVEN");
  add("hidden.custody", input.hidden?.sha256 === HIDDEN_SUITE_SHA256 ? "PASS" : "INCONCLUSIVE", input.hidden?.sha256 === HIDDEN_SUITE_SHA256 ? "HIDDEN_SUITE_DIGEST_BOUND" : "HIDDEN_SUITE_UNBOUND");

  // 4. static policy on the exact diff
  const diff = changedPaths(source.files, candidate.files);
  const touched = [...diff.added, ...diff.modified, ...diff.deleted];
  const prohibited = touched.filter((p) => prohibitedPatterns.some((r) => r.test(p)));
  const disallowed = touched.filter((p) => !prohibited.includes(p) && !allowedPathPattern.test(p));
  const oldTests = Object.keys(source.files).filter((p) => /^test\/.*\.test\.mjs$/.test(p));
  add("paths.prohibited", prohibited.length ? "FAIL" : "PASS", prohibited.length ? "PROHIBITED_PATH_TOUCHED" : "NO_PROHIBITED_PATH", { count: prohibited.length });
  add("paths.allowed", disallowed.length || touched.length === 0 ? "FAIL" : "PASS", touched.length === 0 ? "EMPTY_CANDIDATE" : disallowed.length ? "PATH_OUTSIDE_ALLOWED_SET" : "ONLY_ALLOWED_PATHS", { changed: touched.length, outside: disallowed.length });
  const scanHits: string[] = [];
  for (const p of [...diff.added, ...diff.modified]) {
    const lines = addedLines(source.files[p], candidate.files[p]!).join("\n"), isTest = p.startsWith("test/");
    if (secretPattern.test(lines) || egressPattern.test(lines) || (isTest ? testStrictPattern : srcStrictPattern).test(lines)) scanHits.push(p);
  }
  add("content.scan", scanHits.length ? "FAIL" : "PASS", scanHits.length ? "FORBIDDEN_CONTENT_ADDED" : "NO_FORBIDDEN_CONTENT", { files: scanHits.length });
  const removedTests = diff.deleted.filter((p) => oldTests.includes(p));
  const effects = input.observedEffects;
  add("effects", !Array.isArray(effects) ? "INCONCLUSIVE" : effects.some((e) => forbiddenEffects.includes(e)) ? "FAIL" : "PASS",
    !Array.isArray(effects) ? "EFFECTS_NOT_OBSERVED" : effects.some((e) => forbiddenEffects.includes(e)) ? "FORBIDDEN_EFFECT_OBSERVED" : "NO_FORBIDDEN_EFFECT");

  // 5. isolation of the verifier's own execution
  if ((input.mode ?? "local") === "production") {
    // Production never accepts the runner's self-reported state: only a host-built attestation for an allow-listed runner.
    const attested = attestationValid(input.isolationAttestation, input.runner);
    add("runner.isolation", attested ? "PASS" : "INCONCLUSIVE", attested ? "ISOLATION_ATTESTED" : "ISOLATION_ATTESTATION_REQUIRED", { detail: attested ? "host attestation" : "no valid attestation for an allow-listed production runner" });
  } else {
    const isolation = await input.runner.isolation().catch(() => ({ fsConfined: false, networkDenied: false, envScrubbed: false, detail: "ERROR" }));
    const isolated = isolation.fsConfined && isolation.networkDenied && isolation.envScrubbed;
    add("runner.isolation", isolated ? "PASS" : "INCONCLUSIVE", isolated ? "ISOLATION_PROVEN" : "ISOLATION_UNPROVEN", { detail: isolation.detail });
  }

  // Candidate code is executed only when every gate above is clean: exact identity, supported base,
  // allowed paths, no forbidden content, proven isolation. A failing candidate is not run at all.
  const clean = checks.every((c) => c.status === "PASS");
  const execIds = ["build", "typecheck", "existing.tests", "hidden.C1", "hidden.C2", "hidden.C3", "hidden.C4", "hidden.C5", "candidate.tests", "ui.unrelated"];
  if (!clean || removedTests.length) {
    if (removedTests.length) { add("existing.tests", "FAIL", "EXISTING_TEST_DELETED", { count: removedTests.length }); }
    for (const id of execIds) if (!checks.some((c) => c.id === id)) add(id, "NOT_RUN", "PRECONDITION_NOT_MET");
    return report();
  }

  add("typecheck", "NOT_APPLICABLE", "PLAIN_JAVASCRIPT_NO_TYPESCRIPT_IN_BASE");
  const deadline = input.mode === "production" ? Date.now() + (input.limits?.runMs ?? 20000) : Infinity;
  const remaining = (limit: number): number => { const ms = Math.min(limit, deadline - Date.now(), input.limits?.runMs ?? limit); if (ms < 1) throw Error("VERIFIER_DEADLINE"); return ms; };
  const run = (ws: Workspace, args: string[], timeoutMs = 20000): Promise<RunResult> => input.runner.node(ws, args, { timeoutMs: remaining(timeoutMs) });
  const dispose: Workspace[] = [];
  const open = async (files: Record<string, string>): Promise<Workspace> => { const ws = await input.runner.workspace(files); dispose.push(ws); return ws; };
  try {
    const candWs = await open(candidate.files);
    // build: syntax-level "build" of every shipped module (this app has no bundler)
    const modules = Object.keys(candidate.files).filter((p) => /^src\/[^/]+\.js$/.test(p));
    const builds = await Promise.all(modules.map((m) => run(candWs, ["--check", m], 10000)));
    add("build", builds.length && builds.every((b) => b.exitCode === 0 && !b.timedOut) ? "PASS" : builds.some((b) => b.timedOut) ? "INCONCLUSIVE" : "FAIL",
      builds.every((b) => b.exitCode === 0) ? "BUILD_OK" : "BUILD_FAILED", { modules: modules.length });

    // existing tests: the PRISTINE test files, run against the candidate's source, compared with the same run on the base
    const pristineTests = Object.fromEntries(Object.entries(source.files).filter(([p]) => p.startsWith("test/")));
    const withoutTests = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).filter(([p]) => !p.startsWith("test/")));
    const runTests = async (ws: Workspace, files: string[], extra: string[] = []) => Promise.all(files.map((f) => run(ws, [...extra, ...TAP, f], 30000)));
    const baseWs = await open(source.files), pristineWs = await open({ ...withoutTests(candidate.files), ...pristineTests });
    const controlRuns = await runTests(baseWs, oldTests), candRuns = await runTests(pristineWs, oldTests);
    const controlGreen = oldTests.length > 0 && controlRuns.every((r) => r.exitCode === 0 && tapCount(r.stdout, "fail") === 0);
    const sum = (rs: RunResult[], k: string) => rs.reduce((n, r) => n + (tapCount(r.stdout, k) || 0), 0);
    if (!controlGreen) add("existing.tests", "INCONCLUSIVE", "BASE_TESTS_NOT_GREEN_OR_ABSENT");
    else if (candRuns.some((r) => r.timedOut)) add("existing.tests", "INCONCLUSIVE", "EXISTING_TESTS_TIMED_OUT");
    else add("existing.tests", candRuns.every((r) => r.exitCode === 0 && tapCount(r.stdout, "fail") === 0) && sum(candRuns, "pass") >= sum(controlRuns, "pass") ? "PASS" : "FAIL",
      candRuns.every((r) => r.exitCode === 0) ? "EXISTING_TESTS_GREEN" : "EXISTING_TESTS_BROKEN", { files: oldTests.length, baseline: sum(controlRuns, "pass"), observed: sum(candRuns, "pass") });

    // hidden acceptance: behaviour observed by a confined probe, judged by custody-held expectations here
    const probe = async (ws: Workspace, id: string, ops: unknown[]) => {
      if (input.mode === "production") {
        if (!input.runner.probe) return { crashed: true as const };
        const out = await input.runner.probe(ws, { id, ops }, { timeoutMs: remaining(20000) });
        return out.timedOut ? { timedOut: true as const } : out.crashed || !out.results ? { crashed: true as const } : { results: out.results };
      }
      const nonce = "PROBE_" + randomBytes(16).toString("hex");
      const r = await run(ws, ["--input-type=module", "-e", input.hidden.probeSource, JSON.stringify({ root: ws.dir, scratch: ws.scratch, id, ops, nonce })], 20000);
      const lines = r.stdout.split("\n").filter((l) => l.startsWith(nonce + " "));
      if (r.timedOut) return { timedOut: true as const };
      if (r.exitCode !== 0 || !lines.length) return { crashed: true as const };
      try { return { results: JSON.parse(lines[lines.length - 1]!.slice(nonce.length + 1)) as { ok: boolean; value?: unknown }[] }; } catch { return { crashed: true as const }; }
    };
    for (const id of ["C1", "C2", "C3", "C4", "C5"]) {
      const out = await probe(candWs, id, input.hidden.scenarios[id]! as unknown[]);
      if ("timedOut" in out) { add("hidden." + id, "INCONCLUSIVE", "HIDDEN_PROBE_TIMED_OUT"); continue; }
      if ("crashed" in out) { add("hidden." + id, "FAIL", "CANDIDATE_FAILED_TO_LOAD_OR_RUN"); continue; }
      const verdict = input.hidden.evaluators[id]!(out.results);
      add("hidden." + id, verdict.inconclusive ? "INCONCLUSIVE" : verdict.pass ? "PASS" : "FAIL", verdict.code);
    }

    // unrelated UI: pristine rendering vs candidate rendering, only priority vocabulary may differ
    const uiOps = (ws: Workspace, id: string, scenario: string) => probe(ws, id, input.hidden.scenarios[scenario]! as unknown[]);
    const uiChecks: { pass: boolean; code: string }[] = [];
    for (const [name, candScenario] of [["UI_LIST", "UI_LIST_PRIORITY"], ["UI_FORM", "UI_FORM"]] as const) {
      const b = await uiOps(baseWs, name + "_B", name), c = await uiOps(candWs, name + "_C", candScenario);
      if ("timedOut" in b || "timedOut" in c) { uiChecks.push({ pass: false, code: "UI_PROBE_TIMED_OUT" }); continue; }
      if ("crashed" in b || "crashed" in c) { uiChecks.push({ pass: false, code: "UI_PROBE_CRASHED" }); continue; }
      uiChecks.push(input.hidden.uiEvaluators[name]!(b.results, c.results));
    }
    const uiTimeout = uiChecks.some((u) => u.code === "UI_PROBE_TIMED_OUT");
    add("ui.unrelated", uiTimeout ? "INCONCLUSIVE" : uiChecks.every((u) => u.pass) ? "PASS" : "FAIL", uiTimeout ? "UI_PROBE_TIMED_OUT" : uiChecks.find((u) => !u.pass)?.code ?? "UI_CONFINED_TO_PRIORITY");

    // candidate's own focused tests: must pass, cover every topic, and each topic must FAIL on the base source
    const candTests = [...diff.added, ...diff.modified].filter((p) => /^test\/[^/]+\.test\.mjs$/.test(p));
    if (!candTests.length) add("candidate.tests", "FAIL", "NO_FOCUSED_TESTS");
    else {
      const onCand = await runTests(candWs, candTests);
      const baseSrcWs = await open({ ...withoutTests(source.files), ...Object.fromEntries(Object.entries(candidate.files).filter(([p]) => p.startsWith("test/"))) });
      if (onCand.some((r) => r.timedOut)) add("candidate.tests", "INCONCLUSIVE", "CANDIDATE_TESTS_TIMED_OUT");
      else if (!onCand.every((r) => r.exitCode === 0 && tapCount(r.stdout, "fail") === 0)) add("candidate.tests", "FAIL", "CANDIDATE_TESTS_FAIL");
      else {
        const missing: string[] = [], vacuous: string[] = [];
        for (const t of topics) {
          const cand = await runTests(candWs, candTests, [`--test-name-pattern=${t.pattern}`]);
          if (!cand.some((r) => r.exitCode === 0 && tapCount(r.stdout, "tests") >= 1)) { missing.push(t.id); continue; }
          const onBase = await runTests(baseSrcWs, candTests, [`--test-name-pattern=${t.pattern}`]);
          if (!onBase.some((r) => r.exitCode !== 0 || r.timedOut)) vacuous.push(t.id);
        }
        if (vacuous.length) add("candidate.tests", "FAIL", "TESTS_PASS_WITHOUT_THE_FEATURE", { topics: vacuous });
        else if (missing.length) add("candidate.tests", "INCONCLUSIVE", "TOPIC_COVERAGE_UNPROVEN", { topics: missing });
        else add("candidate.tests", "PASS", "FOCUSED_TESTS_COVER_AND_DISCRIMINATE", { topics: topics.length });
      }
    }
  } catch {
    for (const id of execIds) if (!checks.some((c) => c.id === id)) add(id, "INCONCLUSIVE", "VERIFIER_EXECUTION_ERROR");
  } finally {
    await Promise.allSettled(dispose.map((w) => w.dispose()));
  }
  for (const id of execIds) if (!checks.some((c) => c.id === id)) add(id, "INCONCLUSIVE", "CHECK_NOT_COMPLETED");
  return report();
}

function assemble(input: AlphaTaskInput, checks: CheckResult[]): AcceptanceReport {
  const criteria: CriterionResult[] = Object.entries(CRITERIA).map(([n, title]) => {
    const id = Number(n), related = checks.filter((c) => c.criteria.includes(id));
    const relevant = related.filter((c) => c.status !== "NOT_APPLICABLE");
    const status = related.some((c) => c.status === "FAIL") ? "FAIL" as const
      : relevant.length > 0 && relevant.every((c) => c.status === "PASS") && expectedChecks(id).every((x) => checks.some((c) => c.id === x && (c.status === "PASS" || c.status === "NOT_APPLICABLE"))) ? "PASS" as const : "NOT_VERIFIED" as const;
    return { id, title, status, checks: related.map((c) => c.id) };
  });
  const verdict: Verdict = criteria.some((c) => c.status === "FAIL") ? "FAIL" : criteria.every((c) => c.status === "PASS") ? "PASS" : "PARTIAL";
  const exp = input.expected, candidate = input.candidate, source = input.source;
  return {
    policyId, policySha256, hiddenSuiteSha256: input.hidden?.sha256 ?? "", verdict, criteria, checks,
    identities: { sourceCommit: source?.commit ?? exp?.sourceCommit ?? "", sourceTree: source?.tree ?? "", candidateCommit: candidate?.commit ?? "", candidateTree: candidate?.tree ?? "", runner: input.runner?.id ?? "" },
    separation: { producerEnvironmentId: input.producer?.environmentId ?? "", verifierEnvironmentId: input.verifier?.environmentId ?? "", producerReportConsulted: false,
      producerReportSha256: input.producer?.report === undefined ? null : sha256(canonical(JSON.parse(JSON.stringify(input.producer.report)))) },
    notApplicable: checks.filter((c) => c.status === "NOT_APPLICABLE").map((c) => c.id),
    inconclusive: checks.filter((c) => c.status === "INCONCLUSIVE" || c.status === "NOT_RUN").map((c) => ({ check: c.id, code: c.code })),
  };
}
const expectedChecks = (criterion: number): string[] => Object.entries(mapping).filter(([, cs]) => cs.includes(criterion)).map(([id]) => id);

/** What may cross to the producer: criterion statuses and generic codes only. No scenarios, values, logs or test names. */
export function producerVisible(report: AcceptanceReport): { policyId: string; verdict: Verdict; criteria: { id: number; status: string }[]; failedChecks: string[]; inconclusiveChecks: string[] } {
  return { policyId: report.policyId, verdict: report.verdict, criteria: report.criteria.map((c) => ({ id: c.id, status: c.status })),
    failedChecks: report.checks.filter((c) => c.status === "FAIL" && !c.id.startsWith("hidden.")).map((c) => c.id),
    inconclusiveChecks: report.checks.filter((c) => c.status === "INCONCLUSIVE" || c.status === "NOT_RUN").map((c) => c.id) };
}

/** Bridge to the jobs.ts seam. Everything here is safe to persist as a run event and to show the producer. */
export function acceptanceOutcome(report: AcceptanceReport): { policyId: string; verdict: Verdict; reportSha256: string; criteria: { id: number; status: string }[]; failedChecks: string[]; inconclusive: { check: string; code: string }[] } {
  const visible = producerVisible(report);
  return { policyId: report.policyId, verdict: report.verdict, reportSha256: sha256(canonical(report)), criteria: visible.criteria, failedChecks: visible.failedChecks,
    inconclusive: report.inconclusive.map((i) => ({ check: i.check, code: i.code })) };
}
