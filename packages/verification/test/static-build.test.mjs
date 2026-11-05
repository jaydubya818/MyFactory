import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCandidateStatic } from "../src/index.ts";

const IMAGE = "sha256:" + "a".repeat(64);
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function fixture(t, dockerBody) {
  const root = mkdtempSync(join(tmpdir(), "factory-static-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"), bin = join(root, "bin"), capture = join(root, "calls.jsonl");
  mkdirSync(repo); mkdirSync(bin);
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "index.html"), "<h1>source</h1>\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "c");
  const docker = join(bin, "docker");
  writeFileSync(docker, `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify(args)+'\\n');
if(args[0]==='rm')process.exit(0);
const mounts=args.flatMap((a,i)=>a==='--mount'?[args[i+1]]:[]);
const out=mounts.find(m=>m.includes('target=/out')).match(/source=([^,]+)/)[1];
${dockerBody}
`);
  chmodSync(docker, 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  t.after(() => { process.env.PATH = path; });
  return { root, repo, capture, sha: git(repo, "rev-parse", "HEAD") };
}

test("builds the exact candidate offline into a fresh owned output root", async (t) => {
  const f = fixture(t, "fs.writeFileSync(path.join(out,'index.html'),'<h1>built</h1>');fs.mkdirSync(path.join(out,'assets'));fs.writeFileSync(path.join(out,'assets','a.js'),'x');process.exit(0);");
  const outputDir = join(f.root, "preview", "dist");
  const result = await buildCandidateStatic({ repositoryPath: f.repo, candidateSha: f.sha, image: IMAGE,
    command: "build --outDir /out", outputDir, artifactDir: join(f.root, "logs") });
  assert.equal(result.status, "built");
  assert.equal(result.candidateCommit, f.sha);
  assert.deepEqual(result.files.map(file => file.path), ["assets/a.js", "index.html"]);
  assert.equal(readFileSync(join(outputDir, "index.html"), "utf8"), "<h1>built</h1>");
  const run = readFileSync(f.capture, "utf8").trim().split("\n").map(line => JSON.parse(line)).find(args => args[0] === "run");
  for (const flag of ["--network=none", "--read-only", "--cap-drop=ALL", "--pull=never", "--security-opt=no-new-privileges"]) assert.ok(run.includes(flag), flag);
  const mounts = run.flatMap((arg, i) => arg === "--mount" ? [run[i + 1]] : []);
  assert.ok(mounts.some(m => m.endsWith("target=/src,readonly")));
  assert.ok(mounts.some(m => m.endsWith("target=/out") && !m.includes("readonly")));
  assert.equal(run.at(-1), "build --outDir /out");
  assert.equal(run.at(-3), IMAGE);
});

test("a failing build reports failed and leaves no servable output", async (t) => {
  const f = fixture(t, "process.stderr.write('vite error');process.exit(1);");
  const outputDir = join(f.root, "preview", "dist");
  const result = await buildCandidateStatic({ repositoryPath: f.repo, candidateSha: f.sha, image: IMAGE,
    command: "build", outputDir, artifactDir: join(f.root, "logs") });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.files, []);
  assert.match(readFileSync(result.logPath, "utf8"), /vite error/);
});

test("output without index.html or with a symlink is refused", async (t) => {
  const f = fixture(t, "fs.symlinkSync('/etc/passwd',path.join(out,'index.html'));process.exit(0);");
  const result = await buildCandidateStatic({ repositoryPath: f.repo, candidateSha: f.sha, image: IMAGE,
    command: "build", outputDir: join(f.root, "preview", "dist"), artifactDir: join(f.root, "logs") });
  assert.equal(result.status, "failed");
  assert.match(result.reason, /symlink|regular file/i);
});

test("mutable image references and reused output roots are refused before Docker runs", async (t) => {
  const f = fixture(t, "process.exit(0);");
  await assert.rejects(buildCandidateStatic({ repositoryPath: f.repo, candidateSha: f.sha, image: "node:22-bookworm",
    command: "build", outputDir: join(f.root, "p1"), artifactDir: join(f.root, "logs") }), /immutable/);
  const reused = join(f.root, "p2"); mkdirSync(reused);
  await assert.rejects(buildCandidateStatic({ repositoryPath: f.repo, candidateSha: f.sha, image: IMAGE,
    command: "build", outputDir: reused, artifactDir: join(f.root, "logs") }), /fresh/);
  assert.equal(existsSync(f.capture), false);
});
