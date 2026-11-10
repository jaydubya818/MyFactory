import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { closeSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, resolve } from 'node:path';

/**
 * Outbound-only Factory mailbox poller (hosted/MAILBOX-CONTRACT.md v1). Transport only: it long-polls the hosted mailbox over HTTPS with
 * a per-installation poller credential, forwards each leased request byte-for-byte to the 127.0.0.1 Factory host, and posts the response.
 * It never opens a listener, never authorizes anything (every Factory signature is verified end to end by the Factory itself), never
 * forwards the poller credential to the Factory, and never retries a request it has forwarded (UNKNOWN semantics stay with the client).
 */
export const MAILBOX_LIMITS = Object.freeze({ maxBodyBytes: 1024 * 1024, pollWaitSeconds: 25, leaseMs: 30_000, maxForwardMs: 30_000, maxEvaluateForwardMs: 720_000, maxInFlight: 4, maxPathBytes: 2048 });
export const FORWARD_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
/** Factory routes reachable through the mailbox: the connect protocol, ordered capability admission and health. Nothing else. */
export const FORWARD_PATH_PREFIXES = ['/api/connect/v1/', '/api/capability-admission/', '/api/health'] as const;
export const REQUEST_HEADERS = ['authorization', 'content-type', 'accept', 'idempotency-key', 'last-event-id', 'x-request-id'] as const;
/**
 * Contract v1 `target`: each maps to ONE configured 127.0.0.1 origin with its own allowlist. The verifier allowlist is exactly the existing
 * MyEve qdev verifier host API (lib/qualification/verifier-service.ts + artifact-staging.ts): POST-only exact paths and its request headers.
 */
