import { isAbsolute, join, posix } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { instantiateApp } from "../../../packages/app-builder/src/index.ts";
import type {
  CreateWorkOrderInput,
  FactoryEvent,
  PublicationRequest,
  Run,
  WorkKind,
  WorkerProfile,
  WorkOrder,
  WorkOrderState,
} from "../../../packages/contracts/src/index.ts";
import type { FactoryStorage } from "../../../packages/storage/src/index.ts";

export type Actor = { kind: "human" | "agent" | "system"; id: string };
export type ActionName =
  | "workorder.create" | "workorder.note.add" | "builder.create" | "signal.record" | "run.start" | "run.cancel"
  | "dispatch.set_paused" | "publication.request" | "publication.approve"
  | "publication.publish_draft";

export class ActionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    code: string,
    status = 400,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ActionContext {
  storage: FactoryStorage;
  appBuildDirectory?: string;
  confirmHumanPresence?(request: PublicationRequest): Promise<boolean>;
  startRun(workOrder: WorkOrder): Promise<Run>;
  cancelRun(workOrder: WorkOrder): Promise<Run | null>;
  notify(event: FactoryEvent): void;
}

export interface ActionDefinition {
  name: ActionName;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  actorKinds: Actor["kind"][];
  preconditions: string[];
  approval: "none" | "scoped_human";
  idempotency: string;
  auditEvent: string;
  reconciliation: string;
}

