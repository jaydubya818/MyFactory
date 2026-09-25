import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const DESTINATION_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const WORK_ORDER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DraftPublicationInput {
  destination: string;
  workOrderId: string;
  workspacePath: string;
  inputCommit: string;
  candidateCommit: string;
  baseBranch: string;
  title: string;
  body: string;
}

export interface DraftPublicationResult {
  destination: string;
  branch: string;
  candidateCommit: string;
  pullRequestNumber: number;
  url: string;
  remoteIdentity: string;
  reconciled: boolean;
}

export type PublicationAdapterErrorCode = "invalid_input" | "conflict" | "unavailable" | "uncertain";

export class PublicationAdapterError extends Error {
  readonly code: PublicationAdapterErrorCode;

  constructor(
    code: PublicationAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PublicationAdapterError";
    this.code = code;
  }
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  timeoutMs: number;
}

export type CommandRunner = (
  file: "git" | "gh",
  args: string[],
  options: CommandOptions,
) => Promise<CommandResult>;

export interface DraftPublicationOptions {
  runner?: CommandRunner;
  /** Reconcile a previously uncertain operation without another remote mutation. */
  reconcileOnly?: boolean;
}

interface GitHubReference {
  ref: string;
  object: { sha: string };
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
  state: string;
  draft: boolean;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string };
}

type Inspection =
  | { state: "absent"; branch: string }
  | { state: "branch_only"; branch: string }
  | { state: "published"; branch: string; pullRequest: GitHubPullRequest };

async function defaultRunner(
  file: "git" | "gh",
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
    };
  }
}

function branchFor(workOrderId: string): string {
  if (!WORK_ORDER_PATTERN.test(workOrderId)) {
    throw new PublicationAdapterError("invalid_input", "WorkOrder ID must be a UUID");
  }
  return `codex/factory/wo-${workOrderId.toLowerCase()}`;
}

function validateInput(input: DraftPublicationInput): string {
  if (!DESTINATION_PATTERN.test(input.destination) || input.destination.endsWith(".git")) {
    throw new PublicationAdapterError("invalid_input", "Destination must be owner/repo");
  }
  if (!isAbsolute(input.workspacePath)) {
    throw new PublicationAdapterError("invalid_input", "Workspace path must be absolute");
  }
  if (!SHA_PATTERN.test(input.inputCommit) || !SHA_PATTERN.test(input.candidateCommit) ||
      input.inputCommit === input.candidateCommit) {
    throw new PublicationAdapterError("invalid_input", "Candidate and input must be distinct commit SHAs");
  }
  const base = input.baseBranch;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base) || base.includes("..") ||
      base.includes("//") || base.endsWith("/") || base.endsWith(".") ||
      base.split("/").some((segment) => segment.endsWith(".lock"))) {
    throw new PublicationAdapterError("invalid_input", "Base branch name is invalid");
  }
  if (!input.title.trim() || input.title.length > 256 || input.body.length > 100_000) {
    throw new PublicationAdapterError("invalid_input", "Draft PR title or body is invalid");
  }
  return branchFor(input.workOrderId);
}

