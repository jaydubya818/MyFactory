import { useEffect, useMemo, useState } from "react";
import type { WorkOrder, WorkOrderDetail } from "@factory/contracts";
import { getWorkOrderDetail } from "./api";
import { EmptyMessage, Icon, StatusPill } from "./components";
import { attentionStates, errorText, runningStates, shortId, workOrderStates } from "./domain";
import DispatchControl from "./DispatchControl";

interface Props {
  queue: WorkOrder[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onQueue: () => void;
  onSelect: (id: string) => void;
  onBuilder: () => void;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function OverviewPage({ queue, loading, error, onRetry, onCreate, onQueue, onSelect, onBuilder }: Props) {
  const sorted = useMemo(() => [...queue].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [queue]);
  const review = sorted.filter((order) => order.state === "ready_for_review" || order.state === "awaiting_approval");
  const spotlight = review[0];
  const inProgress = sorted.filter((order) => runningStates.has(order.state));
  const watch = sorted.filter((order) => attentionStates.has(order.state) && order.state !== "awaiting_approval");
  const needsYou = watch.length + review.length;
  const readyCount = review.filter((order) => order.state === "ready_for_review").length;
  const [spotlightDetail, setSpotlightDetail] = useState<WorkOrderDetail | null>(null);
  const [spotlightError, setSpotlightError] = useState<string | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);

  useEffect(() => {
    if (!spotlight) {
      setSpotlightDetail(null);
      setSpotlightError(null);
      return;
    }
    let active = true;
    setSpotlightDetail(null);
    setSpotlightError(null);
    void getWorkOrderDetail(spotlight.id)
      .then((detail) => {
        if (!active) return;
        setSpotlightDetail(detail);
        setSpotlightError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setSpotlightDetail(null);
        setSpotlightError(errorText(reason));
      });
    return () => { active = false; };
  }, [spotlight?.id, spotlight?.updatedAt, detailRevision]);

  const currentDetail = spotlightDetail?.workOrder.id === spotlight?.id ? spotlightDetail : null;
  const latestRun = currentDetail?.runs.slice().sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
  const latestChecks = latestRun ? currentDetail?.checks.filter((check) => check.runId === latestRun.id) ?? [] : [];
  const passedChecks = latestChecks.filter((check) => check.status === "passed").length;
  const initialLoad = loading && queue.length === 0;
  const unavailable = Boolean(error && queue.length === 0);

  return (
    <main className="main-panel overview-page" id="main-content">
      <div className="overview-heading">
        <div>
          <p className="eyebrow">Local software factory</p>
          <h1>Your factory, in focus.</h1>
          <p className="page-lede">{initialLoad ? "Loading saved work…" : unavailable ? "The local service needs attention." : needsYou > 0 ? `${countLabel(needsYou, "work order")} ${needsYou === 1 ? "needs" : "need"} your judgment.` : "Your work and next decisions are visible here."}</p>
        </div>
        <button className="button button--primary" type="button" onClick={onCreate}><Icon name="plus" size={18} /> New WorkOrder</button>
      </div>

      {error && <div className="inline-error overview-error" role="alert"><div><strong>Overview could not refresh</strong><p>{error}</p></div><button className="button button--quiet" type="button" onClick={onRetry}>Retry</button></div>}

      <DispatchControl />

      {initialLoad ? <div className="loading-block" role="status"><span className="loading-bar" /><span className="loading-bar" /><span className="loading-bar" /><p>Loading saved work…</p></div> : unavailable ? <EmptyMessage title="Overview unavailable" description="The local service could not load saved work. Retry when it is running." /> : <>
        {spotlight ? <section className="review-spotlight" aria-labelledby="review-spotlight-title">
          <div className="review-spotlight__body">
            <p className="eyebrow">{workOrderStates[spotlight.state].label} · {shortId(spotlight.id)}</p>
            <h2 id="review-spotlight-title">{spotlight.title}</h2>
            <p>{spotlight.description}</p>
            <button className="review-spotlight__button" type="button" onClick={() => onSelect(spotlight.id)}>Review work order <Icon name="arrow" size={17} /></button>
          </div>
          {spotlightError && <p className="review-spotlight__error" role="alert">Review metrics could not load: {spotlightError} <button type="button" onClick={() => setDetailRevision((value) => value + 1)}>Retry</button></p>}
          <div className="review-spotlight__facts">
            <div><span>Verification</span><strong>{spotlightError ? "Unavailable" : currentDetail ? latestChecks.length ? `${passedChecks} / ${latestChecks.length} passed` : "No checks recorded" : "Loading…"}</strong></div>
            <div><span>Candidate commit</span><strong>{spotlightError ? "Unavailable" : currentDetail ? latestRun?.candidateCommit ? <code title={latestRun.candidateCommit}>{shortId(latestRun.candidateCommit, 10)}</code> : "None recorded" : "Loading…"}</strong></div>
            <div><span>Current state</span><strong>{workOrderStates[spotlight.state].label}</strong></div>
          </div>
        </section> : <section className="review-spotlight review-spotlight--empty" aria-labelledby="review-spotlight-title"><div className="review-spotlight__body"><p className="eyebrow">Review desk</p><h2 id="review-spotlight-title">No work is awaiting review.</h2><p>Completed candidates and approval requests will appear here when they need your attention.</p><button className="review-spotlight__button" type="button" onClick={onQueue}>Open work queue <Icon name="arrow" size={17} /></button></div></section>}

        <p className="overview-provenance"><span className="connection-dot" /> Supervised execution <span aria-hidden="true">·</span> Local workspace</p>

        <section className="overview-list-card" aria-labelledby="in-progress-title">
          <div className="overview-list-card__heading"><h2 id="in-progress-title">In progress</h2><button type="button" onClick={onQueue}>Full queue <Icon name="arrow" size={15} /></button></div>
          {inProgress.length ? <ul>{inProgress.slice(0, 4).map((order) => <li key={order.id}><button type="button" onClick={() => onSelect(order.id)}><span><strong>{order.title}</strong><small>{shortId(order.id)} · {order.kind}</small></span><StatusPill state={order.state} /></button></li>)}</ul> : <div className="overview-list-card__empty"><strong>No active attempts</strong><p>Started work appears here while the supervisor is running.</p></div>}
        </section>

        <div className="overview-secondary-grid"><section className="overview-list-card" aria-labelledby="watch-title">
          <div className="overview-list-card__heading"><h2 id="watch-title">Watch closely</h2><span>{watch.length ? countLabel(watch.length, "work order") : "Nothing waiting"}</span></div>
          {watch.length ? <ul>{watch.slice(0, 4).map((order) => <li key={order.id}><button type="button" onClick={() => onSelect(order.id)}><span><strong>{order.title}</strong><small>{workOrderStates[order.state].guidance}</small></span><StatusPill state={order.state} /></button></li>)}</ul> : <div className="overview-list-card__empty"><strong>No blockers recorded</strong><p>Work that needs a decision, sign-in, or environment fix appears here.</p></div>}
        </section><section className="overview-list-card overview-builder-card" aria-labelledby="overview-builder-title"><div className="overview-list-card__heading"><h2 id="overview-builder-title">Build agent-native apps</h2></div><div className="overview-builder-card__body"><p>Start from a product brief and an available template. The factory prepares a WorkOrder and local scaffold artifacts for review.</p><button className="button button--quiet" type="button" onClick={onBuilder}>Open App builder <Icon name="arrow" size={15} /></button></div></section></div>

        <div className="overview-footer" aria-label="Factory summary"><span><strong>{inProgress.length}</strong> in progress</span><span><strong>{needsYou}</strong> need you</span><span><strong>{readyCount}</strong> ready for review</span><button type="button" onClick={onQueue}>Open work queue <Icon name="arrow" size={16} /></button></div>
      </>}
    </main>
  );
}
