export type WorkKind = "defect" | "feature" | "investigation";

export type WorkerProfile = "container" | "mac" | "browser";

export type WorkOrderState =
  | "needs_investigation"
  | "awaiting_clarification"
  | "queued"
  | "planning"
  | "implementing"
  | "verifying"
  | "ready_for_review"
  | "awaiting_approval"
  | "awaiting_human_login"
  | "awaiting_environment"
  | "failed"
  | "interrupted"
  | "cancelled";

export type RunState =
  | "planning"
  | "implementing"
  | "verifying"
  | "ready_for_review"
  | "failed"
  | "interrupted"
  | "cancelled";

export interface CreateWorkOrderInput {
  idempotencyKey?: string;
  syncToLinear?: boolean;
  title: string;
  description: string;
  kind: WorkKind;
  repositoryPath: string;
  baseRef: string;
  acceptanceCriteria: string[];
  reproductionCommand: string | null;
  expectedFailureText: string | null;
  checkCommands: string[];
  allowedPaths: string[];
  workerProfile: WorkerProfile;
}

export interface WorkOrder extends CreateWorkOrderInput {
  id: string;
  state: WorkOrderState;
  createdAt: string;
  updatedAt: string;
}

export type SignalCoverage = "complete" | "partial" | "unavailable";

export interface Signal {
  id: string;
  source: string;
  sourceIdentity: string;
  sourceRevision: string | null;
  sourceUrl: string | null;
  title: string;
  summary: string;
  provenance: Record<string, unknown>;
  evidence: Record<string, unknown>;
  coverage: SignalCoverage;
  coverageDetail: string | null;
  workOrderId: string | null;
  firstSeenAt: string;
  updatedAt: string;
}

export type ReleaseStage = "beta" | "production";
export type ReleaseStatus = "candidate" | "deployed" | "failed" | "rolled_back";

export interface Release {
  id: string;
  target: string;
  sourceCommit: string;
  artifactIdentity: string;
  stage: ReleaseStage;
  status: ReleaseStatus;
  policyRevision: number;
  previousKnownGoodArtifactIdentity: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  workOrderId: string;
  attemptNumber: number;
  state: RunState;
  workerProfile: WorkerProfile;
  inputCommit: string;
  candidateCommit: string | null;
  workspacePath: string;
  startedAt: string;
  finishedAt: string | null;
  failure: string | null;
}

export type CheckStatus = "passed" | "failed" | "skipped" | "unavailable";

export interface Check {
  id: string;
  runId: string;
  candidateCommit: string;
  command: string;
  status: CheckStatus;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  logPath: string;
  logSha256: string | null;
}

export interface FactoryPolicy {
  revision: number;
  dispatchPaused: boolean;
  updatedAt: string;
}

export interface PublicationRequest {
  id: string;
  workOrderId: string;
  runId: string;
  destination: string;
  candidateCommit: string;
  evidenceDigest: string;
  policyRevision: number;
  createdAt: string;
}

export interface PublicationApproval {
  id: string;
  requestId: string;
  approverId: string;
  candidateCommit: string;
  evidenceDigest: string;
  policyRevision: number;
  approvedAt: string;
  expiresAt: string;
}

export interface FactoryEvent {
  id: number;
  workOrderId: string;
  runId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type ExternalActionState =
  | "prepared"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "unknown";

export interface ExternalAction {
  id: string;
  workOrderId: string;
  runId: string;
  kind: "push" | "draft_pr";
  state: ExternalActionState;
  candidateCommit: string;
  publicationRequestId: string | null;
  destination: string | null;
  remoteIdentity: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderDetail {
  workOrder: WorkOrder;
  runs: Run[];
  checks: Check[];
  events: FactoryEvent[];
  externalActions: ExternalAction[];
  publicationRequests: PublicationRequest[];
  publicationApprovals: PublicationApproval[];
  linearLink?: LinearLink | null;
}

export interface LinearLink {
  workOrderId: string;
  issueId: string;
  teamId: string;
  projectId: string | null;
  state: "pending" | "syncing" | "synced" | "unknown";
  identifier: string | null;
  url: string | null;
  error: string | null;
  updatedAt: string;
}

export interface ConnectionStatus {
  linear: {
    configured: boolean;
    mode: "manual" | "automatic";
    teamId: string | null;
    projectId: string | null;
  };
  clients: { id: string; name: string; actions: string[]; repositoryPaths: string[] }[];
}