function parsedJson(value: string, description: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new PublicationAdapterError("unavailable", `GitHub returned an invalid ${description} response`);
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isNotFound(result: CommandResult): boolean {
  return result.exitCode !== 0 && /\bHTTP 404\b/i.test(result.stderr);
}

async function checked(
  runner: CommandRunner,
  file: "git" | "gh",
  args: string[],
  description: string,
  timeoutMs = 30_000,
): Promise<CommandResult> {
  const result = await runner(file, args, { timeoutMs });
  if (result.exitCode !== 0) {
    throw new PublicationAdapterError("unavailable", `${description} failed; check GitHub access and local credentials`);
  }
  return result;
}

async function ghApi(
  runner: CommandRunner,
  endpoint: string,
  args: string[] = [],
): Promise<CommandResult> {
  return runner("gh", ["api", "--hostname", "github.com", endpoint, ...args], { timeoutMs: 30_000 });
}

async function verifyLocalCandidate(input: DraftPublicationInput, runner: CommandRunner): Promise<void> {
  const head = (await checked(runner, "git", ["-C", input.workspacePath, "rev-parse", "--verify", "HEAD"],
    "Local candidate inspection")).stdout.trim();
  if (head !== input.candidateCommit) {
    throw new PublicationAdapterError("conflict", "Workspace HEAD changed after candidate review");
  }
  const parents = (await checked(runner, "git", ["-C", input.workspacePath,
    "rev-list", "--parents", "-n", "1", input.candidateCommit], "Local candidate parent inspection"))
    .stdout.trim().split(/\s+/);
  if (parents.length !== 2 || parents[0] !== input.candidateCommit || parents[1] !== input.inputCommit) {
    throw new PublicationAdapterError("conflict", "Candidate is no longer based on the reviewed input commit");
  }
}

async function readReference(
  input: DraftPublicationInput,
  runner: CommandRunner,
  branch: string,
): Promise<string | null> {
  const result = await ghApi(runner, `repos/${input.destination}/git/ref/heads/${branch}`);
  if (isNotFound(result)) return null;
  if (result.exitCode !== 0) {
    throw new PublicationAdapterError("unavailable", "Could not inspect GitHub branch state");
  }
  const record = object(parsedJson(result.stdout, "branch"));
  const gitObject = object(record?.object);
  const sha = gitObject?.sha;
  if (record?.ref !== `refs/heads/${branch}` || typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
    throw new PublicationAdapterError("unavailable", "GitHub returned an invalid branch reference");
  }
  return sha;
}

async function readPullRequests(
  input: DraftPublicationInput,
  runner: CommandRunner,
  branch: string,
): Promise<GitHubPullRequest[]> {
  const [owner] = input.destination.split("/");
  const result = await ghApi(runner, `repos/${input.destination}/pulls`, [
    "--method", "GET", "-f", "state=all", "-f", `head=${owner}:${branch}`,
    "-f", "per_page=100", "--paginate", "--slurp",
  ]);
  if (result.exitCode !== 0) {
    throw new PublicationAdapterError("unavailable", "Could not inspect existing GitHub pull requests");
  }
  const pages = parsedJson(result.stdout, "pull request list");
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new PublicationAdapterError("unavailable", "GitHub returned an invalid pull request list");
  }
  return pages.flat() as GitHubPullRequest[];
}

async function inspectRemote(
  input: DraftPublicationInput,
  runner: CommandRunner,
  branch: string,
  requireUnchangedBase = true,
): Promise<Inspection> {
  const repository = await ghApi(runner, `repos/${input.destination}`);
  if (repository.exitCode !== 0) {
    throw new PublicationAdapterError("unavailable", "Could not access the approved GitHub repository");
  }
  const repo = object(parsedJson(repository.stdout, "repository"));
  if (typeof repo?.full_name !== "string" ||
      repo.full_name.toLowerCase() !== input.destination.toLowerCase()) {
    throw new PublicationAdapterError("conflict", "GitHub repository identity differs from the approved destination");
  }
  if (requireUnchangedBase) {
    const baseSha = await readReference(input, runner, input.baseBranch);
    if (baseSha === null || baseSha !== input.inputCommit) {
      throw new PublicationAdapterError("conflict", "Base branch changed since the candidate was verified");
    }
  }
  const remoteCommit = await readReference(input, runner, branch);
  const pulls = await readPullRequests(input, runner, branch);
  if (pulls.length > 1) {
    throw new PublicationAdapterError("conflict", "Multiple pull requests use this WorkOrder branch");
  }
  const pull = pulls[0];
  if (pull) {
    const pullHead = object(pull.head);
    const pullRepo = object(pullHead?.repo);
    const pullBase = object(pull.base);
    if (!object(pull) || !pullHead || !pullBase || !pullRepo ||
        typeof pullRepo.full_name !== "string" ||
        pullRepo.full_name.toLowerCase() !== input.destination.toLowerCase() ||
        pullHead.ref !== branch || pullBase.ref !== input.baseBranch ||
        pull.state !== "open" || pull.draft !== true ||
        !Number.isSafeInteger(pull.number) || pull.number <= 0 ||
        pull.html_url !== `https://github.com/${input.destination}/pull/${pull.number}`) {
      throw new PublicationAdapterError("conflict", "Existing pull request differs from the approved draft destination");
    }
    if (remoteCommit !== input.candidateCommit || pullHead.sha !== input.candidateCommit) {
      throw new PublicationAdapterError("conflict", "Existing pull request points to a different candidate");
    }
    return { state: "published", branch, pullRequest: pull };
  }
  if (remoteCommit !== null && remoteCommit !== input.candidateCommit) {
    throw new PublicationAdapterError("conflict", "WorkOrder branch already points to another commit");
  }
  return remoteCommit === null ? { state: "absent", branch } : { state: "branch_only", branch };
}

