import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, lstat, unlink, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(repositoryPath: string, args: string[]): Promise<string> {
  return gitWithEnv(repositoryPath, args, {});
}

async function gitWithEnv(
  repositoryPath: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30_000,
    env: { ...process.env, ...environment },
  });
  return stdout;
}

export async function resolveCommit(repositoryPath: string, baseRef: string): Promise<string> {
  if (!baseRef || baseRef.startsWith("-")) throw new Error("Invalid base ref");
  const commit = (await git(repositoryPath, ["rev-parse", "--verify", `${baseRef}^{commit}`])).trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error("Base ref did not resolve to a commit");
  return commit;
}

export async function createTaskWorktree(
  repositoryPath: string,
  inputCommit: string,
  workspacesDir: string,
): Promise<string> {
  await mkdir(workspacesDir, { recursive: true, mode: 0o700 });
  const workspacePath = join(workspacesDir, randomUUID());
  await git(repositoryPath, ["worktree", "add", "--detach", workspacePath, inputCommit]);
  return workspacePath;
}

export async function removeTaskWorktree(repositoryPath: string, workspacePath: string): Promise<void> {
  await git(repositoryPath, ["worktree", "remove", "--force", workspacePath]);
}

function allowed(path: string, scopes: string[]): boolean {
  return scopes.some((scope) => {
    const normalized = posix.normalize(scope.replaceAll("\\", "/"));
    if (normalized.endsWith("/**")) {
      const prefix = normalized.slice(0, -2);
      return path.startsWith(prefix);
    }
    if (normalized.endsWith("/")) return path.startsWith(normalized);
    return path === normalized;
  });
}

function parseStatusPaths(raw: string): string[] {
  const records = raw.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") throw new Error("Invalid git status output");
    const code = record.slice(0, 2);
    paths.push(record.slice(3));
    if (code.includes("R") || code.includes("C")) {
      const second = records[++index];
      if (!second) throw new Error("Invalid rename in git status output");
      paths.push(second);
    }
  }
  return [...new Set(paths)];
}

async function validateChangedPaths(workspacePath: string, scopes: string[]): Promise<string[]> {
  const paths = parseStatusPaths(await git(workspacePath, [
    "status", "--porcelain=v1", "-z", "--untracked-files=all",
  ]));
  if (paths.length === 0) throw new Error("Agent produced no source changes");
  for (const path of paths) {
    if (
      path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") ||
      path.split("/").includes(".git") || !allowed(path, scopes)
    ) {
      throw new Error(`Changed path is outside the approved scope: ${path}`);
    }
    let component = workspacePath;
    for (const segment of path.split("/")) {
      component = join(component, segment);
      try {
        const stat = await lstat(component);
        if (stat.isSymbolicLink()) throw new Error(`Symlink change requires review: ${path}`);
      } catch (error) {
        if (error instanceof Error && error.message.includes("Symlink change")) throw error;
        if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error;
      }
    }
  }
  return paths;
}

function validateStagedModes(raw: string): void {
  const records = raw.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const header = records[index];
    if (!header) continue;
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])/.exec(header);
    if (!match) throw new Error("Invalid staged diff metadata");
    const [, oldMode, newMode, change] = match;
    const path = records[++index];
    if (!path) throw new Error("Missing staged diff path");
    if (change === "R" || change === "C") index += 1;
    if ([oldMode, newMode].includes("120000") || [oldMode, newMode].includes("160000")) {
      throw new Error(`Symlink or submodule change requires review: ${path}`);
    }
    if (oldMode !== "000000" && newMode !== "000000" && oldMode !== newMode) {
      throw new Error(`File mode change requires review: ${path}`);
    }
    if (oldMode === "000000" && newMode !== "100644") {
      throw new Error(`New file mode requires review: ${path}`);
    }
  }
}

export interface CandidateCommit {
  commit: string;
  tree: string;
  changedPaths: string[];
  diffPath: string;
}

export async function commitCandidate(
  workspacePath: string,
  inputCommit: string,
  allowedPaths: string[],
  artifactDir: string,
): Promise<CandidateCommit> {
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  const baseCommit = (await git(workspacePath, ["rev-parse", "HEAD"])).trim();
  if (baseCommit !== inputCommit) {
    throw new Error("Workspace HEAD changed during agent execution; candidate requires investigation");
  }
  const observedPaths = await validateChangedPaths(workspacePath, allowedPaths);
  const indexPath = join(artifactDir, `candidate-${randomUUID()}.index`);
  const indexEnvironment = { GIT_INDEX_FILE: indexPath };
  const inIndex = (args: string[]) => gitWithEnv(workspacePath, args, indexEnvironment);
  try {
    await inIndex(["read-tree", baseCommit]);
    await inIndex(["add", "-A"]);
    const changedPaths = (await inIndex(["diff", "--cached", "--name-only", "-z", baseCommit]))
      .split("\0").filter(Boolean);
    if (changedPaths.length === 0) throw new Error("Agent produced no source changes");
    for (const path of changedPaths) {
      if (!observedPaths.includes(path) || !allowed(path, allowedPaths)) {
        throw new Error(`Staged path is outside the approved snapshot: ${path}`);
      }
    }
    validateStagedModes(await inIndex(["diff", "--cached", "--raw", "-z", baseCommit]));
    await inIndex(["diff", "--cached", "--check", baseCommit]);
    const tree = (await inIndex(["write-tree"])).trim();
    const commit = (await gitWithEnv(workspacePath, [
      "commit-tree", tree, "-p", baseCommit, "-m", "Factory candidate change",
    ], {
      GIT_AUTHOR_NAME: "Local Factory",
      GIT_AUTHOR_EMAIL: "factory@localhost.invalid",
      GIT_COMMITTER_NAME: "Local Factory",
      GIT_COMMITTER_EMAIL: "factory@localhost.invalid",
    })).trim();
    await git(workspacePath, ["update-ref", "HEAD", commit, baseCommit]);
    await git(workspacePath, ["read-tree", commit]);
    const diffPath = join(artifactDir, "candidate.patch");
    await writeFile(diffPath, await git(workspacePath, ["show", "--format=", "--binary", commit]), {
      mode: 0o600,
    });
    return { commit, tree, changedPaths, diffPath };
  } finally {
    await unlink(indexPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
