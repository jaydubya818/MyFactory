import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorage } from "../../../packages/storage/src/index.ts";
import { readResult, resultDescription } from "../../../packages/hosted-routing/src/index.mjs";
import { freezeHostedResult } from "../src/hosted-result.ts";

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
  writeFileSync(logPath, "check passed\n");
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
  writeFileSync(logPath, "changed after freeze\n");
  assert.equal(await freezeHostedResult(storage, root, issueId, order.id, run.id), encoded);
  assert.throws(() => readResult(signed.replace(/.$/, "x"), pair.publicKey, issueId),
    /Invalid|Unverified/);
});
