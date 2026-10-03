import { isModelReference } from '../../contracts/src/model-reference.ts';
import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCodexAdapter } from "../src/index.ts";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "factory-agents-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspacePath = join(directory, "workspace");
  const artifactsDir = join(directory, "artifacts");
  const binaryPath = join(directory, "fake-codex.mjs");
  await mkdir(workspacePath);
  await mkdir(artifactsDir);
  await copyFile(new URL("./fixtures/fake-codex.mjs", import.meta.url), binaryPath);
  await chmod(binaryPath, 0o755);
  return { workspacePath, artifactsDir, adapter: createCodexAdapter(binaryPath) };
}

function options(fixture, prompt, overrides = {}) {
  return {
    workspacePath: fixture.workspacePath,
    artifactsDir: fixture.artifactsDir,
    prompt,
    model: "test-model",
    timeoutMs: 3_000,
    ...overrides,
  };
}

test("preflight checks only version and login status", async (t) => {
  const work = await fixture(t);
  const result = await work.adapter.preflightCodex();
  assert.deepEqual(result, {
    workerProfile: "mac",
    binaryAvailable: true,
    version: "codex-cli 0.fake",
    authenticated: true,
    error: null,
  });
});

test("run keeps prompt literal and returns only event-backed completion", async (t) => {
  const work = await fixture(t);
  const events = [];
  const prompt = "Fix reported zero; $(echo still-literal)";
  const result = await work.adapter.runCodex(options(work, prompt, {
    onEvent: (event) => events.push(event.type),
  }));
  assert.equal(result.workerProfile, "mac");
  assert.equal(result.status, "completed");
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.completionEventSeen, true);
  assert.equal(result.threadId, "fixture-thread");
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 4 });
  assert.deepEqual(events, ["thread.started", "turn.started", "turn.completed"]);
  assert.equal(await readFile(result.finalMessagePath, "utf8"), `Final message for ${prompt}`);
  assert.equal((await readFile(result.eventsPath, "utf8")).trim().split("\n").length, 3);
  assert.ok(!result.eventsPath.startsWith(work.workspacePath));
});

test('gateway run isolates child auth and pins the Responses provider to loopback', async t => {
  const prior=process.env.VERCEL_OIDC_TOKEN;
  process.env.VERCEL_OIDC_TOKEN='synthetic-host-only-oidc';
  t.after(()=>{if(prior===undefined)delete process.env.VERCEL_OIDC_TOKEN;else process.env.VERCEL_OIDC_TOKEN=prior;});
  const work = await fixture(t);
  const result = await work.adapter.runCodex(options(work, 'gateway-config', {
    gateway: { baseUrl: 'http://127.0.0.1:8123/v1', childToken: 'a'.repeat(64) },
  }));
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
});

