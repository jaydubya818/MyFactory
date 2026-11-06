import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { parseMeteredContainerProfile, parseAnyContainerProfile, meteredContainerExecutorVersion, containerExecutorVersion, OWNER_CONTAINER_POLICY } from '../src/owner-container-profile.mjs';
import { rewriteMeteredArgv, resetWorkerHome, sweepBrokerCredentials, assertCredentialBindIsolation } from '../src/owner-container-worker.mjs';
import { MeteredContainerExecutor } from '../src/metered-container.ts';
import { assertTrustedExecutablePath } from '../src/executable-trust.ts';
// The wrapper runs under process.execPath, which must itself be trusted. Where it is not (e.g. a shared CI toolcache), the executor must
// refuse fail-closed before any container exists; the positive path is exercised on the pinned owner Mac profile.
const trustedNode = (() => { try { assertTrustedExecutablePath(process.execPath); return true; } catch { return false; } })();
import { createCodexAdapter } from '../../../packages/agents/src/index.ts';
import { isOwnerSubscriptionExecutorVersion } from '../../../packages/contracts/src/owner-subscription-route.ts';
import { createLocalV4Supervisor, createSupervisor } from '../src/server.ts';
import { OWNER_SUBSCRIPTION_PRICING_REVISION } from '../../../packages/storage/src/spend-policy.ts';

