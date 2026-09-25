import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { instantiateApp, listAppTemplates } from "../src/index.ts";

function fixture(t) {
  const taskDirectory = mkdtempSync(join(tmpdir(), "factory-app-builder-"));
  t.after(() => rmSync(taskDirectory, { recursive: true, force: true }));
  return taskDirectory;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("lists the bundled starter without creating an app", () => {
  assert.deepEqual(listAppTemplates(), [{
    id: "feedback-hub",
    name: "Feedback Hub",
    version: "1.0.0",
    description: "A calm place to capture, review, and act on product feedback.",
  }]);
});

test("instantiates a versioned feedback hub and hashes the final generated files", (t) => {
  const taskDirectory = fixture(t);
  const brief = {
    name: 'SellerFi "Signals"',
    description: "Buyer and seller feedback, with context and clear next actions.\nTrust first.",
    audience: ["Buyers", "Sellers"],
    goals: ["Triage incoming reports", "Keep decisions traceable"],
  };
  const result = instantiateApp({
    templateId: "feedback-hub",
    taskDirectory,
    outputName: "sellerfi-feedback",
    productBrief: brief,
  });

  assert.equal(result.outputDir, join(realpathSync(taskDirectory), "sellerfi-feedback"));
  assert.equal(result.template.id, "feedback-hub");
  assert.match(result.template.version, /^\d+\.\d+\.\d+$/);
  assert.match(result.template.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(readFileSync(join(result.outputDir, "app.json"), "utf8")), {
    name: brief.name,
    description: brief.description,
  });
  assert.deepEqual(JSON.parse(readFileSync(join(result.outputDir, "product-brief.json"), "utf8")), brief);
  assert.deepEqual(JSON.parse(readFileSync(result.manifestPath, "utf8")), result);
  assert.equal(result.files.some((entry) => entry.path === "build-manifest.json"), false);
  assert.deepEqual(result.files.map((entry) => entry.path), [...result.files.map((entry) => entry.path)].sort());
  for (const entry of result.files) {
    const bytes = readFileSync(join(result.outputDir, entry.path));
    assert.equal(entry.bytes, bytes.length, entry.path);
    assert.equal(entry.sha256, digest(bytes), entry.path);
  }
});

test("refuses overwrite, path traversal, and a symlinked task directory", (t) => {
  const taskDirectory = fixture(t);
  const input = {
    templateId: "feedback-hub",
    taskDirectory,
    productBrief: { name: "Feedback", description: "Track product reports." },
  };
  const first = instantiateApp(input);
  const originalManifest = readFileSync(first.manifestPath);
  assert.throws(() => instantiateApp(input), /Output already exists/);
  assert.deepEqual(readFileSync(first.manifestPath), originalManifest);
  assert.throws(() => instantiateApp({ ...input, outputName: "../outside" }), /outputName/);
  const link = join(taskDirectory, "linked-task");
  symlinkSync(taskDirectory, link);
  assert.throws(() => instantiateApp({ ...input, taskDirectory: link, outputName: "another" }), /not a symlink/);
});
