import { useEffect, useMemo, useState } from "react";
import type { CreateWorkOrderInput, WorkOrder, WorkOrderDetail as Detail } from "@factory/contracts";
import { getWorkOrderDetail, getWorkOrders, sendAction, type BuilderCreateInput, type BuilderCreateResult } from "./api";
import { EmptyMessage, Icon, StatusPill } from "./components";
import CreateWorkOrderForm from "./CreateWorkOrderForm";
import AppBuilderPage from "./AppBuilderPage";
import ConnectionsPage from "./ConnectionsPage";
import OverviewPage from "./OverviewPage";
import WorkOrderDetail from "./WorkOrderDetail";
import { attentionStates, errorText, formatDate, runningStates, shortId } from "./domain";

type QueueFilter = "all" | "running" | "attention";
type PendingAction = "create" | "builder" | "start" | "cancel" | null;

function urlSelection() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("workOrder");
  if (id) return { id, creating: false, showingQueue: false, showingBuilder: false, showingConnections: false };
  if (params.has("new")) return { id: null, creating: true, showingQueue: false, showingBuilder: false, showingConnections: false };
  return { id: null, creating: false, showingQueue: params.get("view") === "queue", showingBuilder: params.get("view") === "builder", showingConnections: params.get("view") === "connections" };
}

function navigate(id: string | null, creating = false, showingQueue = false, showingBuilder = false, showingConnections = false) {
  const url = new URL(window.location.href);
  url.searchParams.delete("workOrder");
  url.searchParams.delete("new");
  url.searchParams.delete("view");
  if (creating) url.searchParams.set("new", "1");
  else if (id) url.searchParams.set("workOrder", id);
  else if (showingQueue) url.searchParams.set("view", "queue");
  else if (showingBuilder) url.searchParams.set("view", "builder");
  else if (showingConnections) url.searchParams.set("view", "connections");
  window.history.pushState(null, "", url);
}

function createdWorkOrderId(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  if (typeof record.workOrderId === "string") return record.workOrderId;
  if (record.workOrder && typeof record.workOrder === "object") {
    const workOrder = record.workOrder as Record<string, unknown>;
    if (typeof workOrder.id === "string") return workOrder.id;
  }
  return null;
}

