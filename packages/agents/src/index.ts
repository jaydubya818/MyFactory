import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdtemp, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

const MAX_PROMPT_BYTES = 128 * 1024;
const MAX_EVENT_BYTES = 64 * 1024 * 1024;
const MAX_EVENT_LINE_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 8 * 1024 * 1024;
const MAX_FINAL_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const TERMINATION_GRACE_MS = 2_000;
const PREFLIGHT_TIMEOUT_MS = 5_000;

export interface CodexEvent {
  type: string;
  [key: string]: unknown;
}

export interface CodexRunOptions {
  workspacePath: string;
  prompt: string;
  model: string;
  timeoutMs: number;
  artifactsDir: string;
  onProcessStart?: (process: { pid: number; startedAt: string; workspacePath: string }) => void | Promise<void>;
  onEvent?: (event: CodexEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export type CodexRunStatus = "completed" | "failed" | "cancelled" | "timed_out";

export interface CodexRunResult {
  workerProfile: "mac";
  status: CodexRunStatus;
  success: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  startedAt: string;
  finishedAt: string;
  eventsPath: string;
  stderrPath: string;
  finalMessagePath: string;
  finalMessageAvailable: boolean;
  threadId: string | null;
  usage: Record<string, number> | null;
  completionEventSeen: boolean;
  error: string | null;
}

export interface CodexPreflight {
  workerProfile: "mac";
  binaryAvailable: boolean;
  version: string | null;
  authenticated: boolean;
  error: string | null;
}

export interface CodexAdapter {
  runCodex(options: CodexRunOptions): Promise<CodexRunResult>;
  preflightCodex(): Promise<CodexPreflight>;
}

function validateExecutable(executablePath: string): void {
  if (executablePath !== "codex" && !isAbsolute(executablePath)) {
    throw new TypeError("Codex executable must be 'codex' or an absolute path");
  }
  if (executablePath.includes("\0")) {
    throw new TypeError("Codex executable contains a NUL byte");
  }
}

function validateRunOptions(options: CodexRunOptions): void {
  if (!options || typeof options !== "object") {
    throw new TypeError("Run options are required");
  }
  for (const [label, path] of [["workspacePath", options.workspacePath], ["artifactsDir", options.artifactsDir]]) {
    if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
      throw new TypeError(`${label} must be an absolute path without NUL bytes`);
    }
  }
  if (typeof options.prompt !== "string" || options.prompt.trim() === "" ||
      Buffer.byteLength(options.prompt, "utf8") > MAX_PROMPT_BYTES || options.prompt.includes("\0")) {
    throw new TypeError("prompt must be non-empty, at most 128 KiB, and contain no NUL bytes");
  }
  if (typeof options.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(options.model)) {
    throw new TypeError("model must be a simple model identifier");
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError("timeoutMs must be an integer from 1 to 1800000");
  }
  if (options.onEvent !== undefined && typeof options.onEvent !== "function") {
    throw new TypeError("onEvent must be a function");
  }
  if (options.onProcessStart !== undefined && typeof options.onProcessStart !== "function") {
    throw new TypeError("onProcessStart must be a function");
  }
}

async function checkedDirectory(path: string, label: string): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError(`${label} must be an existing directory, not a symlink`);
  }
  return realpath(path);
}

function isInside(path: string, directory: string): boolean {
  const difference = relative(directory, path);
  return difference === "" || (difference !== ".." && !difference.startsWith(`..${sep}`) && !isAbsolute(difference));
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, data: Buffer): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const result = await file.write(data, offset, data.length - offset);
    if (result.bytesWritten === 0) {
      throw new Error("Artifact write made no progress");
    }
    offset += result.bytesWritten;
  }
}

function usageFrom(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value)) {
    if (typeof amount === "number" && Number.isFinite(amount) && amount >= 0) usage[key] = amount;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The child may already have exited.
    }
  }
}