const WORKER = fileURLToPath(new URL('../src/owner-container-worker.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('./fixtures/fake-docker.mjs', import.meta.url));
const IMAGE = 'sha256:' + 'c'.repeat(64);
const mono = () => Number(process.hrtime.bigint() / 1_000_000n);
const hex = () => randomBytes(32).toString('hex');

function fixture(t, image = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'metered-container-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin, { mode: 0o700 });
  const docker = join(bin, 'docker');
  writeFileSync(docker, `#!${process.execPath}\nimport ${JSON.stringify(FAKE)};\n`, { mode: 0o755 });
  mkdirSync(join(bin, 'fake-docker-state'));
  writeFileSync(join(bin, 'fake-docker-state', 'image.json'), JSON.stringify({ id: IMAGE, ...image }));
  const state = join(root, 'state'); mkdirSync(state, { mode: 0o700 });
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const git = (...a) => execFileSync('/usr/bin/git', a, { cwd: workspace, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  git('init', '-q'); writeFileSync(join(workspace, 'a.txt'), 'a\n'); git('add', '.'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base');
  const read = name => JSON.parse(readFileSync(join(bin, 'fake-docker-state', name), 'utf8'));
  return { root, docker, state, workspace, profile: { imageId: IMAGE, dockerExecutable: docker, stateDirectory: state }, read };
}
function gatewayArgv(output, port = 43123, extra = []) {
  return ['exec', '-m', 'openai/gpt-5.5', '--ignore-user-config', '-c', 'model_provider="factory_spend"',
    '-c', 'model_providers.factory_spend.name="Factory Spend Gateway"', '-c', `model_providers.factory_spend.base_url="http://127.0.0.1:${port}/v1"`,
    '-c', 'model_providers.factory_spend.env_key="FACTORY_GATEWAY_TOKEN"', '-c', 'model_providers.factory_spend.wire_api="responses"',
    '-c', 'web_search="disabled"', ...extra, '-C', '/placeholder', '--sandbox', 'workspace-write', '--json', '-o', output, 'do the task'];
}
function runWrapper(f, invocation, argv, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [WORKER, JSON.stringify(invocation), ...argv.map(a => a === '/placeholder' ? f.workspace : a)], { cwd: f.workspace, env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', d => { stderr += d; });
    child.once('close', code => resolve({ code, stderr }));
  });
}
const invocationFor = (f, extra = {}) => ({ mode: 'metered', profile: f.profile, runId: 'run1', workId: 'work1', operationId: 'op' + randomBytes(4).toString('hex'),
  owner: f.root, supervisorPid: process.pid, model: 'openai/gpt-5.5', deadlineMonoMs: mono() + 60_000, ...extra });

test('metered profile carries no credential and is never interchangeable with the owner profile', () => {
  const p = { imageId: IMAGE, dockerExecutable: '/usr/bin/docker', stateDirectory: '/private/state' };
  assert.deepEqual(parseMeteredContainerProfile(p), p);
  assert.equal(parseAnyContainerProfile(p).mode, 'metered');
  assert.equal(parseAnyContainerProfile({ ...p, authFile: '/private/auth.json' }).mode, 'owner');
  for (const raw of [{ ...p, authFile: '/a' }, { ...p, stateDirectory: '/private/a,b' }, { ...p, imageId: 'worker:latest' }, { ...p, extra: 1 }, { ...p, stateDirectory: 'rel' }])
    assert.throws(() => parseMeteredContainerProfile(raw), /METERED_CONTAINER_PROFILE_INVALID/);
  const v = meteredContainerExecutorVersion('codex-cli 0.163.0', p);
  assert.match(v, /route=LOCAL_V4_METERED isolation=metered-container-v1/);
  assert.ok(v.includes(OWNER_CONTAINER_POLICY));
  assert.equal(isOwnerSubscriptionExecutorVersion(v), false);
  assert.notEqual(v, containerExecutorVersion('codex-cli 0.163.0', { ...p, authFile: '/private/auth.json' }));
  assert.throws(() => meteredContainerExecutorVersion('codex-cli 0.164.0', p), /VERSION_INVALID/);
});

test('metered argv: only the host spend-gateway provider, rewritten to the broker alias; login or provider overrides refuse', () => {
  const { argv, port } = rewriteMeteredArgv(gatewayArgv('/tmp/out.txt', 50111));
  assert.equal(port, 50111);
  assert.ok(argv.includes('model_providers.factory_spend.base_url="http://factory-owner-auth:8787/v1"'));
  assert.ok(!argv.some(a => a.includes('127.0.0.1')));
  const bad = [
    gatewayArgv('/o').map(a => a.replace('127.0.0.1', '10.0.0.1')),
    gatewayArgv('/o').filter(a => !a.includes('env_key')),
    gatewayArgv('/o').filter(a => a !== '--ignore-user-config'),
    gatewayArgv('/o', 1, ['-c', 'forced_login_method="chatgpt"']),
    gatewayArgv('/o', 1, ['-c', 'model_providers.factory_spend.requires_openai_auth=true']),
    gatewayArgv('/o', 1, ['-c', 'model_providers.factory_spend.base_url="http://127.0.0.1:9/v1"']),
  ];
  for (const argv of bad) assert.throws(() => rewriteMeteredArgv(argv), /METERED_CONTAINER_ARGUMENTS_INVALID/);
  // Task text is never filtered: the positional prompt may mention ChatGPT, OPENAI_API_KEY, base_url or login methods (review P3).
  for (const prompt of ['Use ChatGPT login docs', 'Document OPENAI_API_KEY', '- forced_login_method="chatgpt" in README', 'set model_providers.x.base_url="http://127.0.0.1:1/v1"'])
    assert.equal(rewriteMeteredArgv([...gatewayArgv('/o').slice(0, -1), prompt]).argv.at(-1), prompt);
});

test('worker home is reset between operations: config.toml and other files never survive; sessions survive only for resume', t => {
  const root = mkdtempSync(join(tmpdir(), 'home-reset-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  resetWorkerHome(home, false);
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), 'notify = ["sh"]\n'); writeFileSync(join(home, '.codex', 'sessions', 's.jsonl'), '{}');
  writeFileSync(join(home, '.bashrc'), 'curl evil'); mkdirSync(join(home, '.codex', 'rules')); writeFileSync(join(home, '.codex', 'AGENTS.md'), 'x');
  resetWorkerHome(home, true);
  assert.deepEqual(readdirSync(home), ['.codex']);
  assert.deepEqual(readdirSync(join(home, '.codex')), ['sessions']);
  resetWorkerHome(home, false);
  assert.deepEqual(readdirSync(join(home, '.codex')), []);
});

test('legacy broker credential files are swept at entry and recovery, including after a crash before docker create', t => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const op of ['a', 'b']) { mkdirSync(join(root, op)); writeFileSync(join(root, op, 'broker.json'), '{"accessToken":"real"}', { mode: 0o600 }); }
  writeFileSync(join(root, 'a', 'intent.json'), '{}');
  assert.equal(sweepBrokerCredentials(root), 2);
  assert.ok(!existsSync(join(root, 'a', 'broker.json')) && existsSync(join(root, 'a', 'intent.json')));
  assert.equal(sweepBrokerCredentials(join(root, 'missing')), 0);
});

test('metered container end to end (synthetic Docker): the API key never exists anywhere, the gateway token reaches only the broker in memory', async t => {
  const f = fixture(t);
  const gatewayToken = hex(), output = join(f.root, 'final-host.txt');
  // A stale credential file from an older build is removed before anything runs.
  mkdirSync(join(f.state, 'old-op'), { mode: 0o700 }); writeFileSync(join(f.state, 'old-op', 'broker.json'), '{"accessToken":"stale"}', { mode: 0o600 });
  const homes = join(f.state, 'homes'); mkdirSync(homes, { mode: 0o700 });
  const r = await runWrapper(f, invocationFor(f), gatewayArgv(output, 45555), { FACTORY_GATEWAY_TOKEN: gatewayToken });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'done\n');
  const broker = f.read('broker-stdin.json');
  assert.equal(broker.mode, 'metered'); assert.equal(broker.gatewayToken, gatewayToken);
  assert.equal(broker.upstream, 'http://host.docker.internal:45555');
  const view = f.read('worker-view.json');
  assert.match(view.invocation.workerGatewayToken, /^[a-f0-9]{64}$/);
  assert.notEqual(view.invocation.workerGatewayToken, gatewayToken);
  assert.equal(broker.workerToken, view.invocation.workerGatewayToken);
  assert.ok(view.invocation.argv.includes('model_providers.factory_spend.base_url="http://factory-owner-auth:8787/v1"'));
  assert.ok(view.invocation.argv.includes('sandbox_workspace_write.network_access=false'));
  assert.equal(view.invocation.argv[view.invocation.argv.indexOf('-o') + 1], '/output/final.txt');
  // While the worker ran, nothing in the state tree (every host path any bind reaches) held the gateway token or a broker file.
  for (const file of view.visible) {
    assert.ok(!file.text.includes(gatewayToken), file.path);
    assert.ok(!file.path.endsWith('broker.json'), file.path);
  }
  assert.ok(!Object.keys(view.mounts).includes('/home/worker/.codex/auth.json'));
  const log = f.read('state.json').log;
  const workerCreate = log.find(a => a[0] === 'create' && a.includes('myfactory-owner-codex'));
  const brokerCreate = log.find(a => a[0] === 'create' && a.includes('myfactory-owner-codex-auth'));
  assert.ok(workerCreate.includes('--memory-swap') && workerCreate.includes('none'));
  assert.ok(brokerCreate.includes('--interactive') && brokerCreate.includes('host.docker.internal:host-gateway'));
  assert.ok(!JSON.stringify(log).includes(gatewayToken), 'the token is never on any docker argv');
  // Cleanup: no containers left, and the hostile config.toml written by the worker does not survive the operation.
  assert.deepEqual(Object.keys(f.read('state.json').containers), []);
  const home = join(homes, readdirSync(homes)[0], '.codex');
  assert.deepEqual(readdirSync(home), ['sessions']);
  assert.ok(!existsSync(join(f.state, 'old-op', 'broker.json')));
  for (const file of readdirSync(f.state, { recursive: true })) assert.ok(!String(file).endsWith('broker.json'), String(file));
});

test('metered wrapper refusals: missing gateway token, owner profile in metered mode, owner-mode profile mismatch', async t => {
  const f = fixture(t), output = join(f.root, 'o.txt');
  assert.notEqual((await runWrapper(f, invocationFor(f), gatewayArgv(output), {})).code, 0);
  assert.notEqual((await runWrapper(f, invocationFor(f, { mode: 'owner' }), gatewayArgv(output), { FACTORY_GATEWAY_TOKEN: hex() })).code, 0);
  assert.notEqual((await runWrapper(f, invocationFor(f), gatewayArgv(output).map(a => a.replace('factory_spend.env_key', 'x')), { FACTORY_GATEWAY_TOKEN: hex() })).code, 0);
  assert.equal(existsSync(join(f.root, 'bin', 'fake-docker-state', 'broker-stdin.json')), false);
  assert.ok(!f.read('state.json').log.some(a => a[0] === 'create'), 'refused before any container exists');
});

test('owner mode end to end (synthetic Docker): the real access token reaches the broker on stdin only; no broker.json at any time', async t => {
  const f = fixture(t);
  const authFile = join(f.root, 'auth.json');
  const access = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.sig`;
  writeFileSync(authFile, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: access, account_id: 'acct', refresh_token: 'REFRESH-SECRET' } }), { mode: 0o600 });
  const output = join(f.root, 'owner-out.txt');
  const argv = ['exec', '-m', 'openai/gpt-5.5', '--ignore-user-config', '-C', '/placeholder', '--sandbox', 'workspace-write', '--json', '-o', output, 'task'];
  const r = await runWrapper(f, { profile: { ...f.profile, authFile }, runId: 'run1', workId: 'w', operationId: 'op1', owner: f.root, supervisorPid: process.pid,
    model: 'openai/gpt-5.5', deadlineMonoMs: mono() + 60_000 }, argv, {});
  assert.equal(r.code, 0, r.stderr);
  const broker = f.read('broker-stdin.json');
  assert.equal(broker.mode, 'owner'); assert.equal(broker.accessToken, access);
  const view = f.read('worker-view.json');
  for (const file of view.visible) { assert.ok(!file.text.includes(access) && !file.text.includes('REFRESH-SECRET'), file.path); assert.ok(!file.path.endsWith('broker.json')); }
});

test('adapter: the metered container requires the gateway and excludes the owner login; the executor routes Codex into the wrapper', async t => {
  const f = fixture(t);
  const codex = join(f.root, 'bin', 'codex'); writeFileSync(codex, '#!/bin/sh\necho "codex-cli 0.163.0"\n', { mode: 0o755 });
  const artifacts = join(f.root, 'artifacts'); mkdirSync(artifacts);
  const adapter = createCodexAdapter(codex, 'mac');
  const base = { workspacePath: f.workspace, artifactsDir: artifacts, prompt: 'task', model: 'openai/gpt-5.5', timeoutMs: 60_000 };
  const meteredContainer = { script: WORKER, invocation: { mode: 'metered' } };
  await assert.rejects(adapter.runCodex({ ...base, meteredContainer }), /Metered container requires the metered gateway/);
  await assert.rejects(adapter.runCodex({ ...base, gateway: { baseUrl: 'http://127.0.0.1:1/v1', childToken: hex() }, meteredContainer: { ...meteredContainer, invocation: { mode: 'owner' } } }), /Metered container/);
  const executor = new MeteredContainerExecutor(adapter, f.profile, f.root);
  await assert.rejects(executor.runCodex({ ...base }), /GATEWAY_REQUIRED/);
  await assert.rejects(executor.runCodex({ ...base, gateway: { baseUrl: 'http://127.0.0.1:1/v1', childToken: hex() }, ownerLogin: true }), /OPTIONS_REFUSED/);
  const childToken = hex(), gateway = { baseUrl: 'http://127.0.0.1:47001/v1', childToken };
  if (!trustedNode) { executor.bindOperation(childToken, { runId: randomUUID(), workId: randomUUID(), deadlineMonoMs: mono() + 30_000 });
    await assert.rejects(executor.runCodex({ ...base, gateway }), /HOST_CODEX_UNTRUSTED/); t.diagnostic('untrusted Node runtime: refused fail-closed'); return; }
  await assert.rejects(executor.runCodex({ ...base, gateway }), /OPERATION_UNBOUND/, 'an unbound token never starts a container');
  // An admitted Work deadline already reached refuses before any container exists (no fresh per-invocation allowance).
  const late = hex(); executor.bindOperation(late, { runId: 'run-late', workId: 'w', deadlineMonoMs: mono() - 1 });
  await assert.rejects(executor.runCodex({ ...base, gateway: { ...gateway, childToken: late } }), /WORK_DEADLINE_REACHED/);
  assert.throws(() => executor.bindOperation(late, { runId: 'r', workId: 'w', deadlineMonoMs: mono() + 1000 }), /BINDING_INVALID/, 'never rebinds');
  const runId = randomUUID(), workDeadline = mono() + 45_000;
  executor.bindOperation(childToken, { runId, workId: randomUUID(), deadlineMonoMs: workDeadline });
  const result = await executor.runCodex({ ...base, gateway, prompt: 'Explain ChatGPT login vs OPENAI_API_KEY; do not set forced_login_method.' });
  assert.equal(result.exitCode, 0, readFileSync(result.stderrPath, 'utf8'));
  const create = f.read('state.json').log.find(a => a[0] === 'create' && a.includes('myfactory-owner-codex'));
  assert.ok(create.includes(`factory.run=${runId}`), 'the container label is the saved Run id that readback probes');
  const invocationDeadline = f.read('worker-view.json').invocation.deadlineUnixMs;
  assert.ok(invocationDeadline <= Date.now() + 45_000, 'the container deadline is the shared absolute Work deadline, not a fresh 600 s');
  assert.equal(f.read('broker-stdin.json').gatewayToken, childToken);
  assert.equal(f.read('broker-stdin.json').upstream, 'http://host.docker.internal:47001');
  const pre = await executor.preflightCodex();
  assert.match(pre.version, /route=LOCAL_V4_METERED/);
});

test('native execution is impossible from configuration: no container means refusal for every executable and provider URL (review MF-2 P1)', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'native-refusal-2-'))); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const price = { revision: 'r1', model: 'openai/gpt-5.5', validUntil: '2099-01-01T00:00:00Z', contextLimitTokens: 1000, outputLimitTokens: 100, inputMicrousdPerMillion: 1, outputMicrousdPerMillion: 1 };
  const loopback = { upstreamOrigin: 'http://127.0.0.1:9', authorize: async () => 'k', price };   // could be a reverse proxy to the real provider
  const make = productiveBinding => () => createLocalV4Supervisor({ dataDir: dir, resultSigning: {}, productiveBinding });
  // The bypass from round 2: a "marked" script that execs the real CLI through shell quoting. Content is no longer inspected at all.
  const bypass = join(dir, 'marked'); writeFileSync(bypass, '#!/bin/sh\n# MYFACTORY_NATIVE_FIXTURE_STAND_IN_NOT_CODEX\nexec /opt/homebrew/bin/co""dex "$@"\n', { mode: 0o755 });
  for (const codexExecutable of [bypass, process.execPath, '/usr/bin/true'])
    for (const extra of [{}, { requireContainer: false }]) assert.throws(make({ provider: loopback, codexExecutable, ...extra }), /Native metered execution refused|not qualified/);
  // The only alternative is an in-process synthetic adapter object (test-only; host JSON cannot express a function), loopback-only.
  const fixture = { runCodex: async () => ({}), preflightCodex: async () => ({}) };
  assert.throws(make({ provider: { ...loopback, upstreamOrigin: 'https://api.openai.com' }, codexExecutable: bypass, nativeFixtureAdapter: fixture }), /test-only, loopback-only/);
  assert.throws(make({ provider: loopback, codexExecutable: bypass, nativeFixtureAdapter: fixture, container: { imageId: IMAGE, dockerExecutable: '/usr/bin/docker', stateDirectory: '/s' } }), /exclusive with the container/);
  assert.throws(make({ provider: loopback, codexExecutable: bypass, nativeFixtureAdapter: { runCodex: 'exec' } }), /test-only/);
  assert.throws(make({ provider: { ...loopback, price: { ...price, revision: OWNER_SUBSCRIPTION_PRICING_REVISION } }, codexExecutable: bypass, nativeFixtureAdapter: fixture }), /subscription operations revision/);
  // No production source composes the fixture seam: only server.ts names it (to validate it).
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  for (const file of ['apps/supervisor/src/local-v4-host.ts', 'scripts/local-v4-host.mjs', 'apps/supervisor/src/dispatch-control.ts', 'apps/supervisor/src/metered-container.ts'])
    assert.ok(!readFileSync(join(root, file), 'utf8').includes('nativeFixtureAdapter'), file);
});

test('container mode never runs the configured executable on the host; the only spawned process is the pinned wrapper under trusted Node', async t => {
  const f = fixture(t);
  const ran = join(f.root, 'host-ran'), codex = join(f.root, 'bin', 'codex-never'); writeFileSync(codex, `#!/bin/sh\ntouch ${ran}\nexit 9\n`, { mode: 0o755 });
  const executor = new MeteredContainerExecutor(createCodexAdapter(codex, 'mac'), f.profile, f.root);
  const pre = await executor.preflightCodex();
  assert.match(pre.version, /^codex-cli 0\.163\.0 route=LOCAL_V4_METERED/); assert.equal(pre.authenticated, true);
  const artifacts = join(f.root, 'artifacts2'); mkdirSync(artifacts);
  const token = hex(); executor.bindOperation(token, { runId: randomUUID(), workId: randomUUID(), deadlineMonoMs: mono() + 30_000 });
  if (!trustedNode) { await assert.rejects(executor.runCodex({ workspacePath: f.workspace, artifactsDir: artifacts, prompt: 'task', model: 'openai/gpt-5.5', timeoutMs: 30_000,
    gateway: { baseUrl: 'http://127.0.0.1:47002/v1', childToken: token } }), /HOST_CODEX_UNTRUSTED/); assert.equal(existsSync(ran), false); t.diagnostic('untrusted Node runtime: refused fail-closed'); return; }
  const result = await executor.runCodex({ workspacePath: f.workspace, artifactsDir: artifacts, prompt: 'task', model: 'openai/gpt-5.5', timeoutMs: 30_000,
    gateway: { baseUrl: 'http://127.0.0.1:47002/v1', childToken: token } });
  assert.equal(result.exitCode, 0, readFileSync(result.stderrPath, 'utf8'));
  assert.equal(existsSync(ran), false, 'the configured executable never ran on the host');
});

test('legacy private-alpha native execution is closed', () => {
  const realProvider = { mode: 'OPENAI_RESPONSES_PRIVATE_ALPHA' };
  assert.throws(() => createSupervisor({ realProvider }), /./);
  const text = readFileSync(fileURLToPath(new URL('../src/private-alpha.ts', import.meta.url)), 'utf8');
  assert.match(text, /throw Error\('Legacy private-alpha native execution is closed/);
  assert.ok(!/createSupervisor\(/.test(text), 'the entry point no longer composes a supervisor');
});

test('credential bind isolation also holds for the metered mode (no auth file)', t => {
  const root = mkdtempSync(join(tmpdir(), 'bind-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const ws = join(root, 'ws'), st = join(root, 'st'); mkdirSync(ws); mkdirSync(st);
  assertCredentialBindIsolation(null, st, ws);
  assert.throws(() => assertCredentialBindIsolation(null, join(ws), ws), /STATE_INSIDE_WORKSPACE/);
});
