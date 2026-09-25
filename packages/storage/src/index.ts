import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Check,
  CreateWorkOrderInput,
  ExternalAction,
  FactoryEvent,
  FactoryPolicy,
  PublicationApproval,
  PublicationRequest,
  Run,
  WorkOrder,
  WorkOrderState,
} from "../../contracts/src/index.ts";

export type CreateRunInput = Pick<
  Run,
  "workOrderId" | "workerProfile" | "inputCommit" | "workspacePath"
> & { state?: Run["state"] };

export type CreateExternalActionInput = Pick<
  ExternalAction,
  "workOrderId" | "runId" | "kind" | "candidateCommit"
>;

export type InsertCheckInput = Omit<Check, "id" | "logSha256"> & { logSha256?: string | null };

export type AppendEventInput = Omit<FactoryEvent, "id" | "createdAt">;

export interface StorageOptions {
  busyTimeoutMs?: number;
}

interface WorkOrderRow {
  id: string;
  title: string;
  description: string;
  kind: WorkOrder["kind"];
  repository_path: string;
  base_ref: string;
  acceptance_criteria_json: string;
  reproduction_command: string | null;
  expected_failure_text: string | null;
  check_commands_json: string;
  allowed_paths_json: string;
  worker_profile: WorkOrder["workerProfile"];
  state: WorkOrder["state"];
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  work_order_id: string;
  attempt_number: number;
  state: Run["state"];
  worker_profile: Run["workerProfile"];
  input_commit: string;
  candidate_commit: string | null;
  workspace_path: string;
  started_at: string;
  finished_at: string | null;
  failure: string | null;
}

interface CheckRow {
  id: string;
  run_id: string;
  candidate_commit: string;
  command: string;
  status: Check["status"];
  exit_code: number | null;
  started_at: string;
  finished_at: string;
  log_path: string;
  log_sha256: string | null;
}

interface PolicyRow {
  revision: number;
  dispatch_paused: number;
  updated_at: string;
}

interface PublicationRequestRow {
  id: string;
  work_order_id: string;
  run_id: string;
  destination: string;
  candidate_commit: string;
  evidence_digest: string;
  policy_revision: number;
  created_at: string;
}

interface PublicationApprovalRow {
  id: string;
  request_id: string;
  approver_id: string;
  candidate_commit: string;
  evidence_digest: string;
  policy_revision: number;
  approved_at: string;
  expires_at: string;
}

interface EventRow {
  id: number;
  work_order_id: string;
  run_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
}

