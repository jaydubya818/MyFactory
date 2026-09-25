import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_VERIFICATION_IMAGE = "node:22-bookworm";

export interface VerificationLimits {
  timeoutMs?: number;
  cpus?: number;
  memoryMb?: number;
  pids?: number;
  maxLogBytes?: number;
}

export interface VerificationInput {
  repositoryPath: string;
  candidateSha: string;
  commands: string[];
  artifactDir: string;
  image?: string;
  limits?: VerificationLimits;
  signal?: AbortSignal;
}

export interface VerificationCheck {
  candidateCommit: string;
  candidateTree: string | null;
  command: string;
  status: "passed" | "failed" | "unavailable";
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  logPath: string;
  reason: string | null;
}

export interface VerificationResult {
  candidateCommit: string;
  candidateTree: string | null;
  image: string;
  checks: VerificationCheck[];
  manifestPath: string;
  exportStatus: "ready" | "unavailable";
  reason: string | null;
}

interface RequiredLimits {
  timeoutMs: number;
  cpus: number;
  memoryMb: number;
  pids: number;
  maxLogBytes: number;
}

interface TreeEntry {
  mode: string;
  objectId: string;
  path: string;
}

const DEFAULT_LIMITS: RequiredLimits = {
  timeoutMs: 120_000,
  cpus: 1,
  memoryMb: 512,
  pids: 64,
  maxLogBytes: 2_000_000,
};

function limitsFor(input: VerificationLimits | undefined): RequiredLimits {
  const limits = { ...DEFAULT_LIMITS, ...input };
  const maximums = {
    timeoutMs: 600_000,
    memoryMb: 4_096,
    pids: 256,
    maxLogBytes: 10_000_000,
  };
  for (const key of ["timeoutMs", "memoryMb", "pids", "maxLogBytes"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > maximums[key]) {
      throw new RangeError(`${key} must be between 1 and ${maximums[key]}`);
    }
  }
  if (!Number.isFinite(limits.cpus) || limits.cpus <= 0 || limits.cpus > 4) {
    throw new RangeError("cpus must be greater than 0 and no more than 4");
  }
  return limits;
}

async function runTool(
  binary: string,
  args: string[],
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<Buffer> {
  const { stdout } = await execFileAsync(binary, args, {
    encoding: "buffer",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    signal,
  });
  return stdout as Buffer;
}

function parseTree(buffer: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let start = 0;
  while (start < buffer.length) {
    const end = buffer.indexOf(0, start);
    if (end < 0) throw new Error("Git tree output was not NUL terminated");
    const entry = buffer.subarray(start, end);
    const tab = entry.indexOf(9);
    if (tab < 0) throw new Error("Git tree entry was malformed");
    const [mode, type, objectId] = entry.subarray(0, tab).toString("ascii").split(" ");
    const path = decoder.decode(entry.subarray(tab + 1));
    if (type !== "blob" || !["100644", "100755", "120000"].includes(mode)) {
      throw new Error(`Unsupported Git tree entry: ${path}`);
    }
    if (
      path.length === 0 || path.startsWith("/") || path !== posix.normalize(path) ||
      path.split("/").some((part) => part === ".." || part === "." || part === ".git")
    ) {
      throw new Error(`Unsafe Git tree path: ${path}`);
    }
    entries.push({ mode, objectId, path });
    start = end + 1;
  }
  return entries;
}

async function blobId(
  path: string,
  algorithm: "sha1" | "sha256",
  symlink: boolean,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error("Verification cancelled");
  const size = symlink ? readlinkSync(path, { encoding: "buffer" }).length : statSync(path).size;
  const hash = createHash(algorithm).update(`blob ${size}\0`);
  if (symlink) {
    hash.update(readlinkSync(path, { encoding: "buffer" }));
  } else {
    for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  }
  return hash.digest("hex");
}

async function assertExactExport(
  exportDir: string,
  entries: TreeEntry[],
  algorithm: "sha1" | "sha256",
  signal?: AbortSignal,
): Promise<void> {
  const expected = new Set(entries.map((entry) => entry.path));
  for (const entry of entries) {
    if (signal?.aborted) throw new Error("Verification cancelled");
    const file = join(exportDir, entry.path);
    let details;
    try {
      details = lstatSync(file);
    } catch {
      throw new Error(`Git archive omitted committed file: ${entry.path}`);
    }
    const symlink = entry.mode === "120000";
    if (symlink !== details.isSymbolicLink() || (!symlink && !details.isFile())) {
      throw new Error(`Git archive changed file type: ${entry.path}`);
    }
    if (!symlink && details.isFile() && Boolean(details.mode & 0o111) !== (entry.mode === "100755")) {
      throw new Error(`Git archive changed executable mode: ${entry.path}`);
    }
    if (await blobId(file, algorithm, symlink, signal) !== entry.objectId) {
      throw new Error(`Git archive changed committed content: ${entry.path}`);
    }
  }

  function walk(directory: string, prefix: string): void {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      const fullPath = join(directory, item.name);
      if (item.isDirectory()) walk(fullPath, relative);
      else if (!expected.has(relative)) throw new Error(`Git archive added untracked content: ${relative}`);
    }
  }
  walk(exportDir, "");
}

