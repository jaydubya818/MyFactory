import { sendToAgentChat, useAgentEngineConfigured } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconArrowLeft, IconArrowRight, IconMessageCircle, IconRefresh } from "@tabler/icons-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import type { Check, FactoryEvent, FactoryManifestResult, FactoryWorkOrdersResponse, WorkOrder, WorkOrderDetail, WorkOrderState } from "@shared/factory-types";
import type { FactoryTextArtifact } from "../../server/lib/factory-supervisor";

type FactoryTab = "overview" | "activity" | "changes" | "verification" | "decisions";

const tabs: { id: FactoryTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "changes", label: "Changes" },
  { id: "verification", label: "Verification" },
  { id: "decisions", label: "Decisions" },
];

const activeStates = new Set<WorkOrderState>(["planning", "implementing", "verifying"]);
const attentionStates = new Set<WorkOrderState>(["needs_investigation", "awaiting_clarification", "awaiting_approval", "awaiting_human_login", "awaiting_environment", "failed", "interrupted"]);

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function shortId(value: string): string {
  return value.length > 9 ? value.slice(0, 9) : value;
}

function statusTone(state: WorkOrderState): string {
  if (state === "ready_for_review") return "ready";
  if (activeStates.has(state)) return "active";
  if (attentionStates.has(state)) return "attention";
  return "quiet";
}

function Status({ state }: { state: WorkOrderState }) {
  return <span className={`factory-status factory-status--${statusTone(state)}`}>{humanize(state)}</span>;
}

