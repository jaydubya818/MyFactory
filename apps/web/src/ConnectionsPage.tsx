import { useEffect, useState } from "react";
import type { ConnectionStatus } from "@factory/contracts";
import { getConnections } from "./api";
import { errorText } from "./domain";

export function useConnections() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    getConnections().then((next) => { if (active) { setStatus(next); setError(null); } })
      .catch((error) => { if (active) setError(errorText(error)); });
    return () => { active = false; };
  }, [revision]);
  return { status, error, refresh: () => setRevision((value) => value + 1) };
}

export default function ConnectionsPage() {
  const { status, error, refresh } = useConnections();
  return <main className="main-panel" id="main-content">
    <div className="page-topline"><div><p className="eyebrow">Workspace</p><h1>Connections</h1><p className="page-lede">Choose how work enters the factory and where it is tracked.</p></div><button className="button button--quiet" onClick={refresh}>Refresh connections</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!status && !error && <p role="status">Loading connections…</p>}
    {status && <div className="connection-cards">
      <section className="paper-card"><div className="card-heading"><p className="eyebrow">Issue tracking</p><h2>Linear</h2></div>
        <p className="muted-copy">{status.linear.configured ? "Configured on this factory host. The first sync verifies access to Linear." : "Not connected. New WorkOrders are saved in MyFactory only."}</p>
        <dl className="stacked-values"><div><dt>New WorkOrders</dt><dd>{status.linear.configured ? status.linear.mode === "automatic" ? "Create a Linear issue by default; you can opt out on each WorkOrder." : "Choose “Create a Linear issue” on each WorkOrder." : "Local only until a connection is configured."}</dd></div>
          {status.linear.teamId && <div><dt>Team</dt><dd><code>{status.linear.teamId}</code></dd></div>}
          {status.linear.projectId && <div><dt>Project</dt><dd><code>{status.linear.projectId}</code></dd></div>}
          <div><dt>Shared with Linear</dt><dd>Title, description, acceptance criteria, type, and WorkOrder ID.</dd></div>
          <div><dt>Tracking</dt><dd>MyFactory shows the issue link and sync outcome. Execution and publication decisions remain in MyFactory.</dd></div></dl>
        <details className="payload-details"><summary>Host setup</summary><p>Set FACTORY_LINEAR_API_KEY and FACTORY_LINEAR_TEAM_ID in the supervisor environment, then restart it. FACTORY_LINEAR_PROJECT_ID is optional. Set FACTORY_LINEAR_MODE to manual or automatic.</p><p>Keep the API key on the host. It is never sent to this browser or connected apps.</p></details>
      </section>
      <section className="paper-card"><div className="card-heading"><p className="eyebrow">Approved apps</p><h2>MyEve, Relay, and sibling apps</h2></div>
        <p className="muted-copy">App backends can create work, read evidence records, and add notes through the factory’s shared actions. Each connection is limited to its configured repositories and actions.</p>
        {status.clients.length ? status.clients.map((client) => <div className="connection-client" key={client.id}><h3>{client.name}</h3><p>{client.actions.join(" · ")}</p><ul>{client.repositoryPaths.map((path) => <li key={path}><code>{path}</code></li>)}</ul></div>) : <p className="muted-copy">No apps have been authorized on this host.</p>}
        <details className="payload-details"><summary>Connect an app</summary><p>Register a backend with the host’s scripts/register-client.mjs command. Give it a dedicated token file, repository scope, and allowed actions. Removing its registration revokes access immediately.</p><p>The connection API is local to this machine. A cloud app needs a separately configured transport to this host.</p></details>
      </section>
    </div>}
  </main>;
}
