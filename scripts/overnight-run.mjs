#!/usr/bin/env node
// Nightly governed issue-to-PR loop. See docs/OVERNIGHT.md.
//
//   node scripts/overnight-run.mjs            # honours FACTORY_OVERNIGHT_LIVE; dry run by default
//   node scripts/overnight-run.mjs --dry-run  # always plan only, even when live is configured
//   node scripts/overnight-run.mjs --ignore-window --dry-run   # rehearse in the daytime
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { overnightConfigFromEnv, OvernightConfigError } from "./overnight/config.mjs";
import { listLabeledIssues } from "./overnight/issues.mjs";
import { connectionClient } from "./overnight/factory-client.mjs";
import { renderSummary, runOvernight } from "./overnight/runner.mjs";

const execFileAsync = promisify(execFile);
const { values } = parseArgs({ options: {
  "dry-run": { type: "boolean", default: false },
  "ignore-window": { type: "boolean", default: false },
  json: { type: "boolean", default: false },
} });

let config;
try {
  config = overnightConfigFromEnv(process.env);
} catch (error) {
  if (error instanceof OvernightConfigError) { console.error(`overnight: ${error.message}`); process.exit(2); }
  throw error;
}
if (values["dry-run"]) config = Object.freeze({ ...config, dryRun: true });
if (values["ignore-window"]) {
  if (!config.dryRun) { console.error("overnight: --ignore-window is only allowed with a dry run"); process.exit(2); }
  config = Object.freeze({ ...config, window: { start: 0, end: 1439, text: "00:00-23:59 (ignored)" } });
}

const dir = join(config.dataDir, "overnight");
mkdirSync(join(dir, "summaries"), { recursive: true, mode: 0o700 });
const ledgerPath = join(dir, "ledger.json");
const lockPath = join(dir, "run.lock");

// One runner at a time. A lock older than two hours is from a crashed run.
if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 2 * 60 * 60 * 1000) rmSync(lockPath);
let lock;
try { lock = openSync(lockPath, "wx", 0o600); } catch {
  console.error("overnight: another overnight run holds the lock; exiting without action");
  process.exit(0);
}

const writeAtomic = (path, text) => {
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
};
const token = config.tokenFile && existsSync(config.tokenFile) ? readFileSync(config.tokenFile, "utf8").trim() : null;

try {
  const report = await runOvernight({ config, now: new Date(), deps: {
    clock: () => new Date(),
    uuid: randomUUID,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readLedger: async () => existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { nights: {} },
    writeLedger: async (ledger) => writeAtomic(ledgerPath, JSON.stringify(ledger, null, 2) + "\n"),
    listIssues: () => listLabeledIssues({ repository: config.repository, label: config.label }),
    resolveBaseSha: async () => {
      const git = (...args) => execFileAsync("git", ["-C", config.repositoryPath, ...args], { encoding: "utf8", timeout: 120_000 });
      await git("fetch", "--quiet", "origin", config.baseBranch);
      return (await git("rev-parse", "--verify", `origin/${config.baseBranch}^{commit}`)).stdout.trim();
    },
    factory: connectionClient({ origin: config.origin, token }),
  } });
  const summary = renderSummary(report);
  const name = `${report.night ?? new Date().toISOString().slice(0, 10)}-${report.mode}.md`;
  writeAtomic(join(dir, "summaries", name), summary);
  writeAtomic(join(dir, "latest.md"), summary);
  console.log(values.json ? JSON.stringify(report, null, 2) : summary);
} finally {
  closeSync(lock);
  rmSync(lockPath, { force: true });
}
