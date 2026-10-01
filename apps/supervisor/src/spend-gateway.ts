import { isModelReference } from '../../../packages/contracts/src/model-reference.ts';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SpendLedger, type SpendBinding, type SpendPhase } from '../../../packages/storage/src/spend.ts';
import {providerAuthorization,type ProviderConnection} from './provider-connection.ts';

/** Revisioned, operator-approved rate card. Rates are integer micro-USD per million tokens. */
export interface SpendPrice {
  revision: string;
  model: string;
  validUntil: string;
  contextLimitTokens: number;
  outputLimitTokens: number;
  inputMicrousdPerMillion: number;
  outputMicrousdPerMillion: number;
}

export interface SpendGatewayOptions extends ProviderConnection {
  ledger: SpendLedger;
  binding: SpendBinding;
  price: SpendPrice;
  upstreamOrigin: string;
  childToken: string;
  phase: SpendPhase;
  timeoutMs?: number;
  assertImplementationProgress?: () => Promise<void>;
  /** Trusted host signal only. Closes the productive CLI; does not admit completion. */
  onProductiveBoundary?: () => void;
  /** Absolute settled operation boundary for a host-owned implementation checkpoint. */
  productiveCheckpointAfter?: number;
  onDecision?: (evidence: {code:string;stage:string;status:number;upstreamStatus:number|null;operationId:string|null;elapsedMs:number;retryable:false}) => void;
}

function positive(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
export function validatePrice(price: SpendPrice): void {
  if (!price || !/^[a-zA-Z0-9._-]{1,64}$/.test(price.revision) ||
    !isModelReference(price.model)||
    !Number.isFinite(Date.parse(price.validUntil)) || Date.parse(price.validUntil) <= Date.now() ||
    !positive(price.contextLimitTokens) || !positive(price.outputLimitTokens) ||
    !positive(price.inputMicrousdPerMillion) || !positive(price.outputMicrousdPerMillion) ||
    !Number.isSafeInteger(price.contextLimitTokens * price.inputMicrousdPerMillion +
      price.outputLimitTokens * price.outputMicrousdPerMillion)) {
    throw new Error('Current pinned model pricing and limits are required');
  }
}

function denied(response: import('node:http').ServerResponse, status: number, detail: string, code = 'REQUEST_DENIED'): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ error: { message: detail, type: 'factory_spend_denied', code, retryable: false } }));
}

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 2_000_000) throw new Error('Provider request exceeds 2 MB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function completedResponse(body: Buffer, streaming: boolean): Record<string, unknown> | null {
  if (!streaming) {
    try { return JSON.parse(body.toString('utf8')) as Record<string, unknown>; } catch { return null; }
  }
  const lines = body.toString('utf8').split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('data: ')) continue;
    try {
      const event = JSON.parse(lines[index].slice(6)) as Record<string, unknown>;
      if (event.type === 'response.completed' && event.response && typeof event.response === 'object') {
        return event.response as Record<string, unknown>;
      }
    } catch { /* A later valid completion may exist. */ }
  }
  return null;
}

function authoritativeUsage(response: Record<string, unknown> | null): { input_tokens: number; output_tokens: number } | null {
  const usage = response?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const input = (usage as Record<string, unknown>).input_tokens;
  const output = (usage as Record<string, unknown>).output_tokens;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || (input as number) < 0 || (output as number) < 0) return null;
  return { input_tokens: input as number, output_tokens: output as number };
}

function unpricedContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(unpricedContent);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.type === 'tool_search') {
    return record.execution !== 'client' || !record.parameters || typeof record.parameters !== 'object' ||
      Array.isArray(record.parameters) ||
      Object.keys(record).some(key => !['type', 'execution', 'description', 'parameters'].includes(key));
  }
  if (['tool_search_call', 'tool_search_output'].includes(String(record.type)) && record.execution !== 'client') return true;
  if (['input_image', 'input_audio', 'input_file', 'image_url', 'audio_url', 'file_id',
    'web_search', 'file_search', 'computer_use', 'code_interpreter', 'image_generation', 'mcp']
    .includes(String(record.type ?? ''))) return true;
  if (['image_url', 'audio_url', 'file_id', 'input_audio'].some(key => key in record)) return true;
  if ('tools' in record && (!Array.isArray(record.tools) ||
    record.tools.some(tool => !tool || typeof tool !== 'object' ||
      !['function', 'custom', 'tool_search'].includes(String((tool as Record<string, unknown>).type)) ||
      unpricedContent(tool)))) return true;
  return Object.values(record).some(unpricedContent);
}