async function runCodexWith(executablePath: string, options: CodexRunOptions): Promise<CodexRunResult> {
  validateRunOptions(options);
  const workspacePath = await checkedDirectory(options.workspacePath, "workspacePath");
  const artifactsDir = await checkedDirectory(options.artifactsDir, "artifactsDir");
  if (isInside(artifactsDir, workspacePath)) {
    throw new TypeError("artifactsDir must be outside the task workspace");
  }

  const runDir = await mkdtemp(join(artifactsDir, "codex-run-"));
  const eventsPath = join(runDir, "events.jsonl");
  const stderrPath = join(runDir, "stderr.log");
  const finalMessagePath = join(runDir, "final-message.txt");
  const eventsFile = await open(eventsPath, "wx", 0o600);
  const stderrFile = await open(stderrPath, "wx", 0o600);
  const startedAt = new Date().toISOString();

  let child: ChildProcess;
  try {
    child = spawn(executablePath, [
      "exec", "-m", options.model,
      "-C", workspacePath,
      "--sandbox", "workspace-write",
      "--json", "-o", finalMessagePath,
      options.prompt,
    ], {
      cwd: workspacePath,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    await Promise.all([eventsFile.close(), stderrFile.close()]);
    throw error;
  }

  let termination: "timeout" | "abort" | "invalid_output" | "process_start_failed" | null = null;
  let closed = false;
  let spawnError: string | null = null;
  const closedPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("error", (error) => { spawnError = error.message; });
    child.once("close", (code, signal) => {
      closed = true;
      resolve({ code, signal });
    });
  });
  let hardKillTimer: ReturnType<typeof setTimeout> | null = null;
  const stop = (reason: typeof termination): void => {
    if (termination || closed || !reason) return;
    termination = reason;
    signalProcessGroup(child, "SIGTERM");
    hardKillTimer = setTimeout(() => signalProcessGroup(child, "SIGKILL"), TERMINATION_GRACE_MS);
    hardKillTimer.unref();
  };
  const timeoutTimer = setTimeout(() => stop("timeout"), options.timeoutMs);
  timeoutTimer.unref();
  const abortHandler = (): void => stop("abort");
  options.signal?.addEventListener("abort", abortHandler, { once: true });
  if (options.signal?.aborted) stop("abort");

  let processStartError: string | null = null;
  if (child.pid && options.onProcessStart) {
    try {
      await options.onProcessStart({ pid: child.pid, startedAt, workspacePath });
    } catch (error) {
      processStartError = `Codex process start handler failed: ${error instanceof Error ? error.message : String(error)}`;
      stop("process_start_failed");
    }
  }

  let threadId: string | null = null;
  let usage: Record<string, number> | null = null;
  let completionEventSeen = false;
  let turnFailed = false;
  let outputError: string | null = null;

  const processLine = async (lineBuffer: Buffer): Promise<void> => {
    if (outputError || processStartError) return;
    if (lineBuffer.length > MAX_EVENT_LINE_BYTES) {
      outputError = "Codex JSONL event exceeded 1 MiB";
      stop("invalid_output");
      return;
    }
    const trimmed = lineBuffer.at(-1) === 13 ? lineBuffer.subarray(0, -1) : lineBuffer;
    let event: unknown;
    try {
      event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(trimmed));
    } catch {
      outputError = "Codex emitted invalid JSONL";
      stop("invalid_output");
      return;
    }
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        typeof (event as Record<string, unknown>).type !== "string") {
      outputError = "Codex emitted an invalid event shape";
      stop("invalid_output");
      return;
    }
    const parsed = event as CodexEvent;
    if (parsed.type === "thread.started") {
      if (typeof parsed.thread_id !== "string" || parsed.thread_id.length === 0 ||
          (threadId !== null && threadId !== parsed.thread_id)) {
        outputError = "Codex emitted an invalid thread identity";
        stop("invalid_output");
        return;
      }
      threadId = parsed.thread_id;
    } else if (parsed.type === "turn.completed") {
      completionEventSeen = true;
      usage = usageFrom(parsed.usage) ?? usage;
    } else if (parsed.type === "turn.failed") {
      turnFailed = true;
    }
    try {
      await options.onEvent?.(parsed);
    } catch {
      outputError = "Codex event handler failed";
      stop("invalid_output");
    }
  };

  const captureEvents = async (): Promise<void> => {
    let total = 0;
    let pending = Buffer.alloc(0);
    for await (const chunk of child.stdout!) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const allowed = Math.min(bytes.length, Math.max(0, MAX_EVENT_BYTES - total));
      if (allowed > 0) await writeAll(eventsFile, bytes.subarray(0, allowed));
      total += allowed;
      if (allowed < bytes.length) {
        outputError ??= "Codex JSONL output exceeded 64 MiB";
        stop("invalid_output");
      }
      if (outputError || allowed === 0) continue;
      const combined = Buffer.concat([pending, bytes.subarray(0, allowed)]);
      let start = 0;
      for (let index = 0; index < combined.length; index += 1) {
        if (combined[index] !== 10) continue;
        await processLine(combined.subarray(start, index));
        start = index + 1;
      }
      pending = combined.subarray(start);
      if (pending.length > MAX_EVENT_LINE_BYTES) {
        outputError = "Codex JSONL event exceeded 1 MiB";
        stop("invalid_output");
      }
    }
    if (pending.length > 0 && !outputError) await processLine(pending);
  };

  const captureStderr = async (): Promise<void> => {
    let total = 0;
    for await (const chunk of child.stderr!) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const allowed = Math.min(bytes.length, Math.max(0, MAX_STDERR_BYTES - total));
      if (allowed > 0) await writeAll(stderrFile, bytes.subarray(0, allowed));
      total += allowed;
      if (allowed < bytes.length) {
        outputError ??= "Codex stderr exceeded 8 MiB";
        stop("invalid_output");
      }
    }
  };

  let exit: { code: number | null; signal: string | null } = { code: null, signal: null };
  try {
    const captures = await Promise.allSettled([
      captureEvents().catch((error) => { stop("invalid_output"); throw error; }),
      captureStderr().catch((error) => { stop("invalid_output"); throw error; }),
    ]);
    exit = await closedPromise;
    for (const result of captures) {
      if (result.status === "rejected") outputError ??= `Artifact capture failed: ${String(result.reason)}`;
    }
  } finally {
    clearTimeout(timeoutTimer);
    // The CLI may exit before one of its descendants. Reap the remaining group.
    if (termination) signalProcessGroup(child, "SIGKILL");
    if (hardKillTimer) clearTimeout(hardKillTimer);
    options.signal?.removeEventListener("abort", abortHandler);
    await Promise.all([eventsFile.close(), stderrFile.close()]);
  }

  let finalMessageAvailable = false;
  try {
    const stat = await lstat(finalMessagePath);
    finalMessageAvailable = stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_FINAL_MESSAGE_BYTES;
  } catch {
    // Failed or cancelled runs may have no final message.
  }

  const status: CodexRunStatus = processStartError ? "failed" :
    termination === "timeout" ? "timed_out" :
    termination === "abort" ? "cancelled" :
    exit.code === 0 && completionEventSeen && !turnFailed && !outputError && finalMessageAvailable ? "completed" : "failed";
  const error = status === "completed" ? null :
    processStartError ?? spawnError ?? outputError ??
    (termination === "timeout" ? "Codex run timed out" :
      termination === "abort" ? "Codex run was cancelled" :
      exit.code !== 0 ? `Codex exited with code ${exit.code ?? "unknown"}` :
      !completionEventSeen ? "Codex exited without a turn.completed event" :
      turnFailed ? "Codex reported turn.failed" :
      !finalMessageAvailable ? "Codex final message artifact is missing or invalid" :
      "Codex run failed");

  return {
    workerProfile: "mac",
    status,
    success: status === "completed",
    exitCode: exit.code,
    exitSignal: exit.signal,
    startedAt,
    finishedAt: new Date().toISOString(),
    eventsPath,
    stderrPath,
    finalMessagePath,
    finalMessageAvailable,
    threadId,
    usage,
    completionEventSeen,
    error,
  };
}