export const MAILBOX_TARGETS = Object.freeze({
  factory: { methods: FORWARD_METHODS as readonly string[], prefixes: FORWARD_PATH_PREFIXES as readonly string[], exact: [] as readonly string[], headers: REQUEST_HEADERS as readonly string[] },
  verifier: { methods: ['POST'] as readonly string[], prefixes: [] as readonly string[],
    exact: ['/qdev/v1/handoff', '/qdev/v1/evaluate', '/qdev/v1/verdict', '/qdev/v1/artifact/file', '/qdev/v1/artifact/commit'] as readonly string[],
    headers: ['authorization', 'content-type', 'accept', 'x-request-id', 'x-qdev-candidate', 'x-qdev-binding', 'x-qdev-path', 'x-qdev-sha256'] as readonly string[] },
  /** Hosted private beta: the Mac-local qualification Relay, only its two remote capability-lease routes (MyEve FactoryRelayLeaseClient). */
  relay: { methods: ['POST'] as readonly string[], prefixes: [] as readonly string[],
    exact: ['/api/v2/runtime/capability-leases', '/api/v2/runtime/capability-leases/prepare'] as readonly string[],
    headers: ['authorization', 'content-type', 'accept', 'x-request-id', 'x-relay-account-id'] as readonly string[] },
});
export type MailboxTarget = keyof typeof MAILBOX_TARGETS;
export const RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'retry-after', 'x-request-id'] as const;
export class MailboxRefused extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
const refuse = (code: string): never => { throw new MailboxRefused(code); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = /^[A-Za-z0-9:_.-]{1,128}$/;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/**
 * Poller credentials have their own format (`mfpoll_` + base64url). The Factory accepts only a 64-hex bearer and the verifier only its
 * configured credential hashes, so an echoed poller credential is structurally unusable by either endpoint; it is still never forwarded.
 */
export const POLLER_CREDENTIAL = /^mfpoll_[A-Za-z0-9_-]{43,256}$/;
/** Data-independent scan: every window is compared in full and the result is folded without early exit. */
export function containsSecret(haystack: Buffer, needle: Buffer): boolean {
  const n = needle.length, last = haystack.length - n;
  if (n === 0 || last < 0) return false;
  let found = 0;
  for (let i = 0; i <= last; i++) {
    let diff = 0;
    for (let j = 0; j < n; j++) diff |= haystack[i + j] ^ needle[j];
    found |= ((diff - 1) >>> 31) & 1;          // 1 exactly when diff === 0
  }
  return found === 1;
}
/** Every byte the poller would send to a local endpoint, in raw and percent-decoded form. */
export function envelopeCarriesSecret(envelope: Pick<MailboxEnvelope, 'path' | 'headers' | 'body'>, secret: string): boolean {
  const needle = Buffer.from(secret, 'utf8');
  let decodedPath = envelope.path; try { decodedPath = decodeURIComponent(envelope.path.replace(/\+/g, ' ')); } catch { /* raw form still scanned */ }
  const parts = [envelope.body, Buffer.from(envelope.path, 'utf8'), Buffer.from(decodedPath, 'utf8'), ...Object.values(envelope.headers).map(v => Buffer.from(v, 'utf8'))];
  let hit = false;
  for (const part of parts) hit = containsSecret(part, needle) || hit;   // no short-circuit: every part is scanned
  return hit;
}

export interface MailboxEnvelope {
  id: string; installationId: string; ownerId: string; createdAt: string; deadline: string; method: typeof FORWARD_METHODS[number];
  target: MailboxTarget; path: string; headers: Record<string, string>; bodySha256: string; body: Buffer; leaseId: string;
}
export interface MailboxPollerOptions {
  /** HTTPS origin of the hosted MyEve mailbox. */
  mailboxOrigin: string;
  installationId: string;
  /** Per-installation poller credential (hosted stores only its hash). Sent only to the mailbox origin. */
  credential: string;
  /** Exact `http://127.0.0.1:<port>` Factory host origin. Any other target refuses. */
  factoryOrigin: string;
  /** Exact `http://127.0.0.1:<port>` verifier host origin (contract v1 `target: "verifier"`). Absent: verifier envelopes refuse. */
  verifierOrigin?: string;
  /** Exact `http://127.0.0.1:<port>` Mac-local Relay origin (target "relay"). Absent: relay envelopes refuse. */
  relayOrigin?: string;
  /** Required owner-only SQLite store of every forwarded id (never evicted) and the single-poller lock for this installation. */
  idStore: string;
  /** Test seams only (never reachable from the launcher config): mailbox fetch and a loopback HTTP mailbox. */
  fetch?: typeof fetch;
  allowLoopbackMailboxForTest?: boolean;
  log?: (event: Record<string, unknown>) => void;
}

/** Exact loopback Factory target: http, 127.0.0.1, explicit port, no path, credentials, query or fragment. */
export function assertLoopbackFactoryOrigin(origin: string): { port: number } {
  const m = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(typeof origin === 'string' ? origin : '');
  const port = m ? Number(m[1]) : NaN;
  if (!m || !Number.isSafeInteger(port) || port < 1 || port > 65535) return refuse('MAILBOX_FACTORY_TARGET_NOT_LOOPBACK');
  return { port };
}
export function assertMailboxOrigin(origin: string, allowLoopbackForTest = false) {
  let url: URL; try { url = new URL(origin); } catch { return refuse('MAILBOX_ORIGIN_INVALID'); }
  if (url.origin !== origin || url.username || url.password) refuse('MAILBOX_ORIGIN_INVALID');
  if (url.protocol === 'https:') return;
  if (allowLoopbackForTest && url.protocol === 'http:' && url.hostname === '127.0.0.1') return;
  refuse('MAILBOX_ORIGIN_REQUIRES_HTTPS');
}
export function assertForwardPath(path: unknown, target: MailboxTarget = 'factory'): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || Buffer.byteLength(path) > MAILBOX_LIMITS.maxPathBytes ||
      /[\0-\x20\x7f#\\]/.test(path) || path.split('?')[0].includes('//') ||
      path.split('?')[0].split('/').some(s => s === '..' || s === '.' || /%2e|%2f|%5c/i.test(s)) ||
      !(MAILBOX_TARGETS[target].exact.includes(path) ||
        MAILBOX_TARGETS[target].prefixes.some(prefix => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(prefix + '?'))))
    return refuse('MAILBOX_PATH_REFUSED');
  return path;
}

