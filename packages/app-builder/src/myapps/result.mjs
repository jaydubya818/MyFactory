import { proofEvidenceReference } from "../../../verification/src/evidence.ts";
import {
  canonical,
  digest,
  sha256,
  operationId,
  signResult,
  verifyResult,
} from "../../../hosted-routing/src/result.ts";
import { candidateObjects } from "./controller.mjs";
export { referenceConfiguration } from "./configuration.mjs";
/** Exact existing Result v1 transport. Local reference verification is a check artifact,
 * never mislabeled INDEPENDENT_CLOUD_VERIFICATION or live provider evidence. */
export function appResult({
  pkg,
  basePackage = null,
  run,
  verification,
  privateKey,
  keyId,
  issuedAt,
}) {
  if (
    run.appDigest !== "sha256:" + digest(pkg) ||
    verification.appDigest !== run.appDigest ||
    !verification.cleanupConfirmed
  )
    throw Error("APP_RESULT_BINDING");
  const configuration = run.configuration,
    configurationDigest = digest(configuration);
  if (
    pkg.factoryVersion.configurationDigest !==
    "sha256:" + configurationDigest
  )
    throw Error("APP_FACTORY_VERSION_BINDING");
  const sourceDigest = digest({
    sourceCommit: pkg.factoryVersion.sourceCommit,
  });
  const execution = {
    version: 1,
    factoryId: "myapps-reference-factory",
    factoryVersion: digest({ sourceDigest, configurationDigest }),
    sourceDigest,
    configurationDigest,
    configuration,
    requestId: run.id,
    requestDigest: run.requestHash,
    workOrderId: pkg.work.workId,
    runId: run.id,
    attemptNumber: 1,
    inputCommit: pkg.source.repositoryCommit,
    capturedAt: issuedAt,
  };
  const objects = candidateObjects(pkg);
  if (
    objects.commit !== run.candidateCommit ||
    objects.tree !== run.candidateTree
  )
    throw Error("APP_RESULT_CANDIDATE_BINDING");
  if (
    pkg.base &&
    (!basePackage ||
      "sha256:" + digest(basePackage) !== pkg.base.digest ||
      candidateObjects(basePackage).commit !== pkg.source.repositoryCommit)
  )
    throw Error("APP_RESULT_BASE_BINDING");
  const patch = Buffer.from(
    basePackage
      ? `diff --git a/app-package.json b/app-package.json\n--- a/app-package.json\n+++ b/app-package.json\n@@ -1 +1 @@\n-${canonical(basePackage)}\n+${canonical(pkg)}\n`
      : `diff --git a/app-package.json b/app-package.json\nnew file mode 100644\n--- /dev/null\n+++ b/app-package.json\n@@ -0,0 +1 @@\n+${canonical(pkg)}\n`,
  );
  const contents = [
    ["app-commit", "git-commit", objects.commitBytes],
    ["app-tree", "git-tree", objects.treeBytes],
    ["app-patch", "patch", patch],
    ["app-verifier", "check-log", Buffer.from(canonical(verification))],
  ];
  const artifacts = contents.map(([id, kind, bytes]) => ({
    id,
    kind,
    producer: execution.factoryId,
    runId: run.id,
    candidateCommit: objects.commit,
    sha256: sha256(bytes),
    size: bytes.length,
    createdAt: issuedAt,
  }));
  const evidence = [
    {
      id: "app-verification",
      producer: execution.factoryId,
      runId: run.id,
      candidateCommit: objects.commit,
      command: configuration.commands[0],
      status:
        verification.status === "PASS"
          ? "passed"
          : verification.status === "FAIL"
            ? "failed"
            : "unavailable",
      exitCode:
        verification.status === "PASS"
          ? 0
          : verification.status === "FAIL"
            ? 1
            : null,
      startedAt: issuedAt,
      finishedAt: issuedAt,
      logArtifactId: "app-verifier",
    },
  ];
  const manifest = {
    protocol: "MYFACTORY_RESULT_V1",
    keyId,
    producer: execution.factoryId,
    operationId: operationId(execution),
    execution,
    status: verification.status === "PASS" ? "COMPLETED" : "FAILED",
    candidate: {
      commit: objects.commit,
      tree: objects.tree,
      base: pkg.source.repositoryCommit,
      patchDigest: sha256(patch),
      commitArtifactId: "app-commit",
      treeArtifactId: "app-tree",
      patchArtifactId: "app-patch",
    },
    evidence,
    artifacts,
    evidenceDigest: digest(evidence),
    artifactDigest: digest(artifacts),
    completedAt: issuedAt,
    issuedAt,
  };
  return signResult(
    manifest,
    contents.map(([id, _kind, bytes]) => ({
      id,
      base64: bytes.toString("base64"),
    })),
    privateKey,
  );
}
export function verifyAppResult({ signed, pkg, run, keys, now }) {
  const configurationDigest = digest(run.configuration),
    sourceDigest = digest({ sourceCommit: pkg.factoryVersion.sourceCommit });
  if (
    pkg.factoryVersion.configurationDigest !==
    "sha256:" + configurationDigest
  )
    throw Error("APP_FACTORY_VERSION_BINDING");
  const verified = verifyResult(signed, {
    keys,
    factoryId: "myapps-reference-factory",
    requestId: run.id,
    workOrderId: pkg.work.workId,
    runId: run.id,
    factoryVersion: digest({ sourceDigest, configurationDigest }),
    now,
  });
  // Generic Result verification accepts truthful terminal failures too. Only a
  // successful terminal Result may promote an App candidate to VERIFIED.
  // Its canonical validator also requires all configured checks to have passed.
  if (verified.manifest.status !== "COMPLETED")
    throw Error("APP_RESULT_NOT_COMPLETED");
  const artifact = signed.artifacts.find((a) => a.id === "app-verifier");
  const report = JSON.parse(Buffer.from(artifact.base64, "base64").toString());
  if (
    report.appDigest !== "sha256:" + digest(pkg) ||
    report.candidateId !== pkg.source.candidateId ||
    report.status !== "PASS" ||
    report.cleanupConfirmed !== true ||
    verified.manifest.candidate.commit !== run.candidateCommit ||
    verified.manifest.candidate.tree !== run.candidateTree
  )
    throw Error("APP_RESULT_BINDING");
  return { manifest: verified.manifest, verification: report };
}

