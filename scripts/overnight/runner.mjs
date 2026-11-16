// Nightly governed loop: one bounded Factory attempt for tonight's labeled issue.
//
// The runner is a registered connection client of the local supervisor. It uses only
// the existing bounded control API (factory.prepare / dispatch / observe / stop), so
// the supervisor's admission limits, spend ledger, writer fencing, independent
// verification and signed Result all still apply. It never merges, never approves
// publication and never retries a night: the morning decision stays with the owner.
import { overnightGuard } from "./config.mjs";
import { issueToWork, selectIssue } from "./issues.mjs";

export const SPEND_DEFAULTS = Object.freeze({
  plannedProductiveOperations: 2,
  plannedCompletionOperations: 1,
  // Conservative per-operation reserve of the qualified gpt-5.4-mini envelope.
  completionReserveMicrousd: 336_864,
});
const POLL_MS = 15_000;
const GRACE_MS = 10 * 60_000;

/** Decode the canonical manifest inside a SignedResult without trusting it as authority. */
export function decodeManifest(result) {
  if (!result || typeof result.encoded !== "string") return null;
  try { return JSON.parse(Buffer.from(result.encoded, "base64url").toString("utf8")); } catch { return null; }
}

/** The Proof facts the morning summary shows: signed status, candidate and per-check evidence. */
export function proofSummary(signed) {
  const manifest = decodeManifest(signed);
  if (!manifest) return null;
  return {
    protocol: signed.protocol,
    manifestDigest: signed.manifestDigest,
    signed: typeof signed.signature === "string" && signed.signature.length > 0,
    status: manifest.status,
    producer: manifest.producer,
    factoryVersion: manifest.execution?.factoryVersion ?? null,
    candidate: manifest.candidate ? { commit: manifest.candidate.commit, base: manifest.candidate.base, patchDigest: manifest.candidate.patchDigest } : null,
    checks: (manifest.evidence ?? []).map((item) => ({ command: item.command, status: item.status, exitCode: item.exitCode })),
    evidenceDigest: manifest.evidenceDigest,
    completedAt: manifest.completedAt,
  };
}

export function prepareRequest({ config, work, requestId, workId, now, spend = SPEND_DEFAULTS }) {
  return {
    requestId, workId, workGeneration: 1, repository: config.repository,
    deadline: new Date(now.getTime() + config.deadlineSeconds * 1000).toISOString(),
    maxSpendUsd: config.maxSpendUsd,
    spendContract: {
      version: "WORK_LEDGER_V2", pricingRevision: config.pricingRevision ?? "(set FACTORY_OVERNIGHT_PRICING_REVISION)",
      plannedProductiveOperations: spend.plannedProductiveOperations,
      plannedCompletionOperations: spend.plannedCompletionOperations,
      maxPaidOperations: spend.plannedProductiveOperations + spend.plannedCompletionOperations,
      completionReserveMicrousd: spend.completionReserveMicrousd,
    },
    input: work,
  };
}

/** Writer identity for factory.dispatch, bound to exactly what prepare captured. */
export function executionIdentity({ prepared, request, uuid }) {
  const s = prepared.snapshot;
  if (!s?.factoryId || !s.factoryVersion || !s.runId || !s.inputCommit || !s.configuration) {
    throw new Error("Factory did not return a prepared execution snapshot");
  }
  return {
    runId: uuid(), writerGeneration: 1, dispatchIdentity: uuid(),
    workId: request.workId, workGeneration: request.workGeneration,
    factoryId: s.factoryId, factoryVersion: s.factoryVersion,
    requestId: request.requestId, workOrderId: s.workOrderId, remoteRunId: s.runId,
    repository: request.repository, baseSha: s.inputCommit,
    allowedPaths: [...s.configuration.allowedPaths], deadline: request.deadline,
  };
}

function message(error) { return error instanceof Error ? error.message : String(error); }

/**
 * Run tonight's loop once. All side effects go through `deps`, so the CLI wires the
 * real supervisor/GitHub/git and tests wire fakes.
 */
