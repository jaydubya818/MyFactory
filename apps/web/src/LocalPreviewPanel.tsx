import { useEffect, useState } from "react";
import { getPreviewLog, getPreviewStatus, sendAction, type PreviewStatus } from "./api";
import { errorText, formatDate } from "./domain";

const statusLabels: Record<PreviewStatus["status"], string> = {
  not_started: "Not started",
  building: "Preparing",
  running: "Live locally",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Interrupted",
};

function safePreviewUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && Boolean(url.port)
      ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function LocalPreviewPanel({ workOrderId, onRefresh }: {
  workOrderId: string;
  onRefresh: () => void;
}) {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await getPreviewStatus(workOrderId);
        if (!active) return;
        setStatus(next);
        setError(null);
      } catch (caught) {
        if (!active) return;
        setStatus(null);
        setError(errorText(caught));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !pending) void load();
    }, 5000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [workOrderId, revision, pending]);

  async function perform(action: "start" | "stop") {
    setPending(action);
    setError(null);
    if (action === "start") setStatus((current) => current ? { ...current, status: "building", url: null } : current);
    try {
      await sendAction(action === "start" ? "builder.preview.start" : "builder.preview.stop", { workOrderId });
      setLog(null);
      setRevision((value) => value + 1);
      onRefresh();
    } catch (caught) {
      setError(errorText(caught));
      setRevision((value) => value + 1);
    } finally {
      setPending(null);
    }
  }

  async function loadLog() {
    setLogLoading(true);
    try {
      const evidence = await getPreviewLog(workOrderId);
      setLog(evidence.available ? evidence.text ?? "" : "No preview log has been recorded yet.");
    } catch (caught) {
      setLog(`The preview log could not be loaded: ${errorText(caught)}`);
    } finally {
      setLogLoading(false);
    }
  }

  const liveUrl = status?.status === "running" ? safePreviewUrl(status.url) : null;
  const canStart = !loading && status !== null && !["building", "running"].includes(status.status);
  const canStop = status?.status === "building" || status?.status === "running";
  const recordedError = status?.lastEvent?.payload?.error;

  return (
    <section className="paper-card local-preview" aria-labelledby="local-preview-title">
      <div className="card-heading"><p className="eyebrow">App builder</p><h2 id="local-preview-title">Local preview</h2></div>
      <p className="muted-copy">Build and open the unchanged scaffold on this computer. This preview does not verify a candidate or publish the app.</p>
      <div className="local-preview__state">
        <span className="muted-copy">Status</span>
        <strong role="status">{loading && !status ? "Loading…" : status ? statusLabels[status.status] : "Unavailable"}</strong>
        {status?.lastEvent && <small>Last recorded {formatDate(status.lastEvent.createdAt)}</small>}
      </div>
      {(error || status?.status === "failed" || status?.status === "interrupted") &&
        <p className="local-preview__error" role="alert">{error ?? (typeof recordedError === "string" ? recordedError : status?.status === "interrupted" ? "The supervisor restarted while preview was active. Start it again when ready." : "The preview could not start. Open the log for details.")}</p>}
      <div className="local-preview__actions">
        {canStart && <button className="button button--primary" type="button" disabled={pending !== null} onClick={() => void perform("start")}>{pending === "start" ? "Preparing…" : "Start local preview"}</button>}
        {canStop && <button className="button button--quiet" type="button" disabled={pending !== null} onClick={() => void perform("stop")}>{pending === "stop" ? "Stopping…" : "Stop preview"}</button>}
        {liveUrl && <a className="button button--quiet" href={liveUrl} target="_blank" rel="noopener noreferrer">Open preview ↗</a>}
        <button className="button button--quiet" type="button" onClick={() => void loadLog()} disabled={logLoading}>{logLoading ? "Loading log…" : log === null ? "View log" : "Refresh log"}</button>
      </div>
      {status?.status === "running" && !liveUrl && <p className="local-preview__error" role="alert">The local service returned an invalid preview URL.</p>}
      {log !== null && <pre className="local-preview__log" aria-label="Preview log">{log}</pre>}
    </section>
  );
}
