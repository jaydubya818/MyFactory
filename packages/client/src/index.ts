import { createHash } from "node:crypto";
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

  async #request<T>(path: string, body?: unknown, timeoutMs = 40_000): Promise<T> {
    const response = await fetch(`${this.#origin}/api/connect/v1/${path}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error",
      headers: { Authorization: `Bearer ${this.#token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
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

  /** Exact immutable signed result. The caller must verify the Factory key and
   * current Work binding before treating any returned bytes as candidate custody. */
  getSignedResult(workOrderId: string, runId: string): Promise<{
    issueId: string; workOrderId: string; runId: string; signedResult: string;
  }> {
    return this.#request(`work-orders/${encodeURIComponent(workOrderId)}/runs/${encodeURIComponent(runId)}/result`);
  }

  /** Bounded, resumable local readback. The signed manifest remains the source
   * of expected identity; callers must authenticate it before this call. */
  async getHostedArtifact(workOrderId: string, runId: string, expected: {
    id: string; byteLength: number; sha256: string; reference: { expiresAt: string }
  }): Promise<Buffer> {
    if (!/^(patch|log):[a-f0-9]{64}$/.test(expected.id) ||
        !Number.isSafeInteger(expected.byteLength) || expected.byteLength < 0 ||
        expected.byteLength > 128_000 || !/^[a-f0-9]{64}$/.test(expected.sha256) ||
        Date.parse(expected.reference.expiresAt) <= Date.now())
      throw new Error("Invalid or expired factory artifact reference");
    const chunks: Buffer[] = [];
    let offset = 0;
    const deadline = Date.now() + 120_000;
    while (offset < expected.byteLength || (offset === 0 && expected.byteLength === 0)) {
      let data: { artifactId: string; offset: number; byteLength: number;
        sha256: string; bytes: string; nextOffset: number } | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new Error("Factory artifact retrieval timed out");
          data = await this.#request(`work-orders/${encodeURIComponent(workOrderId)}/runs/${encodeURIComponent(runId)}/artifacts/${expected.id}?offset=${offset}`,
            undefined, Math.min(20_000, remaining));
          break;
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
      if (!data || data.artifactId !== expected.id || data.offset !== offset ||
          data.byteLength !== expected.byteLength || data.sha256 !== expected.sha256 ||
          typeof data.bytes !== "string") throw new Error("Factory artifact chunk binding failed");
      const chunk = Buffer.from(data.bytes, "base64url");
      if (chunk.toString("base64url") !== data.bytes || chunk.length > 8_000 ||
          data.nextOffset !== offset + chunk.length ||
          (chunk.length === 0 && offset !== expected.byteLength))
        throw new Error("Invalid factory artifact chunk");
      chunks.push(chunk);
      offset = data.nextOffset;
      if (expected.byteLength === 0) break;
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== expected.byteLength ||
        createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
      throw new Error("Factory artifact digest mismatch");
    return bytes;
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
