import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
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

export const MAX_HOSTED_ARTIFACT_BYTES = 128_000;
export const MAX_HOSTED_RESULT_ARTIFACT_BYTES = 256_000;
export const HOSTED_ARTIFACT_CHUNK_BYTES = 8_000;

async function artifact(root: string, path: string, kind: "patch" | "log") {
  const [base, actual] = await Promise.all([realpath(root), realpath(path)]);
  const details = await stat(actual);
  if (!actual.startsWith(`${base}${sep}`) || !details.isFile() || details.size > MAX_HOSTED_ARTIFACT_BYTES)
    throw new Error("Hosted result artifact exceeds its bound or escapes custody");
  const bytes = await readFile(actual);
  return { id: `${kind}:${hash(bytes)}`, kind, byteLength: bytes.length,
    sha256: hash(bytes), bytes };
}

/** The reference is an identity only. Connection authentication and the exact
 * WorkOrder/request/attempt binding authorize every read. */
export function hostedArtifactPath(dataDir: string, operationId: string, artifactId: string): string {
  if (!/^[a-f0-9]{64}$/.test(operationId) || !/^(patch|log):[a-f0-9]{64}$/.test(artifactId))
    throw new Error("Invalid hosted artifact identity");
  return join(dataDir, "hosted-result-artifacts", operationId, artifactId);
}

async function preserveArtifact(dataDir: string, operationId: string, item: Awaited<ReturnType<typeof artifact>>) {
  const path = hostedArtifactPath(dataDir, operationId, item.id);
  await mkdir(join(dataDir, "hosted-result-artifacts", operationId), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, item.bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path);
    if (existing.length !== item.byteLength || hash(existing) !== item.sha256)
      throw new Error("Hosted artifact custody conflict");
  }
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
  if (objects.reduce((size, item) => size + item.byteLength, 0) > MAX_HOSTED_RESULT_ARTIFACT_BYTES)
    throw new Error("Hosted result artifacts exceed aggregate bound");
  if (new Set(objects.map(item => item.id)).size !== objects.length)
    throw new Error("Duplicate hosted artifact identity");
  const actualTree = (await git(run.workspacePath, ["rev-parse", `${run.candidateCommit}^{tree}`])).trim();
  await verifyPatchReconstructsTree(run.workspacePath, root, run.inputCommit,
    String(candidate.diffPath), actualTree);
  const commitObject = await git(run.workspacePath, ["cat-file", "commit", run.candidateCommit]);
  if (actualTree !== candidate.candidateTree || !commitObject.includes(`tree ${actualTree}\n`) ||
      !commitObject.includes(`parent ${run.inputCommit}\n`))
    throw new Error("Candidate Git object differs from saved attempt");
  const operationId = hash(JSON.stringify(["myfactory-result-v1", issueId, runId]));
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  for (const item of objects) await preserveArtifact(dataDir, operationId, item);
  const manifest = {
    requestBindingDigest: binding.digest, workOrderId, runId, attemptNumber: run.attemptNumber,
    inputCommit: run.inputCommit, candidateCommit: run.candidateCommit, candidateTree: actualTree,
    changedPaths: candidate.changedPaths, commitObject: Buffer.from(commitObject).toString("base64url"),
    checks: checks.map(check => ({ id: check.id, command: check.command,
      candidateCommit: check.candidateCommit, status: check.status, exitCode: check.exitCode,
      startedAt: check.startedAt, finishedAt: check.finishedAt, logSha256: check.logSha256 })),
    artifacts: objects.map(({ bytes: _bytes, ...item }) => ({ ...item,
      reference: { version: 1, transport: "linear-comments-v1", expiresAt } })),
  };
  const result = { version: 1, keyVersion: "ed25519-v1", issueId,
    operationId,
    factoryId: snapshot.factoryId, factoryVersion: snapshot.factoryVersion,
    manifestDigest: hash(JSON.stringify(manifest)), manifest, issuedAt: new Date().toISOString() };
  const encoded = Buffer.from(JSON.stringify(result)).toString("base64url");
  if (encoded.length > 48_000 || Buffer.byteLength(JSON.stringify(result)) > 36_000)
    throw new Error("Hosted candidate exceeds bounded result transport");
  storage.saveHostedResult({ operationId: result.operationId, issueId, workOrderId, runId,
    encoded, digest: hash(encoded) });
  return encoded;
}

export const HOSTED_CHUNK_MARKER = "MYFACTORY_ARTIFACT_CHUNK_V1";
export const HOSTED_CHUNK_QUERY = `query FactoryArtifactChunks($id: String!, $after: String) {
  issue(id: $id) { id comments(first: 50, after: $after) {
    nodes { id body } pageInfo { hasNextPage endCursor }
  } }
}`;

type ArtifactGraphql = { graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> };
type ChunkComment = { id: string; body: string };

