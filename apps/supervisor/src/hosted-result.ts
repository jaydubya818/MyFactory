import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath, stat, unlink } from "node:fs/promises";
import { join, sep } from "node:path";
import { promisify } from "node:util";
import type { FactoryStorage } from "../../../packages/storage/src/index.ts";
import { git } from "./git.ts";

const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const execFileAsync = promisify(execFile);

async function verifyPatchReconstructsTree(workspacePath: string, root: string,
  baseCommit: string, patchPath: string, expectedTree: string) {
  const index = join(root, `result-verify-${randomUUID()}.index`);
  const environment = { ...process.env, GIT_INDEX_FILE: index };
  const run = (args: string[]) => execFileAsync("git", ["-C", workspacePath, ...args], {
    env: environment, encoding: "utf8", timeout: 30_000, maxBuffer: 2_000_000,
  });
  try {
    await run(["read-tree", baseCommit]);
    await run(["apply", "--cached", "--binary", patchPath]);
    const { stdout } = await run(["write-tree"]);
    if (stdout.trim() !== expectedTree) throw new Error("Candidate patch does not reconstruct the attested tree");
  } finally {
    await unlink(index).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function artifact(root: string, path: string, kind: "patch" | "log") {
  const [base, actual] = await Promise.all([realpath(root), realpath(path)]);
  const details = await stat(actual);
  if (!actual.startsWith(`${base}${sep}`) || !details.isFile() || details.size > 16_000)
    throw new Error("Hosted result artifact exceeds its bound or escapes custody");
  const bytes = await readFile(actual);
  return { id: `${kind}:${hash(bytes)}`, kind, byteLength: bytes.length,
    sha256: hash(bytes), bytes: bytes.toString("base64url") };
}

/** Builds a bounded immutable export from one saved, completed attempt. The
 * caller signs the returned exact bytes with the configured Factory key. */
export async function freezeHostedResult(storage: FactoryStorage, dataDir: string,
  issueId: string, workOrderId: string, runId: string): Promise<string> {
  const saved = storage.getHostedResult(issueId, runId);
  if (saved) return saved.encoded;
  const binding = storage.getHostedBinding(workOrderId);
  const work = storage.getWorkOrder(workOrderId);
  const run = storage.getRun(runId);
  if (!binding || binding.issueId !== issueId || !work || !run || run.workOrderId !== workOrderId ||
      run.state !== "ready_for_review" || work.state !== "ready_for_review" || !run.candidateCommit)
    throw new Error("Hosted result requires one bound completed attempt");
  const events = storage.listEvents(workOrderId).filter(event => event.runId === runId);
  const one = (type: string) => {
    const matches = events.filter(event => event.type === type);
    if (matches.length !== 1) throw new Error(`Hosted result requires one ${type}`);
    return matches[0];
  };
  const snapshot = one("run.factory_version_attested").payload;
  const candidate = one("run.candidate_committed").payload;
  const started = one("run.started").payload;
  const implementing = one("run.implementing").payload;
  const expected = binding.binding as { expectedFactoryId?: string; expectedFactoryVersion?: unknown };
  if (snapshot.factoryId !== expected.expectedFactoryId ||
      JSON.stringify(snapshot.factoryVersion) !== JSON.stringify(expected.expectedFactoryVersion) ||
      snapshot.requestBindingDigest !== binding.digest || snapshot.issueId !== issueId ||
      snapshot.inputCommit !== run.inputCommit || snapshot.attemptNumber !== run.attemptNumber ||
      (snapshot.effectiveConfiguration as { model?: string })?.model !== started.model ||
      (snapshot.effectiveConfiguration as { agentVersion?: string })?.agentVersion !== implementing.agentVersion ||
      candidate.candidateCommit !== run.candidateCommit)
    throw new Error("Saved attempt does not match its authenticated FactoryVersion or candidate");
  const checks = storage.listChecks(runId);
  const required = work.kind === "defect" && work.reproductionCommand
    ? [...new Set([work.reproductionCommand, ...work.checkCommands])] : work.checkCommands;
  if (checks.length !== required.length || checks.some((check, i) => check.command !== required[i] ||
      check.candidateCommit !== run.candidateCommit || check.status !== "passed" || check.exitCode !== 0 ||
      !check.logSha256)) throw new Error("Hosted result evidence is incomplete");
  const root = join(dataDir, "artifacts", runId);
  const patch = await artifact(root, String(candidate.diffPath), "patch");
  if (patch.sha256 !== candidate.diffSha256) throw new Error("Candidate patch changed before attestation");
  const logs = await Promise.all(checks.map(check => artifact(root, check.logPath, "log")));
  if (logs.some((log, i) => log.sha256 !== checks[i].logSha256))
    throw new Error("Check evidence changed before attestation");
  const objects = [patch, ...logs];
  if (new Set(objects.map(item => item.id)).size !== objects.length)
    throw new Error("Duplicate hosted artifact identity");
  const actualTree = (await git(run.workspacePath, ["rev-parse", `${run.candidateCommit}^{tree}`])).trim();
  await verifyPatchReconstructsTree(run.workspacePath, root, run.inputCommit,
    String(candidate.diffPath), actualTree);
  const commitObject = await git(run.workspacePath, ["cat-file", "commit", run.candidateCommit]);
  if (actualTree !== candidate.candidateTree || !commitObject.includes(`tree ${actualTree}\n`) ||
      !commitObject.includes(`parent ${run.inputCommit}\n`))
    throw new Error("Candidate Git object differs from saved attempt");
  const manifest = {
    requestBindingDigest: binding.digest, workOrderId, runId, attemptNumber: run.attemptNumber,
    inputCommit: run.inputCommit, candidateCommit: run.candidateCommit, candidateTree: actualTree,
    changedPaths: candidate.changedPaths, commitObject: Buffer.from(commitObject).toString("base64url"),
    checks: checks.map(check => ({ id: check.id, command: check.command,
      candidateCommit: check.candidateCommit, status: check.status, exitCode: check.exitCode,
      startedAt: check.startedAt, finishedAt: check.finishedAt, logSha256: check.logSha256 })),
    artifacts: objects,
  };
  const result = { version: 1, keyVersion: "ed25519-v1", issueId,
    operationId: hash(JSON.stringify(["myfactory-result-v1", issueId, runId])),
    factoryId: snapshot.factoryId, factoryVersion: snapshot.factoryVersion,
    manifestDigest: hash(JSON.stringify(manifest)), manifest, issuedAt: new Date().toISOString() };
  const encoded = Buffer.from(JSON.stringify(result)).toString("base64url");
  if (encoded.length > 48_000 || Buffer.byteLength(JSON.stringify(result)) > 36_000)
    throw new Error("Hosted candidate exceeds bounded result transport");
  storage.saveHostedResult({ operationId: result.operationId, issueId, workOrderId, runId,
    encoded, digest: hash(encoded) });
  return encoded;
}
