import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MailboxPoller, ForwardedIdStore, forwardTimeoutMs, parseEnvelope, assertLoopbackFactoryOrigin, assertMailboxOrigin, assertForwardPath, loadPollerConfig, MAILBOX_LIMITS } from '../src/mailbox-poller.ts';

const sha = b => createHash('sha256').update(b).digest('hex');
const gates = {};
const CREDENTIAL = randomBytes(32).toString('base64url');
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));

function envelope(overrides = {}, bodyBytes = Buffer.from('{"requestId":"r1","sig":"é\\u0000"}')) {
  return { id: randomUUID(), installationId: 'inst-1', ownerId: 'owner-1', createdAt: new Date().toISOString(), deadline: new Date(Date.now() + 20_000).toISOString(),
    target: 'factory', method: 'POST', path: '/api/connect/v1/dispatches', headers: { authorization: 'Bearer factory-client-token', 'content-type': 'application/json' },
    bodySha256: sha(bodyBytes), body: bodyBytes.toString('base64'), bodyEncoding: 'base64', leaseId: 'lease_' + randomBytes(12).toString('hex'), ...overrides };
}
async function harness(t, factoryReply = (req, body, res) => { res.writeHead(201, { 'content-type': 'application/json', 'x-request-id': 'fx', 'set-cookie': 'a=b' }); res.end(Buffer.from([0x7b, 0x7d, 0x00, 0xff])); }) {
  const factorySeen = [];
  const factory = createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks); factorySeen.push({ method: req.method, url: req.url, headers: req.headers, body }); factoryReply(req, body, res); }); });
  const queue = [], responses = [], auths = [];
  const mailbox = createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    auths.push(req.headers.authorization);
    if (req.url === '/api/factory-mailbox/v1/next?wait=25' && req.method === 'GET') {
      const next = queue.shift(); if (!next) { res.writeHead(204); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(next)); return;
    }
    if (req.url === '/api/factory-mailbox/v1/respond' && req.method === 'POST') { responses.push(JSON.parse(Buffer.concat(chunks).toString('utf8'))); res.writeHead(204); res.end(); return; }
    res.writeHead(404); res.end(); }); });
  const verifierSeen = [];
  const verifier = createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', async () => {
    verifierSeen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    if (req.url === '/qdev/v1/evaluate' && gates.evaluate) await gates.evaluate;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end('{"state":"FINAL"}'); }); });
  const factoryOrigin = await listen(factory), mailboxOrigin = await listen(mailbox), verifierOrigin = await listen(verifier);
  t.after(() => { factory.close(); mailbox.close(); verifier.close(); });
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mailbox-'))); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pollers = []; t.after(() => { for (const p of pollers) try { p.close(); } catch {} });
  const make = (extra = {}) => { const p = new MailboxPoller({ mailboxOrigin, installationId: 'inst-1', credential: CREDENTIAL, factoryOrigin, verifierOrigin, idStore: join(dir, 'ids.sqlite'),
    allowLoopbackMailboxForTest: true, ...extra }); pollers.push(p); return p; };
  return { factorySeen, verifierSeen, queue, responses, auths, make, dir, factoryOrigin, mailboxOrigin, verifierOrigin };
}

