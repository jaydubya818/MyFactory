import { useEffect, useState } from "react";
import { getCheckLog, getWorkOrderDiff, type TextEvidence } from "./api";
import { errorText } from "./domain";

export default function SavedEvidence({ workOrderId, checkId, runId, candidateCommit, title, summary }: {
  workOrderId: string;
  checkId?: string;
  runId?: string;
  candidateCommit?: string;
  title: string;
  summary: string;
}) {
  const [requested, setRequested] = useState(false);
  const [evidence, setEvidence] = useState<TextEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!requested) return;
    let active = true;
    setLoading(true);
    setError(null);
    setEvidence(null);
    const request = checkId ? getCheckLog(workOrderId, checkId)
      : runId && candidateCommit ? getWorkOrderDiff(workOrderId, { runId, candidateCommit })
      : Promise.reject(new Error("Candidate identity is unavailable. Refresh the work order."));
    void request.then((next) => {
      if (active) setEvidence(next);
    }).catch((reason: unknown) => {
      if (active) setError(errorText(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [requested, workOrderId, checkId, runId, candidateCommit, revision]);

  return <details className="review-evidence" onToggle={(event) => {
    if (event.currentTarget.open) setRequested(true);
  }}>
    <summary>{summary}</summary>
    {loading && <p className="muted-copy" role="status">Loading {title.toLowerCase()}…</p>}
    {error && <div className="inline-error" role="alert">
      <span>{title} could not load: {error}</span>
      <button className="text-button" type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button>
    </div>}
    {evidence && (evidence.available
      ? <pre tabIndex={0} aria-label={title}>{evidence.text || "Artifact is empty."}</pre>
      : <p className="review-evidence__missing">{title} is unavailable in the saved artifacts.</p>)}
  </details>;
}