interface ExternalActionRow {
  id: string;
  work_order_id: string;
  run_id: string;
  kind: ExternalAction["kind"];
  state: ExternalAction["state"];
  candidate_commit: string;
  remote_identity: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const migrations = [
  `CREATE TABLE work_orders (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('defect', 'feature', 'investigation')),
    repository_path TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    acceptance_criteria_json TEXT NOT NULL CHECK (
      json_valid(acceptance_criteria_json) AND json_type(acceptance_criteria_json) = 'array'
    ),
    reproduction_command TEXT,
    check_commands_json TEXT NOT NULL CHECK (
      json_valid(check_commands_json) AND json_type(check_commands_json) = 'array'
    ),
    allowed_paths_json TEXT NOT NULL CHECK (
      json_valid(allowed_paths_json) AND json_type(allowed_paths_json) = 'array'
    ),
    worker_profile TEXT NOT NULL CHECK (worker_profile IN ('container', 'mac', 'browser')),
    state TEXT NOT NULL CHECK (state IN (
      'needs_investigation', 'awaiting_clarification', 'queued', 'planning',
      'implementing', 'verifying', 'ready_for_review', 'awaiting_approval',
      'awaiting_human_login', 'awaiting_environment', 'failed', 'interrupted', 'cancelled'
    )),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX work_orders_state_updated_idx ON work_orders(state, updated_at DESC);

  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    work_order_id TEXT NOT NULL REFERENCES work_orders(id),
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    state TEXT NOT NULL CHECK (state IN (
      'planning', 'implementing', 'verifying', 'ready_for_review',
      'failed', 'interrupted', 'cancelled'
    )),
    worker_profile TEXT NOT NULL CHECK (worker_profile IN ('container', 'mac', 'browser')),
    input_commit TEXT NOT NULL,
    candidate_commit TEXT,
    workspace_path TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    failure TEXT,
    UNIQUE (work_order_id, attempt_number),
    UNIQUE (work_order_id, id)
  ) STRICT;

  CREATE TABLE factory_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id TEXT NOT NULL REFERENCES work_orders(id),
    run_id TEXT,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (
      json_valid(payload_json) AND json_type(payload_json) = 'object'
    ),
    created_at TEXT NOT NULL,
    FOREIGN KEY (work_order_id, run_id) REFERENCES runs(work_order_id, id)
  ) STRICT;

  CREATE INDEX factory_events_order_idx ON factory_events(work_order_id, id);

  CREATE TABLE checks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    candidate_commit TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped', 'unavailable')),
    exit_code INTEGER,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    log_path TEXT NOT NULL
  ) STRICT;

  CREATE INDEX checks_run_idx ON checks(run_id, started_at, id);

  CREATE TABLE external_actions (
    id TEXT PRIMARY KEY,
    work_order_id TEXT NOT NULL REFERENCES work_orders(id),
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('push', 'draft_pr')),
    state TEXT NOT NULL CHECK (state IN ('prepared', 'dispatched', 'succeeded', 'failed', 'unknown')),
    candidate_commit TEXT NOT NULL,
    remote_identity TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (work_order_id, run_id) REFERENCES runs(work_order_id, id)
  ) STRICT;

  CREATE INDEX external_actions_order_idx ON external_actions(work_order_id, created_at, id);`,
  `ALTER TABLE work_orders ADD COLUMN expected_failure_text TEXT;`,
  `ALTER TABLE checks ADD COLUMN log_sha256 TEXT;
  CREATE TABLE factory_policy (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL CHECK (revision > 0),
    dispatch_paused INTEGER NOT NULL CHECK (dispatch_paused IN (0, 1)),
    updated_at TEXT NOT NULL
  ) STRICT;
  INSERT INTO factory_policy VALUES (1, 1, 0, CURRENT_TIMESTAMP);
  CREATE TABLE policy_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    revision INTEGER NOT NULL UNIQUE,
    dispatch_paused INTEGER NOT NULL CHECK (dispatch_paused IN (0, 1)),
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE publication_requests (
    id TEXT PRIMARY KEY,
    work_order_id TEXT NOT NULL REFERENCES work_orders(id),
    run_id TEXT NOT NULL REFERENCES runs(id),
    destination TEXT NOT NULL,
    candidate_commit TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    policy_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX publication_requests_order_idx ON publication_requests(work_order_id, created_at, id);

  CREATE TABLE publication_approvals (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE REFERENCES publication_requests(id),
    approver_id TEXT NOT NULL,
    candidate_commit TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    policy_revision INTEGER NOT NULL,
    approved_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) STRICT;`,
];

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function toJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Value must be JSON serializable");
  return json;
}

function mapWorkOrder(row: WorkOrderRow): WorkOrder {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.kind,
    repositoryPath: row.repository_path,
    baseRef: row.base_ref,
    acceptanceCriteria: parseJson<string[]>(row.acceptance_criteria_json),
    reproductionCommand: row.reproduction_command,
    expectedFailureText: row.expected_failure_text,
    checkCommands: parseJson<string[]>(row.check_commands_json),
    allowedPaths: parseJson<string[]>(row.allowed_paths_json),
    workerProfile: row.worker_profile,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): Run {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    attemptNumber: row.attempt_number,
    state: row.state,
    workerProfile: row.worker_profile,
    inputCommit: row.input_commit,
    candidateCommit: row.candidate_commit,
    workspacePath: row.workspace_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    failure: row.failure,
  };
}