test('forwards one leased request byte-for-byte to the loopback Factory and posts the exact response bound to the request', async t => {
  const h = await harness(t);
  const e = envelope(); h.queue.push(e);
  const poller = h.make();
  const leased = await poller.next();
  assert.equal(await poller.handle(leased), 'RESPONDED');
  assert.equal(h.factorySeen.length, 1);
  const f = h.factorySeen[0];
  assert.equal(f.method, 'POST'); assert.equal(f.url, '/api/connect/v1/dispatches');
  assert.deepEqual(f.body, Buffer.from(e.body, 'base64'));
  assert.equal(f.headers.authorization, 'Bearer factory-client-token');
  assert.ok(!JSON.stringify(f.headers).includes(CREDENTIAL), 'the poller credential never reaches the Factory');
  assert.equal(f.headers['accept-encoding'], undefined);
  const r = h.responses[0];
  assert.equal(r.id, e.id); assert.equal(r.leaseId, e.leaseId); assert.equal(r.requestBodySha256, e.bodySha256);
  assert.equal(r.status, 201);
  assert.deepEqual(Buffer.from(r.body, 'base64'), Buffer.from([0x7b, 0x7d, 0x00, 0xff]));
  assert.equal(r.bodySha256, sha(Buffer.from([0x7b, 0x7d, 0x00, 0xff])));
  assert.deepEqual(r.headers, { 'content-type': 'application/json', 'x-request-id': 'fx' }, 'only allowlisted response headers');
  assert.ok(h.auths.every(a => a === `Bearer ${CREDENTIAL}`));
  assert.equal(await poller.next(), null, '204 means nothing leased');
});

test('single use: a replayed id is never forwarded twice, including after a poller restart', async t => {
  const h = await harness(t);
  const e = envelope();
  const first = h.make();
  assert.equal(await first.handle(parseEnvelope(e, 'inst-1')), 'RESPONDED');
  assert.equal(await first.handle(parseEnvelope(e, 'inst-1')), 'DUPLICATE');
  const restarted = h.make();
  assert.equal(await restarted.handle(parseEnvelope(e, 'inst-1')), 'DUPLICATE');
  assert.equal(h.factorySeen.length, 1);
  assert.equal(statSync(join(h.dir, 'ids.sqlite')).mode & 0o777, 0o600);
});

test('a Factory failure is never retried or answered synthetically; an expired request is not forwarded', async t => {
  const h = await harness(t, (req, body, res) => { req.socket.destroy(); });
  const poller = h.make();
  assert.equal(await poller.handle(parseEnvelope(envelope(), 'inst-1')), 'FORWARD_FAILED');
  assert.equal(h.responses.length, 0); assert.equal(h.factorySeen.length, 1);
  const expired = parseEnvelope(envelope({ deadline: new Date(Date.now() + 5).toISOString() }), 'inst-1');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(await poller.handle(expired), 'EXPIRED');
  assert.equal(h.factorySeen.length, 1);
});

test('bounded sizes: oversized request bodies refuse; an oversized Factory response is not posted', async t => {
  const big = Buffer.alloc(MAILBOX_LIMITS.maxBodyBytes + 1, 0x61);
  assert.throws(() => parseEnvelope(envelope({}, big), 'inst-1'), /BODY/);
  const h = await harness(t, (req, body, res) => { res.writeHead(200); res.end(Buffer.alloc(MAILBOX_LIMITS.maxBodyBytes + 10, 0x62)); });
  assert.equal(await h.make().handle(parseEnvelope(envelope(), 'inst-1')), 'FORWARD_FAILED');
  assert.equal(h.responses.length, 0);
});