/** Strict, untrusted-input parse of one leased request envelope. */
export function parseEnvelope(raw: unknown, installationId: string, now = Date.now()): MailboxEnvelope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse('MAILBOX_ENVELOPE_SHAPE');
  const e = raw as Record<string, unknown>;
  // Contract v1: every field is required (target, leaseId and base64 bodyEncoding included); unknown fields refuse.
  const fields = ['id', 'installationId', 'ownerId', 'createdAt', 'deadline', 'target', 'method', 'path', 'headers', 'bodySha256', 'body', 'bodyEncoding', 'leaseId'];
  if (Object.keys(e).sort().join(',') !== [...fields].sort().join(',')) refuse('MAILBOX_ENVELOPE_SHAPE');
  if (typeof e.target !== 'string' || !Object.hasOwn(MAILBOX_TARGETS, e.target)) refuse('MAILBOX_ENVELOPE_TARGET');
  const target = e.target as MailboxTarget, policy = MAILBOX_TARGETS[target];
  if (typeof e.id !== 'string' || !UUID.test(e.id)) refuse('MAILBOX_ENVELOPE_ID');
  if (e.installationId !== installationId) refuse('MAILBOX_ENVELOPE_INSTALLATION');
  if (typeof e.ownerId !== 'string' || !NAME.test(e.ownerId)) refuse('MAILBOX_ENVELOPE_OWNER');
  const created = typeof e.createdAt === 'string' ? Date.parse(e.createdAt) : NaN, deadline = typeof e.deadline === 'string' ? Date.parse(e.deadline) : NaN;
  if (!Number.isFinite(created) || !Number.isFinite(deadline) || deadline <= now || deadline > now + 3_600_000 || created > now + 60_000) refuse('MAILBOX_ENVELOPE_DEADLINE');
  if (typeof e.method !== 'string' || !policy.methods.includes(e.method)) refuse('MAILBOX_ENVELOPE_METHOD');
  const path = assertForwardPath(e.path, target);
  if (!e.headers || typeof e.headers !== 'object' || Array.isArray(e.headers)) refuse('MAILBOX_ENVELOPE_HEADERS');
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.headers as Record<string, unknown>)) {
    const name = k.toLowerCase();
    if (!policy.headers.includes(name) || typeof v !== 'string' || v.length > 8192 || /[\r\n\0]/.test(v) || Object.hasOwn(headers, name))
      refuse('MAILBOX_ENVELOPE_HEADERS');
    headers[name] = v as string;
  }
  if (e.bodyEncoding !== 'base64') refuse('MAILBOX_ENVELOPE_BODY');
  if (typeof e.body !== 'string' || e.body.length > Math.ceil(MAILBOX_LIMITS.maxBodyBytes / 3) * 4 + 4) refuse('MAILBOX_ENVELOPE_BODY');
  const body = Buffer.from(e.body as string, 'base64');
  if (body.toString('base64') !== e.body) refuse('MAILBOX_ENVELOPE_BODY');   // canonical padded base64 only
  if (body.length > MAILBOX_LIMITS.maxBodyBytes) refuse('MAILBOX_ENVELOPE_BODY_LIMIT');
  if (typeof e.bodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.bodySha256) || sha256(body) !== e.bodySha256) refuse('MAILBOX_ENVELOPE_DIGEST');
  if ((e.method === 'GET' || e.method === 'DELETE') && body.length) refuse('MAILBOX_ENVELOPE_BODY');
  if (typeof e.leaseId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(e.leaseId)) refuse('MAILBOX_ENVELOPE_LEASE');
  return { id: e.id as string, installationId, ownerId: e.ownerId as string, createdAt: e.createdAt as string, deadline: e.deadline as string,
    method: e.method as MailboxEnvelope['method'], target, path, headers, bodySha256: e.bodySha256 as string, body, leaseId: e.leaseId as string };
}

