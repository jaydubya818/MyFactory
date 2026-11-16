import assert from "node:assert/strict";
import test from "node:test";
import { overnightConfigFromEnv } from "../../../scripts/overnight/config.mjs";
import { decodeManifest, executionIdentity, prepareRequest, proofSummary, renderSummary, runOvernight } from "../../../scripts/overnight/runner.mjs";

const env = {
  FACTORY_OVERNIGHT_ENABLED: "1", FACTORY_OVERNIGHT_REPOSITORY: "jaydubya818/MyFactory",
  FACTORY_OVERNIGHT_REPOSITORY_PATH: "/work/MyFactory", FACTORY_OVERNIGHT_DATA_DIR: "/data",
};
const liveEnv = { ...env, FACTORY_OVERNIGHT_LIVE: "1", FACTORY_OVERNIGHT_TOKEN_FILE: "/data/overnight-token",
  FACTORY_OVERNIGHT_PRICING_REVISION: "production-openai-mini-test" };
const night = new Date("2026-11-16T09:30:00Z"); // 01:30 PST, night of 2026-11-15
const sha = "c".repeat(40);
const body = "Tighten docs.\n\n## Acceptance criteria\n- Lists env vars\n\n## Allowed paths\n- docs/OVERNIGHT.md\n\n## Checks\n- npm test --workspace @factory/supervisor\n";
const issue = { number: 41, title: "Tighten docs", state: "open", created_at: "2026-11-15T20:00:00Z",
  user: { login: "jaydubya818" }, labels: [{ name: "factory:overnight" }], body, html_url: "https://github.com/jaydubya818/MyFactory/issues/41" };

function signed(status = "COMPLETED", checks = [{ command: "npm test --workspace @factory/supervisor", status: "passed", exitCode: 0 }]) {
  const manifest = { status, producer: "local-factory", execution: { factoryVersion: "f".repeat(64) },
    candidate: status === "COMPLETED" ? { commit: "d".repeat(40), base: sha, patchDigest: "e".repeat(64) } : null,
    evidence: checks, evidenceDigest: "9".repeat(64), completedAt: "2026-11-16T09:40:00Z" };
  return { protocol: "myfactory.result.v1", encoded: Buffer.from(JSON.stringify(manifest)).toString("base64url"),
    signature: "sig", manifestDigest: "8".repeat(64), artifacts: [] };
}

function harness({ config, ledger = { nights: {} }, issues = [issue], states = ["RUNNING", "COMPLETED"], result = signed(), policy = { dispatchPaused: false } } = {}) {
  const calls = [];
  let ids = 0, t = night.getTime(), reads = 0;
  const writes = [];
  const snapshot = { factoryId: "local-factory", factoryVersion: "f".repeat(64), workOrderId: "wo-1", runId: "run-1",
    inputCommit: sha, configuration: { allowedPaths: ["docs/OVERNIGHT.md"] } };
  const deps = {
    clock: () => new Date(t),
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    sleep: async (ms) => { t += ms; },
    readLedger: async () => structuredClone(ledger),
    writeLedger: async (value) => { writes.push(structuredClone(value)); },
    listIssues: async () => issues,
    resolveBaseSha: async () => sha,
    factory: {
      policy: async () => { calls.push("policy"); return policy; },
      prepare: async (request) => { calls.push(["prepare", request]); return { workOrderId: "wo-1", runId: "run-1", snapshot, state: "PREPARED", quiescent: false }; },
      dispatch: async (id, identity) => { calls.push(["dispatch", identity]); return { state: "RUNNING", quiescent: false }; },
      read: async () => { const state = states[Math.min(reads++, states.length - 1)];
        return { state, quiescent: !["RUNNING", "STOPPING", "UNKNOWN"].includes(state),
          spend: { status: "KNOWN", settledMicrousd: 420000, ceilingMicrousd: 1350000 } }; },
      stop: async () => { calls.push("stop"); return { state: "STOPPING", quiescent: false }; },
      result: async () => { calls.push("result"); return { state: "COMPLETED", result }; },
      requestPublication: async (workOrderId, destination) => { calls.push(["publication", workOrderId, destination]); return { id: "pub-1" }; },
    },
  };
  return { deps, calls, writes, config: config ?? overnightConfigFromEnv(liveEnv) };
}

test("dry run plans the exact bounded request and mutates nothing", async () => {
  const h = harness({ config: overnightConfigFromEnv(env) });
  const report = await runOvernight({ config: h.config, now: night, deps: h.deps });
  assert.equal(report.outcome, "planned");
  assert.equal(report.night, "2026-11-15");
  assert.equal(report.plan.maxSpendUsd, 1.35);
  assert.equal(report.plan.input.baseRef, sha);
  assert.equal(Date.parse(report.plan.deadline) - night.getTime(), 600_000);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.calls, ["policy"]);
  assert.match(renderSummary(report), /Planned request \(dry run\)/);
});

