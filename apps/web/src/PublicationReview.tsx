import { useEffect, useState } from "react";
import type { Check, ExternalAction, FactoryPolicy, PublicationApproval, PublicationRequest, Run, WorkOrderDetail } from "@factory/contracts";
import { getCheckLog, getPolicy, getWorkOrderDiff, sendAction, type TextEvidence } from "./api";
import { errorText, formatDate } from "./domain";

interface ReviewEvidence {
  policy: FactoryPolicy;
  diff: TextEvidence;
  logs: Record<string, TextEvidence>;
}

interface Props {
  detail: WorkOrderDetail;
  onRefresh: () => void;
}

function latestAttempt(detail: WorkOrderDetail): Run | undefined {
  return [...detail.runs].sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
}

function latestRequest(detail: WorkOrderDetail): PublicationRequest | undefined {
  return [...detail.publicationRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function EvidenceText({ title, evidence }: { title: string; evidence: TextEvidence }) {
  if (!evidence.available) return <p className="review-evidence__missing">{title} is unavailable in the saved artifacts.</p>;
  return <pre tabIndex={0} aria-label={title}>{evidence.text || "Artifact is empty."}</pre>;
}

export default function PublicationReview({ detail, onRefresh }: Props) {
  const workOrder = detail.workOrder;
  const run = latestAttempt(detail);
  const checks = run ? detail.checks.filter((check) => check.runId === run.id) : [];
  const checkEvidenceVersion = checks.map((check) => `${check.id}:${check.status}:${check.logSha256 ?? ""}`).join("|");
  const request = latestRequest(detail);
  const approval = request ? detail.publicationApprovals.find((item) => item.requestId === request.id) : undefined;
  const external = request ? detail.externalActions.find((item) =>
    item.kind === "draft_pr" && item.publicationRequestId === request.id) : undefined;
  const [evidence, setEvidence] = useState<ReviewEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [destination, setDestination] = useState(request?.destination ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState<"request" | "approve" | "publish" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setEvidence(null);
    void Promise.all([
      getPolicy(),
      run?.candidateCommit ? getWorkOrderDiff(workOrder.id) : Promise.resolve<TextEvidence>({ available: false, text: null }),
      Promise.all(checks.map(async (check) => [check.id, await getCheckLog(workOrder.id, check.id)] as const)),
    ]).then(([policy, diff, entries]) => {
      if (!active) return;
      setEvidence({ policy, diff, logs: Object.fromEntries(entries) });
    }).catch((cause: unknown) => {
      if (active) setLoadError(errorText(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workOrder.id, run?.id, checkEvidenceVersion, revision]);

  const requiredCommands = workOrder.kind === "defect" && workOrder.reproductionCommand
    ? [...new Set([workOrder.reproductionCommand, ...workOrder.checkCommands])]
    : workOrder.checkCommands;
  const completeChecks = Boolean(run?.candidateCommit) && checks.length === requiredCommands.length && requiredCommands.every((command, index) =>
    checks[index]?.command === command && checks[index]?.candidateCommit === run?.candidateCommit &&
    checks[index]?.status === "passed" && checks[index]?.exitCode === 0 && Boolean(checks[index]?.logSha256)
  );
  const artifactsAvailable = Boolean(evidence?.diff.available) && checks.every((check) => evidence?.logs[check.id]?.available);
  const ready = workOrder.state === "ready_for_review" && run?.state === "ready_for_review" && completeChecks;
  const requestMatches = Boolean(request && run && evidence && request.runId === run.id && request.candidateCommit === run.candidateCommit && request.policyRevision === evidence.policy.revision);
  const approvalRecorded = Boolean(approval);
  const approvalCurrent = Boolean(approval && requestMatches && request && approval.candidateCommit === request.candidateCommit && approval.evidenceDigest === request.evidenceDigest && approval.policyRevision === request.policyRevision && Date.parse(approval.expiresAt) > Date.now());
  const canReconcile = external?.state === "unknown";
  const destinationValid = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(destination.trim());

  async function perform(kind: "request" | "approve" | "publish") {
    setPending(kind);
    setActionError(null);
    setNotice(null);
    try {
      if (kind === "request") {
        if (!ready || !artifactsAvailable || !destinationValid) return;
        await sendAction<PublicationRequest>("publication.request", { workOrderId: workOrder.id, destination: destination.trim() });
        setNotice("Publication proposed. Human approval is still required; nothing has been pushed.");
      } else if (kind === "approve") {
        if (!request || !requestMatches || !artifactsAvailable || !acknowledged) return;
        await sendAction<PublicationApproval>("publication.approve", {
          requestId: request.id,
          candidateCommit: request.candidateCommit,
          evidenceDigest: request.evidenceDigest,
          policyRevision: request.policyRevision,
        });
        setAcknowledged(false);
        setNotice("Approval recorded for this exact candidate and evidence. No code has been published.");
      } else {
        if (!request || (!approvalCurrent && !canReconcile)) return;
        const result = await sendAction<ExternalAction>("publication.publish_draft", { requestId: request.id });
        setNotice(result.state === "succeeded"
          ? "Draft pull request confirmed on GitHub. Review its link and external action record."
          : "Publication outcome is still being checked.");
      }
      onRefresh();
      setRevision((value) => value + 1);
    } catch (cause) {
      setActionError(errorText(cause));
      onRefresh();
      setRevision((value) => value + 1);
    } finally {
      setPending(null);
    }
  }

  return <section className="paper-card publication-review" aria-labelledby="publication-review-title">
    <div className="card-heading"><p className="eyebrow">Human review</p><h2 id="publication-review-title">Publication decision</h2></div>
    <p className="muted-copy">Review the exact candidate and recorded checks. Requests and approvals remain local until a separate draft publication action succeeds.</p>
    {loading && <p className="muted-copy" role="status">Loading policy and evidence…</p>}
    {loadError && <div className="inline-error" role="alert">Evidence could not load: {loadError} <button className="text-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
    <dl className="stacked-values">
      <div><dt>Candidate SHA</dt><dd>{run?.candidateCommit ? <code>{run.candidateCommit}</code> : "No candidate recorded"}</dd></div>
      <div><dt>Input SHA</dt><dd>{run?.inputCommit ? <code>{run.inputCommit}</code> : "No attempt recorded"}</dd></div>
      <div><dt>Policy revision</dt><dd>{evidence?.policy.revision ?? (loading ? "Loading…" : "Unavailable")}</dd></div>
      <div><dt>Verification</dt><dd>{completeChecks ? `${checks.length} required checks passed` : "Required passing checks are incomplete"}</dd></div>
    </dl>
    {run?.candidateCommit && <details className="review-evidence"><summary>Review candidate diff</summary>{evidence ? <EvidenceText title="Candidate diff" evidence={evidence.diff} /> : <p className="muted-copy">{loading ? "Loading diff…" : "Diff unavailable."}</p>}</details>}
    {checks.length > 0 && <div className="review-checks"><h3>Recorded checks</h3>{checks.map((check: Check) => <details className="review-evidence" key={check.id}><summary><span>{check.command}</span><strong>{check.status}</strong></summary><dl className="stacked-values"><div><dt>Check ID</dt><dd><code>{check.id}</code></dd></div><div><dt>Log SHA-256</dt><dd>{check.logSha256 ? <code>{check.logSha256}</code> : "Unavailable"}</dd></div><div><dt>Exit code</dt><dd>{check.exitCode ?? "Unavailable"}</dd></div></dl>{evidence?.logs[check.id] ? <EvidenceText title={`Log for ${check.command}`} evidence={evidence.logs[check.id]} /> : <p className="muted-copy">{loading ? "Loading log…" : "Log unavailable."}</p>}</details>)}</div>}
    {!ready && <p className="review-evidence__missing">A publication request requires a ready candidate with every required check passed. The supervisor will recheck its evidence.</p>}
    {ready && !artifactsAvailable && !loading && <p className="review-evidence__missing">The candidate diff or a check log is unavailable. Review and publication controls are held.</p>}
    <div className="publication-review__request"><label htmlFor="publication-destination">GitHub destination <span>owner/repo</span></label><div><input id="publication-destination" type="text" autoComplete="off" spellCheck={false} value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="owner/repo" /><button className="button button--quiet" type="button" disabled={!ready || !artifactsAvailable || !destinationValid || pending !== null} onClick={() => void perform("request")}>{pending === "request" ? "Requesting…" : "Propose publication"}</button></div><p>Creates a local proposal. It does not authorize a push or draft pull request.</p></div>
    {request && <div className="publication-review__binding"><h3>Latest proposal</h3><dl className="stacked-values"><div><dt>Destination</dt><dd>{request.destination}</dd></div><div><dt>Candidate SHA</dt><dd><code>{request.candidateCommit}</code></dd></div><div><dt>Evidence digest</dt><dd><code>{request.evidenceDigest}</code></dd></div><div><dt>Policy revision</dt><dd>{request.policyRevision}</dd></div><div><dt>Requested</dt><dd>{formatDate(request.createdAt)}</dd></div></dl>{!requestMatches && <p className="review-evidence__missing">This proposal no longer matches the current candidate or policy. Create a fresh proposal after review.</p>}
      {requestMatches && !approvalRecorded && <div className="publication-review__approval"><label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I reviewed this candidate diff, the check logs and their digests, destination, and policy revision.</label><button className="button button--primary" type="button" disabled={!acknowledged || !artifactsAvailable || pending !== null} onClick={() => void perform("approve")}>{pending === "approve" ? "Approving…" : "Approve this exact proposal"}</button></div>}
      {approval && <div className="publication-review__approved"><p>Approval recorded by {approval.approverId} at {formatDate(approval.approvedAt)}. It expires {formatDate(approval.expiresAt)}. The supervisor rechecks candidate, evidence, policy, and expiry before new publication.</p>{!approvalCurrent && !canReconcile && external?.state !== "succeeded" && <p>This approval is stale or expired for the current proposal. Request publication again before proceeding.</p>}{external?.state === "succeeded" && external.remoteIdentity?.startsWith("https://github.com/") ? <a href={external.remoteIdentity} target="_blank" rel="noopener noreferrer">Open confirmed draft pull request ↗</a> : null}{external?.state === "failed" && <p>The publication attempt failed. Review a fresh proposal before retrying.</p>}{external?.state === "dispatched" && <p>Publication is in progress. Refresh this WorkOrder for its outcome.</p>}{(!external || canReconcile) && <button className="button button--quiet" type="button" disabled={(!approvalCurrent && !canReconcile) || pending !== null} onClick={() => void perform("publish")}>{pending === "publish" ? "Checking publication…" : canReconcile ? "Reconcile GitHub outcome" : "Create draft pull request"}</button>}<small>{canReconcile ? "Reconciliation reads GitHub state and does not repeat the push or PR creation." : "The host checks the exact review binding and asks for device-owner confirmation before publishing."}</small></div>}
    </div>}
    {notice && <p className="publication-review__notice" role="status">{notice}</p>}
    {actionError && <p className="review-evidence__missing" role="alert">{actionError}</p>}
  </section>;
}
