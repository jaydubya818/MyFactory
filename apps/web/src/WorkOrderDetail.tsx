import { useState } from "react";
import type {
  Check,
  CheckStatus,
  ExternalAction,
  FactoryEvent,
  Run,
  WorkOrderDetail as Detail,
} from "@factory/contracts";
import { EmptyMessage, Icon, StatusPill } from "./components";
import { formatDate, shortId, workOrderStates, type Tone } from "./domain";
import LocalPreviewPanel from "./LocalPreviewPanel";
import PublicationReview from "./PublicationReview";
import LinearPanel from "./LinearPanel";

type Tab = "overview" | "activity" | "changes" | "verification" | "decisions";

const tabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "changes", label: "Changes" },
  { id: "verification", label: "Verification" },
  { id: "decisions", label: "Decisions" },
];

const checkTone: Record<CheckStatus, Tone> = {
  passed: "success",
  failed: "attention",
  skipped: "quiet",
  unavailable: "attention",
};

function formatEventType(type: string): string {
  return type.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function RunSummary({ run }: { run: Run }) {
  return (
    <div className="run-summary">
      <div className="run-summary__top"><span className="eyebrow">Attempt {run.attemptNumber}</span><span className={`inline-state inline-state--${run.finishedAt ? "quiet" : "active"}`}>{formatEventType(run.state)}</span></div>
      <dl className="key-values">
        <div><dt>Started</dt><dd>{formatDate(run.startedAt)}</dd></div>
        <div><dt>Input commit</dt><dd><code title={run.inputCommit}>{shortId(run.inputCommit, 12)}</code></dd></div>
        {run.candidateCommit && <div><dt>Candidate</dt><dd><code title={run.candidateCommit}>{shortId(run.candidateCommit, 12)}</code></dd></div>}
        {run.finishedAt && <div><dt>Finished</dt><dd>{formatDate(run.finishedAt)}</dd></div>}
      </dl>
      {run.failure && <p className="run-failure">{run.failure}</p>}
    </div>
  );
}

function EventList({ events }: { events: FactoryEvent[] }) {
  if (events.length === 0) {
    return <EmptyMessage title="No activity recorded" description="Events will appear here as this work order moves through the local service." />;
  }
  return (
    <ol className="timeline">
      {[...events].sort((a, b) => b.id - a.id).map((event) => (
        <li className="timeline__item" key={event.id}>
          <span className="timeline__pin" />
          <div className="timeline__body">
            <div className="timeline__heading"><strong>{formatEventType(event.type)}</strong><time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></div>
            {event.runId && <p className="timeline__sub">Run {shortId(event.runId)}</p>}
            {event.type === "workorder.note_added" && typeof event.payload.text === "string" &&
              <p className="timeline__sub">{event.payload.text}</p>}
            {event.payload && Object.keys(event.payload).length > 0 && (
              <details className="payload-details"><summary>Event details</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Overview({ detail, latestRun, onRefresh }: { detail: Detail; latestRun: Run | undefined; onRefresh: () => void }) {
  const order = detail.workOrder;
  const hasAppScaffold = detail.events.some((event) => event.type === "builder.scaffold_created");
  return (
    <div className="content-grid">
      <div className="content-grid__main">
        {hasAppScaffold && <LocalPreviewPanel workOrderId={order.id} onRefresh={onRefresh} />}
        <section className="paper-card">
          <div className="card-heading"><p className="eyebrow">Definition</p><h2>Acceptance criteria</h2></div>
          {order.acceptanceCriteria.length > 0 ? <ol className="criteria-list">{order.acceptanceCriteria.map((criterion, index) => <li key={`${index}-${criterion}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{criterion}</p></li>)}</ol> : <p className="muted-copy">No acceptance criteria were recorded for this work order.</p>}
        </section>
        <section className="paper-card">
          <div className="card-heading"><p className="eyebrow">Limits</p><h2>Scope and checks</h2></div>
          <dl className="stacked-values">
            <div><dt>Repository</dt><dd><code>{order.repositoryPath}</code></dd></div>
            <div><dt>Base ref</dt><dd><code>{order.baseRef}</code></dd></div>
            <div><dt>Permitted paths</dt><dd>{order.allowedPaths.length ? <div className="path-list">{order.allowedPaths.map((path) => <code key={path}>{path}</code>)}</div> : <span>None recorded</span>}</dd></div>
            <div><dt>Reproduce</dt><dd>{order.reproductionCommand ? <code>{order.reproductionCommand}</code> : <span>Not specified</span>}</dd></div>
            {order.expectedFailureText && <div><dt>Failure text</dt><dd><code>{order.expectedFailureText}</code></dd></div>}
            <div><dt>Checks</dt><dd>{order.checkCommands.length ? <ul className="command-list">{order.checkCommands.map((command, index) => <li key={`${index}-${command}`}><code>{command}</code></li>)}</ul> : <span>None specified</span>}</dd></div>
          </dl>
        </section>
      </div>
      <aside className="content-grid__aside" aria-label="Attempt summary">
        <LinearPanel workOrderId={order.id} link={detail.linearLink} onRefresh={onRefresh} />
        <section className="paper-card paper-card--tinted">
          <div className="card-heading"><p className="eyebrow">Execution</p><h2>Latest attempt</h2></div>
          {latestRun ? <RunSummary run={latestRun} /> : <p className="muted-copy">No attempt has started. Its inputs and result will appear here once work begins.</p>}
        </section>
        <section className="paper-card compact-card">
          <p className="eyebrow">Work order</p>
          <dl className="key-values"><div><dt>Created</dt><dd>{formatDate(order.createdAt)}</dd></div><div><dt>Updated</dt><dd>{formatDate(order.updatedAt)}</dd></div><div><dt>Worker</dt><dd className="capitalize">{order.workerProfile}</dd></div></dl>
        </section>
      </aside>
    </div>
  );
}

function Changes({ latestRun, actions }: { latestRun: Run | undefined; actions: ExternalAction[] }) {
  return (
    <div className="single-column">
      {latestRun?.candidateCommit ? (
        <section className="paper-card">
          <div className="card-heading"><p className="eyebrow">Recorded candidate</p><h2>Commit identity</h2></div>
          <p className="muted-copy">The candidate commit is recorded for this attempt. Review the repository diff before approving any publication.</p>
          <dl className="stacked-values"><div><dt>Candidate commit</dt><dd><code>{latestRun.candidateCommit}</code></dd></div><div><dt>Compared with</dt><dd><code>{latestRun.inputCommit}</code></dd></div><div><dt>Workspace</dt><dd><code>{latestRun.workspacePath}</code></dd></div></dl>
        </section>
      ) : <EmptyMessage title="No candidate commit yet" description="A candidate identity will appear here after an implementation attempt produces one." />}
      <section className="paper-card">
        <div className="card-heading"><p className="eyebrow">External actions</p><h2>Publication history</h2></div>
        {actions.length ? <ul className="record-list">{[...actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((action) => <li key={action.id}><div><strong>{action.kind === "draft_pr" ? "Draft pull request" : "Push"}</strong><span className="muted-copy">{formatDate(action.updatedAt)}</span></div><span className={`inline-state inline-state--${action.state === "succeeded" ? "success" : action.state === "failed" || action.state === "unknown" ? "attention" : "neutral"}`}>{formatEventType(action.state)}</span>{action.remoteIdentity && <code>{action.remoteIdentity}</code>}{action.error && <p className="record-error">{action.error}</p>}</li>)}</ul> : <p className="muted-copy">No push or draft pull request action has been recorded.</p>}
      </section>
    </div>
  );
}

function Verification({ checks }: { checks: Check[] }) {
  if (!checks.length) return <EmptyMessage title="No checks have run" description="Verification results will appear here after a candidate is checked." />;
  return (
    <div className="single-column">
      {[...checks].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((check) => (
        <section className="paper-card check-card" key={check.id}>
          <div className="check-card__top"><span className={`inline-state inline-state--${checkTone[check.status]}`}><span className="status-dot" />{formatEventType(check.status)}</span><time dateTime={check.finishedAt}>{formatDate(check.finishedAt)}</time></div>
          <h2><code>{check.command}</code></h2>
          <dl className="check-meta"><div><dt>Candidate</dt><dd><code title={check.candidateCommit}>{shortId(check.candidateCommit, 12)}</code></dd></div><div><dt>Exit code</dt><dd>{check.exitCode ?? "Unavailable"}</dd></div><div><dt>Run</dt><dd><code>{shortId(check.runId)}</code></dd></div></dl>
          <div className="log-location"><span>Log stored at</span><code>{check.logPath}</code></div>
        </section>
      ))}
    </div>
  );
}

function Decisions({ detail, onRefresh }: { detail: Detail; onRefresh: () => void }) {
  const decisionEvents = detail.events.filter((event) => /approval|clarif|decision|login|environment|human/i.test(event.type));
  return (
    <div className="single-column">
      <section className="paper-card decision-card"><p className="eyebrow">Current position</p><h2>{workOrderStates[detail.workOrder.state].label}</h2><p>{workOrderStates[detail.workOrder.state].guidance}</p></section>
      <PublicationReview detail={detail} onRefresh={onRefresh} />
      <section className="paper-card"><div className="card-heading"><p className="eyebrow">Record</p><h2>Human decisions</h2></div>{decisionEvents.length ? <EventList events={decisionEvents} /> : <p className="muted-copy">No clarification, approval, sign-in, or environment decision has been recorded for this work order.</p>}</section>
    </div>
  );
}

interface Props {
  detail: Detail;
  onStart: () => void;
  onCancel: () => void;
  onRefresh: () => void;
  actionPending: "start" | "cancel" | null;
  actionError: string | null;
}

export default function WorkOrderDetail({ detail, onStart, onCancel, onRefresh, actionPending, actionError }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const order = detail.workOrder;
  const latestRun = [...detail.runs].sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
  const hasActiveRun = detail.runs.some((run) => !run.finishedAt && (run.state === "planning" || run.state === "implementing" || run.state === "verifying"));
  const canStart = order.state === "queued" || order.state === "failed" || order.state === "interrupted";

  return (
    <main className="main-panel detail-panel" id="main-content">
      <div className="detail-header">
        <div className="detail-header__identity"><p className="eyebrow">Work order <span className="muted-dot">/</span> <span title={order.id}>{shortId(order.id)}</span></p><StatusPill state={order.state} /></div>
        <div className="detail-header__main"><div><h1>{order.title}</h1><p className="detail-description">{order.description}</p></div><div className="detail-header__actions"><button className="icon-button" type="button" aria-label="Refresh work order" title="Refresh work order" onClick={onRefresh}><Icon name="refresh" /></button>{canStart && <button className="button button--primary" type="button" disabled={actionPending !== null} onClick={onStart}>{actionPending === "start" ? "Starting…" : latestRun ? "Start another attempt" : "Start attempt"}<Icon name="arrow" size={17} /></button>}{hasActiveRun && <button className="button button--danger" type="button" disabled={actionPending !== null} onClick={onCancel}>Cancel run</button>}</div></div>
        <div className={`guidance guidance--${workOrderStates[order.state].tone}`}><span className="guidance__label">Current state</span><p>{workOrderStates[order.state].guidance}</p></div>
        {actionError && <div className="inline-error" role="alert">{actionError}</div>}
        <div className="detail-facts"><div><span>Type</span><strong className="capitalize">{order.kind}</strong></div><div><span>Repository</span><strong title={order.repositoryPath}>{order.repositoryPath.split("/").filter(Boolean).at(-1) || order.repositoryPath}</strong></div><div><span>Worker</span><strong className="capitalize">{order.workerProfile}</strong></div><div><span>Updated</span><strong>{formatDate(order.updatedAt)}</strong></div></div>
      </div>

      <p className="detail-tabs__cue">Scroll sections <span aria-hidden="true">→</span></p>
      <nav className="detail-tabs" aria-label="Work order sections">{tabs.map((tab) => <button className={activeTab === tab.id ? "detail-tabs__button detail-tabs__button--active" : "detail-tabs__button"} type="button" key={tab.id} aria-current={activeTab === tab.id ? "page" : undefined} onClick={() => setActiveTab(tab.id)}>{tab.label}{tab.id === "activity" && detail.events.length > 0 && <span>{detail.events.length}</span>}{tab.id === "verification" && detail.checks.length > 0 && <span>{detail.checks.length}</span>}</button>)}</nav>
      <div className="detail-content" key={activeTab}>
        {activeTab === "overview" && <Overview detail={detail} latestRun={latestRun} onRefresh={onRefresh} />}
        {activeTab === "activity" && <EventList events={detail.events} />}
        {activeTab === "changes" && <Changes latestRun={latestRun} actions={detail.externalActions} />}
        {activeTab === "verification" && <Verification checks={detail.checks} />}
        {activeTab === "decisions" && <Decisions detail={detail} onRefresh={onRefresh} />}
      </div>
    </main>
  );
}