interface DockerOutcome {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  aborted: boolean;
  launchError: string | null;
  cleanupError: string | null;
}

async function runDocker(
  args: string[],
  containerName: string,
  limits: RequiredLimits,
  signal?: AbortSignal,
): Promise<DockerOutcome> {
  if (signal?.aborted) {
    return {
      exitCode: null, output: "", timedOut: false, aborted: true,
      launchError: null, cleanupError: null,
    };
  }
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  let truncated = false;
  let tail = "";
  let timedOut = false;
  let aborted = false;
  let launchError: string | null = null;
  let cleanupError: string | null = null;
  const capture = (data: Buffer): void => {
    tail = (tail + data.toString("utf8")).slice(-4096);
    const available = limits.maxLogBytes - capturedBytes;
    if (available > 0) {
      const part = data.subarray(0, available);
      chunks.push(part);
      capturedBytes += part.length;
    }
    if (data.length > available) truncated = true;
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const killGroup = (): void => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  const onAbort = (): void => {
    aborted = true;
    killGroup();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup();
  }, limits.timeoutMs);
  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.once("error", (error) => {
      launchError = error.message;
      resolveExit(null);
    });
    child.once("close", (code) => resolveExit(code));
  });
  clearTimeout(timer);
  signal?.removeEventListener("abort", onAbort);
  if (timedOut || aborted) {
    try {
      await runTool("docker", ["rm", "-f", containerName], 5_000);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
    }
  }
  const output = Buffer.concat(chunks).toString("utf8") +
    (truncated ? "\n[verification log truncated]\n" : "");
  return {
    exitCode,
    output: output + (truncated ? `\n[tail]\n${tail}` : ""),
    timedOut,
    aborted,
    launchError,
    cleanupError,
  };
}

function unavailableCheck(
  result: VerificationResult,
  command: string,
  index: number,
  directory: string,
  reason: string,
): VerificationCheck {
  const timestamp = new Date().toISOString();
  const logPath = join(directory, `check-${String(index + 1).padStart(3, "0")}.log`);
  writeFileSync(logPath, `${reason}\n`, { mode: 0o600 });
  return {
    candidateCommit: result.candidateCommit,
    candidateTree: result.candidateTree,
    command,
    status: "unavailable",
    exitCode: null,
    startedAt: timestamp,
    finishedAt: timestamp,
    logPath,
    reason,
  };
}

