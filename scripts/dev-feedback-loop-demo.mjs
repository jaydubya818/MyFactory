#!/usr/bin/env node
/**
 * DEV-ONLY end-to-end rehearsal harness for the automatic development-test feedback loop.
 *
 * It composes the REAL JobManager, FactoryStorage, Docker browser-profile verification and the REAL Codex CLI
 * (operator's own ChatGPT login; no API key, no metered provider). The only substituted part is the Work spend
 * gateway: a durable local limiter with the same admission interface (`nextProductive`) and fixed operation and
 * reserve ceilings. It is NOT the production spend ledger, grants no authority and is never imported by the
 * supervisor. Refuses to run unless FACTORY_DEV_FEEDBACK_DEMO=1.
 *
 *   node scripts/dev-feedback-loop-demo.mjs --data DIR --repo REPO --base SHA --task FILE [--crash-at-admission]
 *   node scripts/dev-feedback-loop-demo.mjs --data DIR --recover
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openStorage } from "../packages/storage/src/index.ts";
import { createCodexAdapter, preflightCodex } from "../packages/agents/src/index.ts";
import { verifyCandidate, verifyWorkspaceTree } from "../packages/verification/src/index.ts";
import { JobManager } from "../apps/supervisor/src/jobs.ts";

if (process.env.FACTORY_DEV_FEEDBACK_DEMO !== "1") throw new Error("Development-only harness: set FACTORY_DEV_FEEDBACK_DEMO=1");
const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const value = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const data = resolve(value("data") ?? (() => { throw new Error("--data is required"); })());
mkdirSync(data, { recursive: true });
const log = (type, extra = {}) => process.stdout.write(`${new Date().toISOString()} ${type} ${JSON.stringify(extra)}\n`);

// ---- durable local limiter standing in for the Work admission (same interface as gateway.nextProductive)
const limiterPath = join(data, "limiter.json");
const limits = { maxProductiveOperations: Number(process.env.DEMO_MAX_OPS ?? 4), reserveMicrousd: 500_000, ceilingMicrousd: Number(process.env.DEMO_CEILING_MICROUSD ?? 2_000_000) };
const limiter = () => existsSync(limiterPath) ? JSON.parse(readFileSync(limiterPath, "utf8")) : { ...limits, admitted: 0, history: [] };
const save = state => writeFileSync(limiterPath, JSON.stringify(state, null, 2));
function admit(label) {
  const state = limiter();
  if (state.admitted >= state.maxProductiveOperations) throw new Error(`Work operation limit reached (${state.admitted}/${state.maxProductiveOperations})`);
  if ((state.admitted + 1) * state.reserveMicrousd > state.ceilingMicrousd) throw new Error("Work budget ceiling would be exceeded");
  state.admitted += 1; state.history.push({ at: new Date().toISOString(), label, n: state.admitted });
  save(state); return state;
}

const shim = join(data, "codex-shim.sh");
writeFileSync(shim, `#!/bin/zsh
unset OPENAI_API_KEY NODE_ENV ANTHROPIC_API_KEY OPENROUTER_API_KEY
sub=$1; shift
if [ "$sub" = exec ] && [ "$1" = resume ]; then shift; exec codex exec resume --ignore-user-config --ignore-rules -c model_reasoning_effort="medium" "$@"; fi
exec codex exec --ignore-user-config --ignore-rules -c model_reasoning_effort="medium" "$@"
`, { mode: 0o755 });
const adapter = createCodexAdapter(shim);

const MODEL = process.env.DEMO_MODEL ?? "gpt-6.1-sol";
const IMAGE = process.env.DEMO_IMAGE ?? "qdev-dashboard-profile:20261030";
const COMMANDS = ["npm run build && npx playwright test"];
const pf = await preflightCodex();
if (!pf.binaryAvailable || !pf.authenticated) throw new Error("Codex CLI unavailable or not logged in");

const storage = openStorage(join(data, "factory.sqlite"));
const producer = { capture: () => ({}), finalize: () => ({}),
  snapshot: () => ({ version: 3, configuration: { model: MODEL, executorVersion: pf.version, timeoutMs: 25 * 60 * 1000, commands: COMMANDS, verificationImage: IMAGE, allowedPaths: [] }, factoryVersion: "d".repeat(64) }) };
const jobs = new JobManager(storage, data, event => {
  if (/^(run\.(prepared|implementing|agent_result|implementation_checkpoint|productive_closed|candidate_committed|ready_for_review|failed|check_completed)|feedback\.|agent\.thread)/.test(event.type))
    log(event.type, event.type === "feedback.report_issued" ? { step: event.payload.step, outcome: event.payload.outcome, failures: event.payload.report.failures.length, digest: event.payload.digest.slice(0, 12) }
      : event.type === "run.implementation_checkpoint" ? { step: event.payload.productiveStep, passed: event.payload.passed, tree: event.payload.tree.slice(0, 12) }
      : event.type === "run.agent_result" ? { status: event.payload.status, threadId: event.payload.threadId } : event.type.startsWith("feedback.") ? event.payload : {});
}, {
  // The adapter's gateway/bounded-context options describe the metered boundary; the dev route uses the operator's login instead.
  runCodex: async options => {
    if (options.sandbox === "read-only") { log("completion.skipped", { reason: "dev route: no paid completion operation" }); return { success: true, status: "completed", threadId: null, usage: null, eventsPath: "/dev/null" }; }
    const { gateway, boundedProductiveContext, productiveEndSignal, ...plain } = options;
    log("agent.start", { resume: plain.resumeThreadId ?? null, promptBytes: Buffer.byteLength(plain.prompt) });
    return adapter.runCodex(plain);
  },
  verifyWorkspaceTree: input => verifyWorkspaceTree(input),
  verifyCandidate: input => verifyCandidate(input),
}, producer, MODEL);

let order, prepared;
if (flag("recover")) {
  const meta = JSON.parse(readFileSync(join(data, "demo-meta.json"), "utf8"));
  order = storage.getWorkOrder(meta.workOrderId); prepared = storage.getRun(meta.runId);
  log("recover.begin", { workOrderId: order.id, runId: prepared.id, limiter: limiter() });
} else {
  const repo = resolve(value("repo")), base = value("base"), task = readFileSync(resolve(value("task")), "utf8");
  admit("initial productive operation");
  order = storage.createWorkOrder({ title: "GitHub repository-health dashboard", description: task, kind: "feature", repositoryPath: repo, baseRef: base,
    acceptanceCriteria: ["npm run build && npm test passes in the disposable browser environment"], reproductionCommand: null, expectedFailureText: null,
    checkCommands: COMMANDS, allowedPaths: ["src/**", "test/**", "playwright.config.ts", "playwright.unit.config.ts", "package.json", "README.md"], workerProfile: "mac" });
  prepared = await jobs.prepareRun(order);
  storage.appendEvent({ workOrderId: order.id, runId: prepared.id, type: "factory.writer_bound", payload: { deadline: new Date(Date.now() + 3 * 3600_000).toISOString() } });
  writeFileSync(join(data, "demo-meta.json"), JSON.stringify({ workOrderId: order.id, runId: prepared.id, base, model: MODEL, image: IMAGE }, null, 2));
  log("work.prepared", { workOrderId: order.id, runId: prepared.id, base });
}

const productive = new AbortController();
const gateway = {
  baseUrl: "http://127.0.0.1:1/v1", childToken: "a".repeat(64), productiveEndSignal: productive.signal, close: async () => {},
  nextProductive: async () => {
    if (flag("crash-at-admission") && !flag("recover")) { log("crash.injected", { where: "before admission, after feedback report persisted" }); process.kill(process.pid, "SIGKILL"); }
    const state = admit("feedback resume"); log("admission.granted", { admitted: state.admitted, of: state.maxProductiveOperations });
    return { baseUrl: "http://127.0.0.1:1/v1", childToken: "b".repeat(64), productiveEndSignal: productive.signal };
  },
  beginCompletion: async () => ({ baseUrl: "http://127.0.0.1:1/v1", childToken: "c".repeat(64) }), assertCompleted: () => {}, fenceAuthority: () => {},
};
const before = storage.listEvents(order.id).filter(e => e.type === "factory.execution_settled").length;
if (!jobs.executePrepared(order, prepared, () => true, gateway)) throw new Error("claim refused");
while (storage.listEvents(order.id).filter(e => e.type === "factory.execution_settled").length <= before) await new Promise(r => setTimeout(r, 500));
const events = storage.listEvents(order.id), run = storage.getRun(prepared.id);
writeFileSync(join(data, "events.json"), JSON.stringify(events, null, 1));
const summary = { workOrderId: order.id, runId: run.id, state: run.state, failure: run.failure, candidateCommit: run.candidateCommit,
  agentResponses: events.filter(e => e.type === "run.agent_result").length, threads: [...new Set(events.filter(e => e.type === "run.agent_result").map(e => e.payload.threadId))],
  checkpoints: events.filter(e => e.type === "run.implementation_checkpoint").map(e => e.payload.passed),
  feedbackRounds: events.filter(e => e.type === "feedback.resume_requested").length, stopped: events.filter(e => e.type === "feedback.stopped").map(e => e.payload.reason), limiter: limiter() };
writeFileSync(join(data, "summary.json"), JSON.stringify(summary, null, 2));
log("done", summary);
await jobs.close(); storage.close();
process.exit(0);