export async function runOvernight({ config, now = new Date(), deps, spend = SPEND_DEFAULTS }) {
  const report = { night: null, mode: config.dryRun ? "dry-run" : "live", startedAt: now.toISOString(),
    repository: config.repository, outcome: null, detail: null, issue: null, skipped: [], missing: [],
    workOrderId: null, runId: null, state: null, spend: null, proof: null, publication: null, notes: [] };
  const finish = (outcome, detail) => Object.assign(report, { outcome, detail, finishedAt: deps.clock().toISOString() });

  const ledger = await deps.readLedger();
  let policy = null;
  try { policy = await deps.factory.policy(); } catch (error) { report.notes.push(`Policy unreadable: ${message(error)}`); }
  const guard = overnightGuard({ config, now, ledger, policy });
  report.night = guard.night ?? null;
  if (!guard.ok) return finish(`skipped:${guard.reason}`, guard.detail);
  if (!config.dryRun && !policy) return finish("skipped:supervisor_unreachable", "The local supervisor did not answer; nothing was dispatched.");

  const issues = await deps.listIssues();
  const { issue, skipped } = selectIssue(issues, { label: config.label, holdLabel: config.holdLabel, authors: config.authors, ledger });
  report.skipped = skipped;
  if (!issue) return finish("no_issue", `No open issue labeled ${config.label} is eligible tonight.`);
  report.issue = { number: issue.number, title: issue.title, url: issue.html_url ?? `https://github.com/${config.repository}/issues/${issue.number}` };

  const baseSha = await deps.resolveBaseSha();
  const work = issueToWork(issue, { repository: config.repository, repositoryPath: config.repositoryPath, baseSha });
  if (!work.ok) {
    report.missing = work.missing;
    return finish("needs_clarification", "The issue is missing what a bounded attempt needs; the night was not consumed.");
  }
  const request = prepareRequest({ config, work: work.input, requestId: deps.uuid(), workId: deps.uuid(), now, spend });
  if (config.dryRun) {
    report.plan = request;
    return finish("planned", "Dry run: this is the exact bounded request a live night would prepare. Nothing was dispatched.");
  }

  // Claim the night before any Factory mutation, so a crash can never produce a second attempt.
  ledger.nights = { ...(ledger.nights ?? {}), [guard.night]: { mode: "live", issue: issue.number,
    requestId: request.requestId, workId: request.workId, state: "claimed", startedAt: now.toISOString() } };
  await deps.writeLedger(ledger);
  const save = async (patch) => { Object.assign(ledger.nights[guard.night], patch); await deps.writeLedger(ledger); };

  let prepared, identity;
  try {
    prepared = await deps.factory.prepare(request);
    report.workOrderId = prepared.workOrderId ?? null;
    report.runId = prepared.runId ?? null;
    identity = executionIdentity({ prepared, request, uuid: deps.uuid });
    await save({ state: "prepared", workOrderId: report.workOrderId, runId: report.runId, identity });
  } catch (error) {
    await save({ state: "prepare_failed", error: message(error) });
    return finish("prepare_failed", `Factory refused or could not prepare the bounded request: ${message(error)}`);
  }

  let observed;
  try {
    observed = await deps.factory.dispatch(request.requestId, identity);
    await save({ state: "dispatched" });
  } catch (error) {
    await save({ state: "dispatch_failed", error: message(error) });
    return finish("dispatch_failed", `Factory did not admit the dispatch: ${message(error)}`);
  }

  const hardStop = Date.parse(request.deadline) + GRACE_MS;
  let stopRequested = false;
  while (!observed?.quiescent) {
    if (deps.clock().getTime() >= hardStop) {
      if (stopRequested) break;
      stopRequested = true;
      report.notes.push("Deadline plus grace passed; requested a bounded stop.");
      try { observed = await deps.factory.stop(request.requestId, identity); } catch (error) { report.notes.push(`Stop failed: ${message(error)}`); }
      continue;
    }
    await deps.sleep(POLL_MS);
    try { observed = await deps.factory.read(request.requestId); } catch (error) { report.notes.push(`Observe failed: ${message(error)}`); }
  }
  report.state = observed?.state ?? "UNKNOWN";
  report.spend = observed?.spend ?? null;
  await save({ state: report.state, quiescent: Boolean(observed?.quiescent) });
  if (!observed?.quiescent) return finish("unknown", "The attempt did not reach a reconciled terminal state; it needs your reconciliation before anything else runs.");

  if (report.workOrderId && report.runId) {
    try {
      const read = await deps.factory.result(report.workOrderId, report.runId);
      report.proof = read?.result ? proofSummary(read.result) : null;
    } catch (error) { report.notes.push(`Signed Result unavailable: ${message(error)}`); }
  }
  const completed = report.state === "COMPLETED" && report.proof?.status === "COMPLETED" && report.proof.candidate;
  if (!completed) return finish("not_completed", `The attempt ended ${report.state}; no candidate is ready for review.`);
  const allPassed = report.proof.checks.length > 0 && report.proof.checks.every((check) => check.status === "passed");
  if (!allPassed) report.notes.push("Not every recorded check passed; review the evidence before requesting publication.");

  if (config.requestPublication && allPassed) {
    try {
      report.publication = await deps.factory.requestPublication(report.workOrderId, config.repository);
      await save({ publicationRequested: true });
    } catch (error) { report.notes.push(`Publication request not created: ${message(error)}`); }
  }
  return finish("ready_for_review", "A verified candidate with a signed Result is waiting for your approval.");
}