function StateMessage({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return <div className="factory-state-message" role={retry ? "alert" : undefined}><strong>{title}</strong><p>{detail}</p>{retry && <button type="button" onClick={retry}><IconRefresh size={15} /> Retry</button>}</div>;
}

function Queue({ orders, onSelect }: { orders: WorkOrder[]; onSelect: (id: string) => void }) {
  if (!orders.length) return <StateMessage title="No work orders yet" detail="Saved work will appear here after it is created in the local factory." />;
  return <div className="factory-queue"><div className="factory-queue__head"><h2>Work queue</h2><span>{orders.length} saved</span></div><ul>{orders.map((order) => <li key={order.id}><button type="button" onClick={() => onSelect(order.id)}><span className="factory-queue__identity"><strong>{order.title}</strong><small>{shortId(order.id)} · {order.kind} · {order.repositoryPath.split("/").filter(Boolean).slice(-1)[0] || "Repository pending"}</small></span><Status state={order.state} /><IconArrowRight size={17} aria-hidden="true" /></button></li>)}</ul></div>;
}

function Overview({ orders, onSelect, onAsk }: { orders: WorkOrder[]; onSelect: (id: string) => void; onAsk: (question: string) => void }) {
  const sorted = useMemo(() => [...orders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [orders]);
  const inProgress = sorted.filter((order) => activeStates.has(order.state));
  const needsYou = sorted.filter((order) => attentionStates.has(order.state) || order.state === "ready_for_review");
  const review = sorted.find((order) => order.state === "ready_for_review" || order.state === "awaiting_approval");
  return <div className="factory-content"><div className="factory-title-block"><p className="factory-eyebrow">Local software factory</p><h1>Your factory, in focus.</h1><p>{needsYou.length ? `${needsYou.length} work ${needsYou.length === 1 ? "order needs" : "orders need"} your judgment.` : "Every saved work order and next decision stays visible here."}</p></div>
    {review ? <section className="factory-spotlight"><p className="factory-eyebrow">{humanize(review.state)} · {shortId(review.id)}</p><h2>{review.title}</h2><p>{review.description}</p><button type="button" onClick={() => onSelect(review.id)}>Review work order <IconArrowRight size={16} /></button></section> : <section className="factory-spotlight factory-spotlight--empty"><p className="factory-eyebrow">Review desk</p><h2>No work is awaiting review.</h2><p>Candidate results and approval requests will appear here when recorded.</p></section>}
    <div className="factory-metrics" aria-label="Factory summary"><div><strong>{inProgress.length}</strong><span>in progress</span></div><div><strong>{needsYou.length}</strong><span>need you</span></div><div><strong>{sorted.filter((order) => order.state === "queued").length}</strong><span>queued</span></div></div>
    <div className="factory-agent-prompt factory-ask-button"><div><p className="factory-eyebrow">Factory agent</p><strong>Ask with the queue in view.</strong><p>The agent reads the same saved records and can cite runs, checks, and events.</p></div><button type="button" onClick={() => onAsk("Find blockers in the current work queue. Cite the work orders and evidence you used.")}>Find blockers <IconMessageCircle size={16} /></button></div>
    <Queue orders={sorted} onSelect={onSelect} />
  </div>;
}

function EventList({ events, selectedEvidenceId, onAskEvidence }: { events: FactoryEvent[]; selectedEvidenceId: string | null; onAskEvidence: (id: string, label: string) => void }) {
  if (!events.length) return <StateMessage title="No activity recorded" detail="Events will appear here as this work order changes state." />;
  return <ol className="factory-events">{[...events].sort((a, b) => b.id - a.id).map((event) => {
    const note = event.type === "workorder.note_added" && typeof event.payload.text === "string" ? event.payload.text : null;
    const scaffold = event.type === "builder.scaffold_created" && typeof event.payload.templateVersion === "string"
      ? `Feedback Hub template ${event.payload.templateVersion} · ${String(event.payload.fileCount ?? "unknown")} files`
      : null;
    return <li key={event.id} className={selectedEvidenceId === String(event.id) ? "factory-evidence--selected" : undefined}><div><strong>{humanize(event.type.replace(/\./g, "_"))}</strong><time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></div><p>{note ?? scaffold ?? (event.runId ? `Run ${shortId(event.runId)}` : "Work order event")}</p><button className="factory-ask-button" type="button" onClick={() => onAskEvidence(String(event.id), `event ${event.id}`)}>Explain this event <IconMessageCircle size={14} /></button></li>;
  })}</ol>;
}

function CheckList({ workOrderId, checks, selectedEvidenceId, onSelectEvidence, onAskEvidence }: { workOrderId: string; checks: Check[]; selectedEvidenceId: string | null; onSelectEvidence: (id: string) => void; onAskEvidence: (id: string, label: string) => void }) {
  if (!checks.length) return <StateMessage title="No checks recorded" detail="Verification results will appear here after a candidate is checked." />;
  return <div className="factory-checks">{[...checks].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((check) => <section key={check.id} className={selectedEvidenceId === check.id ? "factory-card factory-evidence--selected" : "factory-card"}><div className="factory-checks__head"><span className={`factory-check-status factory-check-status--${check.status}`}>{humanize(check.status)}</span><time dateTime={check.finishedAt}>{formatDate(check.finishedAt)}</time></div><h3><code>{check.command}</code></h3><p>Exit {check.exitCode ?? "unavailable"} · Candidate <code>{shortId(check.candidateCommit)}</code>{check.logSha256 ? ` · Log SHA-256 ${check.logSha256}` : " · Log digest unavailable"}</p><div className="factory-inline-actions"><button type="button" onClick={() => onSelectEvidence(check.id)}>{selectedEvidenceId === check.id ? "Hide log" : "View log"}</button><button className="factory-ask-button" type="button" onClick={() => onAskEvidence(check.id, `check ${check.command}`)}>Explain this check <IconMessageCircle size={14} /></button></div>{selectedEvidenceId === check.id && <CheckLog workOrderId={workOrderId} checkId={check.id} />}</section>)}</div>;
}

function ArtifactText({ artifact, label }: { artifact: FactoryTextArtifact; label: string }) {
  if (!artifact.available) return <p className="factory-muted">{label} is unavailable in the saved artifacts.</p>;
  const text = artifact.text ?? "";
  const limit = 200_000;
  return <div className="factory-artifact"><pre tabIndex={0} aria-label={label}>{text.slice(0, limit) || "Artifact is empty."}</pre>{text.length > limit && <p>Showing the first {limit.toLocaleString()} characters of this artifact.</p>}</div>;
}

function CandidateDiff({ workOrderId }: { workOrderId: string }) {
  const query = useActionQuery<FactoryTextArtifact>("get-factory-diff", { workOrderId });
  if (query.isPending) return <StateMessage title="Loading candidate diff…" detail="Reading the recorded patch." />;
  if (query.isError) return <StateMessage title="Candidate diff could not be read" detail={query.error.message} retry={() => void query.refetch()} />;
  return <ArtifactText artifact={query.data} label="Candidate diff" />;
}

function CheckLog({ workOrderId, checkId }: { workOrderId: string; checkId: string }) {
  const query = useActionQuery<FactoryTextArtifact>("get-factory-check-log", { workOrderId, checkId });
  if (query.isPending) return <StateMessage title="Loading check log…" detail="Reading the recorded check output." />;
  if (query.isError) return <StateMessage title="Check log could not be read" detail={query.error.message} retry={() => void query.refetch()} />;
  return <ArtifactText artifact={query.data} label="Check log" />;
}

function BuildManifest({ workOrderId, awaitingEnvironment }: { workOrderId: string; awaitingEnvironment: boolean }) {
  const query = useActionQuery<FactoryManifestResult>("get-factory-build-manifest", { workOrderId });
  if (query.isPending) return <StateMessage title="Loading build manifest…" detail="Reading the saved scaffold record." />;
  if (query.isError) return <StateMessage title="Build manifest could not be read" detail={query.error.message} retry={() => void query.refetch()} />;
  if (!query.data.available || !query.data.manifest) return <p className="factory-muted">The build manifest is unavailable in the saved artifacts.</p>;
  const manifest = query.data.manifest;
  return <div className="factory-manifest">
    <p className="factory-muted">Template {manifest.template.id} · version {manifest.template.version} · {manifest.files.length} generated files</p>
    {awaitingEnvironment && <p className="factory-manifest__pending">Scaffold prepared for review. Environment setup and verification are still pending.</p>}
    <ul>{manifest.files.map((file) => <li key={file.path}><strong>{file.path}</strong><span>{file.bytes.toLocaleString()} bytes</span><code title={`SHA-256 ${file.sha256}`}>{file.sha256}</code></li>)}</ul>
  </div>;
}

function Detail({ detail, activeTab, selectedEvidenceId, onTabChange, onBack, onAsk, onAskEvidence, onSelectEvidence }: { detail: WorkOrderDetail; activeTab: FactoryTab; selectedEvidenceId: string | null; onTabChange: (tab: FactoryTab) => void; onBack: () => void; onAsk: (question: string) => void; onAskEvidence: (id: string, label: string) => void; onSelectEvidence: (id: string) => void }) {
  const order = detail.workOrder;
  const latestRun = [...detail.runs].sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
  const decisionEvents = detail.events.filter((event) => /approval|clarif|decision|login|environment|human/i.test(event.type));
  return <div className="factory-content factory-detail"><button className="factory-back" type="button" onClick={onBack}><IconArrowLeft size={16} /> Work queue</button><div className="factory-detail__heading"><div><p className="factory-eyebrow">Work order · {shortId(order.id)}</p><h1>{order.title}</h1><p>{order.description}</p></div><Status state={order.state} /></div>
    <div className="factory-detail__facts"><span><small>Repository</small><strong>{order.repositoryPath || "Not set"}</strong></span><span><small>Base ref</small><strong>{order.baseRef || "Not set"}</strong></span><span><small>Worker</small><strong>{humanize(order.workerProfile)}</strong></span><span><small>Updated</small><strong>{formatDate(order.updatedAt)}</strong></span></div>
    <div className="factory-agent-actions factory-ask-button"><div><p className="factory-eyebrow">Factory agent</p><strong>Ask about this work order</strong><p>Questions use the active section and selected evidence.</p></div><div><button type="button" onClick={() => onAsk("Explain the evidence currently in view. Cite recorded checks, events, or runs.")}>Explain evidence</button><button type="button" onClick={() => onAsk("Find blockers for this work order. Cite the recorded evidence.")}>Find blockers</button><button type="button" onClick={() => onAsk("Prepare the next safe action for this work order. Explain why and do not execute it.")}>Prepare next action</button></div></div>
    <nav className="factory-tabs" aria-label="Work order sections">{tabs.map((tab) => <button type="button" key={tab.id} className={activeTab === tab.id ? "factory-tabs__active" : undefined} aria-current={activeTab === tab.id ? "page" : undefined} onClick={() => onTabChange(tab.id)}>{tab.label}</button>)}</nav>
    <div className="factory-detail__body">{activeTab === "overview" && <div className="factory-detail-grid"><section className="factory-card"><p className="factory-eyebrow">Definition</p><h2>Acceptance criteria</h2>{order.acceptanceCriteria.length ? <ol className="factory-criteria">{order.acceptanceCriteria.map((criterion, index) => <li key={`${index}-${criterion}`}>{criterion}</li>)}</ol> : <p className="factory-muted">No acceptance criteria recorded.</p>}</section><section className="factory-card"><p className="factory-eyebrow">Execution</p><h2>Latest attempt</h2>{latestRun ? <dl className="factory-facts-list"><div><dt>State</dt><dd>{humanize(latestRun.state)}</dd></div><div><dt>Input commit</dt><dd><code>{shortId(latestRun.inputCommit)}</code></dd></div><div><dt>Candidate</dt><dd>{latestRun.candidateCommit ? <code>{shortId(latestRun.candidateCommit)}</code> : "None recorded"}</dd></div><div><dt>Failure</dt><dd>{latestRun.failure || "None recorded"}</dd></div></dl> : <p className="factory-muted">No attempt has started.</p>}</section><section className="factory-card factory-card--wide"><p className="factory-eyebrow">Boundaries</p><h2>Scope and checks</h2><dl className="factory-facts-list"><div><dt>Permitted paths</dt><dd>{order.allowedPaths.length ? order.allowedPaths.join(", ") : "None recorded"}</dd></div><div><dt>Reproduction</dt><dd>{order.reproductionCommand || "Not specified"}</dd></div>{order.expectedFailureText && <div><dt>Expected failure</dt><dd>{order.expectedFailureText}</dd></div>}<div><dt>Checks</dt><dd>{order.checkCommands.length ? order.checkCommands.join(" · ") : "None recorded"}</dd></div></dl></section></div>}
      {activeTab === "activity" && <EventList events={detail.events} selectedEvidenceId={selectedEvidenceId} onAskEvidence={onAskEvidence} />}
      {activeTab === "changes" && <div className="factory-detail-grid"><section className="factory-card"><p className="factory-eyebrow">Candidate</p><h2>Commit identity</h2>{latestRun?.candidateCommit ? <><code className="factory-commit">{latestRun.candidateCommit}</code><button className="factory-ask-button" type="button" onClick={() => onAskEvidence(latestRun.candidateCommit!, "candidate commit")}>Explain candidate <IconMessageCircle size={14} /></button></> : <p className="factory-muted">No candidate commit recorded.</p>}</section><section className="factory-card"><p className="factory-eyebrow">Publication</p><h2>External actions</h2>{detail.externalActions.length ? <ul className="factory-action-list">{detail.externalActions.map((action) => <li key={action.id}><strong>{humanize(action.kind)}</strong><span>{humanize(action.state)}</span>{action.remoteIdentity && <small>{action.remoteIdentity}</small>}</li>)}</ul> : <p className="factory-muted">No push or draft pull request action recorded.</p>}</section>{detail.events.some((event) => event.type === "builder.scaffold_created") && <section className="factory-card factory-card--wide"><p className="factory-eyebrow">App builder</p><h2>Generated files</h2><BuildManifest workOrderId={order.id} awaitingEnvironment={order.state === "awaiting_environment"} /></section>}{latestRun?.candidateCommit && <section className="factory-card factory-card--wide"><p className="factory-eyebrow">Recorded patch</p><h2>Candidate diff</h2><CandidateDiff workOrderId={order.id} /></section>}</div>}
      {activeTab === "verification" && <CheckList workOrderId={order.id} checks={detail.checks} selectedEvidenceId={selectedEvidenceId} onSelectEvidence={onSelectEvidence} onAskEvidence={onAskEvidence} />}
      {activeTab === "decisions" && <div className="factory-detail-grid"><section className="factory-card"><p className="factory-eyebrow">Current position</p><h2>{humanize(order.state)}</h2><p className="factory-muted">Review the recorded events and checks before deciding the next step.</p></section><section className="factory-card"><p className="factory-eyebrow">Publication requests</p><h2>Review record</h2>{detail.publicationRequests.length ? <ul className="factory-action-list">{detail.publicationRequests.map((request) => <li key={request.id}><strong>{request.destination}</strong><span><code>{request.candidateCommit}</code></span><small>Evidence {request.evidenceDigest} · Policy revision {request.policyRevision}</small><small>Requested {formatDate(request.createdAt)} · {detail.publicationApprovals.some((approval) => approval.requestId === request.id) ? "Approval recorded; validity rechecked before publication" : "Awaiting human approval"}</small></li>)}</ul> : <p className="factory-muted">No publication proposal recorded.</p>}</section><section className="factory-card factory-card--wide"><p className="factory-eyebrow">Human record</p><h2>Decision events</h2><EventList events={decisionEvents} selectedEvidenceId={selectedEvidenceId} onAskEvidence={onAskEvidence} /></section></div>}
    </div>
  </div>;
}

export function meta() {
  return [{ title: "Factory | Local Software Factory" }];
}

export default function FactoryRoute() {
  useSetPageTitle("Factory");
  const agentEngine = useAgentEngineConfigured();
  const [searchParams, setSearchParams] = useSearchParams();
  const workOrderId = searchParams.get("workOrder");
  const requestedTab = searchParams.get("tab");
  const activeTab = tabs.some((tab) => tab.id === requestedTab) ? requestedTab as FactoryTab : "overview";
  const selectedEvidenceId = searchParams.get("evidence");
  const queueQuery = useActionQuery<FactoryWorkOrdersResponse>("list-factory-work-orders", {}, { refetchInterval: 7_000 });
  const detailQuery = useActionQuery<WorkOrderDetail>("get-factory-work-order", { workOrderId: workOrderId ?? "" }, { enabled: Boolean(workOrderId), refetchInterval: 7_000 });
  const orders = queueQuery.data?.workOrders ?? [];

  function selectWorkOrder(id: string) {
    setSearchParams({ workOrder: id });
  }

  function showOverview() {
    setSearchParams({});
  }

  function setTab(tab: FactoryTab) {
    if (!workOrderId) return;
    setSearchParams({ workOrder: workOrderId, tab });
  }

  function ask(question: string, evidenceId = selectedEvidenceId) {
    if (agentEngine.missing) return;
    const order = detailQuery.data?.workOrder;
    const context = {
      view: "factory",
      workOrderId,
      activeTab: workOrderId ? activeTab : null,
      selectedEvidenceId: evidenceId,
      ...(order ? { title: order.title, state: order.state } : {}),
    };
    sendToAgentChat({ message: question, context: JSON.stringify(context), submit: true, mode: "plan", chatTarget: "local", openSidebar: true, usageLabel: "factory:contextual-question" });
  }

  function askEvidence(id: string, label: string) {
    if (!workOrderId) return;
    setSearchParams({ workOrder: workOrderId, tab: activeTab, evidence: id });
    ask(`Explain ${label} for this work order. Cite the underlying record and say what it proves.`, id);
  }

  function selectEvidence(id: string) {
    if (!workOrderId) return;
    const next = selectedEvidenceId === id ? null : id;
    setSearchParams(next ? { workOrder: workOrderId, tab: activeTab, evidence: next } : { workOrder: workOrderId, tab: activeTab });
  }

  return <div className="factory-route" data-agent-ready={agentEngine.missing ? "false" : "true"}>
    {queueQuery.data?.supervisorUiOrigin && <nav className="factory-workspace-links" aria-label="Factory tools"><span>Local supervisor</span><a href={`${queueQuery.data.supervisorUiOrigin}/?new=1`} target="_blank" rel="noopener noreferrer">New WorkOrder <IconArrowRight size={14} /></a><a href={`${queueQuery.data.supervisorUiOrigin}/?view=builder`} target="_blank" rel="noopener noreferrer">App builder <IconArrowRight size={14} /></a>{workOrderId && detailQuery.data?.events.some((event) => event.type === "builder.scaffold_created") && <a href={`${queueQuery.data.supervisorUiOrigin}/?workOrder=${encodeURIComponent(workOrderId)}`} target="_blank" rel="noopener noreferrer">Preview controls <IconArrowRight size={14} /></a>}</nav>}
    {agentEngine.missing && <div className="factory-provider-state" role="status"><div><strong>Connect an agent provider to ask questions.</strong><p>Saved work orders and evidence remain available. The agent chat needs a configured provider before it can answer.</p></div><Link to="/settings/agent">Agent settings <IconArrowRight size={16} /></Link></div>}
    {agentEngine.state === "unavailable" && <div className="factory-provider-state factory-provider-state--uncertain" role="status"><strong>Agent connection could not be checked.</strong><span>You can still review saved work. The sidebar will report any chat connection error.</span></div>}
    {workOrderId ? detailQuery.isPending ? <StateMessage title="Loading work order…" detail="Reading the saved work and evidence." /> : detailQuery.isError ? <StateMessage title="Work order unavailable" detail={detailQuery.error.message} retry={() => void detailQuery.refetch()} /> : detailQuery.data ? <Detail detail={detailQuery.data} activeTab={activeTab} selectedEvidenceId={selectedEvidenceId} onTabChange={setTab} onBack={showOverview} onAsk={ask} onAskEvidence={askEvidence} onSelectEvidence={selectEvidence} /> : <StateMessage title="Work order unavailable" detail="The local service did not return a work order." /> : queueQuery.isPending ? <StateMessage title="Loading factory…" detail="Reading saved WorkOrders from the local supervisor." /> : queueQuery.isError ? <StateMessage title="Factory unavailable" detail={queueQuery.error.message} retry={() => void queueQuery.refetch()} /> : <Overview orders={orders} onSelect={selectWorkOrder} onAsk={ask} />}
  </div>;
}
