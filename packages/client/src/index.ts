import type { CreateWorkOrderInput, FactoryEvent, LinearLink, PublicationRequest, WorkOrder, WorkOrderDetail } from "../../contracts/src/index.ts";

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