/** Owner-only regular file (0600, current uid, not a symlink). */
export function readSecretFile(path: string, code = 'MAILBOX_CREDENTIAL'): string {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) return refuse(code + '_PATH');
  let st; try { st = lstatSync(path); } catch { return refuse(code + '_MISSING'); }
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid!()) refuse(code + '_PERMISSIONS');
  const value = readFileSync(path, 'utf8').trim();
  if (!POLLER_CREDENTIAL.test(value)) refuse(code + '_FORMAT');
  return value;
}

type Forwarded = { status: number; headers: Record<string, string>; body: Buffer };
/** One byte-for-byte HTTP exchange with the loopback Factory host (no decompression, no added headers beyond content-length). */
export function forwardToFactory(port: number, envelope: MailboxEnvelope, timeoutMs: number): Promise<Forwarded> {
  return new Promise((resolveForward, reject) => {
    const headers: Record<string, string> = { ...envelope.headers };
    if (envelope.body.length || !['GET', 'DELETE'].includes(envelope.method)) headers['content-length'] = String(envelope.body.length);
    const req = httpRequest({ host: '127.0.0.1', port, method: envelope.method, path: envelope.path, headers, timeout: timeoutMs, agent: false }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAILBOX_LIMITS.maxBodyBytes) { req.destroy(new MailboxRefused('MAILBOX_RESPONSE_LIMIT')); return; }
        chunks.push(chunk);
      });
      res.once('end', () => {
        const out: Record<string, string> = {};
        for (const name of RESPONSE_HEADERS) { const v = res.headers[name]; if (typeof v === 'string' && !/[\r\n\0]/.test(v)) out[name] = v; }
        resolveForward({ status: res.statusCode ?? 502, headers: out, body: Buffer.concat(chunks) });
      });
      res.once('error', reject);
    });
    const hard = setTimeout(() => req.destroy(new MailboxRefused('MAILBOX_FORWARD_TIMEOUT')), timeoutMs);
    req.once('timeout', () => req.destroy(new MailboxRefused('MAILBOX_FORWARD_TIMEOUT')));
    req.once('error', error => { clearTimeout(hard); reject(error); });
    req.once('close', () => clearTimeout(hard));
    req.end(envelope.body);
  });
}

/**
 * Durable, never-evicting record of every forwarded request id (contract v1 P4), shared atomically by every process on this Mac:
 * a SQLite table with a PRIMARY KEY on the id. `claim` is a single INSERT, so two processes can never both forward one id, and no id is
 * ever forgotten. The same database holds the single-poller-per-installation lock.
 */
