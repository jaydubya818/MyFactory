import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AppReferenceController, candidateObjects, EMPTY_APP_SOURCE_COMMIT } from "../src/myapps/controller.mjs";
import { referenceConfiguration } from "../src/myapps/configuration.mjs";
import { appResult, verifyAppResult } from "../src/myapps/result.mjs";
import { canonical, digest } from "../../hosted-routing/src/result.ts";
import { identityReceipt, verifyIdentityReceipt } from "../scripts/qualify-myapps-identity.mjs";

const myeve = process.env.MYEVE_SOURCE_ROOT;
const factory = fileURLToPath(new URL("../../..", import.meta.url));
const factoryCommit = execFileSync("git", ["-C", factory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const boundPaths = [
  ...["contracts", "store", "crm", "preview"].map((p) => `packages/myapps/src/${p}.ts`),
  ...["runtime", "api", "workflow", "hosting"].map((p) => `apps/eve/lib/myapps/${p}.ts`),
];
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
function put(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
function commit(root, message) {
  git(root, "add", ".");
  git(root, "-c", "user.name=Identity Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", message);
}
async function pinnedPackage() {
  const { makePackage } = await import(pathToFileURL(resolve(myeve, "packages/myapps/test/fixtures.mjs")).href);
  const pkg = makePackage();
  pkg.source.repositoryCommit = EMPTY_APP_SOURCE_COMMIT;
  pkg.factoryVersion = { sourceCommit: factoryCommit, configurationDigest: "sha256:" + digest(referenceConfiguration(myeve)) };
  return pkg;
}

test("candidate identity agrees with native Git objects and is independent of JSON key order", { skip: !myeve }, async () => {
  const pkg = await pinnedPackage();
  const first = candidateObjects(pkg);
  const reordered = Object.fromEntries(Object.entries(pkg).reverse());
  assert.deepEqual(candidateObjects(reordered), first);
  for (const [type, bytes, expected] of [["commit", first.commitBytes, first.commit], ["tree", first.treeBytes, first.tree]]) {
    assert.equal(execFileSync("git", ["hash-object", "-t", type, "--stdin"], { input: bytes, encoding: "utf8" }).trim(), expected);
  }
  for (const successor of [
    { ...pkg, source: { ...pkg.source, candidateId: "successor-candidate" } },
    { ...pkg, factoryVersion: { ...pkg.factoryVersion, sourceCommit: "9".repeat(40) } },
    { ...pkg, factoryVersion: { ...pkg.factoryVersion, configurationDigest: "sha256:" + "9".repeat(64) } },
  ]) assert.notEqual(candidateObjects(successor).commit, first.commit);
});

test("every canonical runtime dependency invalidates old FactoryVersion admission", { skip: !myeve }, async () => {
  const root = mkdtempSync(join(tmpdir(), "myapps-identity-dependency-"));
  try {
    for (const path of boundPaths) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      copyFileSync(join(myeve, path), join(root, path));
    }
    const pkg = await pinnedPackage();
    assert.equal("sha256:" + digest(referenceConfiguration(root)), pkg.factoryVersion.configurationDigest);
    for (const path of boundPaths) {
      const bytes = readFileSync(join(root, path));
      put(root, path, Buffer.concat([bytes, Buffer.from("\n// Synthetic successor dependency.\n")]));
      const controller = await AppReferenceController.open({ myeveRoot: root, custodyDirectory: join(root, "custody"), authorize: async () => true });
      try {
        assert.notEqual("sha256:" + digest(referenceConfiguration(root)), pkg.factoryVersion.configurationDigest);
        await assert.rejects(controller.build({ creationIntent: "crm-request-1", pkg }), /APP_FACTORY_VERSION_BINDING/);
      } finally {
        controller.close();
        put(root, path, bytes);
      }
    }
  } finally { rmSync(root, { recursive: true }); }
});

test("signed historical Result remains immutable and cannot approve changed source, configuration or artifacts", { skip: !myeve }, async () => {
  const custody = mkdtempSync(join(tmpdir(), "myapps-identity-result-"));
  const controller = await AppReferenceController.open({ myeveRoot: myeve, custodyDirectory: custody, authorize: async () => true });
  try {
    const pkg = await pinnedPackage();
    const run = await controller.build({ creationIntent: "crm-request-1", pkg });
    const verification = await controller.verify(pkg.spec.ownerId, run.id);
    assert.equal(verification.status, "PASS");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const issuedAt = "2026-10-08T12:00:00.000Z";
    const signed = appResult({ pkg, run, verification, privateKey, keyId: "identity-fixture", issuedAt });
    const historicalBytes = canonical(signed);
    const input = { pkg, run, signed, keys: [{ factoryId: "myapps-reference-factory", keyId: "identity-fixture", publicKey: publicKey.export({ type: "spki", format: "pem" }), activeFrom: "2026-10-08T00:00:00.000Z", notAfter: "2026-10-09T00:00:00.000Z" }], now: Date.parse(issuedAt) };
    const accepted = verifyAppResult(input);
    const sourceDigest = digest({ sourceCommit: pkg.factoryVersion.sourceCommit });
    const configurationDigest = digest(run.configuration);
    assert.equal(accepted.manifest.execution.factoryVersion, digest({ sourceDigest, configurationDigest }));
    assert.throws(() => verifyAppResult({ ...input, pkg: { ...pkg, factoryVersion: { ...pkg.factoryVersion, sourceCommit: "9".repeat(40) } } }), /correlation/i);
    const configuration = { ...run.configuration, executorVersion: "successor" };
    assert.throws(() => verifyAppResult({ ...input, run: { ...run, configuration }, pkg: { ...pkg, factoryVersion: { ...pkg.factoryVersion, configurationDigest: "sha256:" + digest(configuration) } } }), /correlation/i);
    const substituted = structuredClone(signed);
    substituted.artifacts[0].base64 = Buffer.from("substituted source").toString("base64");
    assert.throws(() => verifyAppResult({ ...input, signed: substituted }), /artifact/i);
    assert.equal(canonical(signed), historicalBytes);
    assert.deepEqual(verifyAppResult(input), accepted);
    assert.throws(() => verifyAppResult({ ...input, now: Date.parse("2026-10-10T00:00:00.000Z") }), /key|expir/i);
  } finally { controller.close(); rmSync(custody, { recursive: true }); }
});

test("qualification receipt is reproducible, immutable, non-authorizing and rejects successor source/dependency/migration identities", () => {
  const root = mkdtempSync(join(tmpdir(), "myapps-identity-receipt-"));
  try {
    const roots = { myeveRoot: join(root, "myeve"), myfactoryRoot: join(root, "factory") };
    for (const path of Object.values(roots)) {
      mkdirSync(path); git(path, "init", "-q");
      put(path, "package-lock.json", "{\"lockfileVersion\":3}\n");
      put(path, "migrations/0001_fixture.sql", "SELECT 1;\n");
    }
    for (const path of boundPaths) put(roots.myeveRoot, path, "// fixture-only identity bytes\n");
    for (const path of ["packages/app-builder/scripts/qualify-myapps-identity.mjs", "packages/app-builder/src/myapps/configuration.mjs", "packages/hosted-routing/src/result.ts"])
      put(roots.myfactoryRoot, path, readFileSync(join(factory, path)));
    for (const path of Object.values(roots)) commit(path, "Synthetic historical source");
    const receipt = identityReceipt(roots), historicalBytes = canonical(receipt);
    assert.deepEqual(identityReceipt(roots), receipt);
    assert.equal(receipt.referenceResultV1.configuration.model, "deterministic/no-model");
    assert.equal(receipt.authority.executableProductionGrant, false);
    assert.equal(receipt.authority.releaseApproved, false);
    assert.equal(receipt.authority.deploymentAuthorized, false);
    for (const [repo, path] of [[roots.myeveRoot, boundPaths[0]], [roots.myfactoryRoot, "package-lock.json"], [roots.myeveRoot, "migrations/0001_fixture.sql"]]) {
      const before = identityReceipt(roots);
      put(repo, path, readFileSync(join(repo, path), "utf8") + "\n");
      assert.throws(() => identityReceipt(roots), /CLEAN_SOURCE/);
      commit(repo, "Synthetic successor identity");
      assert.throws(() => verifyIdentityReceipt(before, roots), /STALE_OR_SUBSTITUTED/);
      assert.notEqual(identityReceipt(roots).receiptDigest, before.receiptDigest);
    }
    assert.equal(canonical(receipt), historicalBytes);
    const current = identityReceipt(roots);
    const forged = { ...current, authority: { ...current.authority, releaseApproved: true } };
    assert.throws(() => verifyIdentityReceipt(forged, roots), /STALE_OR_SUBSTITUTED/);
    const configPath = "packages/app-builder/src/myapps/configuration.mjs";
    const config = readFileSync(join(roots.myfactoryRoot, configPath));
    put(roots.myfactoryRoot, configPath, Buffer.concat([config, Buffer.from("\n// successor generator\n")]));
    commit(roots.myfactoryRoot, "Different receipt implementation");
    assert.throws(() => identityReceipt(roots), /GENERATOR_SOURCE_MISMATCH/);
    put(roots.myfactoryRoot, configPath, config);
    rmSync(join(roots.myfactoryRoot, "package-lock.json"));
    symlinkSync("/outside-qualification/lock.json", join(roots.myfactoryRoot, "package-lock.json"));
    commit(roots.myfactoryRoot, "Unqualified linked dependency");
    assert.throws(() => identityReceipt(roots), /REGULAR_SOURCE/);
  } finally { rmSync(root, { recursive: true }); }
});