export const actionRegistry: Record<ActionName, ActionDefinition> = {
  "workorder.create": {
    name: "workorder.create",
    inputSchema: {
      type: "object",
      required: ["title", "description", "kind", "workerProfile"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        kind: { enum: ["defect", "feature", "investigation"] },
        repositoryPath: { type: "string" },
        baseRef: { type: "string" },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        reproductionCommand: { type: ["string", "null"] },
        expectedFailureText: { type: ["string", "null"] },
        checkCommands: { type: "array", items: { type: "string" } },
        allowedPaths: { type: "array", items: { type: "string" } },
        workerProfile: { enum: ["container", "mac", "browser"] },
      },
    },
    outputSchema: { type: "object", description: "A persisted WorkOrder" },
    actorKinds: ["human"],
    preconditions: ["A title and an original request are present"],
    approval: "none",
    idempotency: "A caller-supplied key will be added before connector intake",
    auditEvent: "workorder.created",
    reconciliation: "Read the WorkOrder by returned ID",
  },
  "builder.create": {
    name: "builder.create",
    inputSchema: { type: "object", required: ["templateId", "title", "brief"], properties: {
      templateId: { enum: ["feedback-hub"] }, title: { type: "string" }, brief: { type: "string" },
    } },
    outputSchema: { type: "object", description: "Scaffold artifact and linked WorkOrder" },
    actorKinds: ["human", "agent"],
    preconditions: ["Bundled template is available", "The build output directory can be created"],
    approval: "none",
    idempotency: "Each request creates a new named scaffold and WorkOrder",
    auditEvent: "builder.scaffold_created",
    reconciliation: "Read the WorkOrder event and build manifest",
  },
  "signal.record": {
    name: "signal.record",
    inputSchema: { type: "object", required: ["sourceIdentity", "title", "summary"], properties: {
      sourceIdentity: { type: "string" }, title: { type: "string" }, summary: { type: "string" },
    } },
    outputSchema: { type: "object", description: "A persisted manual signal" },
    actorKinds: ["human", "agent"],
    preconditions: ["Caller supplies a stable source identity to prevent duplicate intake"],
    approval: "none",
    idempotency: "Upsert by manual source identity",
    auditEvent: "signal.recorded",
    reconciliation: "Read Signals by source identity",
  },
  "run.start": {
    name: "run.start",
    inputSchema: {
      type: "object",
      required: ["workOrderId"],
      properties: { workOrderId: { type: "string", format: "uuid" } },
    },
    outputSchema: { type: "object", description: "A persisted Run" },
    actorKinds: ["human"],
    preconditions: [
      "WorkOrder is queued, failed, or interrupted",
      "Defects include a reproduction command and expected failure text; required checks and scope are present",
      "Attempt and concurrency limits permit a run",
    ],
    approval: "none",
    idempotency: "Reject a second start while a run is active",
    auditEvent: "run.started",
    reconciliation: "Read Runs for the WorkOrder",
  },
  "run.cancel": {
    name: "run.cancel",
    inputSchema: {
      type: "object",
      required: ["workOrderId"],
      properties: { workOrderId: { type: "string", format: "uuid" } },
    },
    outputSchema: { type: ["object", "null"], description: "The cancelled Run" },
    actorKinds: ["human"],
    preconditions: ["A run is active for this WorkOrder"],
    approval: "none",
    idempotency: "Already-cancelled work is returned without another signal",
    auditEvent: "run.cancelled",
    reconciliation: "Read current Run and WorkOrder states",
  },
  "workorder.note.add": {
    name: "workorder.note.add",
    inputSchema: { type: "object", required: ["workOrderId", "text"], properties: {
      workOrderId: { type: "string", format: "uuid" }, text: { type: "string" },
    } },
    outputSchema: { type: "object", description: "A persisted audit event" },
    actorKinds: ["human", "agent"],
    preconditions: ["WorkOrder exists", "Text is non-empty and at most 4000 characters"],
    approval: "none",
    idempotency: "Each submitted note is a separate event",
    auditEvent: "workorder.note_added",
    reconciliation: "Read ordered WorkOrder events",
  },
  "dispatch.set_paused": {
    name: "dispatch.set_paused",
    inputSchema: { type: "object", required: ["paused", "expectedRevision"], properties: {
      paused: { type: "boolean" }, expectedRevision: { type: "integer" },
    } },
    outputSchema: { type: "object", description: "The current durable policy" },
    actorKinds: ["human"],
    preconditions: ["Caller supplies the policy revision they inspected"],
    approval: "none",
    idempotency: "No revision change for a repeated value",
    auditEvent: "policy.dispatch_changed",
    reconciliation: "Read the current policy revision",
  },
  "publication.request": {
    name: "publication.request",
    inputSchema: { type: "object", required: ["workOrderId", "destination"], properties: {
      workOrderId: { type: "string", format: "uuid" }, destination: { type: "string" },
    } },
    outputSchema: { type: "object", description: "An immutable publication request" },
    actorKinds: ["human", "agent"],
    preconditions: ["Latest run has an exact candidate with all required checks and intact logs"],
    approval: "scoped_human",
    idempotency: "Equivalent live request is reused",
    auditEvent: "publication.requested",
    reconciliation: "Read request and compare live candidate, evidence, policy",
  },
  "publication.approve": {
    name: "publication.approve",
    inputSchema: { type: "object", required: ["requestId", "candidateCommit", "evidenceDigest", "policyRevision"], properties: {
      requestId: { type: "string", format: "uuid" }, candidateCommit: { type: "string" },
      evidenceDigest: { type: "string" }, policyRevision: { type: "integer" },
    } },
    outputSchema: { type: "object", description: "A time-limited human approval" },
    actorKinds: ["human"],
    preconditions: ["The reviewed candidate, evidence, and policy still match live state"],
    approval: "scoped_human",
    idempotency: "One approval per request",
    auditEvent: "publication.approved",
    reconciliation: "Read the approval and live binding",
  },
  "publication.publish_draft": {
    name: "publication.publish_draft",
    inputSchema: { type: "object", required: ["requestId"], properties: {
      requestId: { type: "string", format: "uuid" },
    } },
    outputSchema: { type: "object", description: "Draft publication result" },
    actorKinds: ["human", "system"],
    preconditions: ["Human approval is current and publication adapter is configured"],
    approval: "scoped_human",
    idempotency: "Reconcile prepared external action before remote retry",
    auditEvent: "publication.dispatched",
    reconciliation: "Inspect the provider before retrying an uncertain mutation",
  },
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ActionError("Action input must be an object", "invalid_input");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string, required = false): string {
  if (value == null && !required) return "";
  if (typeof value !== "string") {
    throw new ActionError(`${field} must be a string`, "invalid_input");
  }
  const normalized = value.trim();
  if (required && normalized.length === 0) {
    throw new ActionError(`${field} is required`, "invalid_input");
  }
  return normalized;
}

function stringArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ActionError(`${field} must be a list of strings`, "invalid_input");
  }
  return value.map((item: string) => item.trim()).filter(Boolean);
}

function parseCreateInput(value: unknown): CreateWorkOrderInput {
  const input = asObject(value);
  const kind = stringValue(input.kind, "kind", true) as WorkKind;
  const workerProfile = stringValue(input.workerProfile, "workerProfile", true) as WorkerProfile;
  if (!["defect", "feature", "investigation"].includes(kind)) {
    throw new ActionError("kind is not supported", "invalid_input");
  }
  if (!["container", "mac", "browser"].includes(workerProfile)) {
    throw new ActionError("workerProfile is not supported", "invalid_input");
  }

  const repositoryPath = stringValue(input.repositoryPath, "repositoryPath");
  if (repositoryPath && !isAbsolute(repositoryPath)) {
    throw new ActionError("repositoryPath must be absolute", "invalid_input");
  }
  const allowedPaths = stringArray(input.allowedPaths, "allowedPaths");
  for (const allowedPath of allowedPaths) {
    const normalized = posix.normalize(allowedPath.replaceAll("\\", "/"));
    if (
      allowedPath.startsWith("/") ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized === "." ||
      normalized.split("/").includes(".git")
    ) {
      throw new ActionError(`Unsafe allowed path: ${allowedPath}`, "invalid_input");
    }
  }

  return {
    title: stringValue(input.title, "title", true),
    description: stringValue(input.description, "description", true),
    kind,
    repositoryPath,
    baseRef: stringValue(input.baseRef, "baseRef"),
    acceptanceCriteria: stringArray(input.acceptanceCriteria, "acceptanceCriteria"),
    reproductionCommand: input.reproductionCommand == null
      ? null
      : stringValue(input.reproductionCommand, "reproductionCommand"),
    expectedFailureText: input.expectedFailureText == null
      ? null
      : stringValue(input.expectedFailureText, "expectedFailureText"),
    checkCommands: stringArray(input.checkCommands, "checkCommands"),
    allowedPaths,
    workerProfile,
  };
}

export function admissionState(input: CreateWorkOrderInput): WorkOrderState {
  if (!input.repositoryPath || !input.baseRef) return "awaiting_environment";
  if (input.acceptanceCriteria.length === 0) return "awaiting_clarification";
  if (input.kind === "defect" && (!input.reproductionCommand || !input.expectedFailureText)) {
    return "needs_investigation";
  }
  if (input.checkCommands.length === 0 || input.allowedPaths.length === 0) {
    return "awaiting_clarification";
  }
  if (input.workerProfile !== "mac") return "awaiting_environment";
  return "queued";
}

function workOrderId(value: unknown): string {
  const id = stringValue(asObject(value).workOrderId, "workOrderId", true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ActionError("workOrderId must be a UUID", "invalid_input");
  }
  return id;
}

function uuidValue(value: unknown, field: string): string {
  const id = stringValue(value, field, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ActionError(`${field} must be a UUID`, "invalid_input");
  }
  return id;
}

