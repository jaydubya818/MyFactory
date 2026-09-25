import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { commitCandidate, resolveCommit } from "../src/git.ts";

function git(path, ...args) {
  return execFileSync("git", ["-C", path, ...args], { encoding: "utf8" }).trim();
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "sellerfi-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  git(repo, "init", "-b", "main");
  writeFileSync(join(repo, "src", "value.js"), "export const value = 1;\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "base");
  return { root, repo };
}

test("supervisor commits only a scoped source change and records exact identity", async (t) => {
  const { root, repo } = repository(t);
  const base = await resolveCommit(repo, "main");
  writeFileSync(join(repo, "src", "value.js"), "export const value = 2;\n");
  const candidate = await commitCandidate(repo, base, ["src/**"], join(root, "artifacts"));
  assert.notEqual(candidate.commit, base);
  assert.deepEqual(candidate.changedPaths, ["src/value.js"]);
  assert.equal(candidate.commit, git(repo, "rev-parse", "HEAD"));
  assert.equal(candidate.tree, git(repo, "rev-parse", "HEAD^{tree}"));
  assert.equal(git(repo, "status", "--porcelain"), "");
});

test("supervisor rejects out-of-scope and symlink changes", async (t) => {
  const { root, repo } = repository(t);
  const base = await resolveCommit(repo, "main");
  writeFileSync(join(repo, "outside.txt"), "not allowed\n");
  await assert.rejects(
    commitCandidate(repo, base, ["src/**"], join(root, "artifacts")),
    /outside the approved scope/,
  );
  rmSync(join(repo, "outside.txt"));
  symlinkSync("/private/tmp", join(repo, "src", "external"));
  await assert.rejects(
    commitCandidate(repo, base, ["src/**"], join(root, "artifacts")),
    /Symlink change requires review/,
  );
});

test("supervisor rejects an agent-created commit even if the worktree is clean", async (t) => {
  const { root, repo } = repository(t);
  const base = await resolveCommit(repo, "main");
  writeFileSync(join(repo, "outside.txt"), "not allowed\n");
  git(repo, "add", "outside.txt");
  git(repo, "-c", "user.name=Agent", "-c", "user.email=agent@example.invalid", "commit", "-m", "agent commit");
  await assert.rejects(
    commitCandidate(repo, base, ["src/**"], join(root, "artifacts")),
    /Workspace HEAD changed/,
  );
});
