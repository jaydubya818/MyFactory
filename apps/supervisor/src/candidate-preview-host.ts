import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, sep } from 'node:path';
import type { FactoryStorage } from '../../../packages/storage/src/index.ts';
import { buildCandidateStatic } from '../../../packages/verification/src/index.ts';
import { ActionError } from './actions.ts';

export interface PreviewTarget { requestId: string; workOrderId: string; runId: string; repositoryPath: string; candidateCommit: string; image: string }
export interface PreviewReceipt { state: 'READY'; requestId: string; runId: string; candidateCommit: string; path: string; files: number }
const READY_EVENT = 'builder.candidate_preview_ready';
// Served pages may run their own scripts but get an opaque origin: no cookies, storage or access to the Factory desk.
const PREVIEW_HEADERS = {
  'Content-Security-Policy': "sandbox allow-scripts allow-forms; default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
};
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json' };
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Private static previews of completed, fully verified candidates. The capability token in the URL is the only
 * authority; only its hash is recorded in WorkOrder history and the token stays in the Factory's own data directory. */
export class CandidatePreviewHost {
  private readonly storage: FactoryStorage;
  private readonly dataDir: string;
  private readonly command: string;
  constructor(storage: FactoryStorage, dataDir: string, command: string) {
    if (!command.trim()) throw new Error('A host-configured preview build command is required');
    this.storage = storage; this.dataDir = dataDir; this.command = command;
  }
  private root(runId: string) { return join(this.dataDir, 'previews', runId); }
  private ready(workOrderId: string, runId: string) {
    return this.storage.listEvents(workOrderId).find(e => e.type === READY_EVENT && e.runId === runId);
  }
  private receipt(target: PreviewTarget, files: number): PreviewReceipt {
    const token = readFileSync(join(this.root(target.runId), 'token'), 'utf8').trim();
    return { state: 'READY', requestId: target.requestId, runId: target.runId, candidateCommit: target.candidateCommit, path: `/preview/${token}/`, files };
  }
  async start(target: PreviewTarget): Promise<PreviewReceipt> {
    const prior = this.ready(target.workOrderId, target.runId);
    if (prior) return this.receipt(target, Number(prior.payload.files));
    const root = this.root(target.runId), attempt = join(root, `build-${Date.now()}`);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const built = await buildCandidateStatic({ repositoryPath: target.repositoryPath, candidateSha: target.candidateCommit, image: target.image,
      command: this.command, outputDir: join(attempt, 'dist'), artifactDir: join(attempt, 'logs') });
    if (built.status !== 'built') {
      this.storage.appendEvent({ workOrderId: target.workOrderId, runId: target.runId, type: 'builder.candidate_preview_failed',
        payload: { requestId: target.requestId, candidateCommit: target.candidateCommit, status: built.status, reason: built.reason } });
      throw new ActionError('Candidate preview build failed', 'preview_failed', 409);
    }
    const token = randomBytes(32).toString('hex');
    return this.storage.transaction(() => {
      const raced = this.ready(target.workOrderId, target.runId);
      if (raced) return this.receipt(target, Number(raced.payload.files));
      writeFileSync(join(root, 'token'), token, { mode: 0o600, flag: 'w' });
      this.storage.appendEvent({ workOrderId: target.workOrderId, runId: target.runId, type: READY_EVENT,
        payload: { requestId: target.requestId, candidateCommit: target.candidateCommit, candidateTree: built.candidateTree, tokenSha256: tokenHash(token),
          outputDir: built.outputDir, image: target.image, files: built.files.length, manifestSha256: createHash('sha256').update(JSON.stringify(built.files)).digest('hex') } });
      return this.receipt(target, built.files.length);
    });
  }
  private outputFor(token: string): string | null {
    const hash = tokenHash(token);
    for (const order of this.storage.listWorkOrders()) {
      const event = this.storage.listEvents(order.id).find(e => e.type === READY_EVENT &&
        timingSafeEqual(Buffer.from(String(e.payload.tokenSha256)), Buffer.from(hash)));
      if (event) return String(event.payload.outputDir);
    }
    return null;
  }
  /** Returns false when the path is not a preview route. */
  serve(pathname: string, method: string | undefined, response: ServerResponse): boolean {
    const match = /^\/preview\/([a-f0-9]{64})\/(.*)$/.exec(pathname);
    if (!match) return false;
    const notFound = () => { response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end(); };
    if (method !== 'GET' && method !== 'HEAD') { response.writeHead(405); response.end(); return true; }
    const output = this.outputFor(match[1]);
    let relative: string;
    try { relative = decodeURIComponent(match[2]) || 'index.html'; } catch { notFound(); return true; }
    if (!output || /[\\\0]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) { notFound(); return true; }
    let file: string;
    try {
      const base = realpathSync(output); file = realpathSync(join(base, relative));
      if (!file.startsWith(base + sep) || !statSync(file).isFile()) { notFound(); return true; }
    } catch { notFound(); return true; }
    const bytes = readFileSync(file);
    response.writeHead(200, { ...PREVIEW_HEADERS, 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': bytes.length });
    response.end(method === 'HEAD' ? undefined : bytes);
    return true;
  }
}