export class ForwardedIdStore {
  readonly #db: DatabaseSync;
  readonly #installation: string;
  #locked = false;
  constructor(path: string, installationId: string) {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) refuse('MAILBOX_ID_STORE_PATH');
    // Created owner-only before SQLite opens it; an existing store must already be a private regular file of this uid.
    closeSync(openSync(path, 'a', 0o600));
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid!()) refuse('MAILBOX_ID_STORE_UNTRUSTED');
    this.#installation = installationId;
    this.#db = new DatabaseSync(path, { timeout: 5000 });
    this.#db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS forwarded_requests (id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, target TEXT NOT NULL, claimed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS poller_lock (installation_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, acquired_at TEXT NOT NULL);`);
  }
  /** One poller per installation: refuses while another LIVE process holds the lock; a dead holder is replaced. */
  acquire() {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.#db.prepare('SELECT pid FROM poller_lock WHERE installation_id = ?').get(this.#installation) as { pid: number } | undefined;
      if (row && row.pid !== process.pid) {
        let alive = true; try { process.kill(row.pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
        if (alive) refuse('MAILBOX_POLLER_ALREADY_RUNNING');
      }
      this.#db.prepare('INSERT OR REPLACE INTO poller_lock VALUES (?, ?, ?)').run(this.#installation, process.pid, new Date().toISOString());
      this.#db.exec('COMMIT'); this.#locked = true;
    } catch (error) { try { this.#db.exec('ROLLBACK'); } catch { /* none open */ } throw error; }
  }
  release() { if (this.#locked) this.#db.prepare('DELETE FROM poller_lock WHERE installation_id = ? AND pid = ?').run(this.#installation, process.pid); this.#locked = false; }
  /** Atomic claim: true exactly once per id, forever and across processes. */
  claim(id: string, target: MailboxTarget): boolean {
    try { this.#db.prepare('INSERT INTO forwarded_requests VALUES (?, ?, ?, ?)').run(id, this.#installation, target, new Date().toISOString()); return true; }
    catch (error) { if (/UNIQUE|constraint/i.test(String((error as Error).message))) return false; throw error; }
  }
  has(id: string) { return !!this.#db.prepare('SELECT 1 FROM forwarded_requests WHERE id = ?').get(id); }
  close() { try { this.release(); } finally { this.#db.close(); } }
}

/** Per-path forward bound: a verifier evaluation runs up to its documented maximum; everything else gets 30 s. Always <= the envelope deadline. */
export function forwardTimeoutMs(envelope: Pick<MailboxEnvelope, 'target' | 'path'>): number {
  return envelope.target === 'verifier' && envelope.path === '/qdev/v1/evaluate' ? MAILBOX_LIMITS.maxEvaluateForwardMs : MAILBOX_LIMITS.maxForwardMs;
}

export class MailboxPoller {
  readonly #o: MailboxPollerOptions;
  readonly #ports: Partial<Record<MailboxTarget, number>> = {};
  readonly #fetch: typeof fetch;
  readonly #store: ForwardedIdStore;
  #stopped = false;
  #abort = new AbortController();
  constructor(options: MailboxPollerOptions) {
    assertMailboxOrigin(options?.mailboxOrigin, options?.allowLoopbackMailboxForTest === true);
    this.#ports.factory = assertLoopbackFactoryOrigin(options.factoryOrigin).port;
    if (options.verifierOrigin !== undefined) {
      this.#ports.verifier = assertLoopbackFactoryOrigin(options.verifierOrigin).port;
      if (this.#ports.verifier === this.#ports.factory) refuse('MAILBOX_TARGETS_NOT_DISTINCT');
    }
    if (options.relayOrigin !== undefined) {
      this.#ports.relay = assertLoopbackFactoryOrigin(options.relayOrigin).port;
      if (this.#ports.relay === this.#ports.factory || this.#ports.relay === this.#ports.verifier) refuse('MAILBOX_TARGETS_NOT_DISTINCT');
    }
    if (typeof options.installationId !== 'string' || !NAME.test(options.installationId)) refuse('MAILBOX_INSTALLATION_INVALID');
    if (typeof options.credential !== 'string' || !POLLER_CREDENTIAL.test(options.credential)) refuse('MAILBOX_CREDENTIAL_FORMAT');
    this.#store = new ForwardedIdStore(options.idStore, options.installationId);
    try { this.#store.acquire(); } catch (error) { this.#store.close(); throw error; }
    this.#o = { ...options };
    this.#fetch = options.fetch ?? fetch;
  }
  #log(event: Record<string, unknown>) { try { this.#o.log?.(event); } catch { /* evidence only */ } }
  seen(id: string) { return this.#store.has(id); }
  stop() { this.#stopped = true; this.#abort.abort(); }
  close() { this.stop(); this.#store.close(); }
  #auth() { return { authorization: `Bearer ${this.#o.credential}`, 'cache-control': 'no-store' }; }
  /** One long-poll: null on 204 (nothing leased). Throws MailboxRefused on any malformed or unexpected mailbox answer. */
  async next(): Promise<MailboxEnvelope | null> {
    const response = await this.#fetch(`${this.#o.mailboxOrigin}/api/factory-mailbox/v1/next?wait=${MAILBOX_LIMITS.pollWaitSeconds}`, {
      method: 'GET', headers: { ...this.#auth(), accept: 'application/json' }, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout((MAILBOX_LIMITS.pollWaitSeconds + 10) * 1000)]) });
    if (response.status === 204) { await response.body?.cancel(); return null; }
    if (response.status !== 200) { await response.body?.cancel(); return refuse('MAILBOX_POLL_STATUS_' + response.status); }
    const text = await boundedText(response, MAILBOX_LIMITS.maxBodyBytes * 2 + 65_536);
    let raw: unknown; try { raw = JSON.parse(text); } catch { return refuse('MAILBOX_ENVELOPE_JSON'); }
    return parseEnvelope(raw, this.#o.installationId);
  }
  /** Forwards one leased request exactly once and posts the answer. Never re-forwards an id, in this or any other process. */
  async handle(envelope: MailboxEnvelope): Promise<'RESPONDED' | 'DUPLICATE' | 'EXPIRED' | 'FORWARD_FAILED'> {
    if (this.#store.has(envelope.id)) { this.#log({ event: 'duplicate', id: envelope.id }); return 'DUPLICATE'; }
    // The poller credential must never reach an endpoint: headers, path, query and the DECODED body are all scanned before any claim.
    if (envelopeCarriesSecret(envelope, this.#o.credential)) { this.#store.claim(envelope.id, envelope.target); return refuse('MAILBOX_CREDENTIAL_ECHO'); }
    // Each contract-v1 target maps to exactly one configured loopback origin; an unconfigured target is never forwarded anywhere else.
    const port = this.#ports[envelope.target];
    if (port === undefined) { this.#log({ event: 'target_unconfigured', id: envelope.id, target: envelope.target }); return refuse('MAILBOX_TARGET_NOT_CONFIGURED'); }
    const remaining = Math.min(Date.parse(envelope.deadline) - Date.now(), forwardTimeoutMs(envelope));
    if (remaining <= 0) { this.#log({ event: 'expired', id: envelope.id }); return 'EXPIRED'; }
    // Claimed durably and atomically BEFORE the endpoint sees it: a crash or a second process can never cause a second forward.
    if (!this.#store.claim(envelope.id, envelope.target)) { this.#log({ event: 'duplicate', id: envelope.id }); return 'DUPLICATE'; }
    let result: Forwarded;
    try { result = await forwardToFactory(port, envelope, remaining); }
    catch (error) {
      // The outcome is unknown to this process. No retry and no synthetic answer: the client's deadline and readback decide.
      this.#log({ event: 'forward_failed', id: envelope.id, code: error instanceof MailboxRefused ? error.code : 'MAILBOX_FORWARD_ERROR' });
      return 'FORWARD_FAILED';
    }
    if (result.body.includes(Buffer.from(this.#o.credential))) return refuse('MAILBOX_CREDENTIAL_ECHO');
    const payload = { id: envelope.id, leaseId: envelope.leaseId, requestBodySha256: envelope.bodySha256,
      status: result.status, headers: result.headers, bodySha256: sha256(result.body), body: result.body.toString('base64'), bodyEncoding: 'base64' };
    const posted = await this.#fetch(`${this.#o.mailboxOrigin}/api/factory-mailbox/v1/respond`, {
      method: 'POST', headers: { ...this.#auth(), 'content-type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(15_000)]) });
    await posted.body?.cancel();
    if (posted.status < 200 || posted.status >= 300) { this.#log({ event: 'respond_refused', id: envelope.id, status: posted.status }); return 'FORWARD_FAILED'; }
    this.#log({ event: 'responded', id: envelope.id, status: result.status });
    return 'RESPONDED';
  }
  /** Long-poll loop with bounded backoff. Up to `maxInFlight` leased requests are handled concurrently, so one long verifier evaluation
   *  never blocks Factory traffic; each id is still forwarded at most once (atomic durable claim). */
  async run(): Promise<void> {
    let backoff = 1000;
    const inFlight = new Set<Promise<unknown>>();
    try {
      while (!this.#stopped) {
        if (inFlight.size >= MAILBOX_LIMITS.maxInFlight) { await Promise.race(inFlight); continue; }
        try {
          const envelope = await this.next();
          if (envelope) {
            const task: Promise<unknown> = this.handle(envelope)
              .catch(error => this.#log({ event: 'handle_refused', id: envelope.id, code: error instanceof MailboxRefused ? error.code : 'MAILBOX_HANDLE_ERROR' }))
              .finally(() => inFlight.delete(task));
            inFlight.add(task);
          }
          backoff = 1000;
        } catch (error) {
          if (this.#stopped) break;
          this.#log({ event: 'poll_error', code: error instanceof MailboxRefused ? error.code : 'MAILBOX_TRANSPORT_ERROR' });
          await new Promise(r => setTimeout(r, backoff)); backoff = Math.min(backoff * 2, 30_000);
        }
      }
    } finally { await Promise.allSettled([...inFlight]); }
  }
}
async function boundedText(response: Response, limit: number): Promise<string> {
  const chunks: Uint8Array[] = []; let size = 0;
  if (response.body) for await (const chunk of response.body) {
    size += chunk.length; if (size > limit) refuse('MAILBOX_ENVELOPE_LIMIT'); chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const MAILBOX_POLLER_CONFIG_SCHEMA = 'myfactory-mailbox-poller/v1';
/** Launcher config: an operator-owned file outside the repository. The credential lives in its own 0600 file, never in the config. */
export function loadPollerConfig(path: string): MailboxPollerOptions {
  if (typeof path !== 'string' || !isAbsolute(path)) return refuse('MAILBOX_CONFIG_PATH');
  let st; try { st = lstatSync(path); } catch { return refuse('MAILBOX_CONFIG_MISSING'); }
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid!() || (st.mode & 0o022) !== 0) refuse('MAILBOX_CONFIG_UNTRUSTED');
  let c: Record<string, unknown>; try { c = JSON.parse(readFileSync(path, 'utf8')); } catch { return refuse('MAILBOX_CONFIG_JSON'); }
  const optional = (name: string) => (c && typeof c === 'object' && Object.hasOwn(c, name) ? [name] : []);
  const keys = ['schema', 'mailboxOrigin', 'installationId', 'credentialFile', 'factoryOrigin', 'idStore', ...optional('verifierOrigin'), ...optional('relayOrigin')];
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).sort().join(',') !== [...keys].sort().join(',') || c.schema !== MAILBOX_POLLER_CONFIG_SCHEMA)
    refuse('MAILBOX_CONFIG_SHAPE');
  assertMailboxOrigin(c.mailboxOrigin as string, false);
  assertLoopbackFactoryOrigin(c.factoryOrigin as string);
  if (c.verifierOrigin !== undefined) assertLoopbackFactoryOrigin(c.verifierOrigin as string);
  if (c.relayOrigin !== undefined) assertLoopbackFactoryOrigin(c.relayOrigin as string);
  const credential = readSecretFile(c.credentialFile as string);
  return { mailboxOrigin: c.mailboxOrigin as string, installationId: c.installationId as string, credential, factoryOrigin: c.factoryOrigin as string,
    ...(c.verifierOrigin !== undefined ? { verifierOrigin: c.verifierOrigin as string } : {}),
    ...(c.relayOrigin !== undefined ? { relayOrigin: c.relayOrigin as string } : {}),
    idStore: c.idStore as string };
}
