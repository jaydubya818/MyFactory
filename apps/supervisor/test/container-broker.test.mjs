import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BROKER = fileURLToPath(new URL('../container/broker.mjs', import.meta.url));
const hex = () => randomBytes(32).toString('hex');
const freePort = () => new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

async function startBroker(t, config) {
  const child = spawn(process.execPath, [BROKER], { stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => child.kill('SIGKILL'));
  const ready = new Promise((resolve, reject) => {
    let out = ''; child.stdout.on('data', d => { out += d; if (out.includes('BROKER_READY\n')) resolve(); });
    child.once('exit', code => reject(Error('broker exited ' + code)));
  });
  child.stdin.end(JSON.stringify(config));
  await ready;
  return child;
}
function exitCode(config) {
  return new Promise(resolve => { const c = spawn(process.execPath, [BROKER], { stdio: ['pipe', 'ignore', 'ignore'] }); c.once('exit', resolve); c.stdin.end(config); });
}

test('metered broker forwards only POST /v1/responses to the host gateway with the gateway token; worker never sees it', async t => {
  const seen = [];
  const gateway = createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: b });
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); });
  await new Promise(r => gateway.listen(0, '127.0.0.1', r)); t.after(() => gateway.close());
  const port = await freePort(), gatewayToken = hex(), workerToken = hex();
  await startBroker(t, { mode: 'metered', upstream: `http://127.0.0.1:${gateway.address().port}`, gatewayToken, workerToken, model: 'openai/gpt-5.5',
    deadlineUnixMs: Date.now() + 60_000, listenHost: '127.0.0.1', listenPort: port });
  const call = (path, body, token = workerToken, method = 'POST') => fetch(`http://127.0.0.1:${port}${path}`, { method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  const ok = { model: 'openai/gpt-5.5', store: false, tools: [{ type: 'function', name: 'shell' }, { type: 'custom', name: 'apply_patch' }], input: [] };
  const r = await call('/v1/responses', ok);
  assert.equal(r.status, 200); assert.equal(await r.text(), '{"ok":true}');
  assert.equal(seen.length, 1); assert.equal(seen[0].auth, `Bearer ${gatewayToken}`); assert.equal(seen[0].url, '/v1/responses');
  const refusals = [
    ['/v1/responses', { ...ok, store: true }], ['/v1/responses', { ...ok, tools: [{ type: 'web_search' }] }],
    ['/v1/responses', { ...ok, tools: [{ type: 'mcp', server_url: 'https://evil' }] }], ['/v1/responses', { ...ok, model: 'openai/other' }],
    ['/v1/responses', { ...ok, previous_response_id: 'resp_1' }], ['/v1/responses', { ...ok, background: true }],
    ['/v1/responses', { ...ok, tools: [{ type: 'tool_search', execution: 'server' }] }], ['/responses', ok], ['/v1/models', ok],
  ];
  for (const [path, body] of refusals) assert.equal((await call(path, body)).status, 403, JSON.stringify(body));
  assert.equal((await call('/v1/responses', ok, gatewayToken)).status, 403, 'the gateway token is not a worker credential');
  assert.equal((await call('/v1/responses', ok, 'x'.repeat(64))).status, 403);
  assert.equal(seen.length, 1, 'no refused request reached the gateway');
});

test('owner broker refuses hosted tools and server-side storage before any upstream request', async t => {
  const port = await freePort(), workerToken = 'w'.repeat(40);
  await startBroker(t, { mode: 'owner', accessToken: 'access', accountId: 'acct', workerToken, model: 'openai/gpt-5.5', deadlineUnixMs: Date.now() + 60_000,
    listenHost: '127.0.0.1', listenPort: port });
  for (const body of [{ model: 'openai/gpt-5.5', store: true }, { model: 'openai/gpt-5.5', tools: [{ type: 'web_search' }] }, { model: 'openai/gpt-5.5', tools: [{ type: 'image_generation' }] }]) {
    const r = await fetch(`http://127.0.0.1:${port}/responses`, { method: 'POST', headers: { authorization: `Bearer ${workerToken}` }, body: JSON.stringify(body) });
    assert.equal(r.status, 403);
  }
});

test('broker refuses to start without a complete in-memory configuration', async () => {
  const base = { mode: 'metered', upstream: 'http://host.docker.internal:4000', gatewayToken: hex(), workerToken: hex(), model: 'm', deadlineUnixMs: Date.now() + 60_000 };
  assert.equal(await exitCode(''), 125);
  assert.equal(await exitCode(JSON.stringify({ ...base, upstream: 'https://api.openai.com' })), 125);
  assert.equal(await exitCode(JSON.stringify({ ...base, gatewayToken: 'sk-real-key' })), 125);
  assert.equal(await exitCode(JSON.stringify({ ...base, mode: 'other' })), 125);
  assert.equal(await exitCode(JSON.stringify({ ...base, deadlineUnixMs: Date.now() + 700_000 })), 124);
  assert.equal(await exitCode(JSON.stringify({ ...base, listenHost: '192.168.1.5' })), 125);
});
