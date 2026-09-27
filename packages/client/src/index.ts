import type { CreateWorkOrderInput, FactoryEvent, LinearLink, PublicationRequest, WorkOrder, WorkOrderDetail } from "../../contracts/src/index.ts";
import type { SignedResult } from "../../hosted-routing/src/result.ts";

export type ConnectedExecutionState = "PREPARED" | "STARTING" | "RUNNING" | "STOPPING" |
  "UNKNOWN" | "COMPLETED" | "FAILED" | "CANCELLED" | "FENCED";
export interface ConnectedExecutionReadback {
  dispatchOperationId:string;clientId:string;factoryId:string;factoryVersion:string;
  requestId:string;workOrderId:string;workDigest:string;policyRevision:number;
  deadline:string;state:ConnectedExecutionState;runId:string|null;attemptNumber:number|null;
  createdAt:string;startedAt:string|null;stopRequestedAt:string|null;terminalAt:string|null;
  resultManifestDigest:string|null;resultUrl:string|null;quiescent:boolean;
}
export interface ConnectedExecutionPrepare {
  dispatchOperationId:string;requestId:string;workOrderId:string;
  factoryId:string;factoryVersion:string;deadline:string;
}

/** Backend client for approved apps on the same host. Never put the token in browser code. */
export class FactoryClient {
  readonly #origin: string;
  readonly #token: string;

  constructor(options: { origin: string; token: string }) {
    const url = new URL(options.origin);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Factory client origin must be a loopback HTTP origin");
    }
    if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error("Invalid factory connection token");
    this.#origin = url.origin;
    this.#token = options.token;
  }

  async #request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.#origin}/api/connect/v1/${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { Authorization: `Bearer ${this.#token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(40_000),
    });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? `Factory request failed (${response.status})`);
    return data;
  }

  async #action<T>(action: string, input: unknown): Promise<T> {
    return (await this.#request<{ result: T }>("actions", { action, input })).result;
  }

  async listWorkOrders(): Promise<WorkOrder[]> {
    return (await this.#request<{ workOrders: WorkOrder[] }>("work-orders")).workOrders;
  }

  getWorkOrder(id: string): Promise<WorkOrderDetail> {
    return this.#request(`work-orders/${encodeURIComponent(id)}`);
  }

  /** Read one exact producer attempt. This never starts or retries execution. */
  getRunResult(workOrderId: string, runId: string): Promise<{
    state: "COMPLETED" | "FAILED" | "CANCELLED" | "RUNNING" | "STOPPING" | "UNKNOWN";
    result: SignedResult | null;
  }> {
    return this.#request(`work-orders/${encodeURIComponent(workOrderId)}/runs/${encodeURIComponent(runId)}/result`);
  }

  getExecutionVersion(workOrderId:string):Promise<{
    factoryId:string;factoryVersion:string;model:string;executorVersion:string;
    workOrderId:string;workDigest:string;policyRevision:number;
  }> {
    return this.#request(`work-orders/${encodeURIComponent(workOrderId)}/execution-version`);
  }

  prepareExecution(input:ConnectedExecutionPrepare):Promise<ConnectedExecutionReadback> {
    return this.#request("executions",input);
  }

  startExecution(dispatchOperationId:string):Promise<ConnectedExecutionReadback> {
    return this.#request(`executions/${encodeURIComponent(dispatchOperationId)}/start`,{});
  }

  readExecution(dispatchOperationId:string):Promise<ConnectedExecutionReadback> {
    return this.#request(`executions/${encodeURIComponent(dispatchOperationId)}`);
  }

  stopExecution(dispatchOperationId:string):Promise<ConnectedExecutionReadback> {
    return this.#request(`executions/${encodeURIComponent(dispatchOperationId)}/stop`,{});
  }

  createWorkOrder(input: CreateWorkOrderInput & { idempotencyKey: string }): Promise<WorkOrder> {
    return this.#action("workorder.create", input);
  }

  addNote(workOrderId: string, text: string): Promise<FactoryEvent> {
    return this.#action("workorder.note.add", { workOrderId, text });
  }

  syncToLinear(workOrderId: string): Promise<LinearLink> {
    return this.#action("linear.sync", { workOrderId });
  }

  requestPublication(workOrderId: string, destination: string): Promise<PublicationRequest> {
    return this.#action("publication.request", { workOrderId, destination });
  }
}