async function readOnlyCommand(executablePath: string, args: string[]): Promise<{
  code: number | null; output: string; error: string | null;
}> {
  const child = spawn(executablePath, args, {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  let error: string | null = null;
  let size = 0;
  const collect = (chunk: Buffer): void => {
    size += chunk.length;
    if (size > 64 * 1024) {
      error = "Preflight output exceeded 64 KiB";
      signalProcessGroup(child, "SIGTERM");
      return;
    }
    output += chunk.toString("utf8");
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.once("error", (cause) => { error = cause.message; });
  let hardKillTimer: ReturnType<typeof setTimeout> | null = null;
  const timer = setTimeout(() => {
    error = "Preflight command timed out";
    signalProcessGroup(child, "SIGTERM");
    hardKillTimer = setTimeout(() => signalProcessGroup(child, "SIGKILL"), TERMINATION_GRACE_MS);
    hardKillTimer.unref();
  }, PREFLIGHT_TIMEOUT_MS);
  timer.unref();
  const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
  clearTimeout(timer);
  if (hardKillTimer) clearTimeout(hardKillTimer);
  return { code, output, error };
}

async function preflightCodexWith(executablePath: string): Promise<CodexPreflight> {
  const versionResult = await readOnlyCommand(executablePath, ["--version"]);
  if (versionResult.code !== 0 || versionResult.error) {
    return { workerProfile: "mac", binaryAvailable: false, version: null, authenticated: false,
      error: versionResult.error ?? "Codex --version failed" };
  }
  const version = versionResult.output.split(/\r?\n/).map((line) => line.trim())
    .find((line) => /^codex-cli\s+\S+/.test(line)) ?? null;
  const loginResult = await readOnlyCommand(executablePath, ["login", "status"]);
  return {
    workerProfile: "mac",
    binaryAvailable: true,
    version,
    authenticated: loginResult.code === 0 && !loginResult.error,
    error: loginResult.error ?? (loginResult.code === 0 ? null : "Codex login status failed"),
  };
}

/** Test/configuration seam. Only host configuration should choose an executable path. */
export function createCodexAdapter(executablePath = "codex"): CodexAdapter {
  validateExecutable(executablePath);
  return {
    runCodex: (options) => runCodexWith(executablePath, options),
    preflightCodex: () => preflightCodexWith(executablePath),
  };
}

const defaultAdapter = createCodexAdapter();
export const runCodex = defaultAdapter.runCodex;
export const preflightCodex = defaultAdapter.preflightCodex;
