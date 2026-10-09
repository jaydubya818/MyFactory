import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digest, sha256 } from "../../../hosted-routing/src/result.ts";

// Bind the trusted cross-repository verifier/runtime dependency by bytes, not a mutable path.
export const referenceConfiguration = (myeveRoot) => ({
  model: "deterministic/no-model",
  executor: "declarative-app-template",
  executorVersion:
    "1+myeve-" +
    digest(
      Object.fromEntries(
        ["contracts.ts", "store.ts", "crm.ts"].map((name) => [
          name,
          sha256(readFileSync(resolve(myeveRoot, "packages/myapps/src", name))),
        ]),
      ),
    ),
  skillRevision: "none",
  workerProfile: "reference-process",
  verificationImage: "trusted-host-node24-reference",
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
  commands: ["myapps-protected-reference-v1"],
  allowedPaths: ["app-package.json"],
  timeoutMs: 15000,
});