function currentPublicationEvidence(storage: FactoryStorage, requestWorkOrderId: string) {
  const order = storage.getWorkOrder(requestWorkOrderId);
  if (!order) throw new ActionError("WorkOrder not found", "not_found", 404);
  const run = storage.listRuns(order.id).at(-1);
  if (!run || run.state !== "ready_for_review" || order.state !== "ready_for_review" || !run.candidateCommit) {
    throw new ActionError("The latest run is not ready for review", "not_ready", 409);
  }
  const committed = storage.listEvents(order.id)
    .filter((event) => event.runId === run.id && event.type === "run.candidate_committed" &&
      event.payload.candidateCommit === run.candidateCommit).at(-1);
  if (!committed || typeof committed.payload.diffPath !== "string" ||
      typeof committed.payload.diffSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(committed.payload.diffSha256)) {
    throw new ActionError("Candidate diff evidence is incomplete", "evidence_incomplete", 409);
  }
  try {
    const observedDiff = createHash("sha256")
      .update(readFileSync(committed.payload.diffPath)).digest("hex");
    if (observedDiff !== committed.payload.diffSha256) {
      throw new ActionError("Candidate diff changed since it was recorded", "evidence_stale", 409);
    }
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError("Candidate diff is unavailable", "evidence_stale", 409);
  }
  const checks = storage.listChecks(run.id);
  const required = order.kind === "defect" && order.reproductionCommand
    ? [...new Set([order.reproductionCommand, ...order.checkCommands])]
    : order.checkCommands;
  if (checks.length !== required.length ||
      required.some((command, index) => checks[index]?.command !== command)) {
    throw new ActionError("Required verification evidence is incomplete", "evidence_incomplete", 409);
  }
  for (const check of checks) {
    if (check.candidateCommit !== run.candidateCommit || check.status !== "passed" ||
        check.exitCode !== 0 || !check.logSha256) {
      throw new ActionError("Verification evidence does not pass for this candidate", "evidence_incomplete", 409);
    }
    let observed: string;
    try {
      observed = createHash("sha256").update(readFileSync(check.logPath)).digest("hex");
    } catch {
      throw new ActionError("Verification log is unavailable", "evidence_stale", 409);
    }
    if (observed !== check.logSha256) {
      throw new ActionError("Verification log changed since it was recorded", "evidence_stale", 409);
    }
  }
  const evidenceDigest = createHash("sha256").update(JSON.stringify({
    diffSha256: committed.payload.diffSha256,
    checks: checks.map((check) => ({
      id: check.id,
      candidateCommit: check.candidateCommit,
      command: check.command,
      status: check.status,
      exitCode: check.exitCode,
      logSha256: check.logSha256,
    })),
  })).digest("hex");
  return { order, run, evidenceDigest, policyRevision: storage.getPolicy().revision };
}

function currentRequestBinding(storage: FactoryStorage, request: PublicationRequest) {
  const latest = storage.listRuns(request.workOrderId).at(-1);
  if (!latest || latest.id !== request.runId || latest.candidateCommit !== request.candidateCommit) {
    throw new ActionError("Candidate changed since publication was requested", "candidate_stale", 409);
  }
  if (storage.getPolicy().revision !== request.policyRevision) {
    throw new ActionError("Policy changed since publication was requested", "policy_stale", 409);
  }
  const current = currentPublicationEvidence(storage, request.workOrderId);
  if (current.evidenceDigest !== request.evidenceDigest) {
    throw new ActionError("Evidence changed since publication was requested", "evidence_stale", 409);
  }
  if (current.policyRevision !== request.policyRevision) {
    throw new ActionError("Policy changed since publication was requested", "policy_stale", 409);
  }
  return current;
}

