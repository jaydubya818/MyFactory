import { useState } from "react";
import type { LinearLink } from "@factory/contracts";
import { sendAction } from "./api";
import { errorText } from "./domain";
import { useConnections } from "./ConnectionsPage";

export default function LinearPanel({ workOrderId, link, onRefresh }: { workOrderId: string; link?: LinearLink | null; onRefresh: () => void }) {
  const { status, error: connectionError, refresh } = useConnections();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function sync() {
    setPending(true); setError(null);
    try { await sendAction("linear.sync", { workOrderId }); }
    catch (error) { setError(errorText(error)); }
    finally { setPending(false); onRefresh(); }
  }
  return <section className="paper-card"><div className="card-heading"><p className="eyebrow">Connected tracking</p><h2>Linear</h2></div>
    {link?.state === "synced" && link.url ? <><a className="button button--quiet" href={link.url} target="_blank" rel="noreferrer">Open {link.identifier} ↗</a><p className="muted-copy">Issue created in Linear. Execution and review continue here.</p></> : <>
      <p className="muted-copy" role="status">{pending || link?.state === "syncing" ? "Checking Linear and syncing this work order…" : link ? "This work order is saved. Linear sync needs attention." : !status ? "Checking connection…" : status.linear.configured ? "This work order has no Linear issue yet." : "Not connected. This work order is saved in MyFactory only."}</p>
      {link?.error && <p className="muted-copy">{link.error}</p>}
      {status?.linear.configured && <><p className="muted-copy">Send the title, description, acceptance criteria, type, and ID to team <code>{link?.teamId ?? status.linear.teamId}</code>.</p><button className="button button--quiet" disabled={pending || link?.state === "syncing"} onClick={() => void sync()}>{pending ? "Syncing…" : link ? "Retry Linear sync" : "Create Linear issue"}</button></>}
    </>}
    {(error || connectionError) && <p className="form-error" role="alert">{error || connectionError}</p>}
    {connectionError && <button className="button button--quiet" onClick={refresh}>Retry connection</button>}
  </section>;
}