function QueuePage({
  queue,
  loading,
  error,
  onRetry,
  onCreate,
  onSelect,
}: {
  queue: WorkOrder[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [search, setSearch] = useState("");
  const sorted = useMemo(() => [...queue].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [queue]);
  const running = sorted.filter((order) => runningStates.has(order.state));
  const attention = sorted.filter((order) => attentionStates.has(order.state));
  const queued = sorted.filter((order) => order.state === "queued");
  const ready = sorted.filter((order) => order.state === "ready_for_review");
  const visible = sorted.filter((order) => {
    if (filter === "running" && !runningStates.has(order.state)) return false;
    if (filter === "attention" && !attentionStates.has(order.state)) return false;
    const term = search.trim().toLocaleLowerCase();
    return !term || `${order.title} ${order.id} ${order.repositoryPath}`.toLocaleLowerCase().includes(term);
  });

  return (
    <main className="main-panel queue-page" id="main-content">
      <div className="page-topline queue-page__heading">
        <div><p className="eyebrow">Overview</p><h1>Work queue</h1><p className="page-lede">Every work order has a visible state and next step.</p></div>
        <div className="heading-actions"><button className="button button--quiet" type="button" onClick={onRetry}><Icon name="refresh" size={16} /> Refresh</button><button className="button button--primary" type="button" onClick={onCreate}><Icon name="plus" size={18} /> New WorkOrder</button></div>
      </div>
      <div className="queue-metrics" aria-label="Queue summary"><div><strong>{error && queue.length === 0 ? "—" : running.length}</strong><span>in progress</span></div><div><strong>{error && queue.length === 0 ? "—" : attention.length}</strong><span>need you</span></div><div><strong>{error && queue.length === 0 ? "—" : queued.length}</strong><span>queued</span></div><div className="queue-metrics__note"><span className={`connection-dot ${error ? "connection-dot--error" : ""}`} /> {error ? "Service needs attention" : "Local supervisor"}</div></div>
      {error && <div className="inline-error queue-page__error" role="alert"><div><strong>Queue could not refresh</strong><p>{error}</p></div><button className="button button--quiet" type="button" onClick={onRetry}>Retry</button></div>}
      <section className="queue-table-card" aria-label="Work orders">
        <div className="queue-table-card__toolbar"><div className="filter-row" aria-label="Filter work orders"><button className={filter === "all" ? "filter-button filter-button--active" : "filter-button"} type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All work</button><button className={filter === "running" ? "filter-button filter-button--active" : "filter-button"} type="button" aria-pressed={filter === "running"} onClick={() => setFilter("running")}>Active</button><button className={filter === "attention" ? "filter-button filter-button--active" : "filter-button"} type="button" aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>Needs you</button></div><div className="queue-table-card__tools"><label className="search-label" htmlFor="queue-search">Search work orders</label><input id="queue-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search work orders" /><span>{visible.length} {visible.length === 1 ? "WorkOrder" : "WorkOrders"}</span></div></div>
        {loading && queue.length === 0 ? <div className="loading-block" role="status"><span className="loading-bar" /><span className="loading-bar" /><span className="loading-bar" /><p>Loading saved work…</p></div> : error && queue.length === 0 ? <EmptyMessage eyebrow="Work queue" title="Queue unavailable" description="The local service could not load saved work. Retry when the service is running." /> : visible.length === 0 ? <EmptyMessage eyebrow={queue.length === 0 ? "Work queue" : "Filtered view"} title={queue.length === 0 ? "No work orders yet" : "No matching work orders"} description={queue.length === 0 ? "Create a narrowly scoped work order to begin. It will appear here as soon as the local service saves it." : "Change the search or filter to see other work orders."} action={queue.length === 0 ? <button className="button button--primary" type="button" onClick={onCreate}>Create work order <Icon name="arrow" size={17} /></button> : undefined} /> : <div className="queue-table-scroll"><table className="queue-table"><thead><tr><th scope="col">WorkOrder</th><th scope="col">Repository</th><th scope="col">State</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead><tbody>{visible.map((order) => <tr key={order.id}><td><button className="table-link" type="button" onClick={() => onSelect(order.id)}><strong>{order.title}</strong><span>{shortId(order.id)} · {order.kind}</span></button></td><td className="queue-table__repo" title={order.repositoryPath}>{order.repositoryPath.split("/").filter(Boolean).at(-1) || order.repositoryPath}</td><td><StatusPill state={order.state} /></td><td className="queue-table__time"><time dateTime={order.updatedAt}>{formatDate(order.updatedAt)}</time></td><td><button className="table-open" type="button" aria-label={`Open ${order.title}`} onClick={() => onSelect(order.id)}><Icon name="chevron" size={17} /></button></td></tr>)}</tbody></table></div>}
      </section>
      <div className="queue-bottom-cards"><section className="summary-card"><div className="summary-card__heading"><h2>On the worker</h2><span>{running.length} active</span></div>{running.length ? <><button className="summary-card__link" type="button" onClick={() => onSelect(running[0].id)}><strong>{running[0].title}</strong><StatusPill state={running[0].state} /></button><p>{running.length === 1 ? "One attempt is currently in progress." : `${running.length} work orders are currently in progress.`}</p></> : <div className="summary-card__empty"><strong>No active run</strong><p>Started attempts will appear here while the supervisor works.</p></div>}</section><section className="summary-card"><div className="summary-card__heading"><h2>{attention.length ? "Needs your input" : "Review readiness"}</h2><span>{attention.length ? `${attention.length} waiting` : `${ready.length} ready`}</span></div>{attention.length ? <><button className="summary-card__link" type="button" onClick={() => onSelect(attention[0].id)}><strong>{attention[0].title}</strong><StatusPill state={attention[0].state} /></button><p>Open the work order to see the blocker and recorded decisions.</p></> : ready.length ? <><button className="summary-card__link" type="button" onClick={() => onSelect(ready[0].id)}><strong>{ready[0].title}</strong><StatusPill state={ready[0].state} /></button><p>Review its candidate and verification evidence.</p></> : <div className="summary-card__empty"><strong>Nothing waiting for review</strong><p>Work that needs a decision or review will appear here.</p></div>}</section></div>
    </main>
  );
}

export default function App() {
  const initial = urlSelection();
  const [selectedId, setSelectedId] = useState<string | null>(initial.id);
  const [creating, setCreating] = useState(initial.creating);
  const [showingQueue, setShowingQueue] = useState(initial.showingQueue);
  const [showingBuilder, setShowingBuilder] = useState(initial.showingBuilder);
  const [showingConnections, setShowingConnections] = useState(initial.showingConnections);
  const [queue, setQueue] = useState<WorkOrder[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      const next = urlSelection();
      setSelectedId(next.id);
      setCreating(next.creating);
      setShowingQueue(next.showingQueue);
      setShowingBuilder(next.showingBuilder);
      setShowingConnections(next.showingConnections);
      setActionError(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadQueue() {
      try {
        const next = await getWorkOrders();
        if (!active) return;
        setQueue(next);
        setQueueError(null);
      } catch (error) {
        if (active) setQueueError(errorText(error));
      } finally {
        if (active) setQueueLoading(false);
      }
    }
    void loadQueue();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadQueue();
    }, 7000);
    const onFocus = () => void loadQueue();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [revision]);

  useEffect(() => {
    if (!selectedId || creating) {
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }
    let active = true;
    setDetail((current) => current?.workOrder.id === selectedId ? current : null);
    setDetailLoading(true);
    async function loadDetail() {
      try {
        const next = await getWorkOrderDetail(selectedId!);
        if (!active) return;
        setDetail(next);
        setDetailError(null);
      } catch (error) {
        if (active) setDetailError(errorText(error));
      } finally {
        if (active) setDetailLoading(false);
      }
    }
    void loadDetail();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadDetail();
    }, 7000);
    const onFocus = () => void loadDetail();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [selectedId, creating, revision]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function showQueue() {
    setSelectedId(null);
    setCreating(false);
    setShowingQueue(true);
    setShowingBuilder(false);
    setShowingConnections(false);
    setActionError(null);
    navigate(null, false, true);
  }

  function showOverview() {
    setSelectedId(null);
    setCreating(false);
    setShowingQueue(false);
    setShowingBuilder(false);
    setShowingConnections(false);
    setActionError(null);
    navigate(null);
  }

  function selectWorkOrder(id: string) {
    setSelectedId(id);
    setCreating(false);
    setShowingQueue(false);
    setShowingBuilder(false);
    setShowingConnections(false);
    setActionError(null);
    navigate(id);
  }

  function openCreate() {
    setSelectedId(null);
    setCreating(true);
    setShowingQueue(false);
    setShowingBuilder(false);
    setShowingConnections(false);
    setActionError(null);
    navigate(null, true);
  }

  function openBuilder() {
    setSelectedId(null);
    setCreating(false);
    setShowingQueue(false);
    setShowingBuilder(true);
    setShowingConnections(false);
    setActionError(null);
    navigate(null, false, false, true);
  }

  function openConnections() {
    setSelectedId(null);
    setCreating(false);
    setShowingQueue(false);
    setShowingBuilder(false);
    setShowingConnections(true);
    setActionError(null);
    navigate(null, false, false, false, true);
  }

  async function createWorkOrder(input: CreateWorkOrderInput) {
    setPendingAction("create");
    setActionError(null);
    try {
      const result = await sendAction("workorder.create", input);
      const id = createdWorkOrderId(result);
      setNotice(id ? "Work order created. It is now in the queue." : "Work order created. The queue is refreshing.");
      setCreating(false);
      setShowingBuilder(false);
      setShowingConnections(false);
      if (id) {
        setSelectedId(id);
        setShowingQueue(false);
        navigate(id);
      } else {
        setShowingQueue(true);
        navigate(null, false, true);
      }
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function createAppScaffold(input: BuilderCreateInput) {
    setPendingAction("builder");
    setActionError(null);
    try {
      const result = await sendAction<BuilderCreateResult>("builder.create", input);
      const id = createdWorkOrderId(result?.workOrder);
      setNotice("App scaffold prepared. Open its WorkOrder to start a local preview when ready.");
      setShowingBuilder(false);
      setShowingConnections(false);
      if (id) {
        setSelectedId(id);
        navigate(id);
      } else {
        setShowingQueue(true);
        navigate(null, false, true);
      }
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function runAction(action: "run.start" | "run.cancel") {
    if (!selectedId) return;
    const kind = action === "run.start" ? "start" : "cancel";
    setPendingAction(kind);
    setActionError(null);
    try {
      await sendAction(action, { workOrderId: selectedId });
      setNotice(kind === "start" ? "Attempt started. The work order is refreshing." : "Cancellation requested. The work order is refreshing.");
      setRevision((value) => value + 1);
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setPendingAction(null);
    }
  }

  const displayedDetail = detail?.workOrder.id === selectedId ? detail : null;
  const pageName = showingConnections ? "Connections" : creating ? "New WorkOrder" : selectedId ? "Work order" : showingBuilder ? "App builder" : showingQueue ? "Work queue" : "Overview";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="side-nav" aria-label="Workspace navigation">
        <div className="brand"><div className="brand__mark" aria-hidden="true"><span /><span /><span /></div><div><strong>Local<br />Factory</strong><span>Work desk</span></div></div>
        <p className="side-nav__label">Workspace</p>
        <nav><button className={!selectedId && !creating && !showingQueue && !showingBuilder && !showingConnections ? "side-nav__item side-nav__item--active" : "side-nav__item"} type="button" aria-label="Overview" aria-current={!selectedId && !creating && !showingQueue && !showingBuilder && !showingConnections ? "page" : undefined} onClick={showOverview}><Icon name="overview" size={17} /><span>Overview</span></button><button className={showingBuilder ? "side-nav__item side-nav__item--active" : "side-nav__item"} type="button" aria-label="App builder" aria-current={showingBuilder ? "page" : undefined} onClick={openBuilder}><Icon name="builder" size={17} /><span>App builder</span></button><button className={showingQueue && !selectedId && !creating ? "side-nav__item side-nav__item--active" : "side-nav__item"} type="button" aria-label="Work queue" aria-current={showingQueue && !selectedId && !creating ? "page" : undefined} onClick={showQueue}><Icon name="inbox" size={17} /><span>Work queue</span><em>{queue.length}</em></button><button className={creating ? "side-nav__item side-nav__item--active" : "side-nav__item"} type="button" aria-label="New work" aria-current={creating ? "page" : undefined} onClick={openCreate}><Icon name="plus" size={17} /><span>New work</span></button><button className={showingConnections ? "side-nav__item side-nav__item--active" : "side-nav__item"} type="button" aria-current={showingConnections ? "page" : undefined} onClick={openConnections}><Icon name="builder" size={17} /><span>Connections</span></button></nav>
        <div className="side-nav__footer"><p><span className={`connection-dot ${queueError ? "connection-dot--error" : ""}`} /> {queueError ? "Service needs attention" : queueLoading ? "Connecting…" : "Local service"}</p><span>Supervised execution</span></div>
      </aside>
      <div className="workspace">
        <header className="topbar"><div className="breadcrumb"><button type="button" onClick={showOverview}>Local Factory</button><span>/</span><span>{pageName}</span></div><div className="topbar__right"><span>Local workspace</span><span className="topbar__monogram" aria-hidden="true">LF</span></div></header>
        {showingConnections ? <ConnectionsPage /> : creating ? <CreateWorkOrderForm onSubmit={createWorkOrder} onCancel={showQueue} pending={pendingAction === "create"} serverError={actionError} /> : showingBuilder ? <AppBuilderPage onCreate={createAppScaffold} pending={pendingAction === "builder"} serverError={actionError} /> : !selectedId && showingQueue ? <QueuePage queue={queue} loading={queueLoading} error={queueError} onRetry={() => setRevision((value) => value + 1)} onCreate={openCreate} onSelect={selectWorkOrder} /> : !selectedId ? <OverviewPage queue={queue} loading={queueLoading} error={queueError} onRetry={() => setRevision((value) => value + 1)} onCreate={openCreate} onQueue={showQueue} onSelect={selectWorkOrder} onBuilder={openBuilder} /> : detailError && !displayedDetail ? <main className="main-panel main-panel--empty" id="main-content"><EmptyMessage eyebrow="Work order unavailable" title="Details could not be loaded" description={detailError} action={<button className="button button--primary" type="button" onClick={() => setRevision((value) => value + 1)}>Retry <Icon name="refresh" size={16} /></button>} /></main> : displayedDetail ? <><WorkOrderDetail key={displayedDetail.workOrder.id} detail={displayedDetail} onStart={() => void runAction("run.start")} onCancel={() => setConfirmCancel(true)} onRefresh={() => setRevision((value) => value + 1)} actionPending={pendingAction === "start" || pendingAction === "cancel" ? pendingAction : null} actionError={actionError} />{detailError && <div className="stale-banner" role="alert">Unable to refresh this work order: {detailError} <button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}</> : <main className="main-panel main-panel--empty" id="main-content"><div className="loading-block" role="status"><span className="loading-bar" /><span className="loading-bar" /><span className="loading-bar" /><p>{detailLoading ? "Loading work order…" : "Preparing work order…"}</p></div></main>}
      </div>
      {notice && <div className="toast" role="status"><span className="toast__icon"><Icon name="check" size={16} /></span><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><Icon name="close" size={16} /></button></div>}
      {confirmCancel && <div className="dialog-backdrop"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" aria-describedby="cancel-description" onKeyDown={(event) => { if (event.key === "Escape") setConfirmCancel(false); }}><p className="eyebrow">Active attempt</p><h2 id="cancel-title">Cancel this run?</h2><p id="cancel-description">The worker will be asked to stop. Its recorded history remains available for review.</p><div className="confirm-dialog__actions"><button className="button button--quiet" type="button" autoFocus onClick={() => setConfirmCancel(false)}>Keep running</button><button className="button button--danger" type="button" onClick={() => { setConfirmCancel(false); void runAction("run.cancel"); }}>Cancel run</button></div></div></div>}
    </div>
  );
}
