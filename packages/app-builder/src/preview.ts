import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppBuildResult, ManifestFile } from "./index.ts";

const LOG_LIMIT_BYTES = 2_000_000;
const MANIFEST_LIMIT_BYTES = 2_000_000;
const INSTALL_TIMEOUT_MS = 180_000;
const CHECK_TIMEOUT_MS = 90_000;
const START_TIMEOUT_MS = 20_000;
const GENERATED_DIRECTORIES = new Set(["node_modules", "dist", ".data"]);
const CHILD_WRAPPER = fileURLToPath(new URL("./preview-child.mjs", import.meta.url));

export interface PreviewSnapshot {
  workOrderId: string;
  outputDir: string;
  status: "building" | "running" | "failed" | "stopped";
  url?: string;
  logPath: string;
  logSha256: string;
  requestedAt: string;
  updatedAt: string;
  error?: string;
}

interface PreviewEntry {
  snapshot: PreviewSnapshot;
  expectedManifestSha256: string;
  logFd: number;
  logBytes: number;
  logClosed: boolean;
  stopping: boolean;
  activeProcess?: ChildProcess;
  runtimeProcess?: ChildProcess;
  runtimeClosed?: Promise<void>;
  startPromise?: Promise<PreviewSnapshot>;
  runtimeExitReason?: string;
}

class PreviewStoppedError extends Error {}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeManifestPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && !path.startsWith("/") && !path.includes("\\") &&
    path === posix.normalize(path) && !path.split("/").some((part) => !part || part === "." || part === "..");
}

function terminateGroup(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); }
  catch { try { child.kill(signal); } catch { /* Already exited. */ } }
}

function killWithGrace(child: ChildProcess): void {
  terminateGroup(child);
  const force = setTimeout(() => terminateGroup(child, "SIGKILL"), 1500);
  force.unref();
  child.once("close", () => clearTimeout(force));
}

function sanitizedEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    HOME: home,
    TMPDIR: tmpdir(),
    CI: "1",
    npm_config_cache: process.env.npm_config_cache ?? join(homedir(), ".npm-cache"),
    npm_config_offline: "true",
    npm_config_update_notifier: "false",
  };
}

/** Runs a generated app locally from a checked manifest, with bounded offline build steps. */
export class LocalAppPreviewManager {
  readonly #evidenceDirectory: string;
  readonly #onEvent: (workOrderId: string, type: string, payload: Record<string, unknown>) => void;
  readonly #entries = new Map<string, PreviewEntry>();

  constructor(options: {
    evidenceDirectory: string;
    onEvent: (workOrderId: string, type: string, payload: Record<string, unknown>) => void;
  }) {
    if (!options || typeof options.evidenceDirectory !== "string" || !isAbsolute(options.evidenceDirectory) ||
        typeof options.onEvent !== "function") {
      throw new TypeError("evidenceDirectory must be absolute and onEvent must be a function");
    }
    mkdirSync(options.evidenceDirectory, { recursive: true, mode: 0o700 });
    this.#evidenceDirectory = realpathSync(options.evidenceDirectory);
    this.#onEvent = options.onEvent;
  }

  status(workOrderId: string): PreviewSnapshot | null {
    const snapshot = this.#entries.get(workOrderId)?.snapshot;
    return snapshot ? { ...snapshot } : null;
  }

  async start(input: { workOrderId: string; outputDir: string; expectedManifestSha256: string }): Promise<PreviewSnapshot> {
    if (!input || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.workOrderId) ||
        typeof input.outputDir !== "string" || !isAbsolute(input.outputDir) ||
        !/^[0-9a-f]{64}$/.test(input.expectedManifestSha256)) {
      throw new TypeError("Invalid preview request");
    }
    const existing = this.#entries.get(input.workOrderId);
    if (existing && (existing.snapshot.status === "building" || existing.snapshot.status === "running")) {
      if (existing.snapshot.outputDir !== input.outputDir ||
          existing.expectedManifestSha256 !== input.expectedManifestSha256) {
        throw new Error("A different preview is already active for this WorkOrder");
      }
      return existing.startPromise ?? { ...existing.snapshot };
    }