/** Morning summary in Markdown. Read-only facts; the only actions it lists are the owner's. */
export function renderSummary(report) {
  const lines = [`# MyFactory overnight — night of ${report.night ?? "(outside window)"}`, ""];
  lines.push(`- Mode: ${report.mode}`, `- Outcome: **${report.outcome}**`, `- ${report.detail ?? ""}`);
  if (report.issue) lines.push(`- Issue: [#${report.issue.number} ${report.issue.title}](${report.issue.url})`);
  if (report.workOrderId) lines.push(`- WorkOrder: \`${report.workOrderId}\`${report.runId ? ` · run \`${report.runId}\`` : ""}`);
  if (report.state) lines.push(`- Factory state: ${report.state}`);
  if (report.spend) {
    const s = report.spend;
    const used = s.settledMicrousd;
    lines.push(`- Spend: ${s.status ?? "?"}${Number.isFinite(used) ? ` · ${(used / 1_000_000).toFixed(4)} USD settled` : ""}${s.ceilingMicrousd ? ` of ${(s.ceilingMicrousd / 1_000_000).toFixed(2)} USD ceiling` : ""}${s.unknownExposureMicrousd ? ` · UNKNOWN exposure ${(s.unknownExposureMicrousd / 1_000_000).toFixed(4)} USD` : ""}`);
  }
  if (report.missing?.length) lines.push("", "## Issue needs", ...report.missing.map((item) => `- ${item}`));
  if (report.proof) {
    const p = report.proof;
    lines.push("", "## Proof (signed Result)",
      `- Status: ${p.status} · signed: ${p.signed ? "yes" : "no"} · protocol ${p.protocol}`,
      `- Manifest digest: \`${p.manifestDigest}\``,
      `- FactoryVersion: \`${p.factoryVersion}\``);
    if (p.candidate) lines.push(`- Candidate: \`${p.candidate.commit}\` on base \`${p.candidate.base}\` · patch \`${p.candidate.patchDigest}\``);
    lines.push(`- Evidence digest: \`${p.evidenceDigest}\``, "", "| Check | Status | Exit |", "| --- | --- | --- |",
      ...p.checks.map((c) => `| \`${String(c.command).replace(/\|/g, "\\|")}\` | ${c.status} | ${c.exitCode} |`));
  }
  if (report.publication) lines.push("", `Publication request created: \`${report.publication.id ?? JSON.stringify(report.publication)}\``);
  if (report.outcome === "ready_for_review") {
    lines.push("", "## Your morning decision",
      "1. Open the work desk (http://127.0.0.1:8787) and review the diff and check logs for this WorkOrder.",
      report.publication ? "2. Approve the publication request (Touch ID), then publish the draft PR." : "2. Request publication, approve it (Touch ID), then publish the draft PR.",
      "3. Review and merge the draft PR on GitHub yourself. MyFactory never merges.");
  }
  if (report.plan) lines.push("", "## Planned request (dry run)", "```json", JSON.stringify(report.plan, null, 2), "```");
  if (report.skipped?.length) lines.push("", "## Skipped issues", ...report.skipped.map((s) => `- #${s.number}: ${s.reason}`));
  if (report.notes?.length) lines.push("", "## Notes", ...report.notes.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}
