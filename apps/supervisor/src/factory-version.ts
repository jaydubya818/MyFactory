import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { WorkOrder } from "../../../packages/contracts/src/index.ts";

const execFileAsync = promisify(execFile);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const skillReferenceCommit = "fd8f20a879b507cf09feba08663a1edf7a949353";

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", sourceRoot, ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 2_000_000,
  });
  return stdout.trim();
}

export function factoryIdentity(dataDir: string): string {
  const path = resolve(dataDir, "factory-id");
  if (!existsSync(path)) writeFileSync(path, randomUUID(), { flag: "wx", mode: 0o600 });
  const value = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f-]{36}$/.test(value)) throw new Error("Invalid saved Factory identity");
  return value;
}

/** Source and effective configuration are captured before any hosted attempt
 * does productive work. An unidentifiable or dirty installation fails closed. */
export async function captureFactoryVersion(input: { dataDir: string; workOrder: WorkOrder;
  inputCommit: string; model: string; agentVersion: string }) {
  const [sourceCommit, sourceTree, status] = await Promise.all([
    git(["rev-parse", "HEAD"]), git(["rev-parse", "HEAD^{tree}"]),
    git(["status", "--porcelain=v1", "--untracked-files=all"]),
  ]);
  if (!/^[a-f0-9]{40,64}$/.test(sourceCommit) || !/^[a-f0-9]{40,64}$/.test(sourceTree) || status)
    throw new Error("Factory source/build cannot be attested from a clean installation");
  const effectiveConfiguration = {
    model: input.model, agentExecutable: "codex", agentVersion: input.agentVersion,
    skillReferenceCommit, workerProfile: input.workOrder.workerProfile,
    verifierProfile: "factory-verify-candidate-v1", checkCommands: input.workOrder.checkCommands,
    reproductionCommand: input.workOrder.reproductionCommand,
    expectedFailureText: input.workOrder.expectedFailureText,
    allowedPaths: input.workOrder.allowedPaths, inputCommit: input.inputCommit,
  };
  return { factoryId: factoryIdentity(input.dataDir),
    factoryVersion: { sourceCommit, sourceTree, configurationDigest: createHash("sha256")
      .update(JSON.stringify(effectiveConfiguration)).digest("hex") }, effectiveConfiguration };
}
