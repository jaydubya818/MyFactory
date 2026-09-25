#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

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
const finalMessagePath = valueAfter("-o");
const prompt = args.at(-1);
if (valueAfter("-m") !== "test-model" || !valueAfter("-C") ||
    valueAfter("--sandbox") !== "workspace-write" || !args.includes("--json") ||
    !finalMessagePath || !prompt) {
  process.exit(65);
}

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
