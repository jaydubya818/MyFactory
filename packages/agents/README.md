# Host Codex adapter

`@factory/agents` runs one Codex CLI attempt for the explicit `mac` worker profile. It is an isolated module: it does not choose work, grant approval, verify a commit, or publish a PR. The supervisor must select the profile, enforce policy and leases, and display the selected host access before starting a run.

```ts
import { preflightCodex, runCodex } from "@factory/agents";

const preflight = await preflightCodex(); // `codex --version`, then `codex login status`
const result = await runCodex({
  workspacePath: "/absolute/task-owned/workspace",
  artifactsDir: "/absolute/host-owned/artifacts",
  prompt: "Reproduce the defect, make the bounded fix, and report the change.",
  model: "your-configured-model",
  timeoutMs: 30 * 60 * 1000,
  onProcessStart: async ({ pid, startedAt, workspacePath }) => { /* persist PID and ownership */ },
  onEvent: async (event) => { /* persist a normalized event */ },
  signal: abortController.signal,
});
```

Both directories must already exist, be absolute, and not be symlinks. Artifacts must be outside the task workspace. A private run directory contains `events.jsonl`, `stderr.log`, and the CLI's `final-message.txt`. Treat raw event/stderr files as sensitive operational data; do not show unreviewed logs or authentication material as general evidence.

The adapter invokes `codex exec -m <model> -C <workspace> --sandbox workspace-write --json -o <artifact> <prompt>` without a shell and with stdin closed. It awaits `onProcessStart` immediately after spawn, before processing output, so the supervisor can persist the PID for restart fencing. If that callback fails, the adapter terminates the process group and returns `failed`. It sends timeout/cancellation signals to the child process group, then escalates to `SIGKILL`. It reports success only when the process exits 0, valid JSONL contains `turn.completed`, no `turn.failed` occurs, and the final-message artifact is a regular file. Final prose never supplies verification or publication authority.

Codex's **host command sandbox is not Docker isolation**. The worker runs on the local host with the user's Codex authentication and may have access defined by the host and CLI configuration. The runtime must show that access and must not label this profile as a container worker. The executable override exposed by `createCodexAdapter` is for trusted host configuration and fake-binary tests, never WorkOrder input.

Run `npm test --workspace @factory/agents` from the repository root. Tests invoke a fake executable and do not contact a model provider.