    const evidenceDir = join(this.#evidenceDirectory, input.workOrderId);
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    if (!lstatSync(evidenceDir).isDirectory() || realpathSync(evidenceDir) !== evidenceDir) {
      throw new Error("Preview evidence directory must be a real directory");
    }
    const logPath = join(evidenceDir, `preview-${Date.now()}-${randomBytes(4).toString("hex")}.log`);
    const logFd = openSync(logPath, "wx", 0o600);
    const now = new Date().toISOString();
    const entry: PreviewEntry = {
      snapshot: {
        workOrderId: input.workOrderId, outputDir: input.outputDir, status: "building", logPath,
        logSha256: digest(Buffer.alloc(0)), requestedAt: now, updatedAt: now,
      },
      expectedManifestSha256: input.expectedManifestSha256,
      logFd, logBytes: 0, logClosed: false, stopping: false,
    };
    this.#entries.set(input.workOrderId, entry);
    this.#append(entry, `Preview requested for ${input.workOrderId}\n`);
    this.#emit(entry, "builder.preview_requested");
    entry.startPromise = this.#buildAndLaunch(entry, input.outputDir);
    return entry.startPromise;
  }

  async stop(workOrderId: string): Promise<PreviewSnapshot | null> {
    const entry = this.#entries.get(workOrderId);
    if (!entry) return null;
    if (entry.snapshot.status === "stopped" || entry.snapshot.status === "failed") return { ...entry.snapshot };
    entry.stopping = true;
    if (entry.activeProcess) killWithGrace(entry.activeProcess);
    if (entry.runtimeProcess) {
      entry.runtimeProcess.stdin?.end();
      const timeout = setTimeout(() => killWithGrace(entry.runtimeProcess!), 1500);
      timeout.unref();
      await Promise.race([entry.runtimeClosed, new Promise<void>((resolveWait) => setTimeout(resolveWait, 4000))]);
      clearTimeout(timeout);
    }
    if (entry.startPromise) await entry.startPromise;
    this.#markStopped(entry);
    return { ...entry.snapshot };
  }

