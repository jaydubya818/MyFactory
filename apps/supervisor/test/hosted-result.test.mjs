import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorage } from "../../../packages/storage/src/index.ts";
import { FactoryClient } from "../../../packages/client/src/index.ts";
import { readResult, resultDescription } from "../../../packages/hosted-routing/src/index.mjs";
import { freezeHostedResult, publishHostedArtifacts, HOSTED_CHUNK_MARKER } from "../src/hosted-result.ts";
import { createSupervisor } from "../src/server.ts";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");

test("freezes one real candidate and check log, verifies signature, and replays saved bytes", async t => {
  const root = mkdtempSync(join(tmpdir(), "factory-result-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repositoryPath = join(root, "repo");
  mkdirSync(repositoryPath);
  const git = (...args) => execFileSync("git", ["-C", repositoryPath, ...args],
    { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(repositoryPath, "app.txt"), "before\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const inputCommit = git("rev-parse", "HEAD");
  writeFileSync(join(repositoryPath, "app.txt"), "after\n");
  git("add", ".");
  git("commit", "-qm", "candidate");
  const candidateCommit = git("rev-parse", "HEAD");
  const candidateTree = git("rev-parse", "HEAD^{tree}");

  const storage = openStorage(join(root, "factory.sqlite"));
  t.after(() => storage.close());
  const order = storage.createWorkOrder({ title: "Fixture change", description: "Test bound export",
    kind: "feature", repositoryPath, baseRef: inputCommit, acceptanceCriteria: ["Change app"],
    reproductionCommand: null, expectedFailureText: null, checkCommands: ["git diff --check"],
    allowedPaths: ["app.txt"], workerProfile: "mac" });
  const run = storage.createRun({ workOrderId: order.id, workerProfile: "mac", inputCommit,
    workspacePath: repositoryPath });
  const issueId = "linear-issue-fixture";
  const bindingDigest = "b".repeat(64);
  const factoryVersion = { sourceCommit: inputCommit, sourceTree: git("rev-parse", `${inputCommit}^{tree}`),
    configurationDigest: "c".repeat(64) };
  storage.recordHostedBinding(issueId, "myeve", order.id,
    { expectedFactoryId: "fixture-factory", expectedFactoryVersion: factoryVersion }, bindingDigest);
  const artifactRoot = join(root, "artifacts", run.id);
  mkdirSync(artifactRoot, { recursive: true });
  const patchPath = join(artifactRoot, "candidate.patch");
  const logPath = join(artifactRoot, "check.log");
  writeFileSync(patchPath, execFileSync("git", ["-C", repositoryPath, "show", "--format=", "--binary", "HEAD"]));
  writeFileSync(logPath, `check passed\n${"x".repeat(20_000)}`);
  const now = new Date().toISOString();
  storage.appendEvent({ workOrderId: order.id, runId: run.id, type: "run.started",
    payload: { model: "fixture-model" } });
  storage.appendEvent({ workOrderId: order.id, runId: run.id, type: "run.factory_version_attested",
    payload: { factoryId: "fixture-factory", factoryVersion, requestBindingDigest: bindingDigest,
      issueId, inputCommit, attemptNumber: run.attemptNumber,
      effectiveConfiguration: { model: "fixture-model", agentVersion: "fixture-agent" } } });
  storage.appendEvent({ workOrderId: order.id, runId: run.id, type: "run.implementing",
    payload: { agentVersion: "fixture-agent" } });
  storage.appendEvent({ workOrderId: order.id, runId: run.id, type: "run.candidate_committed",
    payload: { candidateCommit, candidateTree, changedPaths: ["app.txt"], diffPath: patchPath,
      diffSha256: sha(readFileSync(patchPath)) } });
  storage.insertCheck({ runId: run.id, candidateCommit, command: "git diff --check",
    status: "passed", exitCode: 0, startedAt: now, finishedAt: now,
    logPath, logSha256: sha(readFileSync(logPath)) });
  storage.saveRun({ ...run, state: "ready_for_review", candidateCommit, finishedAt: now });
  storage.saveWorkOrder({ ...order, state: "ready_for_review" });

  const encoded = await freezeHostedResult(storage, root, issueId, order.id, run.id);
  const pair = generateKeyPairSync("ed25519");
  const signed = resultDescription("Original issue", encoded, pair.privateKey);
  const verified = readResult(signed, pair.publicKey, issueId);
  assert.equal(verified.manifest.candidateCommit, candidateCommit);
  assert.equal(verified.manifest.candidateTree, candidateTree);
  assert.equal(verified.manifest.checks[0].logSha256, sha(readFileSync(logPath)));
  assert.equal(verified.factoryVersion.configurationDigest, factoryVersion.configurationDigest);
  assert.equal(verified.manifest.artifacts[0].reference.transport, "linear-comments-v1");
  assert.equal(verified.manifest.artifacts[0].bytes, undefined);
  const comments = new Map();
  let creates = 0;
  let uncertain = true;
  const linear = { async graphql(query, variables) {
    if (query.includes("query FactoryArtifactChunks")) return { issue: { id: issueId,
      comments: { nodes: [...comments].map(([id, body]) => ({ id, body })),
        pageInfo: { hasNextPage: false, endCursor: null } } } };
    if (query.includes("mutation FactoryArtifactChunk")) {
      creates++;
      const { id, body } = variables.input;
      if (comments.has(id) && comments.get(id) !== body) throw new Error("conflict");
      comments.set(id, body);
      if (uncertain) { uncertain = false; throw new Error("provider response lost"); }
      return { commentCreate: { success: true, comment: { id, body } } };
    }
    throw new Error("Unexpected GraphQL operation");
  } };
  await publishHostedArtifacts(linear, storage, root, issueId, order.id, run.id, encoded);
  assert.ok([...comments.values()].every(body => body.includes(HOSTED_CHUNK_MARKER)));
  const published = creates;
  await publishHostedArtifacts(linear, storage, root, issueId, order.id, run.id, encoded);
  assert.equal(creates, published);
  const token = "d".repeat(64);
  writeFileSync(join(root, "connections.json"), JSON.stringify({ clients: [{ id: "myeve",
    name: "MyEve", tokenSha256: sha(token), repositoryPaths: [repositoryPath], actions: [] }] }));
  const host = createSupervisor({ dataDir: root, linear: {} });
  t.after(() => host.close());
  await new Promise(resolve => host.server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${host.server.address().port}`;
  const client = new FactoryClient({ origin, token });
  assert.deepEqual(await client.getHostedArtifact(order.id, run.id, verified.manifest.artifacts[1]),
    readFileSync(logPath));
  const denied = await fetch(`${origin}/api/connect/v1/work-orders/${order.id}/runs/${run.id}/artifacts/${verified.manifest.artifacts[1].id}`);
  assert.equal(denied.status, 401);
  const other = storage.createWorkOrder({ title: "Other Work", description: "Other scope",
    kind: "feature", repositoryPath, baseRef: inputCommit, acceptanceCriteria: ["Other"],
    reproductionCommand: null, expectedFailureText: null, checkCommands: ["git diff --check"],
    allowedPaths: ["app.txt"], workerProfile: "mac" });
  const crossWork = await fetch(`${origin}/api/connect/v1/work-orders/${other.id}/runs/${run.id}/artifacts/${verified.manifest.artifacts[1].id}`,
    { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(crossWork.status, 404);
  await assert.rejects(() => client.getHostedArtifact(order.id, run.id,
    { ...verified.manifest.artifacts[1], reference: { expiresAt: "2000-01-01T00:00:00.000Z" } }), /expired/);
  const firstId = comments.keys().next().value;
  comments.set(firstId, "substituted");
  await assert.rejects(() => publishHostedArtifacts(linear, storage, root,
    issueId, order.id, run.id, encoded), /conflict/);
  writeFileSync(logPath, "changed after freeze\n");
  assert.equal(await freezeHostedResult(storage, root, issueId, order.id, run.id), encoded);
  assert.throws(() => readResult(signed.replace(/.$/, "x"), pair.publicKey, issueId),
    /Invalid|Unverified/);
});