function persistManifest(result: VerificationResult): void {
  writeFileSync(result.manifestPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
}

export async function verifyCandidate(input: VerificationInput): Promise<VerificationResult> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(input.candidateSha)) {
    throw new TypeError("candidateSha must be a full Git commit SHA");
  }
  if (input.commands.length === 0 || input.commands.some((command) => !command.trim())) {
    throw new TypeError("commands must contain at least one nonempty command");
  }
  const limits = limitsFor(input.limits);
  const image = input.image ?? DEFAULT_VERIFICATION_IMAGE;
  if (!/^[A-Za-z0-9][A-Za-z0-9_./:@-]*$/.test(image)) {
    throw new TypeError("image must be a local Docker image reference without whitespace or options");
  }
  let repositoryPathForContainment: string;
  try {
    repositoryPathForContainment = realpathSync(input.repositoryPath);
  } catch {
    repositoryPathForContainment = resolve(input.repositoryPath);
  }
  const requestedArtifactRelative = relative(repositoryPathForContainment, resolve(input.artifactDir));
  if (!requestedArtifactRelative.startsWith("..") && !isAbsolute(requestedArtifactRelative)) {
    throw new Error("artifactDir must be outside the target repository");
  }
  mkdirSync(input.artifactDir, { recursive: true });
  const artifactRoot = realpathSync(input.artifactDir);
  const artifactRelativeToRepository = relative(repositoryPathForContainment, artifactRoot);
  if (!artifactRelativeToRepository.startsWith("..") && !isAbsolute(artifactRelativeToRepository)) {
    throw new Error("artifactDir must be outside the target repository");
  }
  const evidenceDir = realpathSync(mkdtempSync(join(resolve(input.artifactDir), "verification-")));
  const temporaryDir = mkdtempSync(join(evidenceDir, ".candidate-"));
  const exportDir = join(temporaryDir, "export");
  const archivePath = join(temporaryDir, "candidate.tar");
  mkdirSync(exportDir, { mode: 0o755 });
  chmodSync(exportDir, 0o755);
  const result: VerificationResult = {
    candidateCommit: input.candidateSha.toLowerCase(),
    candidateTree: null,
    image,
    checks: [],
    manifestPath: join(evidenceDir, "manifest.json"),
    exportStatus: "unavailable",
    reason: null,
  };
  persistManifest(result);

  try {
    try {
      const repositoryPath = realpathSync(input.repositoryPath);
      const resolved = (await runTool("git", ["-C", repositoryPath, "rev-parse", "--verify", `${result.candidateCommit}^{commit}`], 30_000, input.signal))
        .toString("utf8").trim();
      if (resolved !== result.candidateCommit) throw new Error("Candidate did not resolve to the requested commit");
      result.candidateTree = (await runTool("git", ["-C", repositoryPath, "rev-parse", `${resolved}^{tree}`], 30_000, input.signal))
        .toString("utf8").trim();
      const format = (await runTool("git", ["-C", repositoryPath, "rev-parse", "--show-object-format"], 30_000, input.signal))
        .toString("utf8").trim();
      if (format !== "sha1" && format !== "sha256") throw new Error(`Unsupported Git object format: ${format}`);
      const entries = parseTree(await runTool("git", ["-C", repositoryPath, "ls-tree", "-r", "-z", "--full-tree", resolved], 30_000, input.signal));
      await runTool("git", ["-C", repositoryPath, "archive", "--format=tar", `--output=${archivePath}`, resolved], 30_000, input.signal);
      await runTool("tar", ["-xf", archivePath, "-C", exportDir], 30_000, input.signal);
      if (input.signal?.aborted) throw new Error("Verification cancelled");
      await assertExactExport(exportDir, entries, format, input.signal);
      if (input.signal?.aborted) throw new Error("Verification cancelled");
      if (existsSync(join(exportDir, ".git"))) throw new Error("Export unexpectedly contains .git metadata");
      if (exportDir.includes(",")) throw new Error("Export path contains a comma unsupported by Docker --mount");
      result.exportStatus = "ready";
      persistManifest(result);
    } catch (error) {
      result.reason = `Candidate export unavailable: ${error instanceof Error ? error.message : String(error)}`;
      input.commands.forEach((command, index) => {
        result.checks.push(unavailableCheck(result, command, index, evidenceDir, result.reason!));
      });
      persistManifest(result);
      return result;
    }

    let infrastructureFailure: string | null = null;
    for (const [index, command] of input.commands.entries()) {
      if (input.signal?.aborted) infrastructureFailure = "Verification cancelled";
      if (infrastructureFailure) {
        result.checks.push(unavailableCheck(result, command, index, evidenceDir, infrastructureFailure));
        persistManifest(result);
        continue;
      }
      const startedAt = new Date().toISOString();
      const name = `factory-verify-${randomUUID()}`;
      const args = [
        "run", "--rm", "--pull=never", "--name", name,
        "--network=none", "--read-only", "--cap-drop=ALL",
        "--security-opt=no-new-privileges", "--user=65534:65534",
        `--pids-limit=${limits.pids}`, `--cpus=${limits.cpus}`,
        `--memory=${limits.memoryMb}m`, `--memory-swap=${limits.memoryMb}m`,
        "--mount", `type=bind,source=${exportDir},target=/src,readonly`,
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
        "--workdir=/src", "--env=HOME=/tmp", "--entrypoint=/bin/sh",
        image, "-lc", command,
      ];
      const outcome = await runDocker(args, name, limits, input.signal);
      const finishedAt = new Date().toISOString();
      const logPath = join(evidenceDir, `check-${String(index + 1).padStart(3, "0")}.log`);
      writeFileSync(logPath, outcome.output, { mode: 0o600 });
      let status: VerificationCheck["status"] = outcome.exitCode === 0 ? "passed" : "failed";
      let reason: string | null = null;
      if (outcome.aborted) {
        status = "unavailable";
        reason = `Verification cancelled${outcome.cleanupError ? `; container removal failed: ${outcome.cleanupError}` : ""}`;
        infrastructureFailure = reason;
      } else if (outcome.launchError || outcome.exitCode === 125 ||
        /permission denied while trying to connect to (?:the )?docker|cannot connect to the docker daemon|failed to connect to docker|docker daemon is not running/i.test(outcome.output)) {
        status = "unavailable";
        reason = `Docker unavailable: ${outcome.launchError ?? outcome.output.trim()}`;
        infrastructureFailure = reason;
      } else if (outcome.timedOut) {
        status = "unavailable";
        reason = `Check exceeded ${limits.timeoutMs} ms; container removal ${outcome.cleanupError ? `failed: ${outcome.cleanupError}` : "attempted"}`;
      } else if (outcome.exitCode === 137) {
        status = "unavailable";
        reason = "Check was killed at the configured resource limit";
      } else if (outcome.exitCode === 126 || outcome.exitCode === 127) {
        status = "unavailable";
        reason = "Required executable is unavailable in the verification image";
      } else if (/read-only file system|\bEROFS\b|(?:EACCES|permission denied).{0,120}\/src/i.test(outcome.output)) {
        status = "unavailable";
        reason = "Check requires writes to the read-only candidate or container filesystem";
      }
      result.checks.push({
        candidateCommit: result.candidateCommit,
        candidateTree: result.candidateTree,
        command,
        status,
        exitCode: outcome.exitCode,
        startedAt,
        finishedAt,
        logPath,
        reason,
      });
      persistManifest(result);
    }
    return result;
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}
