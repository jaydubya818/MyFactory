import type {
  CreateWorkOrderInput,
  FactoryPolicy,
  FactoryEvent,
  PublicationApproval,
  PublicationRequest,
  WorkOrder,
  WorkOrderDetail,
} from "@factory/contracts";

type ActionName = "workorder.create" | "run.start" | "run.cancel" | "builder.create" |
  "builder.preview.start" | "builder.preview.stop" | "dispatch.set_paused" |
  "publication.request" | "publication.approve" | "publication.publish_draft";

export interface TextEvidence {
  available: boolean;
  text: string | null;
}

export interface BuilderTemplate {
  id: string;
  name: string;
  version: string;
  description: string;
}

export interface BuilderCreateInput {
  templateId: string;
  title: string;
  brief: string;
}

export interface BuilderCreateResult {
  workOrder: WorkOrder;
  artifactPath: string;
  manifestPath: string;
  templateVersion: string;
}

export interface PreviewStatus {
  status: "not_started" | "building" | "running" | "failed" | "stopped" | "interrupted";
  url: string | null;
  lastEvent: { type: string; createdAt: string; payload: Record<string, unknown> | null } | null;
}

export interface PreviewActionResult {
  status: "building" | "running" | "failed" | "stopped";
  url?: string;
  error?: string;
}

let sessionTokenRequest: Promise<string> | null = null;

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (record.error && typeof record.error === "object") {
      const detail = record.error as Record<string, unknown>;
      if (typeof detail.message === "string") return detail.message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return `Request failed (${status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("The local service is unavailable. Check that it is running, then retry.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      response.ok
        ? "The local service returned an unreadable response."
        : `Request failed (${response.status}).`,
    );
  }

  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return body as T;
}

export async function getWorkOrders(): Promise<WorkOrder[]> {
  const data = await request<{ workOrders: WorkOrder[] }>("/api/work-orders");
  if (!Array.isArray(data.workOrders)) {
    throw new Error("The local service returned an invalid work queue.");
  }
  return data.workOrders;
}

export async function getWorkOrderDetail(id: string): Promise<WorkOrderDetail> {
  const data = await request<WorkOrderDetail>(`/api/work-orders/${encodeURIComponent(id)}`);
  if (!data || !data.workOrder || !Array.isArray(data.runs) || !Array.isArray(data.checks) || !Array.isArray(data.events) || !Array.isArray(data.externalActions)) {
    throw new Error("The local service returned invalid work order details.");
  }
  return data;
}

export async function getBuilderTemplates(): Promise<BuilderTemplate[]> {
  const data = await request<{ templates: BuilderTemplate[] }>("/api/app-builder/templates");
  if (!Array.isArray(data.templates) || data.templates.some((template) =>
    !template || typeof template.id !== "string" || typeof template.name !== "string" ||
    typeof template.version !== "string" || typeof template.description !== "string"
  )) {
    throw new Error("The local service returned invalid App builder templates.");
  }
  return data.templates;
}

export async function getPolicy(): Promise<FactoryPolicy> {
  const data = await request<{ policy: FactoryPolicy }>("/api/policy");
  if (!data?.policy || typeof data.policy.revision !== "number" || typeof data.policy.dispatchPaused !== "boolean") {
    throw new Error("The local service returned an invalid dispatch policy.");
  }
  return data.policy;
}

async function textEvidence(path: string): Promise<TextEvidence> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", credentials: "same-origin", headers: { Accept: "text/plain" } });
  } catch {
    throw new Error("The local service is unavailable. Check that it is running, then retry.");
  }
  if (response.status === 404) return { available: false, text: null };
  if (!response.ok) throw new Error(`Evidence request failed (${response.status}).`);
  return { available: true, text: await response.text() };
}

export function getWorkOrderDiff(workOrderId: string): Promise<TextEvidence> {
  return textEvidence(`/api/work-orders/${encodeURIComponent(workOrderId)}/diff`);
}

export function getCheckLog(workOrderId: string, checkId: string): Promise<TextEvidence> {
  return textEvidence(`/api/work-orders/${encodeURIComponent(workOrderId)}/checks/${encodeURIComponent(checkId)}/log`);
}

export async function getPreviewStatus(workOrderId: string): Promise<PreviewStatus> {
  const data = await request<PreviewStatus>(`/api/work-orders/${encodeURIComponent(workOrderId)}/preview`);
  if (!data || !["not_started", "building", "running", "failed", "stopped", "interrupted"].includes(data.status) ||
      (data.url !== null && typeof data.url !== "string")) {
    throw new Error("The local service returned an invalid preview status.");
  }
  return data;
}

export function getPreviewLog(workOrderId: string): Promise<TextEvidence> {
  return textEvidence(`/api/work-orders/${encodeURIComponent(workOrderId)}/preview/log`);
}

async function sessionToken(): Promise<string> {
  if (!sessionTokenRequest) {
    sessionTokenRequest = request<{ token: string }>("/api/session").then((session) => {
      if (!session || typeof session.token !== "string" || !session.token) {
        throw new Error("The local service did not provide a session token.");
      }
      return session.token;
    });
  }
  return sessionTokenRequest;
}

async function authenticatedPost<T>(path: string, body: unknown): Promise<T> {
  try {
    const token = await sessionToken();
    return await request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Factory-Token": token },
      body: JSON.stringify(body),
    });
  } catch (error) {
    sessionTokenRequest = null;
    throw error;
  }
}

export async function sendAction<T = unknown>(
  action: ActionName,
  input: CreateWorkOrderInput | { workOrderId: string } | BuilderCreateInput |
    { paused: boolean; expectedRevision: number } |
    { workOrderId: string; destination: string } |
    { requestId: string; candidateCommit: string; evidenceDigest: string; policyRevision: number } |
    { requestId: string },
): Promise<T> {
  const data = await authenticatedPost<{ result: T }>("/api/actions", { action, input });
  if (!data || !("result" in data)) {
    throw new Error("The local service did not return an action result.");
  }
  return data.result;
}

export type { FactoryPolicy, FactoryEvent, PublicationApproval, PublicationRequest };