test("live night claims the ledger first, dispatches once and summarizes the Proof", async () => {
  const h = harness();
  const report = await runOvernight({ config: h.config, now: night, deps: h.deps });
  assert.equal(report.outcome, "ready_for_review");
  assert.equal(h.writes[0].nights["2026-11-15"].state, "claimed");
  assert.equal(h.calls.filter((c) => c[0] === "prepare").length, 1);
  const dispatch = h.calls.find((c) => c[0] === "dispatch")[1];
  assert.equal(dispatch.remoteRunId, "run-1");
  assert.equal(dispatch.baseSha, sha);
  assert.deepEqual(dispatch.allowedPaths, ["docs/OVERNIGHT.md"]);
  assert.equal(report.proof.candidate.commit, "d".repeat(40));
  assert.equal(report.publication, null, "publication requests are opt-in");
  const summary = renderSummary(report);
  assert.match(summary, /Proof \(signed Result\)/);
  assert.match(summary, /Touch ID/);
  assert.match(summary, /MyFactory never merges/);
  assert.equal(h.writes.at(-1).nights["2026-11-15"].state, "COMPLETED");
});

test("opt-in publication request only after every check passed", async () => {
  const config = overnightConfigFromEnv({ ...liveEnv, FACTORY_OVERNIGHT_REQUEST_PUBLICATION: "1" });
  const h = harness({ config });
  const report = await runOvernight({ config, now: night, deps: h.deps });
  assert.deepEqual(h.calls.find((c) => c[0] === "publication"), ["publication", "wo-1", "jaydubya818/MyFactory"]);
  assert.equal(report.publication.id, "pub-1");
  const failing = harness({ config, result: signed("COMPLETED", [{ command: "npm test", status: "failed", exitCode: 1 }]) });
  await runOvernight({ config, now: night, deps: failing.deps });
  assert.equal(failing.calls.some((c) => c[0] === "publication"), false);
});

test("a used night, a paused policy or an unreachable supervisor dispatches nothing", async () => {
  const used = harness({ ledger: { nights: { "2026-11-15": { mode: "live", issue: 7 } } } });
  assert.equal((await runOvernight({ config: used.config, now: night, deps: used.deps })).outcome, "skipped:night_used");
  const paused = harness({ policy: { dispatchPaused: true } });
  assert.equal((await runOvernight({ config: paused.config, now: night, deps: paused.deps })).outcome, "skipped:dispatch_paused");
  const down = harness();
  down.deps.factory.policy = async () => { throw new Error("ECONNREFUSED"); };
  assert.equal((await runOvernight({ config: down.config, now: night, deps: down.deps })).outcome, "skipped:supervisor_unreachable");
  for (const h of [used, paused, down]) assert.equal(h.writes.length, 0);
});

test("an underspecified issue is reported without consuming the night", async () => {
  const h = harness({ issues: [{ ...issue, body: "Please improve docs" }] });
  const report = await runOvernight({ config: h.config, now: night, deps: h.deps });
  assert.equal(report.outcome, "needs_clarification");
  assert.ok(report.missing.includes("## Allowed paths"));
  assert.equal(h.writes.length, 0);
});

test("prepare refusal is recorded and ends the night", async () => {
  const h = harness();
  h.deps.factory.prepare = async () => { throw new Error("Supervisor POST returned 409: Qualified V2 pricing and exact plan required"); };
  const report = await runOvernight({ config: h.config, now: night, deps: h.deps });
  assert.equal(report.outcome, "prepare_failed");
  assert.equal(h.writes.at(-1).nights["2026-11-15"].state, "prepare_failed");
  assert.equal(h.calls.some((c) => c[0] === "dispatch"), false);
});

test("a run past its deadline gets one bounded stop and reports UNKNOWN when unreconciled", async () => {
  const h = harness({ states: ["RUNNING"] });
  const report = await runOvernight({ config: h.config, now: night, deps: h.deps });
  assert.equal(h.calls.filter((c) => c === "stop").length, 1);
  assert.equal(report.outcome, "unknown");
});

test("helpers bind identity to the prepared snapshot and decode manifests", () => {
  const config = overnightConfigFromEnv(liveEnv);
  const request = prepareRequest({ config, work: { title: "x" }, requestId: "r", workId: "w", now: night });
  assert.equal(request.spendContract.maxPaidOperations, 3);
  assert.equal(request.spendContract.pricingRevision, "production-openai-mini-test");
  assert.throws(() => executionIdentity({ prepared: { snapshot: null }, request, uuid: () => "u" }), /snapshot/);
  assert.equal(decodeManifest({ encoded: "not json" }), null);
  assert.equal(proofSummary(signed()).checks[0].status, "passed");
});

test("pipes in check commands are escaped in the morning summary table", () => {
  const proof = proofSummary(signed("COMPLETED", [{ command: "cat a | grep b", status: "passed", exitCode: 0 }]));
  const text = renderSummary({ mode: "live", outcome: "ready_for_review", night: "2026-11-15", proof });
  assert.match(text, /\| `cat a \\\| grep b` \| passed \| 0 \|/);
});