function resultFor(input: DraftPublicationInput, inspection: Extract<Inspection, { state: "published" }>, reconciled: boolean): DraftPublicationResult {
  return {
    destination: input.destination,
    branch: inspection.branch,
    candidateCommit: input.candidateCommit,
    pullRequestNumber: inspection.pullRequest.number,
    url: inspection.pullRequest.html_url,
    remoteIdentity: `${input.destination}#${inspection.pullRequest.number}`,
    reconciled,
  };
}

/**
 * Reconcile remote state before any mutation. A previously unknown action must
 * call with reconcileOnly and remain held unless the exact draft PR is found.
 */
export async function publishDraftPullRequest(
  input: DraftPublicationInput,
  options: DraftPublicationOptions = {},
): Promise<DraftPublicationResult> {
  const branch = validateInput(input);
  const runner = options.runner ?? defaultRunner;
  if (!options.reconcileOnly) await verifyLocalCandidate(input, runner);
  let inspection = await inspectRemote(input, runner, branch, !options.reconcileOnly);
  if (inspection.state === "published") return resultFor(input, inspection, true);
  if (options.reconcileOnly) {
    throw new PublicationAdapterError("uncertain", "Remote publication has not been proven; manual reconciliation is required");
  }

  if (inspection.state === "absent") {
    const ref = `refs/heads/${branch}`;
    await runner("git", ["-C", input.workspacePath, "push", "--no-verify", "--porcelain",
      `--force-with-lease=${ref}:`, `https://github.com/${input.destination}.git`,
      `${input.candidateCommit}:${ref}`], { timeoutMs: 120_000 });
    try {
      inspection = await inspectRemote(input, runner, branch);
    } catch {
      throw new PublicationAdapterError("uncertain", "Remote branch state is uncertain after the push attempt");
    }
    if (inspection.state === "published") return resultFor(input, inspection, true);
    if (inspection.state !== "branch_only") {
      throw new PublicationAdapterError("uncertain", "Remote branch did not confirm the approved candidate");
    }
    // A lost push response is safe to advance past only because the exact remote SHA was read back.
  }

  const [owner] = input.destination.split("/");
  const created = await ghApi(runner, `repos/${input.destination}/pulls`, [
    "--method", "POST", "-f", `title=${input.title}`, "-f", `body=${input.body}`,
    "-f", `head=${owner}:${branch}`, "-f", `base=${input.baseBranch}`,
    "-F", "draft=true",
  ]);
  try {
    const confirmed = await inspectRemote(input, runner, branch);
    if (confirmed.state === "published") return resultFor(input, confirmed, created.exitCode !== 0);
  } catch {
    // A failed or ambiguous create response cannot authorize a second create.
  }
  throw new PublicationAdapterError("uncertain", "Draft PR creation could not be confirmed on GitHub");
}
