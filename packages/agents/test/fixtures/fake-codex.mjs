#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log("codex-cli 0.fake");
  process.exit(0);
}

if (args[0] === "login" && args[1] === "status") {
  console.log("Logged in for fixture testing");
  process.exit(0);
}

if (args[0] !== "exec") process.exit(64);

const valueAfter = (flag) => args[args.indexOf(flag) + 1];

if (args[1] === "resume") {
  // `codex exec resume [OPTIONS] SESSION_ID PROMPT`: no -C and no --sandbox; sandbox is a config override.
  const session = args.at(-2), resumePrompt = args.at(-1), configs = args.flatMap((arg, index) => arg === "-c" ? [args[index + 1]] : []);
  if (args.includes("-C") || args.includes("--sandbox") || !args.includes("--json") || valueAfter("-m") !== "test-model" ||
      !configs.includes('sandbox_mode="workspace-write"') || !valueAfter("-o")) process.exit(67);
  // Gateway children keep sessions under CODEX_HOME: a resume can only find the saved session in the same home.
  if (resumePrompt === "resume-needs-session-store" && !existsSync(`${process.env.CODEX_HOME}/saved-session`)) process.exit(68);
  if (resumePrompt === "resume-hang" || resumePrompt === "resume-hang-no-thread") {
    if (resumePrompt === "resume-hang") console.log(JSON.stringify({ type: "thread.started", thread_id: session }));
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  if (resumePrompt !== "resume-no-thread") console.log(JSON.stringify({ type: "thread.started", thread_id: resumePrompt === "resume-wrong-thread" ? "some-other-session" : session }));
  console.log(JSON.stringify({ type: "turn.started" }));
  writeFileSync(valueAfter("-o"), `Resumed ${session} with ${resumePrompt}`);
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3, output_tokens: 2 } }));
  process.exit(0);
}
const finalMessagePath = valueAfter("-o");
const prompt = args.at(-1);
if (valueAfter("-m") !== (prompt === "namespaced-model" ? "openai/gpt-5.4-mini" : "test-model") || !valueAfter("-C") ||
    valueAfter("--sandbox") !== "workspace-write" || !args.includes("--json") ||
    !finalMessagePath || !prompt) {
  process.exit(65);
}

if (prompt === 'gateway-config') {
  const configs = args.flatMap((arg, index) => arg === '-c' ? [args[index + 1]] : []);
  if (!args.includes('--ignore-user-config') ||
      !configs.includes('model_provider="factory_spend"') ||
      !configs.includes('model_providers.factory_spend.supports_websockets=false') ||
      !configs.includes('web_search="disabled"') ||
      !configs.some(item => item.startsWith('model_providers.factory_spend.base_url="http://127.0.0.1:8123/v1"')) ||
      process.env.FACTORY_GATEWAY_TOKEN !== 'a'.repeat(64) ||
      process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.VERCEL_OIDC_TOKEN ||
      process.env.HOME !== process.env.CODEX_HOME) process.exit(66);
}

if (prompt === "save-session" && process.env.CODEX_HOME) writeFileSync(`${process.env.CODEX_HOME}/saved-session`, "1");
console.log(JSON.stringify({ type: "thread.started", thread_id: "fixture-thread" }));
console.log(JSON.stringify({ type: "turn.started" }));

if (prompt === "hang-with-child") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(`${finalMessagePath}.child-pid`, String(child.pid));
  setInterval(() => {}, 1_000);
} else if (prompt === "hang") {
  setInterval(() => {}, 1_000);
} else if (prompt === "invalid-json") {
  console.log("{invalid JSONL");
  writeFileSync(finalMessagePath, "Looks successful, but JSONL is invalid");
} else {
  writeFileSync(finalMessagePath, `Final message for ${prompt}`);
  if (prompt !== "missing-completion") {
    console.log(JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 12, output_tokens: 4, ignored: "not a number" },
    }));
  }
  if (prompt === "nonzero-exit") process.exitCode = 9;
}
