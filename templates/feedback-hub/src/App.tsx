import { useEffect, useMemo, useState, type FormEvent } from "react";
import appConfig from "../app.json";
import { sendAction } from "./api.ts";
import {
  feedbackPriorities, feedbackSources, feedbackStatuses,
  type AgentContext, type Feedback, type FeedbackDetail, type FeedbackPriority,
  type FeedbackSource, type FeedbackStatus,
} from "./shared/actions.ts";

const statusLabel: Record<FeedbackStatus, string> = {
  new: "New", reviewing: "Reviewing", planned: "Planned", closed: "Closed",
};
const priorityLabel: Record<FeedbackPriority, string> = {
  unset: "Not set", low: "Low", medium: "Medium", high: "High",
};
const sourceLabel: Record<FeedbackSource, string> = {
  manual: "Manual", support: "Support", interview: "Interview", in_app: "In-app",
};

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function relativeCount(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function FeedbackForm({
  mode, current, busy, error, onClose, onSave,
}: {
  mode: "create" | "edit";
  current?: FeedbackDetail;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: { title: string; description: string; source: FeedbackSource; customer: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(current?.title ?? "");
  const [description, setDescription] = useState(current?.description ?? "");
  const [source, setSource] = useState<FeedbackSource>(current?.source ?? "manual");
  const [customer, setCustomer] = useState(current?.customer ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave({ title, description, source, customer });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="feedback-form-title">
        <div className="modal__top">
          <div><p className="eyebrow">{mode === "create" ? "Capture a signal" : "Refine the record"}</p><h2 id="feedback-form-title">{mode === "create" ? "New feedback" : "Edit feedback"}</h2></div>
          <button className="icon-button" type="button" aria-label="Close form" onClick={onClose} disabled={busy}>×</button>
        </div>
        <form onSubmit={submit}>
          <label className="field">Title <input autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What did you hear?" /></label>
          <label className="field">Details <textarea required rows={6} maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Include the user's words, context, and what happened." /></label>
          <div className="field-grid">
            <label className="field">Source <select value={source} onChange={(event) => setSource(event.target.value as FeedbackSource)}>{feedbackSources.map((item) => <option key={item} value={item}>{sourceLabel[item]}</option>)}</select></label>
            <label className="field">Person or team <input maxLength={100} value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Optional" /></label>
          </div>
          <p className="form-hint">Capture what is known. Priority and next steps can be decided during review.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="modal__actions"><button type="button" className="button button--quiet" onClick={onClose} disabled={busy}>Cancel</button><button className="button button--primary" type="submit" disabled={busy}>{busy ? "Saving…" : mode === "create" ? "Save feedback" : "Save changes"}</button></div>
        </form>
      </section>
    </div>
  );
}

function EmptyInbox({ onCreate }: { onCreate: () => void }) {
  return <div className="empty-inbox"><div className="empty-inbox__symbol" aria-hidden="true"><span>✳</span></div><p className="eyebrow">A clear starting point</p><h2>Nothing in the inbox yet.</h2><p>Capture a customer observation or a product idea. Every item gets a place to review evidence, make a decision, and record why.</p><button className="button button--primary" onClick={onCreate}>+ Add feedback</button></div>;
}

function Detail({
  detail, context, busy, onEdit, onUpdate, onAddNote, onCopyBrief,
}: {
  detail: FeedbackDetail;
  context: AgentContext | null;
  busy: boolean;
  onEdit: () => void;
  onUpdate: (changes: { status?: FeedbackStatus; priority?: FeedbackPriority }) => Promise<void>;
  onAddNote: (body: string) => Promise<boolean>;
  onCopyBrief: () => Promise<void>;
}) {
  const [note, setNote] = useState("");

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onAddNote(note)) setNote("");
  }

  return <article className="detail">
    <div className="detail__head">
      <span className={`status-pill status-pill--${detail.status}`}>{statusLabel[detail.status]}</span>
      <button className="text-button" type="button" onClick={onEdit} disabled={busy}>Edit details ↗</button>
    </div>
    <h2>{detail.title}</h2>
    <p className="detail__date">Captured {dateLabel(detail.createdAt)} · {sourceLabel[detail.source]}</p>
    <div className="detail__description">{detail.description}</div>
    {detail.customer && <p className="detail__customer"><span>From</span> {detail.customer}</p>}

    <section className="decision-box" aria-labelledby="decision-heading">
      <div><p className="eyebrow">Decision</p><h3 id="decision-heading">Triage</h3></div>
      <div className="field-grid">
        <label className="field">Status <select aria-label="Feedback status" value={detail.status} disabled={busy} onChange={(event) => void onUpdate({ status: event.target.value as FeedbackStatus })}>{feedbackStatuses.map((status) => <option value={status} key={status}>{statusLabel[status]}</option>)}</select></label>
        <label className="field">Priority <select aria-label="Feedback priority" value={detail.priority} disabled={busy} onChange={(event) => void onUpdate({ priority: event.target.value as FeedbackPriority })}>{feedbackPriorities.map((priority) => <option value={priority} key={priority}>{priorityLabel[priority]}</option>)}</select></label>
      </div>
      <p>Use an internal note to explain a consequential decision.</p>
    </section>

    <section className="detail-section" aria-labelledby="notes-heading">
      <div className="section-heading"><h3 id="notes-heading">Internal notes</h3><span>{detail.notes.length}</span></div>
      <form className="note-form" onSubmit={submitNote}><label className="sr-only" htmlFor="new-note">Add an internal note</label><textarea id="new-note" rows={3} maxLength={2000} required value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add evidence, context, or the reason for a decision…" /><button className="button button--dark" disabled={busy || !note.trim()} type="submit">{busy ? "Saving…" : "Add note"}</button></form>
      {detail.notes.length === 0 ? <p className="subtle-message">No notes yet. Add the first decision or finding.</p> : <div className="notes-list">{detail.notes.map((item) => <div className="note" key={item.id}><div className="note__meta"><strong>{item.actor === "agent" ? "Agent" : "You"}</strong><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></div><p>{item.body}</p></div>)}</div>}
    </section>

    <section className="agent-box" aria-labelledby="agent-heading">
      <div className="agent-box__head"><div><p className="eyebrow">Contextual handoff</p><h3 id="agent-heading">Agent brief</h3></div><span className="agent-box__mark" aria-hidden="true">✳</span></div>
      <p>This brief uses the current record and notes. Copy it for an agent, or use the local agent CLI. No agent runs automatically.</p>
      <button className="button button--outline" type="button" onClick={() => void onCopyBrief()} disabled={!context}>Copy current brief ↗</button>
    </section>

    <section className="detail-section activity-section" aria-labelledby="activity-heading"><div className="section-heading"><h3 id="activity-heading">Activity</h3><span>{detail.events.length}</span></div><ol className="activity-list">{detail.events.map((event) => <li key={event.id}><span className="activity-list__dot" /><div><p>{event.summary}</p><small>{event.actor === "agent" ? "Agent" : "You"} · {dateLabel(event.createdAt)}</small></div></li>)}</ol></section>
  </article>;
}

export default function App() {
  const [allItems, setAllItems] = useState<Feedback[]>([]);
  const [visibleItems, setVisibleItems] = useState<Feedback[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [context, setContext] = useState<AgentContext | null>(null);
  const [status, setStatus] = useState<FeedbackStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [view, setView] = useState<"inbox" | "guide">("inbox");

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadingList(true);
      try {
        const [all, visible] = await Promise.all([
          sendAction("list_feedback", {}, controller.signal),
          sendAction("list_feedback", { search, status }, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setAllItems(all);
        setVisibleItems(visible);
        setSelectedId((id) => visible.some((item) => item.id === id) ? id : (visible[0]?.id ?? null));
        setError(null);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The inbox could not load.");
      } finally {
        if (!controller.signal.aborted) setLoadingList(false);
      }
    }, search ? 180 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, status, revision]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); setContext(null); return; }
    const controller = new AbortController();
    setLoadingDetail(true);
    Promise.all([
      sendAction("get_feedback", { id: selectedId }, controller.signal),
      sendAction("get_agent_context", { id: selectedId }, controller.signal),
    ]).then(([nextDetail, nextContext]) => {
      if (!controller.signal.aborted) { setDetail(nextDetail); setContext(nextContext); setError(null); }
    }).catch((caught) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Feedback could not load.");
    }).finally(() => { if (!controller.signal.aborted) setLoadingDetail(false); });
    return () => controller.abort();
  }, [selectedId, revision]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setRevision((value) => value + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const counts = useMemo(() => ({
    total: allItems.length,
    new: allItems.filter((item) => item.status === "new").length,
    reviewing: allItems.filter((item) => item.status === "reviewing").length,
    planned: allItems.filter((item) => item.status === "planned").length,
  }), [allItems]);

  async function createOrEdit(draft: { title: string; description: string; source: FeedbackSource; customer: string }) {
    setBusy(true); setError(null);
    try {
      if (formMode === "edit" && detail) {
        const updated = await sendAction("update_feedback", { id: detail.id, expectedVersion: detail.version, changes: draft });
        setDetail(updated); setNotice("Feedback details saved.");
      } else {
        const created = await sendAction("create_feedback", draft);
        setSelectedId(created.id); setNotice("Feedback captured.");
        setStatus("all"); setSearch(""); setView("inbox");
      }
      setFormMode(null); setRevision((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Feedback could not be saved."); setRevision((value) => value + 1); }
    finally { setBusy(false); }
  }

  async function update(changes: { status?: FeedbackStatus; priority?: FeedbackPriority }) {
    if (!detail) return;
    setBusy(true); setError(null);
    try {
      const updated = await sendAction("update_feedback", { id: detail.id, expectedVersion: detail.version, changes });
      setDetail(updated); setNotice("Decision saved."); setRevision((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Decision could not be saved."); setRevision((value) => value + 1); }
    finally { setBusy(false); }
  }

  async function addNote(body: string): Promise<boolean> {
    if (!detail) return false;
    setBusy(true); setError(null);
    try {
      const updated = await sendAction("add_note", { id: detail.id, body });
      setDetail(updated); setNotice("Internal note added."); setRevision((value) => value + 1);
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Note could not be saved."); return false; }
    finally { setBusy(false); }
  }

  async function copyBrief() {
    if (!selectedId) return;
    try {
      const fresh = await sendAction("get_agent_context", { id: selectedId });
      await navigator.clipboard.writeText(fresh.brief);
      setContext(fresh);
      setNotice("Current agent brief copied.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The current brief could not be copied.");
    }
  }

  const selected = detail?.id === selectedId ? detail : null;

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <div className="brand"><div className="brand__mark" aria-hidden="true">f<span>·</span></div><div><strong>{appConfig.name}</strong><span>Product signals, in one place</span></div></div>
      <p className="sidebar__label">Workspace</p>
      <nav aria-label="Main navigation"><button className={`nav-item ${view === "inbox" ? "nav-item--active" : ""}`} type="button" onClick={() => setView("inbox")}><span className="nav-item__glyph" aria-hidden="true">▤</span> Inbox <em>{counts.total}</em></button><button className={`nav-item ${view === "guide" ? "nav-item--active" : ""}`} type="button" onClick={() => setView("guide")}><span className="nav-item__glyph" aria-hidden="true">✳</span> Agent guide</button></nav>
      <div className="sidebar__bottom"><span className="local-dot" /> Local workspace<br /><small>Records stay in this app's SQLite file.</small></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><span>{view === "inbox" ? "Workspace / Feedback inbox" : "Workspace / Agent guide"}</span><span className="topbar__right"><span className="topbar__avatar" aria-hidden="true">FH</span> Local</span></header>
      <main id="main-content" className="main">
        {notice && <div className="toast" role="status"><span>✓</span>{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
        {error && <div className="error-banner" role="alert"><div><strong>Something needs attention</strong><p>{error}</p></div><button className="button button--quiet" type="button" onClick={() => { setError(null); setRevision((value) => value + 1); }}>Retry</button></div>}
        {view === "guide" ? <section className="guide"><p className="eyebrow">Working with an agent</p><h1>Context first. Decisions visible.</h1><p className="guide__intro">The agent CLI reads and writes the same feedback records as this interface. Give an agent the current item brief, then review its changes here. Nothing is submitted to a model by opening this page.</p><div className="guide__grid"><div><span className="guide__number">01</span><h2>Read the record</h2><p>Use <code>get_agent_context</code> for the selected item. It includes the description, current state, and notes.</p></div><div><span className="guide__number">02</span><h2>Make a bounded change</h2><p>Use <code>update_feedback</code> to triage or <code>add_note</code> to preserve the reasoning. Updates require the current version.</p></div><div><span className="guide__number">03</span><h2>Check the result</h2><p>Refresh the inbox to inspect the record and activity. A status change does not mean implementation happened automatically.</p></div></div><div className="guide__command"><span>From this app directory</span><code>{"npm run agent -- list_feedback '{\"status\":\"new\"}'"}</code></div><button className="button button--primary" onClick={() => setView("inbox")}>Return to inbox →</button></section> : <>
          <section className="page-heading"><div><p className="eyebrow">Product intelligence / Inbox</p><h1>Feedback worth acting on.</h1><p>{appConfig.description}</p></div><button className="button button--primary" type="button" onClick={() => setFormMode("create")}>+ Capture feedback</button></section>
          <section className="metrics" aria-label="Feedback summary"><div><span>All feedback</span><strong>{counts.total}</strong><small>Every captured signal</small></div><div><span>New</span><strong>{counts.new}</strong><small>Ready for review</small></div><div><span>Reviewing</span><strong>{counts.reviewing}</strong><small>Gathering context</small></div><div><span>Planned</span><strong>{counts.planned}</strong><small>Decision recorded</small></div></section>
          <div className="content-grid">
            <section className="inbox" aria-label="Feedback inbox"><div className="inbox__top"><div><p className="eyebrow">Inbox</p><h2>Signals</h2></div><div className="inbox__top-actions"><span>{relativeCount(visibleItems.length, "item")}</span><button className="text-button" type="button" onClick={() => setRevision((value) => value + 1)} disabled={loadingList}>Refresh ↻</button></div></div><div className="inbox__controls"><label className="search"><span aria-hidden="true">⌕</span><span className="sr-only">Search feedback</span><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Search feedback" /></label><label className="filter"><span className="sr-only">Filter status</span><select value={status} onChange={(event) => setStatus(event.target.value as FeedbackStatus | "all")}><option value="all">All statuses</option>{feedbackStatuses.map((item) => <option value={item} key={item}>{statusLabel[item]}</option>)}</select></label></div>
              {loadingList && allItems.length === 0 ? <div className="list-state" role="status">Loading feedback…</div> : error && allItems.length === 0 ? <div className="list-state"><strong>Inbox unavailable</strong><p>Refresh to try again.</p><button className="text-button" onClick={() => setRevision((value) => value + 1)}>Refresh inbox</button></div> : visibleItems.length === 0 ? allItems.length === 0 && !search && status === "all" ? <EmptyInbox onCreate={() => setFormMode("create")} /> : <div className="list-state"><strong>No matching feedback</strong><p>Try a different search or status.</p><button className="text-button" onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</button></div> : <div className="feedback-list">{visibleItems.map((item) => <button type="button" key={item.id} className={`feedback-row ${selectedId === item.id ? "feedback-row--selected" : ""}`} onClick={() => setSelectedId(item.id)} aria-current={selectedId === item.id ? "true" : undefined}><div className="feedback-row__top"><span className={`status-pill status-pill--${item.status}`}>{statusLabel[item.status]}</span><time dateTime={item.updatedAt}>{dateLabel(item.updatedAt)}</time></div><h3>{item.title}</h3><p>{item.description}</p><div className="feedback-row__foot"><span>{sourceLabel[item.source]}{item.customer ? ` · ${item.customer}` : ""}</span><span>{item.priority === "unset" ? "Priority unset" : `${priorityLabel[item.priority]} priority`}</span></div></button>)}</div>}
            </section>
            <section className="detail-shell" aria-label="Feedback detail">{loadingDetail && !selected ? <div className="detail-state" role="status">Loading feedback…</div> : selected ? <Detail key={selected.id} detail={selected} context={context?.feedback.id === selected.id ? context : null} busy={busy} onEdit={() => setFormMode("edit")} onUpdate={update} onAddNote={addNote} onCopyBrief={copyBrief} /> : <div className="detail-state"><span aria-hidden="true">↖</span><h2>Select a signal</h2><p>Choose feedback from the inbox to review its details and next step.</p></div>}</section>
          </div>
        </>}
      </main>
    </div>
    {formMode && <FeedbackForm key={`${formMode}-${detail?.id ?? "new"}`} mode={formMode} current={formMode === "edit" ? detail ?? undefined : undefined} busy={busy} error={error} onClose={() => { setFormMode(null); setError(null); }} onSave={createOrEdit} />}
  </div>;
}