export async function performAction(
  context: ActionContext,
  action: string,
  rawInput: unknown,
  actor: Actor,
): Promise<unknown> {
  const definition = actionRegistry[action as ActionName];
  if (!definition) throw new ActionError("Unknown action", "unknown_action", 404);
  if (!definition.actorKinds.includes(actor.kind)) {
    throw new ActionError("This actor cannot perform that action", "forbidden", 403);
  }

  if (action === "dispatch.set_paused") {
    const input = asObject(rawInput);
    if (typeof input.paused !== "boolean" || !Number.isSafeInteger(input.expectedRevision)) {
      throw new ActionError("paused and expectedRevision are required", "invalid_input");
    }
    const current = context.storage.getPolicy();
    if (current.revision !== input.expectedRevision) {
      throw new ActionError("Policy revision changed", "policy_stale", 409);
    }
    if (current.dispatchPaused === input.paused) return current;
    try {
      return context.storage.setDispatchPaused(input.paused, current.revision, actor.id);
    } catch (error) {
      if (error instanceof Error && error.message === "Policy revision changed") {
        throw new ActionError(error.message, "policy_stale", 409);
      }
      throw error;
    }
  }

  if (action === "publication.approve" || action === "publication.publish_draft") {
    const input = asObject(rawInput);
    const requestId = uuidValue(input.requestId, "requestId");
    const request = context.storage.getPublicationRequest(requestId);
    if (!request) throw new ActionError("Publication request not found", "not_found", 404);
    const current = currentRequestBinding(context.storage, request);
    if (action === "publication.approve") {
      const candidateCommit = stringValue(input.candidateCommit, "candidateCommit", true);
      const evidenceDigest = stringValue(input.evidenceDigest, "evidenceDigest", true);
      const policyRevision = input.policyRevision;
      if (!Number.isSafeInteger(policyRevision) || policyRevision !== request.policyRevision ||
          candidateCommit !== request.candidateCommit || evidenceDigest !== request.evidenceDigest) {
        throw new ActionError("Reviewed publication inputs do not match the live request", "review_mismatch", 409);
      }
      const existing = context.storage.getPublicationApproval(requestId);
      if (existing) return existing;
      if (!context.confirmHumanPresence) {
        throw new ActionError("Human presence verification is unavailable", "approval_unavailable", 503);
      }
      if (!(await context.confirmHumanPresence(request))) {
        throw new ActionError("Human presence was not confirmed; approval was not recorded", "approval_denied", 409);
      }
      const { approval, event } = context.storage.transaction(() => {
        currentRequestBinding(context.storage, request);
        const approval = context.storage.createPublicationApproval({
          requestId,
          approverId: actor.id,
          candidateCommit,
          evidenceDigest,
          policyRevision,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
        const event = context.storage.appendEvent({
          workOrderId: request.workOrderId, runId: request.runId,
          type: "publication.approved", payload: { requestId, approvalId: approval.id, actor: actor.id },
        });
        return { approval, event };
      });
      context.notify(event);
      return approval;
    }
    const approval = context.storage.getPublicationApproval(requestId);
    if (!approval) throw new ActionError("A human must approve this exact request", "approval_required", 409);
    if (approval.candidateCommit !== current.run.candidateCommit ||
        approval.evidenceDigest !== current.evidenceDigest ||
        approval.policyRevision !== current.policyRevision ||
        Date.parse(approval.expiresAt) <= Date.now()) {
      throw new ActionError("Publication approval is stale or expired", "approval_stale", 409);
    }
    throw new ActionError("GitHub draft publication is not configured yet", "publication_unavailable", 503);
  }

  if (action === "workorder.create") {
    const input = parseCreateInput(rawInput);
    const state = admissionState(input);
    const { workOrder, event } = context.storage.transaction(() => {
      const workOrder = context.storage.createWorkOrder(input, state);
      const event = context.storage.appendEvent({
        workOrderId: workOrder.id,
        runId: null,
        type: "workorder.created",
        payload: { actor: actor.id, state },
      });
      return { workOrder, event };
    });
    context.notify(event);
    return workOrder;
  }

  if (action === "builder.create") {
    const input = asObject(rawInput);
    const templateId = stringValue(input.templateId, "templateId", true);
    if (templateId !== "feedback-hub") throw new ActionError("Unknown app template", "invalid_input");
    const title = stringValue(input.title, "title", true);
    const brief = stringValue(input.brief, "brief", true);
    if (title.length > 80 || brief.length > 10_000) {
      throw new ActionError("Title or brief is too long", "invalid_input");
    }
    if (!context.appBuildDirectory) {
      throw new ActionError("App builder output is not configured", "awaiting_environment", 503);
    }
    mkdirSync(context.appBuildDirectory, { recursive: true, mode: 0o700 });
    const build = instantiateApp({
      templateId,
      taskDirectory: context.appBuildDirectory,
      outputName: `feedback-hub-${randomUUID()}`,
      productBrief: { name: title, description: brief },
    });
    try {
      const { workOrder, event } = context.storage.transaction(() => {
        const workOrder = context.storage.createWorkOrder({
          title, description: brief, kind: "feature", repositoryPath: build.outputDir,
          baseRef: "", acceptanceCriteria: [
            "Inbox and detail views implement the product brief",
            "The UI and agent use the same typed actions",
            "Template tests and production build pass",
          ],
          reproductionCommand: null, expectedFailureText: null,
          checkCommands: ["npm test", "npm run build"],
          allowedPaths: ["src/**", "server/**", "scripts/**", "tests/**", "app.json",
            "AGENTS.md", "README.md", "package.json", "package-lock.json", "vite.config.ts",
            "tsconfig.json", "index.html", ".gitignore"],
          workerProfile: "mac",
        }, "awaiting_environment");
        const event = context.storage.appendEvent({
          workOrderId: workOrder.id, runId: null, type: "builder.scaffold_created",
          payload: {
            actor: actor.id, artifactPath: build.outputDir, manifestPath: build.manifestPath,
            templateId: build.template.id, templateVersion: build.template.version,
            templateSha256: build.template.sha256, fileCount: build.files.length,
            nextStep: "Prepare Node 24 dependencies and independent verification before candidate review",
          },
        });
        return { workOrder, event };
      });
      context.notify(event);
      return { workOrder, artifactPath: build.outputDir, manifestPath: build.manifestPath,
        templateVersion: build.template.version, templateSha256: build.template.sha256, files: build.files };
    } catch (error) {
      rmSync(build.outputDir, { recursive: true, force: true });
      throw error;
    }
  }

  if (action === "signal.record") {
    const input = asObject(rawInput);
    const sourceIdentity = stringValue(input.sourceIdentity, "sourceIdentity", true);
    const title = stringValue(input.title, "title", true);
    const summary = stringValue(input.summary, "summary", true);
    if (sourceIdentity.length > 160 || title.length > 200 || summary.length > 10_000) {
      throw new ActionError("Signal fields are too long", "invalid_input");
    }
    return context.storage.upsertSignal({
      source: "manual", sourceIdentity, sourceRevision: null, sourceUrl: null,
      title, summary, provenance: { actor: actor.id, actorKind: actor.kind },
      evidence: {}, coverage: "partial", coverageDetail: "Manual report; reproduction and coverage have not been verified",
    });
  }

  const id = workOrderId(rawInput);
  const workOrder = context.storage.getWorkOrder(id);
  if (!workOrder) throw new ActionError("WorkOrder not found", "not_found", 404);

  if (action === "workorder.note.add") {
    const text = stringValue(asObject(rawInput).text, "text", true);
    if (text.length > 4_000) throw new ActionError("Note is too long", "invalid_input");
    const event = context.storage.appendEvent({
      workOrderId: id, runId: null, type: "workorder.note_added",
      payload: { text, actor: actor.id, actorKind: actor.kind },
    });
    context.notify(event);
    return event;
  }

  if (action === "publication.request") {
    const destination = stringValue(asObject(rawInput).destination, "destination", true);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(destination)) {
      throw new ActionError("destination must be owner/repo", "invalid_input");
    }
    const current = currentPublicationEvidence(context.storage, id);
    const existing = context.storage.listPublicationRequests(id).findLast((request) =>
      request.destination === destination && request.runId === current.run.id &&
      request.candidateCommit === current.run.candidateCommit &&
      request.evidenceDigest === current.evidenceDigest &&
      request.policyRevision === current.policyRevision &&
      !context.storage.getPublicationApproval(request.id));
    if (existing) return existing;
    const { request, event } = context.storage.transaction(() => {
      const live = currentPublicationEvidence(context.storage, id);
      const request = context.storage.createPublicationRequest({
        workOrderId: id, runId: live.run.id, destination,
        candidateCommit: live.run.candidateCommit!, evidenceDigest: live.evidenceDigest,
        policyRevision: live.policyRevision,
      });
      const event = context.storage.appendEvent({
        workOrderId: id, runId: live.run.id, type: "publication.requested",
        payload: { requestId: request.id, destination, actor: actor.id, candidateCommit: request.candidateCommit },
      });
      return { request, event };
    });
    context.notify(event);
    return request;
  }

  if (action === "run.start") {
    if (context.storage.getPolicy().dispatchPaused) {
      throw new ActionError("Dispatch is paused", "dispatch_paused", 409);
    }
    if (!["queued", "failed", "interrupted", "awaiting_environment"].includes(workOrder.state)) {
      throw new ActionError(`WorkOrder is ${workOrder.state}`, "not_ready", 409);
    }
    const missingState = admissionState(workOrder);
    if (missingState !== "queued") {
      throw new ActionError(`WorkOrder requires ${missingState}`, "not_ready", 409);
    }
    if (context.storage.listRuns(id).length >= 2) {
      throw new ActionError("Attempt limit reached", "attempt_limit", 409);
    }
    return context.startRun(workOrder);
  }

  return context.cancelRun(workOrder);
}
