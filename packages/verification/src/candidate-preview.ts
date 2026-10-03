import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import type { BrowserJourney } from './browser-evidence.ts';

const exec = promisify(execFile);
const trustedPreviews = new WeakSet<object>();
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};
export interface CandidatePreviewInput {
  repositoryPath: string; workOrderId: string; runId: string; candidateCommit: string;
  staticRoot: string; path: string; expectedText: string[];
}
export interface CandidatePreview {
  identity: { workOrderId: string; runId: string; candidateCommit: string; candidateTree: string; staticRoot: string };
  journey: BrowserJourney;
  close(): Promise<void>;
}
export function isTrustedCandidatePreview(value: unknown): value is CandidatePreview {
  return !!value && typeof value === 'object' && trustedPreviews.has(value);
}

/** Read-only static candidate preview. No package install, command execution, or external binding. */
export async function startCandidatePreview(input: CandidatePreviewInput): Promise<CandidatePreview> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.candidateCommit) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.workOrderId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.runId) ||
    !/^(?:\.|[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)$/.test(input.staticRoot) ||
    !input.path.startsWith('/') || input.path.includes('..') || input.path.includes('?') ||
    !Array.isArray(input.expectedText) || input.expectedText.length < 1 || input.expectedText.length > 12)
    throw new Error('Invalid exact candidate preview request');
  const git = async (...args: string[]) => (await exec('git', ['-C', input.repositoryPath, ...args],
    { timeout: 10_000, maxBuffer: 5 * 1024 * 1024, encoding: 'buffer' })).stdout as Buffer;
  const resolved = (await git('rev-parse', '--verify', `${input.candidateCommit}^{commit}`)).toString('utf8').trim();
  if (resolved !== input.candidateCommit) throw new Error('Candidate commit identity mismatch');
  const candidateTree = (await git('rev-parse', `${resolved}^{tree}`)).toString('utf8').trim();
  const algorithm = (await git('rev-parse', '--show-object-format')).toString('utf8').trim();
  if (!['sha1', 'sha256'].includes(algorithm)) throw new Error('Unsupported Git object format');
  const files = new Map<string, Buffer>();
  const entries = (await git('ls-tree', '-r', '-z', '--full-tree', resolved)).toString('utf8').split('\0').filter(Boolean);
  if (entries.length > 512) throw new Error('Candidate tree too large for static preview');
  let total = 0;
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/.exec(entry);
    if (!match) throw new Error('Unsupported candidate tree entry');
    const file = match[3];
    if (file.startsWith('/') || file !== posix.normalize(file) || file.split('/').some(part => part === '.' || part === '..'))
      throw new Error('Unsafe candidate path');
    if (input.staticRoot !== '.' && !file.startsWith(`${input.staticRoot}/`)) continue;
    const servedPath = input.staticRoot === '.' ? file : file.slice(input.staticRoot.length + 1);
    const bytes = await git('cat-file', 'blob', match[2]);
    if (bytes.length > 2 * 1024 * 1024 || (total += bytes.length) > 4 * 1024 * 1024) throw new Error('Static preview byte limit');
    const objectHash = createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (objectHash !== match[2]) throw new Error('Candidate blob identity mismatch');
    files.set(`/${servedPath}`, bytes);
  }
  if (!files.has('/index.html')) throw new Error('Candidate has no static index.html');
  const server: Server = createServer((request, response) => {
    const pathname = (request.url ?? '/').split('?')[0];
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { response.writeHead(400).end(); return; }
    if (!['GET', 'HEAD'].includes(request.method ?? '') || !decoded.startsWith('/') || decoded.includes('..') || decoded.includes('\\')) {
      response.writeHead(403).end(); return;
    }
    const path = decoded === '/' ? '/index.html' : decoded;
    const bytes = files.get(path);
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': contentTypes[posix.extname(path)] ?? 'application/octet-stream',
      'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') response.end(); else response.end(bytes);
  });
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { server.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('Preview address unavailable'); }
  const preview = Object.freeze({
    identity: Object.freeze({ workOrderId: input.workOrderId, runId: input.runId, candidateCommit: resolved, candidateTree, staticRoot: input.staticRoot }),
    journey: Object.freeze({ url: `http://127.0.0.1:${address.port}/`, path: input.path,
      expectedText: Object.freeze([...input.expectedText]) }) as BrowserJourney,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  });
  trustedPreviews.add(preview);
  return preview;
}
