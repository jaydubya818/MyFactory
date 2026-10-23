import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CreateWorkOrderInput, WorkKind, WorkerProfile } from "@factory/contracts";
import { lines } from "./domain";
import { Icon } from "./components";
import { useConnections } from "./ConnectionsPage";

const DRAFT_KEY = "myfactory-new-work-draft-v1";

function loadDraft(): Partial<Record<string, string>> {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<string, string>>) : {};
  } catch {
    return {};
  }
}

function saveDraft(values: Record<string, string>): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(values));
  } catch {
    // SessionStorage may be unavailable (private-browsing quota, etc.).
  }
}

function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore
  }
}

interface Props {
  /** Resolves true only after the work order was created. False or a thrown error keeps the draft. */
  onSubmit: (input: CreateWorkOrderInput) => Promise<boolean>;
  onCancel: () => void;
  pending: boolean;
  serverError: string | null;
}

export default function CreateWorkOrderForm({ onSubmit, onCancel, pending, serverError }: Props) {
  const draft = loadDraft();
  const [title, setTitle] = useState(draft.title ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [kind, setKind] = useState<WorkKind>((draft.kind as WorkKind) ?? "defect");
  const [repositoryPath, setRepositoryPath] = useState(draft.repositoryPath ?? "");
  const [baseRef, setBaseRef] = useState(draft.baseRef ?? "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(draft.acceptanceCriteria ?? "");
  const [reproductionCommand, setReproductionCommand] = useState(draft.reproductionCommand ?? "");
  const [expectedFailureText, setExpectedFailureText] = useState(draft.expectedFailureText ?? "");
  const [checkCommands, setCheckCommands] = useState(draft.checkCommands ?? "");
  const [allowedPaths, setAllowedPaths] = useState(draft.allowedPaths ?? "");
  const [workerProfile, setWorkerProfile] = useState<WorkerProfile>((draft.workerProfile as WorkerProfile) ?? "mac");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { status: connections, error: connectionError, refresh: refreshConnections } = useConnections();
  const [linearChoice, setLinearChoice] = useState<boolean | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const syncToLinear = linearChoice ?? (connections?.linear.configured && connections.linear.mode === "automatic") ?? false;
  const errorRef = useRef<HTMLDivElement>(null);

  // Persist draft to sessionStorage whenever field values change.
  useEffect(() => {
    saveDraft({ title, description, kind, repositoryPath, baseRef, acceptanceCriteria,
      reproductionCommand, expectedFailureText, checkCommands, allowedPaths, workerProfile });
  }, [title, description, kind, repositoryPath, baseRef, acceptanceCriteria,
    reproductionCommand, expectedFailureText, checkCommands, allowedPaths, workerProfile]);

  // Focus and scroll the error container into view whenever an error appears.
  useEffect(() => {
    if ((validationError ?? serverError) && errorRef.current) {
      errorRef.current.focus();
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [validationError, serverError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    const criteria = lines(acceptanceCriteria);
    const paths = lines(allowedPaths);
    const checks = lines(checkCommands);
    if (![title, description, repositoryPath, baseRef].every((value) => value.trim())) {
      setValidationError("Complete the title, description, repository path, and base ref.");
      return;
    }
    if (repositoryPath.trim() && !repositoryPath.trim().startsWith("/")) {
      setValidationError("Repository path must be an absolute path starting with /.");
      return;
    }
    if (criteria.length === 0 || paths.length === 0 || checks.length === 0) {
      setValidationError("Add an acceptance criterion, a permitted path, and a check command.");
      return;
    }
    if (kind === "defect" && !reproductionCommand.trim()) {
      setValidationError("A reproduction command is required for defect work orders.");
      return;
    }
    if (kind === "defect" && !expectedFailureText.trim()) {
      setValidationError("A defect needs the exact failure text expected from its baseline reproduction.");
      return;
    }

    let created = false;
    try {
      created = await onSubmit({
        idempotencyKey,
        syncToLinear,
        title: title.trim(),
        description: description.trim(),
        kind,
        repositoryPath: repositoryPath.trim(),
        baseRef: baseRef.trim(),
        acceptanceCriteria: criteria,
        reproductionCommand: reproductionCommand.trim() || null,
        expectedFailureText: kind === "defect" ? expectedFailureText.trim() : null,
        checkCommands: checks,
        allowedPaths: paths,
        workerProfile,
      });
    } catch {
      return;
    }
    if (created === true) clearDraft();
  }

  return (
    <main className="main-panel create-panel" id="main-content">
      <div className="page-topline">
        <div>
          <p className="eyebrow">New work order</p>
          <h1>Define the work.</h1>
          <p className="page-lede">A narrow scope and clear checks make the resulting change reviewable.</p>
        </div>
        <button className="text-button" type="button" onClick={() => { clearDraft(); onCancel(); }}>Back to queue <Icon name="arrow" size={16} /></button>
      </div>

      <form className="create-form" noValidate onSubmit={(event) => void submit(event)}>
        <section className="form-section" aria-labelledby="work-section-title">
          <div className="form-section__intro">
            <span className="section-number">01</span>
            <div><h2 id="work-section-title">The outcome</h2><p>State what should change and how someone will know it worked.</p></div>
          </div>
          <div className="form-section__fields">
            <div className="field"><label htmlFor="work-title">Title <span aria-hidden="true">*</span></label><input id="work-title" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></div>
            <div className="field"><label htmlFor="work-kind">Type <span aria-hidden="true">*</span></label><select id="work-kind" value={kind} onChange={(event) => setKind(event.target.value as WorkKind)}><option value="defect">Defect</option><option value="feature">Feature</option><option value="investigation">Investigation</option></select></div>
            <div className="field field--full"><label htmlFor="work-description">Description <span aria-hidden="true">*</span></label><textarea id="work-description" required rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /><p className="field-help">Include the observed behavior, expected behavior, and useful context.</p></div>
            <div className="field field--full"><label htmlFor="work-criteria">Acceptance criteria <span aria-hidden="true">*</span></label><textarea id="work-criteria" required rows={4} value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} /><p className="field-help">One criterion per line.</p></div>
          </div>
        </section>

        <section className="form-section" aria-labelledby="scope-section-title">
          <div className="form-section__intro">
            <span className="section-number">02</span>
            <div><h2 id="scope-section-title">The boundary</h2><p>Point to one repository and specify where edits may land.</p></div>
          </div>
          <div className="form-section__fields">
            <div className="field field--full"><label htmlFor="repository-path">Repository path <span aria-hidden="true">*</span></label><input id="repository-path" required value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} aria-describedby="repository-path-help" /><p className="field-help" id="repository-path-help">Absolute path to the local Git repository (must start with <code>/</code>). Example: <code>/Users/yourname/project</code></p></div>
            <div className="field"><label htmlFor="base-ref">Base branch or ref <span aria-hidden="true">*</span></label><input id="base-ref" required value={baseRef} onChange={(event) => setBaseRef(event.target.value)} /></div>
            <div className="field"><label htmlFor="worker-profile">Worker profile <span aria-hidden="true">*</span></label><select id="worker-profile" value={workerProfile} onChange={(event) => setWorkerProfile(event.target.value as WorkerProfile)}><option value="mac">Mac — available</option><option value="container" disabled>Container — unavailable in Phase 1</option><option value="browser" disabled>Browser — unavailable in Phase 1</option></select><p className="field-help">Mac runs Codex on this machine in a task worktree. Docker checks verify the committed result. This worker can access host credentials and network; it does not run inside a container.</p></div>
            <div className="field field--full"><label htmlFor="allowed-paths">Permitted paths <span aria-hidden="true">*</span></label><textarea id="allowed-paths" required rows={3} value={allowedPaths} onChange={(event) => setAllowedPaths(event.target.value)} /><p className="field-help">One repository-relative path or pattern per line.</p></div>
          </div>
        </section>

        <section className="form-section" aria-labelledby="evidence-section-title">
          <div className="form-section__intro">
            <span className="section-number">03</span>
            <div><h2 id="evidence-section-title">The evidence</h2><p>Give the worker a way to reproduce and verify the result.</p></div>
          </div>
          <div className="form-section__fields">
            <div className="field field--full"><label htmlFor="reproduction-command">Reproduction command {kind === "defect" && <span aria-hidden="true" title="Required for defects">*</span>}</label><input id="reproduction-command" required={kind === "defect"} value={reproductionCommand} onChange={(event) => setReproductionCommand(event.target.value)} aria-describedby="reproduction-command-help" /><p className="field-help" id="reproduction-command-help">{kind === "defect" ? <strong>Required for defects.</strong> : null} This command must fail before the fix and pass on the candidate.</p></div>
            {kind === "defect" && <div className="field field--full"><label htmlFor="expected-failure-text">Expected failure text <span aria-hidden="true">*</span></label><input id="expected-failure-text" required value={expectedFailureText} onChange={(event) => setExpectedFailureText(event.target.value)} /><p className="field-help">Enter an exact, case-sensitive substring of the baseline command’s failure log. The worker uses it to confirm the reported defect was reproduced.</p></div>}
            <div className="field field--full"><label htmlFor="check-commands">Check commands <span aria-hidden="true">*</span></label><textarea id="check-commands" required rows={3} value={checkCommands} onChange={(event) => setCheckCommands(event.target.value)} /><p className="field-help">One command per line. These are run to verify a candidate.</p></div>
          </div>
        </section>

        <section className="form-section" aria-labelledby="tracking-title"><div className="form-section__intro"><span className="section-number">04</span><div><h2 id="tracking-title">Connected tracking</h2><p>Keep a linked issue in Linear.</p></div></div><div className="form-section__fields"><div className="field field--full">
          {connectionError ? <><p className="form-error" role="alert">{connectionError}</p><button type="button" className="button button--quiet" onClick={refreshConnections}>Retry connection</button></> : !connections ? <p role="status">Checking Linear connection…</p> : connections.linear.configured ? <><label className="checkbox-label"><input type="checkbox" checked={syncToLinear} onChange={(event) => setLinearChoice(event.target.checked)} /> Create a Linear issue</label><p className="field-help">Shares this title, description, acceptance criteria, type, and ID with team {connections.linear.teamId}{connections.linear.projectId ? `, project ${connections.linear.projectId}` : ""}. The saved WorkOrder shows the issue link or a retry option.</p></> : <p className="field-help">Linear is not connected. This WorkOrder will be saved in MyFactory only. <a href="?view=connections" target="_blank" rel="noreferrer">View connections</a></p>}
        </div></div></section>
        {(validationError ?? serverError) && (
          <div
            ref={errorRef}
            className="form-error"
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
          >
            {validationError ?? serverError}
          </div>
        )}
        <div className="form-actions">
          <button className="button button--quiet" type="button" onClick={() => { clearDraft(); onCancel(); }} disabled={pending}>Cancel</button>
          <button className="button button--primary" type="submit" disabled={pending || !connections}>{pending ? "Creating…" : "Create work order"}<Icon name="arrow" size={17} /></button>
        </div>
      </form>
    </main>
  );
}
