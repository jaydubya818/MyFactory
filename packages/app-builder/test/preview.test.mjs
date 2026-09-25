import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { instantiateApp, LocalAppPreviewManager } from "../src/index.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "factory-preview-test-"));
  const build = instantiateApp({
    templateId: "feedback-hub",
    taskDirectory: directory,
    productBrief: { name: "Test Hub", description: "A local test feedback inbox." },
  });
  const expectedManifestSha256 = createHash("sha256").update(readFileSync(build.manifestPath)).digest("hex");
  const events = [];
  const manager = new LocalAppPreviewManager({
    evidenceDirectory: join(directory, "evidence"),
    onEvent: (workOrderId, type, payload) => events.push({ workOrderId, type, payload }),
  });
  return {
    directory, build, expectedManifestSha256, events, manager,
    input: { workOrderId: "test-order", outputDir: build.outputDir, expectedManifestSha256 },
    async clean() { await manager.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

test("preview refuses modified or extra scaffold files before install", async () => {
  for (const tamper of [
    (build) => writeFileSync(join(build.outputDir, "app.json"), "{}"),
    (build) => writeFileSync(join(build.outputDir, "unexpected.js"), "surprise"),
    (build) => {
      mkdirSync(join(build.outputDir, ".data"));
      symlinkSync(join(build.outputDir, "app.json"), join(build.outputDir, ".data", "feedback-hub.sqlite"));
    },
  ]) {
    const state = fixture();
    try {
      tamper(state.build);
      const result = await state.manager.start(state.input);
      assert.equal(result.status, "failed");
      assert.match(result.error, /source hash changed|extra file|symlink/);
      assert.deepEqual(state.events.map((event) => event.type), ["builder.preview_requested", "builder.preview_failed"]);
      assert.equal(state.manager.status("test-order")?.status, "failed");
      assert.equal(result.logSha256, createHash("sha256").update(readFileSync(result.logPath)).digest("hex"));
    } finally { await state.clean(); }
  }
});

test("preview checks the manifest digest before running commands", async () => {
  const state = fixture();
  try {
    const result = await state.manager.start({ ...state.input, expectedManifestSha256: "0".repeat(64) });
    assert.equal(result.status, "failed");
    assert.match(result.error, /manifest SHA-256/);
  } finally { await state.clean(); }
});

test("preview does not launch when its durable request event cannot be recorded", async () => {
  const state = fixture();
  const manager = new LocalAppPreviewManager({
    evidenceDirectory: join(state.directory, "rejected-evidence"),
    onEvent: () => { throw new Error("event store unavailable"); },
  });
  try {
    await assert.rejects(manager.start(state.input), /event store unavailable/);
    assert.equal(manager.status("test-order"), null);
  } finally {
    await manager.close();
    await state.clean();
  }
});

test("offline install has a clean environment and source is rechecked afterward", async () => {
  const state = fixture();
  const binaryDirectory = join(state.directory, "bin");
  mkdirSync(binaryDirectory);
  const npm = join(binaryDirectory, "npm");
  writeFileSync(npm, `#!/bin/sh\nprintf 'SECRET=%s\\n' "\${PREVIEW_SECRET-unset}"\nprintf 'ARGS=%s\\n' "$*"\nprintf '{"name":"tampered"}\\n' > app.json\nexit 0\n`);
  chmodSync(npm, 0o755);
  const originalPath = process.env.PATH;
  const originalSecret = process.env.PREVIEW_SECRET;
  process.env.PATH = `${binaryDirectory}:${originalPath ?? ""}`;
  process.env.PREVIEW_SECRET = "credential-must-not-pass";
  try {
    const result = await state.manager.start(state.input);
    assert.equal(result.status, "failed");
    assert.match(result.error, /source hash changed: app.json/);
    const log = readFileSync(result.logPath, "utf8");
    assert.match(log, /SECRET=unset/);
    assert.match(log, /--offline --ignore-scripts --no-audit --no-fund/);
    assert.doesNotMatch(log, /credential-must-not-pass/);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalSecret === undefined) delete process.env.PREVIEW_SECRET;
    else process.env.PREVIEW_SECRET = originalSecret;
    await state.clean();
  }
});

test("a server that exits at readiness never leaves a running preview", async () => {
  const state = fixture();
  const serverPath = join(state.build.outputDir, "server", "index.ts");
  const fakeServer = Buffer.from(`export async function createFeedbackServer() {\n  return { listen: async () => { setTimeout(() => process.exit(7), 0); return 43210; }, close: async () => {} };\n}\n`);
  writeFileSync(serverPath, fakeServer);
  const manifest = JSON.parse(readFileSync(state.build.manifestPath, "utf8"));
  const serverEntry = manifest.files.find((entry) => entry.path === "server/index.ts");
  serverEntry.sha256 = createHash("sha256").update(fakeServer).digest("hex");
  serverEntry.bytes = fakeServer.length;
  writeFileSync(state.build.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const binaryDirectory = join(state.directory, "bin");
  mkdirSync(binaryDirectory);
  const npm = join(binaryDirectory, "npm");
  writeFileSync(npm, `#!/bin/sh\nmkdir -p node_modules/.bin\nprintf '#!/bin/sh\\nexit 0\\n' > node_modules/.bin/tsc\nprintf '#!/bin/sh\\nmkdir -p dist\\nprintf ok > dist/index.html\\n' > node_modules/.bin/vite\nchmod +x node_modules/.bin/tsc node_modules/.bin/vite\n`);
  chmodSync(npm, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binaryDirectory}:${originalPath ?? ""}`;
  try {
    await state.manager.start({
      ...state.input,
      expectedManifestSha256: createHash("sha256").update(readFileSync(state.build.manifestPath)).digest("hex"),
    });
    for (let attempt = 0; attempt < 40 && state.manager.status("test-order")?.status === "running"; attempt++) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    assert.equal(state.manager.status("test-order")?.status, "failed");
    const types = state.events.map((event) => event.type);
    const started = types.indexOf("builder.preview_started");
    const exited = types.indexOf("builder.preview_exited");
    if (exited >= 0) assert.ok(started >= 0 && started < exited, types.join(" → "));
    else assert.ok(types.includes("builder.preview_failed"), types.join(" → "));
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await state.clean();
  }
});