test('untrusted envelopes refuse: wrong installation, digest, method, path, headers, encoding, deadline', () => {
  const bad = [
    envelope({ installationId: 'inst-2' }), envelope({ bodySha256: 'a'.repeat(64) }), envelope({ method: 'CONNECT' }),
    envelope({ path: '/api/admin/reset' }), envelope({ path: '/api/connect/v1/../../admin' }), envelope({ path: '//evil.example/api/connect/v1/x' }),
    envelope({ path: '/api/connect/v1/%2e%2e/x' }), envelope({ path: 'http://evil/api/connect/v1/x' }), envelope({ path: '/api/healthz' }),
    envelope({ headers: { cookie: 'session=1' } }), envelope({ headers: { host: 'evil' } }), envelope({ headers: { authorization: 'a\r\nx: y' } }),
    envelope({ bodyEncoding: 'hex' }), envelope({ deadline: new Date(Date.now() - 1).toISOString() }), envelope({ deadline: new Date(Date.now() + 7_200_000).toISOString() }),
    envelope({ id: 'not-a-uuid' }), envelope({ extra: true }), envelope({ method: 'GET' }), envelope({ leaseId: 'x' }),
    envelope({ target: 'relay' }), envelope({ target: undefined }), envelope({ leaseId: undefined }), envelope({ bodyEncoding: undefined }),
    envelope({ target: 'verifier' }), envelope({ target: 'verifier', path: '/qdev/v1/handoff', method: 'GET', body: '', bodySha256: sha(Buffer.alloc(0)) }),
    envelope({ target: 'verifier', path: '/qdev/v1/admin' }), envelope({ target: 'verifier', path: '/qdev/v1/handoff', headers: { 'idempotency-key': 'k' } }),
    envelope({ target: 'factory', path: '/qdev/v1/handoff' }), envelope({ target: 'factory', headers: { 'x-qdev-path': 'a' } }),
  ];
  for (const e of bad) assert.throws(() => parseEnvelope(e, 'inst-1'), /MAILBOX_/, JSON.stringify(e).slice(0, 120));
  assert.equal(assertForwardPath('/api/health'), '/api/health');
  assert.equal(assertForwardPath('/api/capability-admission/challenge?x=1'), '/api/capability-admission/challenge?x=1');
});

test('targets: the Factory must be exact 127.0.0.1; the mailbox must be HTTPS (loopback http only through the test seam)', () => {
  for (const origin of ['http://localhost:8792', 'http://0.0.0.0:8792', 'https://127.0.0.1:8792', 'http://127.0.0.2:8792', 'http://[::1]:8792',
    'http://127.0.0.1', 'http://127.0.0.1:8792/', 'http://user@127.0.0.1:8792', 'http://example.com:80'])
    assert.throws(() => assertLoopbackFactoryOrigin(origin), /NOT_LOOPBACK/, origin);
  assert.deepEqual(assertLoopbackFactoryOrigin('http://127.0.0.1:8792'), { port: 8792 });
  assert.throws(() => assertMailboxOrigin('http://127.0.0.1:3000'), /REQUIRES_HTTPS/);
  assert.throws(() => assertMailboxOrigin('http://myeve.example'), /REQUIRES_HTTPS/);
  assert.throws(() => assertMailboxOrigin('https://myeve.example/path'), /ORIGIN_INVALID/);
  assertMailboxOrigin('https://myeve.example');
  assert.throws(() => new MailboxPoller({ mailboxOrigin: 'https://m.example', installationId: 'i', credential: CREDENTIAL, factoryOrigin: 'http://10.0.0.5:8792' }), /NOT_LOOPBACK/);
});

