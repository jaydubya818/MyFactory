import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonical, digest, sha256 } from "../../hosted-routing/src/result.ts";
import { referenceConfiguration } from "../src/myapps/configuration.mjs";

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args]);
function sourceIdentity(root) {
  if (git(root, "status", "--porcelain", "--untracked-files=normal").length)
    throw Error("IDENTITY_REQUIRES_CLEAN_SOURCE");
  const commit = git(root, "rev-parse", "HEAD").toString().trim();
  const tree = git(root, "rev-parse", "HEAD^{tree}").toString().trim();
  const entries = git(root, "ls-tree", "-r", "-z", commit)
    .toString().split("\0").filter(Boolean);
  const modes = new Map(entries.map((entry) => [entry.slice(entry.indexOf("\t") + 1), entry.slice(0, 6)]));
  const paths = [...modes.keys()].sort();
  const groups = {
    dependencies: paths.filter((p) => /(^|\/)(package(-lock)?\.json)$/.test(p)),
    migrations: paths.filter((p) => /(^|\/)migrations\/.*\.sql$/.test(p)),
    packaging: paths.filter((p) => p.startsWith("packages/myapps/") ||
      p.startsWith("packages/app-builder/src/myapps/") ||
      p.startsWith("apps/builder/lib/") ||
      p === "apps/builder/next.config.ts" ||
      p.startsWith("apps/eve/lib/myapps/")),
  };
  if (!groups.dependencies.includes("package-lock.json") || !groups.packaging.length)
    throw Error("IDENTITY_REQUIRED_SOURCE_MISSING");
  if (Object.values(groups).flat().some((p) => !["100644", "100755"].includes(modes.get(p))))
    throw Error("IDENTITY_REQUIRES_REGULAR_SOURCE");
  const hashes = Object.fromEntries(Object.entries(groups).map(([name, entries]) => [
    name, Object.fromEntries(entries.map((p) => [p, sha256(git(root, "show", `${commit}:${p}`))])),
  ]));
  return { commit, tree, ...hashes };
}

/** Qualification evidence only. This never installs or issues a release/execution grant. */
export function identityReceipt({ myeveRoot, myfactoryRoot }) {
  const myeve = sourceIdentity(resolve(myeveRoot));
  const myfactory = sourceIdentity(resolve(myfactoryRoot));
  // The receipt must describe the implementation actually producing its identity.
  const implementationRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const generator = Object.fromEntries([
    "packages/app-builder/scripts/qualify-myapps-identity.mjs",
    "packages/app-builder/src/myapps/configuration.mjs",
    "packages/hosted-routing/src/result.ts",
  ].map((path) => {
    const executing = sha256(readFileSync(resolve(implementationRoot, path)));
    if (executing !== sha256(git(resolve(myfactoryRoot), "show", `${myfactory.commit}:${path}`)))
      throw Error("IDENTITY_GENERATOR_SOURCE_MISMATCH");
    return [path, executing];
  }));
  const configuration = referenceConfiguration(resolve(myeveRoot));
  if (configuration.model !== "deterministic/no-model")
    throw Error("IDENTITY_REQUIRES_NO_MODEL");
  const sourceDigest = digest({ sourceCommit: myfactory.commit });
  const configurationDigest = digest(configuration);
  for (const [root, source] of [[myeveRoot, myeve], [myfactoryRoot, myfactory]]) {
    if (git(root, "status", "--porcelain", "--untracked-files=normal").length ||
        git(root, "rev-parse", "HEAD").toString().trim() !== source.commit)
      throw Error("IDENTITY_SOURCE_CHANGED_DURING_CAPTURE");
  }
  const body = {
    format: "myapps.nonproduction-identity-receipt.v1",
    generator,
    sources: { myeve, myfactory },
    referenceResultV1: {
      sourceDigest, configurationDigest,
      factoryVersion: digest({ sourceDigest, configurationDigest }),
      configuration,
    },
    authority: {
      environment: "disposable-nonproduction", releaseApproved: false,
      executableProductionGrant: false, deploymentAuthorized: false,
      paidOperations: 0, liveProviderQualification: false,
    },
  };
  return { ...body, receiptDigest: digest(body) };
}

export function verifyIdentityReceipt(receipt, roots) {
  const current = identityReceipt(roots);
  if (canonical(receipt) !== canonical(current))
    throw Error("IDENTITY_RECEIPT_STALE_OR_SUBSTITUTED");
  return current;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, myeveRoot, myfactoryRoot, file] = process.argv.slice(2);
  if (!["create", "verify"].includes(mode) || !myeveRoot || !myfactoryRoot || !file)
    throw Error("Usage: qualify-myapps-identity.mjs create|verify MYEVE_ROOT MYFACTORY_ROOT RECEIPT.json");
  const roots = { myeveRoot, myfactoryRoot };
  if (mode === "create") {
    const receipt = identityReceipt(roots);
    writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    console.log(receipt.receiptDigest);
  } else {
    console.log(verifyIdentityReceipt(JSON.parse(readFileSync(file, "utf8")), roots).receiptDigest);
  }
}