function mapCheck(row: CheckRow): Check {
  return {
    id: row.id,
    runId: row.run_id,
    candidateCommit: row.candidate_commit,
    command: row.command,
    status: row.status,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    logPath: row.log_path,
    logSha256: row.log_sha256,
  };
}

function mapPolicy(row: PolicyRow): FactoryPolicy {
  return {
    revision: row.revision,
    dispatchPaused: row.dispatch_paused === 1,
    updatedAt: row.updated_at,
  };
}

function mapPublicationRequest(row: PublicationRequestRow): PublicationRequest {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    runId: row.run_id,
    destination: row.destination,
    candidateCommit: row.candidate_commit,
    evidenceDigest: row.evidence_digest,
    policyRevision: row.policy_revision,
    createdAt: row.created_at,
  };
}

function mapPublicationApproval(row: PublicationApprovalRow): PublicationApproval {
  return {
    id: row.id,
    requestId: row.request_id,
    approverId: row.approver_id,
    candidateCommit: row.candidate_commit,
    evidenceDigest: row.evidence_digest,
    policyRevision: row.policy_revision,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
  };
}

function mapEvent(row: EventRow): FactoryEvent {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    runId: row.run_id,
    type: row.type,
    payload: parseJson<Record<string, unknown>>(row.payload_json),
    createdAt: row.created_at,
  };
}