function chunkId(operationId: string, artifactId: string, index: number): string {
  const digest = hash(JSON.stringify(["myfactory-artifact-chunk-v1", operationId, artifactId, index]));
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function sameChunkBody(actual: string | undefined, expected: string): boolean {
  if (actual === expected) return true;
  if (typeof actual !== "string") return false;
  const marker = `<!-- ${HOSTED_CHUNK_MARKER} -->`;
  const end = `<!-- /${HOSTED_CHUNK_MARKER} -->`;
  const payload = (body: string) => {
    const normalized = body.trim().replace(/\r\n/g, "\n");
    if (!normalized.startsWith(marker) || !normalized.endsWith(end)) return null;
    try { return JSON.stringify(JSON.parse(normalized.slice(marker.length, -end.length).trim())); }
    catch { return null; }
  };
  return payload(actual) !== null && payload(actual) === payload(expected);
}

/** Read every comment page so a retry can reconcile uncertain mutations before
 * it creates any new chunk. Linear authentication is supplied by the caller. */
async function listArtifactComments(linear: ArtifactGraphql, issueId: string): Promise<ChunkComment[]> {
  const comments: ChunkComment[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const result: { issue: { id: string; comments: { nodes: ChunkComment[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null } =
      await linear.graphql(HOSTED_CHUNK_QUERY, { id: issueId, after });
    if (result.issue?.id !== issueId || !Array.isArray(result.issue.comments?.nodes))
      throw new Error("Hosted artifact issue identity changed");
    comments.push(...result.issue.comments.nodes);
    if (!result.issue.comments.pageInfo.hasNextPage) return comments;
    after = result.issue.comments.pageInfo.endCursor;
    if (!after) throw new Error("Hosted artifact comment cursor is missing");
  }
  throw new Error("Hosted artifact comment pagination bound exceeded");
}

/** Publish chunks before publishing the signed manifest. Deterministic comment
 * IDs plus readback make retries safe after an unknown provider outcome. */
export async function publishHostedArtifacts(linear: ArtifactGraphql, storage: FactoryStorage,
  dataDir: string, issueId: string, workOrderId: string, runId: string, encoded: string): Promise<void> {
  const binding = storage.getHostedBinding(workOrderId);
  const saved = storage.getHostedResult(issueId, runId);
  if (!binding || binding.issueId !== issueId || !saved || saved.encoded !== encoded ||
      storage.getRun(runId)?.workOrderId !== workOrderId)
    throw new Error("Hosted artifact publication requires exact saved result binding");
  const result = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    operationId: string; manifest: { artifacts: { id: string; byteLength: number; sha256: string;
      reference: { expiresAt: string } }[] } };
  if (!/^[a-f0-9]{64}$/.test(result.operationId) || result.manifest.artifacts.length > 21)
    throw new Error("Invalid saved hosted artifact manifest");
  const existing = new Map((await listArtifactComments(linear, issueId)).map(comment => [comment.id, comment.body]));
  for (const item of result.manifest.artifacts) {
    if (!/^(patch|log):[a-f0-9]{64}$/.test(item.id) || item.byteLength > MAX_HOSTED_ARTIFACT_BYTES ||
        Date.parse(item.reference.expiresAt) <= Date.now())
      throw new Error("Invalid hosted artifact bound");
    const bytes = await readFile(hostedArtifactPath(dataDir, result.operationId, item.id));
    if (bytes.length !== item.byteLength || hash(bytes) !== item.sha256)
      throw new Error("Hosted artifact changed before publication");
    const count = Math.max(1, Math.ceil(bytes.length / HOSTED_ARTIFACT_CHUNK_BYTES));
    for (let index = 0; index < count; index++) {
      const id = chunkId(result.operationId, item.id, index);
      const body = `<!-- ${HOSTED_CHUNK_MARKER} -->\n${JSON.stringify({ version: 1,
        operationId: result.operationId, artifactId: item.id, index, count,
        bytes: bytes.subarray(index * HOSTED_ARTIFACT_CHUNK_BYTES,
          (index + 1) * HOSTED_ARTIFACT_CHUNK_BYTES).toString("base64url") })}\n<!-- /${HOSTED_CHUNK_MARKER} -->`;
      if (existing.has(id)) {
        if (!sameChunkBody(existing.get(id), body)) throw new Error("Hosted artifact chunk conflict");
        continue;
      }
      try {
        const created = await linear.graphql<{ commentCreate: { success: boolean;
          comment: ChunkComment | null } }>(
          "mutation FactoryArtifactChunk($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body } } }",
          { input: { id, issueId, body } });
        if (!created.commentCreate?.success || created.commentCreate.comment?.id !== id ||
            !sameChunkBody(created.commentCreate.comment?.body, body))
          throw new Error("Hosted artifact chunk was not confirmed");
      } catch (error) {
        const observed = (await listArtifactComments(linear, issueId)).find(comment => comment.id === id);
        if (!sameChunkBody(observed?.body, body)) throw error;
      }
      existing.set(id, body);
    }
  }
  const observed = new Map((await listArtifactComments(linear, issueId)).map(comment => [comment.id, comment.body]));
  for (const [id, body] of existing) {
    if (body.includes(HOSTED_CHUNK_MARKER) && !sameChunkBody(observed.get(id), body))
      throw new Error("Hosted artifact publication readback failed");
  }
}