test("process start callback is awaited before event processing", async (t) => {
  const work = await fixture(t);
  const order = [];
  let processInfo;
  let persisted = false;
  const result = await work.adapter.runCodex(options(work, "ordinary", {
    onProcessStart: async (info) => {
      processInfo = info;
      order.push("process-start");
      // Hold persistence until this fast child has actually exited. A fixed
      // sleep can miss the lost-output race on slower development machines.
      let exited = false;
      for (let i = 0; i < 200; i++) {
        try { process.kill(info.pid, 0); }
        catch (error) { if (error.code === 'ESRCH') { exited = true; break; } throw error; }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.equal(exited, true, 'fixture must exit before the start receipt settles');
      persisted = true;
    },
    onEvent: (event) => {
      assert.equal(persisted, true);
      order.push(event.type);
    },
  }));
  assert.equal(result.status, "completed");
  assert.ok(Number.isInteger(processInfo.pid) && processInfo.pid > 0);
  assert.equal(processInfo.startedAt, result.startedAt);
  assert.equal(processInfo.workspacePath, await realpath(work.workspacePath));
  assert.deepEqual(order, ["process-start", "thread.started", "turn.started", "turn.completed"]);
});

test("process start persistence failure terminates the process group and returns failed", async (t) => {
  const work = await fixture(t);
  let pid;
  const events = [];
  const result = await work.adapter.runCodex(options(work, "hang", {
    onProcessStart: ({ pid: startedPid }) => {
      pid = startedPid;
      throw new Error("database unavailable");
    },
    onEvent: (event) => events.push(event),
  }));
  assert.equal(result.status, "failed");
  assert.equal(result.success, false);
  assert.match(result.error, /process start handler failed: database unavailable/);
  assert.deepEqual(events, []);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("exit zero with persuasive final prose but no turn.completed is failure", async (t) => {
  const work = await fixture(t);
  const result = await work.adapter.runCodex(options(work, "missing-completion"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.finalMessageAvailable, true);
  assert.equal(result.completionEventSeen, false);
  assert.equal(result.status, "failed");
  assert.match(result.error, /turn\.completed/);
});

test("turn.completed with nonzero exit is failure", async (t) => {
  const work = await fixture(t);
  const result = await work.adapter.runCodex(options(work, "nonzero-exit"));
  assert.equal(result.exitCode, 9);
  assert.equal(result.completionEventSeen, true);
  assert.equal(result.status, "failed");
});

test("malformed JSONL prevents success", async (t) => {
  const work = await fixture(t);
  const result = await work.adapter.runCodex(options(work, "invalid-json"));
  assert.equal(result.status, "failed");
  assert.match(result.error, /invalid JSONL/);
});

test("timeout and abort stop the process group", async (t) => {
  const work = await fixture(t);
  // Allow the fixture's own Node process to start and record its child before timing it out.
  const timedOut = await work.adapter.runCodex(options(work, "hang-with-child", { timeoutMs: 3_000 }));
  assert.equal(timedOut.status, "timed_out");
  assert.equal(timedOut.success, false);
  const childPid = Number(await readFile(`${timedOut.finalMessagePath}.child-pid`, "utf8"));
  t.after(() => { try { process.kill(childPid, "SIGKILL"); } catch {} });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 80);
  t.after(() => clearTimeout(timer));
  const cancelled = await work.adapter.runCodex(options(work, "hang", { signal: controller.signal }));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.success, false);
});

test("artifacts may not be written inside the task workspace", async (t) => {
  const work = await fixture(t);
  await assert.rejects(
    work.adapter.runCodex(options(work, "ordinary", { artifactsDir: work.workspacePath })),
    /outside the task workspace/,
  );
});


test("Attempt 3: exact provider-qualified model reaches the executor as one literal argument", async t => {
  const work = await fixture(t);
  let started = false;
  const result = await work.adapter.runCodex(options(work, "namespaced-model", {
    model: "openai/gpt-5.4-mini",
    onProcessStart: () => { started = true; },
  }));
  assert.equal(started, true);
  assert.equal(result.success, true);
  assert.equal(await readFile(result.finalMessagePath, "utf8"), "Final message for namespaced-model");
});


test("unsafe or ambiguous model references never launch an executor", async t => {
  const work = await fixture(t);
  for (const model of ["", "openai/", "/gpt-5.4-mini", "openai//gpt", "a/b/c",
    "../gpt", "openai/../gpt", "openai/gpt..mini", "https://gateway/model", "file:model",
    "openai\\gpt", "openai/gpt;id", "$(id)", "gpt`id`", "gpt|cat", "gpt&&id",
    " gpt", "gpt ", "openai/gpt\n", "gpt\r", "gpt\t", "gpt\0", "gpt\u2028", "gpt😀", "a".repeat(121)]) {
    await assert.rejects(work.adapter.runCodex(options(work, "ordinary", {
      model, onProcessStart: () => assert.fail("Unsafe model reached process start"),
    })), /canonical model reference/, JSON.stringify(model));
  }
});


test("canonical model references preserve qualified and legacy identity with bounded length", () => {
  for (const model of ["openai/gpt-5.4-mini", "gpt-5.4-mini", "provider/model_v1.2", "a".repeat(120)]) {
    assert.equal(isModelReference(model), true);
  }
  for (const model of [null, undefined, 1, {}, [], "a/" + "b".repeat(119), "a:b", "a/b:c"]) {
    assert.equal(isModelReference(model), false);
  }
});

test('host productive boundary yields a quiescent process without claiming a completed model turn',async t=>{
 const work=await fixture(t),boundary=new AbortController();let pid;
 const result=await work.adapter.runCodex(options(work,'hang',{
  productiveEndSignal:boundary.signal,onProcessStart: p=>{pid=p.pid;setTimeout(()=>boundary.abort(),100);}
 }));
 assert.equal(result.status,'yielded');assert.equal(result.success,false);assert.equal(result.completionEventSeen,false);
 assert.throws(()=>process.kill(-pid,0),{code:'ESRCH'});
});

test('owner cancellation dominates a productive boundary signal',async t=>{
 const work=await fixture(t),boundary=new AbortController(),owner=new AbortController();
 const result=await work.adapter.runCodex(options(work,'hang',{
  productiveEndSignal:boundary.signal,signal:owner.signal,onProcessStart:()=>{setTimeout(()=>{boundary.abort();owner.abort();},100);}
 }));
 assert.equal(result.status,'cancelled');assert.equal(result.success,false);
});


test('host productive protocol cannot be enabled without its metered checkpoint or in completion', async t => {
  const work = await fixture(t);
  for (const overrides of [
    {boundedProductiveContext:true},
    {boundedProductiveContext:true,gateway:{baseUrl:'http://127.0.0.1:8123/v1',childToken:'a'.repeat(64)}},
    {boundedProductiveContext:true,gateway:{baseUrl:'http://127.0.0.1:8123/v1',childToken:'a'.repeat(64)},productiveEndSignal:new AbortController().signal,sandbox:'read-only'},
  ]) await assert.rejects(work.adapter.runCodex(options(work,'ordinary',overrides)),/Bounded productive context/);
});

test('explicit container adapter reports its execution profile without changing local defaults',async t=>{
 const work=await fixture(t),binaryPath=join(work.workspacePath,'..','fake-codex.mjs');
 const adapter=createCodexAdapter(binaryPath,'container');
 assert.equal((await adapter.preflightCodex()).workerProfile,'container');
 const result=await adapter.runCodex(options(work,'bounded container fixture'));
 assert.equal(result.workerProfile,'container');assert.equal(result.status,'completed');
 assert.throws(()=>createCodexAdapter(binaryPath,'unqualified'),/Unsupported/);
});
