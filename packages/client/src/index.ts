import type { CreateWorkOrderInput, FactoryEvent, LinearLink, PublicationRequest, WorkOrder, WorkOrderDetail } from "../../contracts/src/index.ts";
import type { SignedResult } from "../../hosted-routing/src/result.ts";
import { createHash } from "node:crypto";
import { EVIDENCE_KINDS, EVIDENCE_LIMITS, proofEvidenceReference } from "../../verification/src/evidence.ts";
import type { EvidenceReadRequest, EvidenceTransportScope, TransportEvidenceMetadata } from "../../../apps/supervisor/src/evidence-transport.ts";

export class FactoryClientHttpError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message); this.status = status; this.code = code;
  }
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
    const data = await response.json() as T & { error?: string; code?: string };
    if (!response.ok) throw new FactoryClientHttpError(data.error ?? `Factory request failed (${response.status})`, response.status, data.code ?? null);
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

  /** The backend verifies exact bytes before handing a reference to MyEve Proof. */
  async readEvidence(input: EvidenceReadRequest): Promise<{ ref: TransportEvidenceMetadata; proofReference: string; bytes: Buffer }> {
    const response = await this.#request<{ scope: EvidenceTransportScope; ref: TransportEvidenceMetadata; proofReference: string; base64: string }>('evidence/read', input);
    const ref = response.ref;
    if (!response.scope || response.scope.ownerScope !== input.ownerScope ||
      response.scope.repository !== input.repository || response.scope.workId !== input.workId ||
      response.scope.workGeneration !== input.workGeneration || response.scope.requestId !== input.requestId ||
      !ref || ref.workOrderId !== input.workOrderId || ref.runId !== input.runId ||
      ref.candidateCommit !== input.candidateCommit || ref.factoryVersion !== input.factoryVersion ||
      ref.kind !== input.evidenceKind || !EVIDENCE_KINDS.includes(ref.kind) || ref.sha256 !== input.expectedDigest ||
      response.proofReference !== input.evidenceReference || proofEvidenceReference(ref) !== input.evidenceReference ||
      !Number.isSafeInteger(ref.size) || ref.size <= 0 || ref.size > EVIDENCE_LIMITS[ref.kind] ||
      typeof response.base64 !== 'string' || response.base64.length > Math.ceil(EVIDENCE_LIMITS[ref.kind] / 3) * 4 + 4)
      throw new Error('Factory evidence binding mismatch');
    const bytes = Buffer.from(response.base64, 'base64');
    if (bytes.length !== ref.size || bytes.toString('base64') !== response.base64 ||
      createHash('sha256').update(bytes).digest('hex') !== ref.sha256)
      throw new Error('Factory evidence digest mismatch');
    return { ref, proofReference: response.proofReference, bytes };
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