function mapExternalAction(row: ExternalActionRow): ExternalAction {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    runId: row.run_id,
    kind: row.kind,
    state: row.state,
    candidateCommit: row.candidate_commit,
    remoteIdentity: row.remote_identity,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class FactoryStorage {
  readonly #database: DatabaseSync;

  constructor(path: string, options: StorageOptions = {}) {
    if (path.length === 0) throw new TypeError("Database path must not be empty");
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs <= 0) {
      throw new RangeError("busyTimeoutMs must be a positive integer");
    }
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

    this.#database = new DatabaseSync(path, {
      timeout: busyTimeoutMs,
      enableForeignKeyConstraints: true,
    });
    try {
      this.#database.exec("PRAGMA journal_mode = WAL");
      this.#database.exec("PRAGMA foreign_keys = ON");
      this.#database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      this.#migrate();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  transaction<T>(operation: () => T): T {
    return this.#write(operation);
  }

  #write<T>(operation: () => T): T {
    if (this.#database.isTransaction) return operation();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#database.isTransaction) {
        try {
          this.#database.exec("ROLLBACK");
        } catch {
          // Preserve the original failure.
        }
      }
      throw error;
    }
  }

  #migrate(): void {
    const row = this.#database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (row.user_version > migrations.length) {
      throw new Error(`Unsupported database schema version ${row.user_version}`);
    }
    for (let index = row.user_version; index < migrations.length; index += 1) {
      this.#write(() => {
        this.#database.exec(migrations[index]);
        this.#database.exec(`PRAGMA user_version = ${index + 1}`);
      });
    }
  }

  createWorkOrder(
    input: CreateWorkOrderInput,
    state: WorkOrderState = "queued",
  ): WorkOrder {
    const timestamp = new Date().toISOString();
    const workOrder: WorkOrder = {
      ...input,
      expectedFailureText: input.expectedFailureText ?? null,
      id: randomUUID(),
      state,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#write(() => {
      this.#database.prepare(`INSERT INTO work_orders (
        id, title, description, kind, repository_path, base_ref,
        acceptance_criteria_json, reproduction_command, expected_failure_text, check_commands_json,
        allowed_paths_json, worker_profile, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        workOrder.id,
        workOrder.title,
        workOrder.description,
        workOrder.kind,
        workOrder.repositoryPath,
        workOrder.baseRef,
        toJson(workOrder.acceptanceCriteria),
        workOrder.reproductionCommand,
        workOrder.expectedFailureText,
        toJson(workOrder.checkCommands),
        toJson(workOrder.allowedPaths),
        workOrder.workerProfile,
        workOrder.state,
        workOrder.createdAt,
        workOrder.updatedAt,
      );
    });
    return workOrder;
  }

  getWorkOrder(id: string): WorkOrder | null {
    const row = this.#database.prepare("SELECT * FROM work_orders WHERE id = ?")
      .get(id) as unknown as WorkOrderRow | undefined;
    return row ? mapWorkOrder(row) : null;
  }

  listWorkOrders(): WorkOrder[] {
    const rows = this.#database.prepare(
      "SELECT * FROM work_orders ORDER BY created_at DESC, id DESC",
    ).all() as unknown as WorkOrderRow[];
    return rows.map(mapWorkOrder);
  }

  saveWorkOrder(workOrder: WorkOrder): WorkOrder {
    const saved = { ...workOrder, expectedFailureText: workOrder.expectedFailureText ?? null,
      updatedAt: new Date().toISOString() };
    this.#write(() => {
      const result = this.#database.prepare(`UPDATE work_orders SET
        title = ?, description = ?, kind = ?, repository_path = ?, base_ref = ?,
        acceptance_criteria_json = ?, reproduction_command = ?, expected_failure_text = ?, check_commands_json = ?,
        allowed_paths_json = ?, worker_profile = ?, state = ?, updated_at = ?
        WHERE id = ? AND created_at = ?`).run(
        saved.title,
        saved.description,
        saved.kind,
        saved.repositoryPath,
        saved.baseRef,
        toJson(saved.acceptanceCriteria),
        saved.reproductionCommand,
        saved.expectedFailureText,
        toJson(saved.checkCommands),
        toJson(saved.allowedPaths),
        saved.workerProfile,
        saved.state,
        saved.updatedAt,
        saved.id,
        saved.createdAt,
      );
      if (result.changes !== 1) throw new Error(`WorkOrder ${saved.id} was not found`);
    });
    return saved;
  }

  createRun(input: CreateRunInput): Run {
    return this.#write(() => {
      const row = this.#database.prepare(
        "SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt FROM runs WHERE work_order_id = ?",
      ).get(input.workOrderId) as { next_attempt: number };
      const run: Run = {
        id: randomUUID(),
        workOrderId: input.workOrderId,
        attemptNumber: row.next_attempt,
        state: input.state ?? "planning",
        workerProfile: input.workerProfile,
        inputCommit: input.inputCommit,
        candidateCommit: null,
        workspacePath: input.workspacePath,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        failure: null,
      };
      this.#database.prepare(`INSERT INTO runs (
        id, work_order_id, attempt_number, state, worker_profile, input_commit,
        candidate_commit, workspace_path, started_at, finished_at, failure
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        run.id,
        run.workOrderId,
        run.attemptNumber,
        run.state,
        run.workerProfile,
        run.inputCommit,
        run.candidateCommit,
        run.workspacePath,
        run.startedAt,
        run.finishedAt,
        run.failure,
      );
      return run;
    });
  }

  getRun(id: string): Run | null {
    const row = this.#database.prepare("SELECT * FROM runs WHERE id = ?")
      .get(id) as unknown as RunRow | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(workOrderId: string): Run[] {
    const rows = this.#database.prepare(
      "SELECT * FROM runs WHERE work_order_id = ? ORDER BY attempt_number ASC",
    ).all(workOrderId) as unknown as RunRow[];
    return rows.map(mapRun);
  }

  saveRun(run: Run): Run {
    this.#write(() => {
      const result = this.#database.prepare(`UPDATE runs SET
        state = ?, candidate_commit = ?, workspace_path = ?, finished_at = ?, failure = ?
        WHERE id = ? AND work_order_id = ? AND attempt_number = ?
          AND worker_profile = ? AND input_commit = ? AND started_at = ?`).run(
        run.state,
        run.candidateCommit,
        run.workspacePath,
        run.finishedAt,
        run.failure,
        run.id,
        run.workOrderId,
        run.attemptNumber,
        run.workerProfile,
        run.inputCommit,
        run.startedAt,
      );
      if (result.changes !== 1) throw new Error(`Run ${run.id} was not found`);
    });
    return run;
  }

  appendEvent(input: AppendEventInput): FactoryEvent {
    return this.#write(() => {
      const createdAt = new Date().toISOString();
      const result = this.#database.prepare(`INSERT INTO factory_events
        (work_order_id, run_id, type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)`).run(
        input.workOrderId,
        input.runId,
        input.type,
        toJson(input.payload),
        createdAt,
      );
      return { ...input, id: Number(result.lastInsertRowid), createdAt };
    });
  }

  listEvents(workOrderId: string, afterId = 0): FactoryEvent[] {
    const rows = this.#database.prepare(
      "SELECT * FROM factory_events WHERE work_order_id = ? AND id > ? ORDER BY id ASC",
    ).all(workOrderId, afterId) as unknown as EventRow[];
    return rows.map(mapEvent);
  }

  insertCheck(input: InsertCheckInput): Check {
    const check: Check = { ...input, id: randomUUID(), logSha256: input.logSha256 ?? null };
    this.#write(() => {
      this.#database.prepare(`INSERT INTO checks (
        id, run_id, candidate_commit, command, status, exit_code,
        started_at, finished_at, log_path, log_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        check.id,
        check.runId,
        check.candidateCommit,
        check.command,
        check.status,
        check.exitCode,
        check.startedAt,
        check.finishedAt,
        check.logPath,
        check.logSha256,
      );
    });
    return check;
  }

  listChecks(runId: string): Check[] {
    const rows = this.#database.prepare(
      "SELECT * FROM checks WHERE run_id = ? ORDER BY started_at ASC, rowid ASC",
    ).all(runId) as unknown as CheckRow[];
    return rows.map(mapCheck);
  }

  getPolicy(): FactoryPolicy {
    const row = this.#database.prepare("SELECT * FROM factory_policy WHERE singleton = 1")
      .get() as unknown as PolicyRow;
    return mapPolicy(row);
  }

  setDispatchPaused(paused: boolean, expectedRevision: number, actorId: string): FactoryPolicy {
    return this.#write(() => {
      const updatedAt = new Date().toISOString();
      const result = this.#database.prepare(`UPDATE factory_policy SET
        dispatch_paused = ?, revision = revision + 1, updated_at = ?
        WHERE singleton = 1 AND revision = ?`).run(paused ? 1 : 0, updatedAt, expectedRevision);
      if (result.changes !== 1) throw new Error("Policy revision changed");
      const policy = this.getPolicy();
      this.#database.prepare(`INSERT INTO policy_events
        (revision, dispatch_paused, actor_id, created_at) VALUES (?, ?, ?, ?)`).run(
        policy.revision, policy.dispatchPaused ? 1 : 0, actorId, updatedAt,
      );
      return policy;
    });
  }

  createPublicationRequest(input: Omit<PublicationRequest, "id" | "createdAt">): PublicationRequest {
    const request: PublicationRequest = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.#write(() => {
      this.#database.prepare(`INSERT INTO publication_requests (
        id, work_order_id, run_id, destination, candidate_commit,
        evidence_digest, policy_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        request.id, request.workOrderId, request.runId, request.destination,
        request.candidateCommit, request.evidenceDigest, request.policyRevision,
        request.createdAt,
      );
    });
    return request;
  }

  getPublicationRequest(id: string): PublicationRequest | null {
    const row = this.#database.prepare("SELECT * FROM publication_requests WHERE id = ?")
      .get(id) as unknown as PublicationRequestRow | undefined;
    return row ? mapPublicationRequest(row) : null;
  }

  listPublicationRequests(workOrderId: string): PublicationRequest[] {
    const rows = this.#database.prepare(
      "SELECT * FROM publication_requests WHERE work_order_id = ? ORDER BY created_at, rowid",
    ).all(workOrderId) as unknown as PublicationRequestRow[];
    return rows.map(mapPublicationRequest);
  }

  createPublicationApproval(input: Omit<PublicationApproval, "id" | "approvedAt">): PublicationApproval {
    const approval: PublicationApproval = {
      ...input,
      id: randomUUID(),
      approvedAt: new Date().toISOString(),
    };
    this.#write(() => {
      this.#database.prepare(`INSERT INTO publication_approvals (
        id, request_id, approver_id, candidate_commit, evidence_digest,
        policy_revision, approved_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        approval.id, approval.requestId, approval.approverId,
        approval.candidateCommit, approval.evidenceDigest, approval.policyRevision,
        approval.approvedAt, approval.expiresAt,
      );
    });
    return approval;
  }

  getPublicationApproval(requestId: string): PublicationApproval | null {
    const row = this.#database.prepare("SELECT * FROM publication_approvals WHERE request_id = ?")
      .get(requestId) as unknown as PublicationApprovalRow | undefined;
    return row ? mapPublicationApproval(row) : null;
  }

  listPublicationApprovals(workOrderId: string): PublicationApproval[] {
    const rows = this.#database.prepare(`SELECT a.* FROM publication_approvals a
      JOIN publication_requests r ON r.id = a.request_id
      WHERE r.work_order_id = ? ORDER BY a.approved_at, a.rowid`)
      .all(workOrderId) as unknown as PublicationApprovalRow[];
    return rows.map(mapPublicationApproval);
  }

  createExternalAction(input: CreateExternalActionInput): ExternalAction {
    const timestamp = new Date().toISOString();
    const action: ExternalAction = {
      ...input,
      id: randomUUID(),
      state: "prepared",
      remoteIdentity: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#write(() => {
      this.#database.prepare(`INSERT INTO external_actions (
        id, work_order_id, run_id, kind, state, candidate_commit,
        remote_identity, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        action.id,
        action.workOrderId,
        action.runId,
        action.kind,
        action.state,
        action.candidateCommit,
        action.remoteIdentity,
        action.error,
        action.createdAt,
        action.updatedAt,
      );
    });
    return action;
  }

  getExternalAction(id: string): ExternalAction | null {
    const row = this.#database.prepare("SELECT * FROM external_actions WHERE id = ?")
      .get(id) as unknown as ExternalActionRow | undefined;
    return row ? mapExternalAction(row) : null;
  }

  listExternalActions(workOrderId: string): ExternalAction[] {
    const rows = this.#database.prepare(
      "SELECT * FROM external_actions WHERE work_order_id = ? ORDER BY created_at ASC, rowid ASC",
    ).all(workOrderId) as unknown as ExternalActionRow[];
    return rows.map(mapExternalAction);
  }

  saveExternalAction(action: ExternalAction): ExternalAction {
    const saved = { ...action, updatedAt: new Date().toISOString() };
    this.#write(() => {
      const result = this.#database.prepare(`UPDATE external_actions SET
        state = ?, remote_identity = ?, error = ?, updated_at = ?
        WHERE id = ? AND work_order_id = ? AND run_id = ? AND kind = ?
          AND candidate_commit = ? AND created_at = ?`).run(
        saved.state,
        saved.remoteIdentity,
        saved.error,
        saved.updatedAt,
        saved.id,
        saved.workOrderId,
        saved.runId,
        saved.kind,
        saved.candidateCommit,
        saved.createdAt,
      );
      if (result.changes !== 1) {
        throw new Error(`ExternalAction ${saved.id} was not found`);
      }
    });
    return saved;
  }
}

export function openStorage(path: string, options?: StorageOptions): FactoryStorage {
  return new FactoryStorage(path, options);
}