/** Existing EvidenceProvider envelopes, derived only from an independently authenticated Result.
 * Retrieval remains owner-scoped by the caller; this grants no publication or installation. */
export function appEvidence({
  signed,
  pkg,
  run,
  keys,
  now,
  ownerId,
  repository,
}) {
  if (
    ownerId !== pkg.work.ownerId ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
  )
    throw Error("APP_UNAVAILABLE");
  const { manifest } = verifyAppResult({ signed, pkg, run, keys, now });
  const patch = signed.artifacts.find(
    (a) => a.id === manifest.candidate.patchArtifactId,
  );
  const entries = [
    [
      "TestEvidence",
      "application/json",
      Buffer.from(
        JSON.stringify(
          manifest.evidence.map((c) => ({
            command: c.command,
            status: c.status,
            exitCode: c.exitCode,
            candidateCommit: c.candidateCommit,
          })),
        ),
      ),
    ],
    ["DiffEvidence", "text/x-diff", Buffer.from(patch.base64, "base64")],
  ];
  return entries.map(([kind, mediaType, bytes]) => {
    const hash = sha256(bytes);
    const ref = {
      id: kind + "-" + hash,
      kind,
      mediaType,
      workOrderId: pkg.work.workId,
      runId: run.id,
      candidateCommit: run.candidateCommit,
      factoryVersion: manifest.execution.factoryVersion,
      sha256: hash,
      size: bytes.length,
      collectedAt: manifest.issuedAt,
      source: "myapps-signed-result",
    };
    return {
      scope: {
        ownerScope: ownerId,
        repository,
        workId: pkg.work.workId,
        workGeneration: pkg.work.workGeneration,
        requestId: run.id,
      },
      ref,
      proofReference: proofEvidenceReference(ref),
      base64: bytes.toString("base64"),
    };
  });
}