/** A local, exact-binding Responses boundary. Unknown routes and usage fail closed. */
export class SpendGateway {
  readonly #server: Server;
  readonly #options: SpendGatewayOptions;
  #requestActive = false;
  #productiveClosed = false;
  constructor(options: SpendGatewayOptions) {
    validatePrice(options.price);
    if (!/^https:\/\//.test(options.upstreamOrigin) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(options.upstreamOrigin)) {
      throw new Error('Upstream must be HTTPS or a loopback fixture');
    }
    if ((!options.upstreamApiKey&&!options.authorize) || !options.childToken) throw new Error('Separate upstream and child credentials required');
    this.#options = options;
    this.#server = createServer((request, response) => { void this.#handle(request, response); });
  }
  async listen(): Promise<string> {
    await new Promise<void>((resolve, reject) => { this.#server.once('error', reject); this.#server.listen(0, '127.0.0.1', resolve); });
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}/v1`;
  }
  async close(): Promise<void> { await new Promise<void>(resolve => this.#server.close(() => resolve())); }

  async #handle(request: IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    const { ledger, binding, price } = this.#options;
    if (request.method !== 'POST' || request.url !== '/v1/responses') return denied(response, 404, 'Unqualified provider route');
    const submitted = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
    const expected = this.#options.childToken;
    if (submitted.length !== expected.length || !timingSafeEqual(Buffer.from(submitted), Buffer.from(expected))) {
      return denied(response, 401, 'Gateway child credential required');
    }
    if(this.#requestActive && (this.#options.assertImplementationProgress||this.#options.onProductiveBoundary)) return denied(response,409,'Concurrent executor request denied','CONCURRENT_REQUEST_DENIED');
    this.#requestActive=true;
    let operationId: string | null = null;
    let stage = 'request';
    let upstreamStatus: number | null = null;
    const started=Date.now();
    const record=(code:string,status:number)=>this.#options.onDecision?.({code,stage,status,upstreamStatus,operationId,elapsedMs:Date.now()-started,retryable:false});
    try {
      validatePrice(price);
      const bytes = await bodyOf(request);
      const payload = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
      if (!payload || Array.isArray(payload) || payload.model !== price.model) return denied(response, 400, 'Unqualified model');
      if (bytes.length > price.contextLimitTokens) return denied(response, 400, 'Input exceeds qualified context bound');
      if (payload.previous_response_id != null || payload.conversation != null || payload.background === true) {
        return denied(response, 400, 'Server-side context is unqualified');
      }
      if (payload.service_tier != null && payload.service_tier !== 'default') return denied(response, 400, 'Unpriced service tier');
      if(['providerOptions','provider_options','models','routing','byok'].some(key=>key in payload))
        return denied(response,400,'Client provider routing is unqualified');
      if (unpricedContent(payload)) return denied(response, 400, 'Unpriced content or hosted tool');
      if (payload.stream !== undefined && typeof payload.stream !== 'boolean') return denied(response, 400, 'Invalid stream mode');
      const requestedOutput = payload.max_output_tokens;
      if (requestedOutput !== undefined && (!positive(requestedOutput as number) || (requestedOutput as number) > price.outputLimitTokens)) {
        return denied(response, 400, 'Output limit exceeds qualified price card');
      }
      payload.max_output_tokens = requestedOutput ?? price.outputLimitTokens;
      const outputCap = payload.max_output_tokens as number;
      // Full context reservation is deliberately more conservative than estimating tokens from bytes.
      const reserveMicrousd = Math.ceil(price.contextLimitTokens * price.inputMicrousdPerMillion / 1_000_000) +
        Math.ceil(price.outputLimitTokens * price.outputMicrousdPerMillion / 1_000_000);
      stage='admission';
      if(this.#options.phase==='productive'&&this.#options.onProductiveBoundary){
        const spend=ledger.read(binding.workId);
        if(this.#productiveClosed || (spend && spend.operations.filter(op=>op.phase==='productive').length>=(this.#options.productiveCheckpointAfter??spend.plannedProductiveOperations))){
          ledger.assertCompletionEligible(binding);
          if(!this.#productiveClosed){
            this.#productiveClosed=true;
            record(this.#options.productiveCheckpointAfter===1?'PRODUCTIVE_CHECKPOINT':'PRODUCTIVE_PHASE_CLOSED',409);
            this.#options.onProductiveBoundary();
          }
          return denied(response,409,'Productive process must yield to trusted host checks','PRODUCTIVE_PHASE_CLOSED');
        }
      }
      stage='capacity';
      if(this.#options.phase==='productive'&&this.#options.assertImplementationProgress){
        const spend=ledger.read(binding.workId);
        if(!spend)throw Error('Work budget missing');
        const used=spend.operations.filter(op=>op.phase==='productive').length;
        if(used===spend.plannedProductiveOperations-1)await this.#options.assertImplementationProgress();
      }
      stage='identity';
      const outgoing=this.#options.prepareRequest?this.#options.prepareRequest(payload):payload;
      const credential=await providerAuthorization(this.#options);
      // Identity refresh may take time. Recheck price and ledger admission afterward.
      validatePrice(price);
      stage='admission';
      operationId = randomUUID();
      ledger.reserve({ ...binding, operationId, model: price.model, pricingRevision: price.revision,
        reservedMicrousd: reserveMicrousd, phase: this.#options.phase });
      ledger.markDispatched(operationId);
      stage='upstream';
      const upstream = await fetch(new URL('/v1/responses', this.#options.upstreamOrigin), {
        method: 'POST', headers: { authorization: `Bearer ${credential}`,
          'content-type': 'application/json' }, body: JSON.stringify(outgoing),redirect:'error',
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? 120_000),
      });
      upstreamStatus=upstream.status;
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (!upstream.body) throw new Error('Provider response body missing');
      for await (const chunk of upstream.body) {
        total += chunk.length;
        if (total > 16_000_000) throw new Error('Provider response exceeds evidence limit');
        chunks.push(chunk);
      }
      const result = Buffer.concat(chunks);
      if(result.includes(Buffer.from(credential)))throw new Error('Provider credential echo denied');
      const completed = completedResponse(result, payload.stream === true);
      const usage = authoritativeUsage(completed);
      const providerRequestId = upstream.headers.get('x-request-id') ??
        (typeof completed?.id === 'string' ? completed.id : null);
      if(providerRequestId?.includes(credential))throw new Error('Provider credential echo denied');
      if (!upstream.ok || completed?.status !== 'completed' || !usage || !providerRequestId || usage.input_tokens > price.contextLimitTokens ||
        usage.output_tokens > outputCap) throw new Error('Provider outcome or usage unqualified');
      const actual = Math.ceil(usage.input_tokens * price.inputMicrousdPerMillion / 1_000_000) +
        Math.ceil(usage.output_tokens * price.outputMicrousdPerMillion / 1_000_000);
      ledger.settle(operationId, actual, providerRequestId, usage);
      record('SETTLED',upstream.status);
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store', 'x-request-id': providerRequestId });
      response.end(result);
    } catch (error) {
      if (operationId) {
        try { ledger.markUnknown(operationId); } catch { /* Durable reservation remains retained. */ }
      }
      // Fixed codes only: never persist raw exceptions, provider bodies or headers.
      const code=stage==='admission'?'LOCAL_ADMISSION_DENIED':stage==='capacity'?'IMPLEMENTATION_CAPACITY_PROTECTED':
        stage==='identity'?'PROVIDER_IDENTITY_UNAVAILABLE':stage==='upstream'?'PROVIDER_OUTCOME_UNKNOWN':'INVALID_REQUEST';
      const status=stage==='admission'||stage==='capacity'?409:stage==='request'?400:503;
      record(code,status);
      denied(response,status,code,code);
    } finally { this.#requestActive=false; }
  }
}
