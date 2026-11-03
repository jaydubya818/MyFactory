import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyWorkspaceTree } from "../src/index.ts";
import { buildFailureReport } from "../src/failure-report.ts";

// Real Docker + real Chromium. Skipped (not faked) when the Playwright-capable local image is absent.
const IMAGE = process.env.FACTORY_BROWSER_TEST_IMAGE ?? "qdev-dashboard-profile:20261030";
const available = spawnSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" }).status === 0;
const skip = available ? false : `Docker image ${IMAGE} is not present locally`;

function fixtureRepo(t, tests) {
  const root = mkdtempSync(join(tmpdir(), "factory-browser-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "test"), { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fx", private: true, scripts: { "test:browser": "playwright test --config=playwright.config.ts", crash: "kill -9 $$", slow: "sleep 30", write: "echo x > /src/forbidden" } }));
  writeFileSync(join(repo, "playwright.config.ts"), "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: 'test', reporter: 'list', use: { browserName: 'chromium' } });\n");
  writeFileSync(join(repo, "test/a.spec.ts"), tests);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.name=f", "-c", "user.email=f@example.invalid", "commit", "-qm", "base"]);
  const tree = execFileSync("git", ["-C", repo, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  return { repo, tree, artifactDir: join(root, "artifacts") };
}

const spec = (body) => `import { test, expect } from '@playwright/test';\n${body}\n`;
const identity = (tree) => ({ workOrderId: "w", runId: "r", step: 1, candidateTree: tree });
const leftovers = key => execFileSync("docker", ["ps", "-aq", "--filter", `label=factory.run=${key}`], { encoding: "utf8" }).trim();

test("browser profile runs real Chromium offline in a disposable container and reports a failed assertion", { skip, timeout: 120000 }, async t => {
  const fx = fixtureRepo(t, spec(`test('ok', async ({ page }) => { await page.setContent('<h1>Hi</h1>'); await expect(page.locator('h1')).toHaveText('Hi'); });
test('wrong text', async ({ page }) => { await page.setContent('<h1>Hello</h1>'); await expect(page.locator('h1')).toHaveText('Hi', { timeout: 1000 }); });`));
  const result = await verifyWorkspaceTree({ repositoryPath: fx.repo, tree: fx.tree, commands: ["npm run test:browser"], artifactDir: fx.artifactDir, image: IMAGE, profile: "browser", resourceKey: "browser-fail" });
  assert.equal(result.exportStatus, "ready");
  assert.equal(result.checks[0].status, "failed");
  assert.equal(result.checks[0].exitCode, 1);
  const report = await buildFailureReport({ identity: identity(fx.tree), checks: result.checks });
  assert.equal(report.outcome, "FAILED");
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].kind, "BROWSER_TEST_FAILED");
  assert.equal(report.failures[0].expected, '"Hi"');
  assert.equal(report.failures[0].received, '"Hello"');
  assert.equal(leftovers("browser-fail"), "", "disposable container was removed");
});

test("passing browser suite passes; the candidate checkout is never written", { skip, timeout: 120000 }, async t => {
  const fx = fixtureRepo(t, spec(`test('ok', async ({ page }) => { await page.setContent('<h1>Hi</h1>'); await expect(page.locator('h1')).toHaveText('Hi'); });`));
  const result = await verifyWorkspaceTree({ repositoryPath: fx.repo, tree: fx.tree, commands: ["npm run test:browser"], artifactDir: fx.artifactDir, image: IMAGE, profile: "browser", resourceKey: "browser-pass" });
  assert.equal(result.checks[0].status, "passed");
  assert.equal((await buildFailureReport({ identity: identity(fx.tree), checks: result.checks })).outcome, "PASSED");
});

test("the standard profile still cannot run a browser suite that needs a writable workspace", { skip, timeout: 120000 }, async t => {
  const fx = fixtureRepo(t, spec(`test('ok', async ({ page }) => { await page.setContent('<h1>Hi</h1>'); });`));
  const result = await verifyWorkspaceTree({ repositoryPath: fx.repo, tree: fx.tree, commands: ["npm run test:browser"], artifactDir: fx.artifactDir, image: IMAGE, resourceKey: "browser-std" });
  assert.notEqual(result.checks[0].status, "passed", "default profile must stay restrictive");
});

test("test code has no network and cannot write to the candidate mount", { skip, timeout: 120000 }, async t => {
  const fx = fixtureRepo(t, spec(`test('no network', async ({ page }) => {
  const reached = await page.evaluate(async () => { try { await fetch('https://example.com', { mode: 'no-cors', signal: AbortSignal.timeout(2000) }); return true; } catch { return false; } });
  expect(reached).toBe(false);
});`));
  const net = await verifyWorkspaceTree({ repositoryPath: fx.repo, tree: fx.tree, commands: ["npm run test:browser"], artifactDir: fx.artifactDir, image: IMAGE, profile: "browser", resourceKey: "browser-net" });
  assert.equal(net.checks[0].status, "passed", "outbound request must fail inside the disposable environment");
  const write = await verifyWorkspaceTree({ repositoryPath: fx.repo, tree: fx.tree, commands: ["npm run write"], artifactDir: fx.artifactDir, image: IMAGE, profile: "browser", resourceKey: "browser-write" });
  assert.notEqual(write.checks[0].status, "passed");
});

test("runner crash and timeout are UNKNOWN reports, never ordinary failures", { skip, timeout: 120000 }, async t => {
  const fx = fixtureRepo(t, spec(`test('ok', async () => {});`));
  const crash = await verifyWorkspaceTree({ repositoryPath: fx.repo, tree: fx.tree, commands: ["npm run crash"], artifactDir: fx.artifactDir, image: IMAGE, profile: "browser", resourceKey: "browser-crash" });
  assert.equal(crash.checks[0].status, "unavailable");
  assert.equal((await buildFailureReport({ identity: identity(fx.tree), checks: crash.checks })).outcome, "UNKNOWN");
  const slow = await verifyWorkspaceTree({ repositoryPath: fx.repo, tree: fx.tree, commands: ["npm run slow"], artifactDir: fx.artifactDir, image: IMAGE, profile: "browser", resourceKey: "browser-slow", limits: { timeoutMs: 3000 } });
  assert.equal(slow.checks[0].status, "unavailable");
  const report = await buildFailureReport({ identity: identity(fx.tree), checks: slow.checks });
  assert.equal(report.outcome, "UNKNOWN");
  assert.equal(report.failures[0].kind, "TIMED_OUT");
  assert.equal(leftovers("browser-slow"), "", "timed-out container was removed");
});

test("tool caches next to node_modules are writable and installed packages still resolve", { skip, timeout: 120000 }, async t => {
  const fx = fixtureRepo(t, spec(`test('ok', async () => {});`));
  const cmd = "node -e \"require('fs').mkdirSync('node_modules/.vite-temp'); require('@playwright/test'); console.log('resolved')\"";
  const result = await verifyWorkspaceTree({ repositoryPath: fx.repo, tree: fx.tree, commands: [cmd], artifactDir: fx.artifactDir, image: IMAGE, profile: "browser", resourceKey: "browser-cache" });
  assert.equal(result.checks[0].status, "passed", result.checks[0].reason ?? "");
});

test("an unknown profile is rejected before any container starts", async t => {
  const fx = fixtureRepo(t, spec(`test('ok', async () => {});`));
  await assert.rejects(verifyWorkspaceTree({ repositoryPath: fx.repo, tree: fx.tree, commands: ["true"], artifactDir: fx.artifactDir, profile: "privileged" }), /profile/);
});