  async close(): Promise<void> {
    await Promise.all([...this.#entries.keys()].map((workOrderId) => this.stop(workOrderId)));
  }

  async #buildAndLaunch(entry: PreviewEntry, outputDir: string): Promise<PreviewSnapshot> {
    try {
      const home = join(dirname(entry.snapshot.logPath), "home");
      mkdirSync(home, { recursive: true, mode: 0o700 });
      const env = sanitizedEnvironment(home);

      this.#verifySource(entry, outputDir);
      await this.#runCommand(entry, "install", "npm", ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], outputDir, env, INSTALL_TIMEOUT_MS);
      this.#verifySource(entry, outputDir);
      await this.#runCommand(entry, "typecheck", join(outputDir, "node_modules/.bin/tsc"), ["--noEmit"], outputDir, env, CHECK_TIMEOUT_MS);
      this.#verifySource(entry, outputDir);
      await this.#runCommand(entry, "build", join(outputDir, "node_modules/.bin/vite"), ["build"], outputDir, env, CHECK_TIMEOUT_MS);
      this.#verifySource(entry, outputDir);
      if (entry.stopping) throw new PreviewStoppedError("Preview was stopped");
      const url = await this.#launch(entry, outputDir, env);
      if (entry.stopping) throw new PreviewStoppedError("Preview was stopped");
      this.#append(entry, `Preview listening at ${url}\n`);
      this.#update(entry, { status: "running", url, error: undefined });
      this.#emit(entry, "builder.preview_started");
    } catch (error) {
      if (entry.stopping || error instanceof PreviewStoppedError) this.#markStopped(entry);
      else {
        const message = error instanceof Error ? error.message : "Preview failed";
        this.#append(entry, `Preview failed: ${message}\n`);
        this.#update(entry, { status: "failed", url: undefined, error: message });
        this.#emit(entry, "builder.preview_failed");
        this.#closeLog(entry);
      }
    }
    return { ...entry.snapshot };
  }

  #verifySource(entry: PreviewEntry, outputDir: string): void {
    if (entry.stopping) throw new PreviewStoppedError("Preview was stopped");
    if (realpathSync(outputDir) !== resolve(outputDir) || !lstatSync(outputDir).isDirectory()) {
      throw new Error("Preview output must be a real directory");
    }
    const manifestPath = join(outputDir, "build-manifest.json");
    const manifestStat = lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.size > MANIFEST_LIMIT_BYTES) {
      throw new Error("Build manifest is missing or too large");
    }
    const manifestBytes = readFileSync(manifestPath);
    if (digest(manifestBytes) !== entry.expectedManifestSha256) throw new Error("Build manifest SHA-256 does not match");
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as AppBuildResult;
    if (manifest.schemaVersion !== 1 || manifest.outputDir !== outputDir || manifest.manifestPath !== manifestPath ||
        manifest.template?.id !== "feedback-hub" || !Array.isArray(manifest.files) ||
        manifest.files.length < 1 || manifest.files.length > 1000) {
      throw new Error("Build manifest metadata is invalid");
    }
    const expected = new Map<string, ManifestFile>();
    const allowedDirectories = new Set<string>();
    for (const file of manifest.files) {
      if (!safeManifestPath(file.path) || file.path === "build-manifest.json" ||
          GENERATED_DIRECTORIES.has(file.path.split("/")[0]) ||
          !/^[0-9a-f]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
          file.bytes > 20_000_000 || expected.has(file.path)) {
        throw new Error("Build manifest file list is invalid");
      }
      expected.set(file.path, file);
      const parts = file.path.split("/");
      for (let index = 1; index < parts.length; index++) allowedDirectories.add(parts.slice(0, index).join("/"));
    }
    const found = new Set<string>();
    const walk = (directory: string, prefix: string) => {
      for (const item of readdirSync(directory)) {
        const path = prefix ? `${prefix}/${item}` : item;
        const fullPath = join(directory, item);
        const stat = lstatSync(fullPath);
        if (stat.isSymbolicLink()) throw new Error(`Preview contains a symlink: ${path}`);
        if (!prefix && GENERATED_DIRECTORIES.has(item)) {
          if (!stat.isDirectory()) throw new Error(`Generated path is not a directory: ${path}`);
          continue;
        }
        if (stat.isDirectory()) {
          if (!allowedDirectories.has(path)) throw new Error(`Preview contains an extra directory: ${path}`);
          walk(fullPath, path);
        } else if (stat.isFile()) {
          if (path === "build-manifest.json") continue;
          const declared = expected.get(path);
          if (!declared) throw new Error(`Preview contains an extra file: ${path}`);
          if (stat.size !== declared.bytes || digest(readFileSync(fullPath)) !== declared.sha256) {
            throw new Error(`Preview source hash changed: ${path}`);
          }
          found.add(path);
        } else throw new Error(`Preview contains an unsupported entry: ${path}`);
      }
    };
    walk(outputDir, "");
    if (found.size !== expected.size) throw new Error("Preview source files are missing");
    this.#append(entry, `Verified manifest and ${found.size} source files\n`);
  }

  async #runCommand(entry: PreviewEntry, label: string, command: string, args: string[], cwd: string,
    env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
    if (entry.stopping) throw new PreviewStoppedError("Preview was stopped");
    this.#append(entry, `\n$ ${label}: ${command} ${args.join(" ")}\n`);
    await new Promise<void>((resolveRun, rejectRun) => {
      const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      entry.activeProcess = child;
      let failure: string | null = null;
      const timeout = setTimeout(() => {
        failure = `${label} timed out after ${timeoutMs} ms`;
        killWithGrace(child);
      }, timeoutMs);
      timeout.unref();
      const onOutput = (chunk: Buffer) => {
        if (!this.#append(entry, chunk) && !failure) {
          failure = `${label} exceeded the ${LOG_LIMIT_BYTES} byte log limit`;
          killWithGrace(child);
        }
      };
      child.stdout?.on("data", onOutput);
      child.stderr?.on("data", onOutput);
      child.on("error", (error) => { failure = `${label} could not start: ${error.message}`; });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (entry.activeProcess === child) entry.activeProcess = undefined;
        if (entry.stopping) rejectRun(new PreviewStoppedError("Preview was stopped"));
        else if (failure) rejectRun(new Error(failure));
        else if (code === 0) resolveRun();
        else rejectRun(new Error(`${label} exited with ${code ?? signal ?? "unknown status"}`));
      });
    });
  }

  async #launch(entry: PreviewEntry, outputDir: string, env: NodeJS.ProcessEnv): Promise<string> {
    this.#append(entry, "\n$ start: production server on 127.0.0.1:0\n");
    return new Promise<string>((resolveReady, rejectReady) => {
      const child = spawn(process.execPath, [CHILD_WRAPPER, outputDir], {
        cwd: outputDir, env, detached: true, stdio: ["pipe", "pipe", "pipe"],
      });
      entry.runtimeProcess = child;
      let ready = false;
      let stdout = "";
      const timeout = setTimeout(() => {
        entry.runtimeExitReason = `Production server did not start within ${START_TIMEOUT_MS} ms`;
        killWithGrace(child);
      }, START_TIMEOUT_MS);
      timeout.unref();
      entry.runtimeClosed = new Promise<void>((resolveClosed) => {
        child.on("close", (code, signal) => {
          clearTimeout(timeout);
          resolveClosed();
          entry.runtimeProcess = undefined;
          if (!ready) {
            rejectReady(new Error(entry.runtimeExitReason ?? `Production server exited with ${code ?? signal ?? "unknown status"}`));
          } else if (!entry.stopping) {
            const reason = entry.runtimeExitReason ?? `Production server exited with ${code ?? signal ?? "unknown status"}`;
            this.#append(entry, `${reason}\n`);
            this.#update(entry, { status: "failed", url: undefined, error: reason });
            this.#emit(entry, "builder.preview_exited");
            this.#closeLog(entry);
          }
        });
      });
      const onOutput = (chunk: Buffer) => {
        if (!this.#append(entry, chunk)) {
          entry.runtimeExitReason = `Production server exceeded the ${LOG_LIMIT_BYTES} byte log limit`;
          killWithGrace(child);
        }
      };
      child.stdout?.on("data", (chunk: Buffer) => {
        onOutput(chunk);
        if (ready) return;
        stdout += chunk.toString("utf8");
        if (stdout.length > 10_000) stdout = stdout.slice(-10_000);
        for (const line of stdout.split("\n")) {
          if (!line.startsWith("FACTORY_PREVIEW_READY ")) continue;
          try {
            const payload = JSON.parse(line.slice("FACTORY_PREVIEW_READY ".length)) as { url?: string };
            const url = new URL(payload.url ?? "");
            if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
              throw new Error("Production server returned a non-loopback URL");
            }
            clearTimeout(timeout);
            ready = true;
            resolveReady(url.toString().replace(/\/$/, ""));
            return;
          } catch (error) {
            entry.runtimeExitReason = error instanceof Error ? error.message : "Invalid preview URL";
            killWithGrace(child);
            return;
          }
        }
      });
      child.stderr?.on("data", onOutput);
      child.on("error", (error) => {
        entry.runtimeExitReason = `Production server could not start: ${error.message}`;
      });
    });
  }

  #append(entry: PreviewEntry, value: string | Buffer): boolean {
    if (entry.logClosed) return false;
    const bytes = typeof value === "string" ? Buffer.from(value) : value;
    const remaining = LOG_LIMIT_BYTES - entry.logBytes;
    if (remaining <= 0) return false;
    const written = writeSync(entry.logFd, bytes, 0, Math.min(bytes.length, remaining));
    entry.logBytes += written;
    return written === bytes.length;
  }

  #update(entry: PreviewEntry, patch: Partial<PreviewSnapshot>): void {
    entry.snapshot = { ...entry.snapshot, ...patch, updatedAt: new Date().toISOString() };
  }

  #emit(entry: PreviewEntry, type: string): void {
    entry.snapshot.logSha256 = digest(readFileSync(entry.snapshot.logPath));
    this.#onEvent(entry.snapshot.workOrderId, type, { ...entry.snapshot, logBytes: entry.logBytes });
  }

  #markStopped(entry: PreviewEntry): void {
    if (entry.snapshot.status === "stopped") return;
    this.#append(entry, "Preview stopped\n");
    this.#update(entry, { status: "stopped", url: undefined, error: undefined });
    this.#emit(entry, "builder.preview_stopped");
    this.#closeLog(entry);
  }

  #closeLog(entry: PreviewEntry): void {
    if (entry.logClosed) return;
    closeSync(entry.logFd);
    entry.logClosed = true;
  }
}
