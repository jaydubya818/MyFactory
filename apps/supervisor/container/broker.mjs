// Trusted credential projection: no refresh token, auth file, host socket or general proxy is exposed to the worker.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
const config = JSON.parse(readFileSync('/run/factory/broker.json', 'utf8'));
const deadline = config.deadlineUnixMs;
if (!Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline - Date.now() > 600_000) process.exit(124);
const requests = new Set();
const server = createServer(async (req, res) => {
  const target = req.url === '/responses' && req.method === 'POST' ? '/responses'
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
    if (body && JSON.parse(body.toString('utf8')).model !== config.model) throw Error('MODEL_DENIED');
    const upstream = await fetch(`https://chatgpt.com/backend-api/codex${target}`, {
      method: req.method, body, redirect: 'error', signal: controller.signal,
      headers: { authorization: `Bearer ${config.accessToken}`, 'chatgpt-account-id': config.accountId,
        'content-type': 'application/json', accept: req.headers.accept === 'text/event-stream' ? 'text/event-stream' : 'application/json',
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
server.listen(8787, '0.0.0.0');
const stop = () => { for (const c of requests) c.abort(); server.closeAllConnections(); process.exit(124); };
setTimeout(stop, deadline - Date.now());
setInterval(() => { if (Date.now() >= deadline) stop(); }, 25);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