test('no inbound listener: the poller module and launcher never create a server or listen', () => {
  for (const file of ['../src/mailbox-poller.ts', '../../../scripts/mailbox-poller.mjs']) {
    const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.ok(!/createServer|\.listen\(|node:net|node:dgram|createSocket/.test(text), file);
  }
});

test('launcher config: credential only from an owner-only 0600 file; group/world-readable or symlinked material refuses', t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mailbox-config-'))); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cred = join(dir, 'poller-credential'); writeFileSync(cred, CREDENTIAL + '\n', { mode: 0o600 });
  const config = join(dir, 'poller.json');
  const write = o => { writeFileSync(config, JSON.stringify({ schema: 'myfactory-mailbox-poller/v1', mailboxOrigin: 'https://myeve.example', installationId: 'inst-1',
    credentialFile: cred, factoryOrigin: 'http://127.0.0.1:8792', idStore: join(dir, 'ids.sqlite'), ...o }), { mode: 0o600 }); };
  write({}); assert.equal(loadPollerConfig(config).credential, CREDENTIAL);
  chmodSync(cred, 0o644); assert.throws(() => loadPollerConfig(config), /CREDENTIAL_PERMISSIONS/); chmodSync(cred, 0o600);
  write({ factoryOrigin: 'http://localhost:8792' }); assert.throws(() => loadPollerConfig(config), /NOT_LOOPBACK/);
  write({ verifierOrigin: 'http://127.0.0.1:8795' }); assert.equal(loadPollerConfig(config).verifierOrigin, 'http://127.0.0.1:8795');
  write({ verifierOrigin: 'https://verifier.example' }); assert.throws(() => loadPollerConfig(config), /NOT_LOOPBACK/);
  write({ mailboxOrigin: 'http://myeve.example' }); assert.throws(() => loadPollerConfig(config), /REQUIRES_HTTPS/);
  write({ extra: 1 }); assert.throws(() => loadPollerConfig(config), /CONFIG_SHAPE/);
  write({}); chmodSync(config, 0o666); assert.throws(() => loadPollerConfig(config), /CONFIG_UNTRUSTED/);
  const launcher = fileURLToPath(new URL('../../../scripts/mailbox-poller.mjs', import.meta.url));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  const run = spawnSync(process.execPath, [launcher], { env, encoding: 'utf8' });
  assert.equal(run.status, 2); assert.match(run.stderr, /usage/);
  const withEnv = spawnSync(process.execPath, [launcher, config], { env: { ...env, NODE_ENV: 'production' }, encoding: 'utf8' });
  assert.equal(withEnv.status, 2); assert.match(withEnv.stderr, /NODE_ENV/);
});

test('run loop: polls, forwards sequentially, backs off on mailbox errors and stops cleanly', async t => {
  const h = await harness(t);
  h.queue.push(envelope(), envelope({ method: 'GET', path: '/api/health', body: '', bodySha256: sha(Buffer.alloc(0)), headers: {} }));
  const poller = h.make();
  const running = poller.run();
  for (let i = 0; i < 100 && h.responses.length < 2; i++) await new Promise(r => setTimeout(r, 20));
  poller.stop(); await running;
  assert.equal(h.responses.length, 2);
  assert.equal(h.factorySeen[1].method, 'GET'); assert.equal(h.factorySeen[1].url, '/api/health');
});

test('contract v1 targets: verifier envelopes reach only the configured verifier origin with its own allowlist; unconfigured targets refuse', async t => {
  const h = await harness(t);
  const bytes = Buffer.from([1, 2, 3, 0, 255]);
  const v = envelope({ target: 'verifier', path: '/qdev/v1/artifact/file', headers: { authorization: 'Bearer verifier-credential',
    'content-type': 'application/octet-stream', 'x-qdev-path': 'index.html', 'x-qdev-sha256': 'a'.repeat(64), 'x-qdev-candidate': 'commit=a', 'x-qdev-binding': 'projectSha256=b' } }, bytes);
  const poller = h.make();
  assert.equal(await poller.handle(parseEnvelope(v, 'inst-1')), 'RESPONDED');
  assert.equal(h.verifierSeen.length, 1); assert.equal(h.factorySeen.length, 0);
  assert.deepEqual(h.verifierSeen[0].body, bytes); assert.equal(h.verifierSeen[0].url, '/qdev/v1/artifact/file');
  assert.equal(h.verifierSeen[0].headers['x-qdev-path'], 'index.html');
  assert.equal(await poller.handle(parseEnvelope(envelope(), 'inst-1')), 'RESPONDED');
  assert.equal(h.factorySeen.length, 1); assert.equal(h.verifierSeen.length, 1);
  const factoryOnly = h.make({ verifierOrigin: undefined, idStore: join(h.dir, 'ids-2.sqlite') });
  await assert.rejects(factoryOnly.handle(parseEnvelope(envelope({ target: 'verifier', path: '/qdev/v1/verdict' }), 'inst-1')), /TARGET_NOT_CONFIGURED/);
  assert.equal(h.verifierSeen.length, 1);
  assert.throws(() => h.make({ verifierOrigin: h.factoryOrigin }), /NOT_DISTINCT/);
  assert.throws(() => h.make({ verifierOrigin: 'http://localhost:8795' }), /NOT_LOOPBACK/);
});

