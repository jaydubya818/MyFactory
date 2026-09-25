import type { FactoryWorkOrdersResponse, FactoryPublicationRequest, WorkOrderDetail, FactoryEvent, FactoryPolicy, FactoryManifestResult, FactoryBuildManifest } from "../../shared/factory-types";

type AgentAction = "workorder.note.add" | "publication.request";

function supervisorOrigin(): string {
  // guard:allow-env-credential — This is a non-secret local service address, validated as loopback below.
  const configured = process.env.FACTORY_SUPERVISOR_URL ?? "http://127.0.0.1:8787";
  const url = new URL(configured);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("FACTORY_SUPERVISOR_URL must be a loopback HTTP origin.");
  }
  return url.origin;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : `Factory supervisor request failed (${response.status}).`;
    throw new Error(message);
  }
  if (!body || typeof body !== "object") throw new Error("Factory supervisor returned an invalid response.");
  return body as T;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, supervisorOrigin()), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return jsonResponse<T>(response);
}

export async function listFactoryWorkOrders(): Promise<FactoryWorkOrdersResponse> {
  const result = await get<Pick<FactoryWorkOrdersResponse, "workOrders">>("/api/work-orders");
  if (!Array.isArray(result.workOrders)) throw new Error("Factory supervisor returned an invalid work queue.");
  return { ...result, supervisorUiOrigin: supervisorOrigin() };
}

export async function getFactoryPolicy(): Promise<FactoryPolicy> {
  const result = await get<{ policy: FactoryPolicy }>("/api/policy");
  if (!result.policy || typeof result.policy.revision !== "number" || typeof result.policy.dispatchPaused !== "boolean") {
    throw new Error("Factory supervisor returned an invalid policy.");
  }
  return result.policy;
}

export async function getFactoryWorkOrder(workOrderId: string): Promise<WorkOrderDetail> {
  const result = await get<WorkOrderDetail>(`/api/work-orders/${encodeURIComponent(workOrderId)}`);
  if (!result.workOrder || !Array.isArray(result.runs) || !Array.isArray(result.checks) || !Array.isArray(result.events) || !Array.isArray(result.externalActions) || !Array.isArray(result.publicationRequests) || !Array.isArray(result.publicationApprovals)) {
    throw new Error("Factory supervisor returned invalid work order details.");
  }
  return result;
}

export interface FactoryTextArtifact {
  available: boolean;
  text: string | null;
  reason: string | null;
}

async function textArtifact(path: string): Promise<FactoryTextArtifact> {
  const response = await fetch(new URL(path, supervisorOrigin()), {
    headers: { Accept: "text/plain" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) {
    return { available: false, text: null, reason: "The recorded artifact is unavailable." };
  }
  if (!response.ok) {
    throw new Error(`Factory evidence request failed (${response.status}).`);
  }
  return { available: true, text: await response.text(), reason: null };
}

export function getFactoryDiff(workOrderId: string): Promise<FactoryTextArtifact> {
  return textArtifact(`/api/work-orders/${encodeURIComponent(workOrderId)}/diff`);
}

export function getFactoryCheckLog(workOrderId: string, checkId: string): Promise<FactoryTextArtifact> {
  return textArtifact(`/api/work-orders/${encodeURIComponent(workOrderId)}/checks/${encodeURIComponent(checkId)}/log`);
}

export async function getFactoryBuildManifest(workOrderId: string): Promise<FactoryManifestResult> {
  const response = await fetch(new URL(`/api/work-orders/${encodeURIComponent(workOrderId)}/build-manifest`, supervisorOrigin()), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return { available: false, manifest: null };
  const manifest = await jsonResponse<FactoryBuildManifest>(response);
  if (!manifest.template || !Array.isArray(manifest.files)) throw new Error("Factory supervisor returned an invalid build manifest.");
  return { available: true, manifest };
}

async function agentAction<T>(action: AgentAction, input: unknown): Promise<T> {
  const origin = supervisorOrigin();
  const sessionResponse = await fetch(new URL("/api/session", origin), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const session = await jsonResponse<{ token: string }>(sessionResponse);
  if (typeof session.token !== "string" || !session.token) throw new Error("Factory supervisor did not provide a session token.");
  const response = await fetch(new URL("/api/agent/actions", origin), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Factory-Token": session.token,
      Origin: origin,
    },
    body: JSON.stringify({ action, input }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await jsonResponse<{ result: T }>(response);
  if (!("result" in result)) throw new Error("Factory supervisor did not return an action result.");
  return result.result;
}

export function addFactoryNote(workOrderId: string, text: string): Promise<FactoryEvent> {
  return agentAction<FactoryEvent>("workorder.note.add", { workOrderId, text });
}

export function requestFactoryPublication(workOrderId: string, destination: string): Promise<FactoryPublicationRequest> {
  return agentAction<FactoryPublicationRequest>("publication.request", { workOrderId, destination });
}
