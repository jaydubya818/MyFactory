// Trusted credential projection: no refresh token, API key, auth file, host socket or general proxy is exposed to the worker.
// The configuration (and its credential) arrives once on stdin and lives only in this process's memory; nothing is written to disk.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
let config;
try { config = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(125); }
const deadline = config.deadlineUnixMs;
if (!Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline - Date.now() > 600_000) process.exit(124);
const metered = config.mode === 'metered';
// Metered: only the host spend gateway (which holds the API key, prices, reserves and settles), reached through Docker's host alias.
if (metered ? !/^http:\/\/(?:host\.docker\.internal|127\.0\.0\.1):\d{1,5}$/.test(config.upstream ?? '') || !/^[a-f0-9]{64}$/.test(config.gatewayToken ?? '')
  : config.mode !== 'owner' || typeof config.accessToken !== 'string' || typeof config.accountId !== 'string') process.exit(125);
if (typeof config.workerToken !== 'string' || config.workerToken.length < 32 || typeof config.model !== 'string') process.exit(125);
const port = config.listenPort ?? 8787, host = config.listenHost ?? '0.0.0.0';
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || !['0.0.0.0', '127.0.0.1'].includes(host)) process.exit(125);
// Hosted tools and server-side storage are exfiltration channels through the model; only local tool shapes are forwarded.
const LOCAL_TOOLS = new Set(['function', 'custom', 'local_shell']);
function bodyAllowed(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.model !== config.model) return false;
  if (body.store === true || body.background === true || body.previous_response_id != null || body.conversation != null) return false;
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some(t => !t || typeof t !== 'object' ||
    !(LOCAL_TOOLS.has(t.type) || t.type === 'tool_search' && t.execution === 'client')))) return false;
  return true;
}
const requests = new Set();
const server = createServer(async (req, res) => {
  const target = metered
    ? (req.url === '/v1/responses' && req.method === 'POST' ? '/v1/responses' : null)
    : req.url === '/responses' && req.method === 'POST' ? '/responses'
      : /^\/models(?:\?client_version=[A-Za-z0-9._-]+)?$/.test(req.url ?? '') && req.method === 'GET' ? req.url : null;
  if (!target || req.headers.authorization !== `Bearer ${config.workerToken}` || Date.now() >= deadline) {
    res.writeHead(403); res.end(); return;
  }
  const controller = new AbortController(); requests.add(controller);
  req.once('aborted', () => controller.abort()); res.once('close', () => controller.abort());
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length; if (size > 16 * 1024 * 1024) throw Error('REQUEST_LIMIT'); chunks.push(chunk);
    }
    const body = req.method === 'POST' ? Buffer.concat(chunks) : undefined;
    if (body && !bodyAllowed(JSON.parse(body.toString('utf8')))) { res.writeHead(403, { 'cache-control': 'no-store' }); res.end(); return; }
    const accept = req.headers.accept === 'text/event-stream' ? 'text/event-stream' : 'application/json';
    const upstream = metered
      ? await fetch(`${config.upstream}${target}`, { method: 'POST', body, redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${config.gatewayToken}`, 'content-type': 'application/json', accept } })
      : await fetch(`https://chatgpt.com/backend-api/codex${target}`, {
        method: req.method, body, redirect: 'error', signal: controller.signal,
        headers: { authorization: `Bearer ${config.accessToken}`, 'chatgpt-account-id': config.accountId,
          'content-type': 'application/json', accept,
          originator: 'codex_cli_rs', 'user-agent': 'codex_cli_rs/0.163.0', 'openai-beta': 'responses=experimental' },
      });
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
    if (upstream.body) for await (const chunk of upstream.body) {
      if (!res.write(chunk)) await new Promise((resolve, reject) => { res.once('drain', resolve); res.once('close', () => reject(Error('CLOSED'))); });
    }
    res.end();
  } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
  finally { controller.abort(); requests.delete(controller); }
});
server.requestTimeout = 600_000;
server.headersTimeout = 5000;
server.maxConnections = 4;
server.listen(port, host, () => process.stdout.write('BROKER_READY\n'));
const stop = () => { for (const c of requests) c.abort(); server.closeAllConnections(); process.exit(124); };
setTimeout(stop, deadline - Date.now());
setInterval(() => { if (Date.now() >= deadline) stop(); }, 25);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