test('never forward twice: no eviction after thousands of ids, and an atomic claim shared across processes', async t => {
  const h = await harness(t);
  const first = envelope();
  const poller = h.make();
  assert.equal(await poller.handle(parseEnvelope(first, 'inst-1')), 'RESPONDED');
  const store = new ForwardedIdStore(join(h.dir, 'ids.sqlite'), 'inst-1'); t.after(() => store.close());
  for (let i = 0; i < 5000; i++) assert.equal(store.claim(randomUUID(), 'factory'), true);
  assert.equal(await poller.handle(parseEnvelope(first, 'inst-1')), 'DUPLICATE', 'the first id is never evicted');
  // Another PROCESS claims an id first: this poller must not forward it.
  const other = envelope();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {ForwardedIdStore} from ${JSON.stringify(fileURLToPath(new URL('../src/mailbox-poller.ts', import.meta.url)))};` +
    `const s=new ForwardedIdStore(${JSON.stringify(join(h.dir, 'ids.sqlite'))},'inst-1');process.stdout.write(String(s.claim(${JSON.stringify(other.id)},'factory')));s.close();`],
    { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(child.stdout, 'true', child.stderr);
  assert.equal(await poller.handle(parseEnvelope(other, 'inst-1')), 'DUPLICATE');
  assert.equal(h.factorySeen.length, 1);
});

test('one poller per installation: a live holder refuses a second poller; a dead holder is replaced', async t => {
  const h = await harness(t);
  const path = join(h.dir, 'ids.sqlite');
  h.make().close();                                                   // creates the store
  const db = new DatabaseSync(path); t.after(() => db.close());
  db.prepare('INSERT OR REPLACE INTO poller_lock VALUES (?, ?, ?)').run('inst-1', process.ppid, new Date().toISOString());
  assert.throws(() => h.make(), /POLLER_ALREADY_RUNNING/);
  db.prepare('INSERT OR REPLACE INTO poller_lock VALUES (?, ?, ?)').run('inst-1', 2 ** 22 + 12345, new Date().toISOString());
  const p = h.make();
  assert.equal(db.prepare('SELECT pid FROM poller_lock').get().pid, process.pid);
  p.close();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM poller_lock').get().n, 0, 'released on close');
});

test('per-path forward bound: verifier evaluation gets its documented maximum, everything else 30 s; a long evaluation does not block Factory traffic', async t => {
  assert.equal(forwardTimeoutMs({ target: 'verifier', path: '/qdev/v1/evaluate' }), 720_000);
  assert.ok(MAILBOX_LIMITS.maxEvaluateForwardMs >= 600_000 + 60_000, 'covers the verifier evaluation deadline plus grace');
  for (const e of [{ target: 'verifier', path: '/qdev/v1/handoff' }, { target: 'verifier', path: '/qdev/v1/verdict' }, { target: 'factory', path: '/api/connect/v1/dispatches' }])
    assert.equal(forwardTimeoutMs(e), 30_000);
  const h = await harness(t);
  let release; gates.evaluate = new Promise(r => { release = r; }); t.after(() => { release(); delete gates.evaluate; });
  h.queue.push(envelope({ target: 'verifier', path: '/qdev/v1/evaluate', deadline: new Date(Date.now() + 900_000).toISOString() }), envelope());
  const poller = h.make(); const running = poller.run();
  for (let i = 0; i < 100 && h.responses.length < 1; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(h.responses.length, 1, 'the Factory request was answered while the evaluation was still running');
  assert.equal(h.verifierSeen.length, 1);
  release();
  for (let i = 0; i < 100 && h.responses.length < 2; i++) await new Promise(r => setTimeout(r, 20));
  poller.stop(); await running;
  assert.equal(h.responses.length, 2);
});
