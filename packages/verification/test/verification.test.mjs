import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_VERIFICATION_IMAGE, verifyCandidate } from "../src/index.ts";

function git(repositoryPath, ...args) {
  return execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8" }).trim();
}

function commit(repositoryPath, message) {
  git(repositoryPath, "add", ".");
  git(repositoryPath, "-c", "user.name=Factory Test", "-c", "user.email=factory@example.invalid", "commit", "-qm", message);
  return git(repositoryPath, "rev-parse", "HEAD");
}

test("verifies the exact commit in a read-only, offline container and records honest outcomes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "factory-verification-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repositoryPath = join(root, "repo");
  const artifactDir = join(root, "artifacts");
  const binDir = join(root, "bin");
  const capturePath = join(root, "docker-calls.jsonl");
  mkdirSync(repositoryPath);
  mkdirSync(binDir);
  execFileSync("git", ["init", "-q", repositoryPath]);
  writeFileSync(join(repositoryPath, "value.txt"), "committed\n");
  const candidateSha = commit(repositoryPath, "initial candidate");
  writeFileSync(join(repositoryPath, "value.txt"), "uncommitted edit\n");

  const fakeDocker = join(binDir, "docker");
  writeFileSync(fakeDocker, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FACTORY_FAKE_DOCKER_CAPTURE, JSON.stringify(args) + '\\n');
if (args[0] === 'rm') process.exit(0);
const mount = args[args.indexOf('--mount') + 1];
const source = mount.match(/source=([^,]+)/)[1];
if (fs.existsSync(path.join(source, '.git'))) process.exit(125);
if (fs.readFileSync(path.join(source, 'value.txt'), 'utf8') !== 'committed\\n') process.exit(1);
const command = args.at(-1);
if (command === 'assert-committed') { process.stdout.write('candidate matches commit\\n'); process.exit(0); }
if (command === 'write-project') { process.stderr.write('touch: cannot touch /src/generated: Read-only file system\\n'); process.exit(1); }
if (command === 'fail-check') { process.stderr.write('assertion failed\\n'); process.exit(1); }
if (command === 'wait-for-cancel') { setInterval(() => {}, 1000); }
else process.exit(127);
`);
  chmodSync(fakeDocker, 0o755);
  const originalPath = process.env.PATH;
  const originalCapture = process.env.FACTORY_FAKE_DOCKER_CAPTURE;
  process.env.PATH = `${binDir}:${originalPath}`;
  process.env.FACTORY_FAKE_DOCKER_CAPTURE = capturePath;
  t.after(() => {
    process.env.PATH = originalPath;
    if (originalCapture === undefined) delete process.env.FACTORY_FAKE_DOCKER_CAPTURE;
    else process.env.FACTORY_FAKE_DOCKER_CAPTURE = originalCapture;
  });

  await t.test("each check keeps its commit, tree, log, and isolated Docker arguments", async () => {
    const result = await verifyCandidate({
      repositoryPath, candidateSha, artifactDir,
      commands: ["assert-committed", "write-project", "fail-check"],
      limits: { timeoutMs: 10_000, cpus: 0.5, memoryMb: 256, pids: 32 },
    });
    assert.equal(result.exportStatus, "ready");
    assert.equal(result.image, DEFAULT_VERIFICATION_IMAGE);
    assert.deepEqual(result.checks.map((check) => check.status), ["passed", "unavailable", "failed"]);
    assert.match(result.checks[1].reason, /read-only candidate/);
    assert.match(readFileSync(result.checks[0].logPath, "utf8"), /candidate matches commit/);
    assert.ok(result.checks.every((check) => check.candidateCommit === candidateSha));
    assert.ok(result.checks.every((check) => check.candidateTree === result.candidateTree));
    assert.deepEqual(JSON.parse(readFileSync(result.manifestPath, "utf8")), result);

    const calls = readFileSync(capturePath, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(calls.length, 3);
    for (const args of calls) {
      assert.ok(args.includes("--network=none"));
      assert.ok(args.includes("--read-only"));
      assert.ok(args.includes("--pull=never"));
      assert.ok(args.includes("--cap-drop=ALL"));
      assert.ok(args.includes("--cpus=0.5"));
      assert.ok(args.includes("--memory=256m"));
      assert.ok(args.includes("--pids-limit=32"));
      assert.ok(args[args.indexOf("--mount") + 1].endsWith(",target=/src,readonly"));
      assert.equal(args[args.indexOf("--mount") + 1].includes("docker.sock"), false);
      assert.equal(args.at(-3), DEFAULT_VERIFICATION_IMAGE);
    }
  });

  await t.test("git diff --check validates the candidate commit without requiring .git in the source export", async () => {
    const whitespaceRepository = join(root, "whitespace-repo");
    mkdirSync(whitespaceRepository);
    execFileSync("git", ["init", "-q", whitespaceRepository]);
    writeFileSync(join(whitespaceRepository, "value.txt"), "baseline\n");
    commit(whitespaceRepository, "baseline");
    writeFileSync(join(whitespaceRepository, "value.txt"), "clean candidate\n");
    const cleanCandidate = commit(whitespaceRepository, "clean candidate");

    const clean = await verifyCandidate({
      repositoryPath: whitespaceRepository,
      candidateSha: cleanCandidate,
      artifactDir,
      commands: ["git diff --check"],
    });
    assert.deepEqual(clean.checks.map((check) => check.status), ["passed"]);
    assert.match(readFileSync(clean.checks[0].logPath, "utf8"), /No whitespace errors found/);

    writeFileSync(join(whitespaceRepository, "value.txt"), "trailing space \n");
    const invalidCandidate = commit(whitespaceRepository, "candidate with trailing whitespace");
    const invalid = await verifyCandidate({
      repositoryPath: whitespaceRepository,
      candidateSha: invalidCandidate,
      artifactDir,
      commands: ["git diff --check"],
    });
    assert.deepEqual(invalid.checks.map((check) => check.status), ["failed"]);
    assert.notEqual(invalid.checks[0].exitCode, 0);
    assert.match(readFileSync(invalid.checks[0].logPath, "utf8"), /trailing whitespace/);
    assert.equal(readFileSync(capturePath, "utf8").trim().split("\n").length, 3);
  });

  await t.test("archive attributes that omit committed content block verification", async () => {
    writeFileSync(join(repositoryPath, ".gitattributes"), "value.txt export-ignore\n");
    const omittedSha = commit(repositoryPath, "omit tracked content from archive");
    const callsBefore = readFileSync(capturePath, "utf8").trim().split("\n").length;
    const result = await verifyCandidate({
      repositoryPath, candidateSha: omittedSha, artifactDir,
      commands: ["assert-committed"],
    });
    assert.equal(result.exportStatus, "unavailable");
    assert.equal(result.checks[0].status, "unavailable");
    assert.match(result.reason, /omitted committed file/);
    assert.equal(readFileSync(capturePath, "utf8").trim().split("\n").length, callsBefore);
  });

  await t.test("missing repositories produce unavailable evidence and image options are rejected", async () => {
    const result = await verifyCandidate({
      repositoryPath: join(root, "missing-repo"), candidateSha, artifactDir,
      commands: ["assert-committed"],
    });
    assert.equal(result.checks[0].status, "unavailable");
    assert.match(result.reason, /Candidate export unavailable/);
    assert.ok(existsSync(result.checks[0].logPath));
    await assert.rejects(verifyCandidate({
      repositoryPath, candidateSha, artifactDir,
      commands: ["assert-committed"], image: "--privileged",
    }), /image must be a local Docker image reference/);
  });

  await t.test("abort stops an active check and records remaining checks as unavailable", async () => {
    const controller = new AbortController();
    const pending = verifyCandidate({
      repositoryPath, candidateSha, artifactDir,
      commands: ["wait-for-cancel", "assert-committed"],
      signal: controller.signal,
      limits: { timeoutMs: 10_000 },
    });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (existsSync(capturePath) && readFileSync(capturePath, "utf8").includes("wait-for-cancel")) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(readFileSync(capturePath, "utf8"), /wait-for-cancel/);
    controller.abort();
    const result = await pending;
    assert.deepEqual(result.checks.map((check) => check.status), ["unavailable", "unavailable"]);
    assert.match(result.checks[0].reason, /cancelled/);
    assert.match(readFileSync(capturePath, "utf8"), /\["rm","-f","factory-verify-/);
  });
});
