import { spawnSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, lstatSync, realpathSync, rmSync, existsSync, copyFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_CONTAINER_NAME as WORKER, OWNER_CONTAINER_BROKER as BROKER, OWNER_CONTAINER_NETWORK as NETWORK, parseOwnerContainerProfile, OWNER_CONTAINER_POLICY, assertOwnerContainerPolicy, qualifyContainerClock, ownerDockerEndpoint } from './owner-container-profile.mjs';
import { assertTrustedExecutablePath, assertTrustedFile, trustedAncestors } from './executable-trust.ts';

const mono = () => Number(process.hrtime.bigint() / 1_000_000n);
const env = { PATH: '/usr/bin:/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin', HOME: process.env.HOME };
export function dockerCommand(profile, args, timeout = 10_000) {
  assertTrustedExecutablePath(profile.dockerExecutable);
  assertOwnerContainerPolicy();
  const r = spawnSync(profile.dockerExecutable, ['--host',ownerDockerEndpoint(),...args], { encoding: 'utf8', env, timeout, maxBuffer: 2 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw Error('OWNER_CONTAINER_DOCKER_UNAVAILABLE');
  return r.stdout.trim();
}
function absent(profile) {
  // Empty success is required. Daemon failure, running OR stopped containers all refuse before ledger exposure.
  for (const name of [WORKER, BROKER]) if (dockerCommand(profile, ['ps', '-aq', '--filter', `name=^/${name}$`])) return false;
  return true;
}
export function assertContainerAvailable(raw) {
  const p = parseOwnerContainerProfile(raw);
  assertTrustedFile(p.authFile);
  privateDir(p.stateDirectory);
  if (!trustedAncestors(realpathSync(p.stateDirectory))) throw Error('OWNER_CONTAINER_STATE_UNTRUSTED');
  if (!process.getuid() || !Number.isSafeInteger(process.getgid())) throw Error('OWNER_CONTAINER_NONROOT_OPERATOR_REQUIRED');
  if (!absent(p)) throw Error('OWNER_CONTAINER_PREVIOUS_EXECUTION_UNRESOLVED');
  const image = JSON.parse(dockerCommand(p, ['image', 'inspect', p.imageId]));
  if (image.length !== 1 || image[0].Id !== p.imageId || image[0].Config?.Labels?.['factory.owner.policy'] !== OWNER_CONTAINER_POLICY ||
      image[0].Config?.Labels?.['factory.owner.codex'] !== '0.163.0' || image[0].Config?.Labels?.['factory.owner.node'] !== '24.22.1' ||
      image[0].Config?.Labels?.['factory.owner.undici'] !== '7.30.1') throw Error('OWNER_CONTAINER_IMAGE_MISMATCH');
  const st = lstatSync(p.authFile);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077)) throw Error('OWNER_CONTAINER_AUTH_UNTRUSTED');
  const auth = JSON.parse(readFileSync(p.authFile, 'utf8'));
  const tokens = auth.tokens;
  if (auth.auth_mode !== 'chatgpt' || !tokens?.access_token || !tokens.account_id) throw Error('OWNER_CONTAINER_CHATGPT_REQUIRED');
  const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString('utf8'));
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 < Date.now() + 610_000) throw Error('OWNER_CONTAINER_AUTH_EXPIRY');
  return p;
}
const safeId = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
function privateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const st = lstatSync(path);
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077)) throw Error('OWNER_CONTAINER_STATE_UNTRUSTED');
}
const jsonFile = (path, data, mode = 0o600) => {
  const fd = openSync(path, 'wx', mode);
  try { writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
};
const ownerHash = owner => createHash('sha256').update(owner).digest('hex');
export function assertCredentialBindIsolation(authFile, stateDirectory, workspacePath) {
  const workspace = realpathSync(workspacePath), state = realpathSync(stateDirectory), auth = realpathSync(authFile);
  for (const root of [workspace, state]) {
    const path = relative(root, auth);
    if (path === '' || path !== '..' && !path.startsWith('../') && !isAbsolute(path)) throw Error('OWNER_CONTAINER_AUTH_EXPOSED_BY_BIND');
  }
  const path = relative(workspace, state);
  if (path === '' || path !== '..' && !path.startsWith('../') && !isAbsolute(path)) throw Error('OWNER_CONTAINER_STATE_INSIDE_WORKSPACE');
}

/** Startup may remove only this host's recorded resources after the old supervisor is proven absent. UNKNOWN ledger state is never cleared. */
export function recoverOwnerContainers(raw, owner) {
  const p = parseOwnerContainerProfile(raw);
  try {
    const found = [];
    for (const name of [WORKER, BROKER]) {
      const id = dockerCommand(p, ['ps', '-aq', '--filter', `name=^/${name}$`]);
      if (!id) continue;
      const info = JSON.parse(dockerCommand(p, ['inspect', id]))[0]; const labels = info.Config?.Labels ?? {};
      const op = labels['factory.owner.operation'];
      if (!safeId(op) || labels['factory.owner.host'] !== ownerHash(owner) || labels['factory.owner.policy'] !== OWNER_CONTAINER_POLICY) throw Error('FOREIGN');
      const path = join(p.stateDirectory, op, 'intent.json'), st = lstatSync(path);
      if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077)) throw Error('MANIFEST');
      const record = JSON.parse(readFileSync(path, 'utf8'));
      if (record.owner !== owner || record.operationId !== op || labels['factory.run'] !== record.runId || info.Image !== p.imageId ||
        !Number.isSafeInteger(record.supervisorPid) || record.supervisorPid < 2) throw Error('BINDING');
      try { process.kill(record.supervisorPid, 0); throw Error('LIVE'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
      found.push({ id: info.Id, operationId: op });
    }
    const network = dockerCommand(p, ['network', 'ls', '-q', '--filter', `name=^${NETWORK}$`]);
    if (network) {
      const info = JSON.parse(dockerCommand(p, ['network', 'inspect', network]))[0];
      if (!found.length || info.Labels?.['factory.owner.host'] !== ownerHash(owner) || !found.some(f => f.operationId === info.Labels?.['factory.owner.operation'])) throw Error('NETWORK');
    }
    for (const f of found) dockerCommand(p, ['rm', '-f', f.id]);
    if (network) dockerCommand(p, ['network', 'rm', network]);
    if (!absent(p)) throw Error('NOT_ABSENT');
    for (const f of found) rmSync(join(p.stateDirectory, f.operationId, 'broker.json'), { force: true });
    return { status: found.length ? 'REAPED' : 'NONE', ledgerReconciled: false };
  } catch { return { status: 'UNVERIFIED', ledgerReconciled: false }; }
}

export async function runContainer(invocation, argv) {
  const p = assertContainerAvailable(invocation.profile);
  if (![invocation.runId, invocation.workId, invocation.operationId].every(safeId) ||
    !Number.isSafeInteger(invocation.deadlineMonoMs) || invocation.deadlineMonoMs <= mono()) throw Error('OWNER_CONTAINER_INVOCATION_INVALID');
  const left = () => Math.max(0, Math.min(600_000, Math.floor(invocation.deadlineMonoMs - mono())));
  // Reserve one second for the independently qualified host/VM clock skew; setup never gives time back.
  const deadlineUnixMs = Date.now() + left() - 1000;
  const workspace = realpathSync(process.cwd());
  assertCredentialBindIsolation(p.authFile, p.stateDirectory, workspace);
  const outputAt = argv.indexOf('-o');
  const cwdAt = argv.indexOf('-C');
  if (outputAt < 0 || !argv[outputAt + 1] || (cwdAt >= 0 && realpathSync(argv[cwdAt + 1]) !== workspace)) throw Error('OWNER_CONTAINER_ARGUMENTS_INVALID');
  const hostOutput = resolve(argv[outputAt + 1]);
  const opDir = join(p.stateDirectory, invocation.operationId), home = join(p.stateDirectory, 'homes', createHash('sha256').update(invocation.workId).digest('hex'));
  privateDir(p.stateDirectory); privateDir(opDir); privateDir(home);
  const output = join(opDir, 'output'); privateDir(output);
  const codexHome = join(home, '.codex'); privateDir(codexHome);
  // These are synthetic identifiers, never projections of real account claims or reusable authentication.
  const jwt = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: 4102444800, jti: randomBytes(32).toString('base64url'), 'https://api.openai.com/auth': { chatgpt_account_id: 'factory-isolated', chatgpt_plan_type: 'pro' } })).toString('base64url')}.factory`;
  const workerToken = jwt;
  const dummyAuth = join(codexHome, 'auth.json');
  if (lstatSync(codexHome).isSymbolicLink()) throw Error('OWNER_CONTAINER_HOME_UNTRUSTED');
  if (!existsSync(dummyAuth)) writeFileSync(dummyAuth, '{}', { mode: 0o444, flag: 'wx' });
  if (!lstatSync(dummyAuth).isFile() || lstatSync(dummyAuth).isSymbolicLink()) throw Error('OWNER_CONTAINER_AUTH_TARGET_UNTRUSTED');
  jsonFile(join(opDir, 'auth.json'), { auth_mode: 'chatgpt', OPENAI_API_KEY: null,
    tokens: { id_token: jwt, access_token: workerToken, refresh_token: '', account_id: 'factory-isolated' }, last_refresh: new Date().toISOString() }, 0o444);
  const auth = JSON.parse(readFileSync(p.authFile, 'utf8'));
  jsonFile(join(opDir, 'broker.json'), { accessToken: auth.tokens.access_token, accountId: auth.tokens.account_id, workerToken, model: invocation.model, deadlineUnixMs });
  const childArgv = [...argv]; childArgv[outputAt + 1] = '/output/final.txt'; if (cwdAt >= 0) childArgv[cwdAt + 1] = '/workspace';
  childArgv.splice(childArgv.indexOf('--json'), 0,
    '-c', 'chatgpt_base_url="http://factory-owner-auth:8787"', '-c', 'approval_policy="never"',
    '-c', 'model_provider="factory_owner"', '-c', 'model_providers.factory_owner.name="Factory owner credential broker"',
    '-c', 'model_providers.factory_owner.base_url="http://factory-owner-auth:8787"', '-c', 'model_providers.factory_owner.supports_websockets=false',
    '-c', 'model_providers.factory_owner.requires_openai_auth=true', '-c', 'model_providers.factory_owner.wire_api="responses"',
    '-c', 'features.responses_websockets=false', '-c', 'features.responses_websockets_v2=false', '-c', 'features.enable_request_compression=false',
    '-c', 'sandbox_workspace_write.network_access=false',
    '-c', 'model_providers.factory_owner.request_max_retries=0', '-c', 'model_providers.factory_owner.stream_max_retries=0');
  const readOnly = childArgv.includes('read-only') || childArgv.includes('sandbox_mode="read-only"');
  // Export only the exact input Git objects; never expose the host's common Git directory, remotes, hooks or credentials.
  const gitDir = join(opDir, 'git');
  const git = spawnSync('/usr/bin/git', ['clone', '--bare', '--no-hardlinks', '--depth=1', `file://${workspace}`, gitDir],
    { env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
  if (git.error || git.status !== 0) throw Error('OWNER_CONTAINER_INPUT_GIT_REFUSED');
  writeFileSync(join(gitDir, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\nworktree = /workspace\n[safe]\ndirectory = /workspace\n');
  jsonFile(join(opDir, 'invocation.json'), { argv: childArgv, remainingMs: left(), deadlineUnixMs, workerUid: process.getuid(), workerGid: process.getgid() }, 0o444);
  writeFileSync(join(opDir, 'git-link'), 'gitdir: /git\n', { flag: 'wx', mode: 0o444 });
  const label = ['--label', `factory.run=${invocation.runId}`, '--label', `factory.owner.operation=${invocation.operationId}`, '--label', `factory.owner.policy=${OWNER_CONTAINER_POLICY}`];
  if (typeof invocation.owner !== 'string' || !isAbsolute(invocation.owner) || !Number.isSafeInteger(invocation.supervisorPid) || invocation.supervisorPid < 2) throw Error('OWNER_CONTAINER_HOST_BINDING');
  label.push('--label', `factory.owner.host=${ownerHash(invocation.owner)}`);
  jsonFile(join(opDir, 'intent.json'), { owner: invocation.owner, supervisorPid: invocation.supervisorPid, operationId: invocation.operationId, runId: invocation.runId });
  const seccompFile = join(opDir, 'seccomp.json');
  assertOwnerContainerPolicy();
  writeFileSync(seccompFile, readFileSync(new URL('../container/seccomp.json', import.meta.url)), { mode: 0o400, flag: 'wx' });
  const gitMount = lstatSync(join(workspace, '.git')).isDirectory()
    ? `type=bind,src=${gitDir},dst=/workspace/.git,readonly`
    : `type=bind,src=${join(opDir, 'git-link')},dst=/workspace/.git,readonly`;
  const common = ['--pull=never', '--read-only', '--security-opt', 'no-new-privileges', '--pids-limit', '192', '--memory', '2g', '--cpus', '2', '--cap-drop', 'ALL', ...label];
  let workerId, brokerId, networkId, running;
  let stopped = false, cleanupFailed = false;
  const cleanup = () => {
    if (stopped) return; stopped = true;
    for (const id of [workerId, brokerId]) if (id) { try { dockerCommand(p, ['rm', '-f', id]); } catch { cleanupFailed = true; } }
    if (networkId) { try { dockerCommand(p, ['network', 'rm', networkId]); } catch { cleanupFailed = true; } }
    try { if (!absent(p)) cleanupFailed = true; } catch { cleanupFailed = true; }
    if (!cleanupFailed) rmSync(join(opDir, 'broker.json'), { force: true });
  };
  const onSignal = () => { cleanup(); process.exit(124); };
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
  let exit = 125;
  try {
    if (left() <= 0) return 124;
    // Atomic fixed-name create is the second machine-wide exclusion, independent of the native flock lifetime.
    workerId = dockerCommand(p, ['create', '--name', WORKER, '--network', 'none', ...common,
      '--security-opt', `seccomp=${seccompFile}`, '--cap-add', 'SETUID', '--cap-add', 'SETGID',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777', '--tmpfs', '/run:rw,nosuid,nodev,size=16m',
      '--mount', `type=bind,src=${workspace},dst=/workspace${readOnly ? ',readonly' : ''}`,
      '--mount', `type=bind,src=${gitDir},dst=/git,readonly`, '--mount', gitMount,
      '--mount', `type=bind,src=${home},dst=/home/worker`, '--mount', `type=bind,src=${output},dst=/output`,
      '--mount', `type=bind,src=${join(opDir, 'auth.json')},dst=/home/worker/.codex/auth.json,readonly`,
      '--mount', `type=bind,src=${join(opDir, 'invocation.json')},dst=/run/factory/invocation.json,readonly`, p.imageId]);
    networkId = dockerCommand(p, ['network', 'create', '--internal', ...label, NETWORK]);
    brokerId = dockerCommand(p, ['create', '--name', BROKER, '--network', 'bridge', ...common, '--user', `${process.getuid()}:${process.getgid()}`,
      '--mount', `type=bind,src=${join(opDir, 'broker.json')},dst=/run/factory/broker.json,readonly`,
      '--entrypoint', 'node', p.imageId, '/opt/factory-owner/broker.mjs']);
    dockerCommand(p, ['network', 'connect', '--alias', 'factory-owner-auth', NETWORK, brokerId]);
    dockerCommand(p, ['network', 'disconnect', 'none', workerId]);
    dockerCommand(p, ['network', 'connect', NETWORK, workerId]);
    jsonFile(join(opDir, 'resources.json'), { ...invocation, supervisorPid: process.ppid, wrapperPid: process.pid, workerId, brokerId, networkId, deadlineUnixMs });
    if (left() <= 0) return 124;
    dockerCommand(p, ['start', brokerId]);
    const beforeClock = { wall: Date.now(), mono: mono() };
    const guestWall = Number(dockerCommand(p, ['exec', brokerId, 'node', '-e', 'process.stdout.write(String(Date.now()))'], 3000));
    const afterClock = { wall: Date.now(), mono: mono() };
    qualifyContainerClock(beforeClock, guestWall, afterClock);
    if (left() <= 1000) throw Error('OWNER_CONTAINER_CLOCK_UNQUALIFIED');
    jsonFile(join(opDir, 'clock-proof.json'), { beforeClock, guestWall, afterClock, guardSafetyMarginMs: 1000 });
    running = spawn(p.dockerExecutable, ['--host',ownerDockerEndpoint(),'start', '-a', '-i', workerId], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    const kill = setTimeout(onSignal, left());
    exit = await new Promise(resolve => { running.once('error', () => resolve(125)); running.once('close', code => resolve(code ?? 125)); });
    clearTimeout(kill);
    const state = JSON.parse(dockerCommand(p, ['inspect', '--format', '{{json .State}}', workerId]));
    jsonFile(join(opDir, 'exit-state.json'), state);
    for (const [kind, id] of [['worker', workerId], ['broker', brokerId]]) {
      try { writeFileSync(join(opDir, `${kind}.log`), dockerCommand(p, ['logs', '--tail', '100', id]), { mode: 0o600 }); } catch { /* absence is checked separately */ }
    }
    if (state.Error || state.Running || state.OOMKilled || state.Dead || !Number.isInteger(state.ExitCode) || state.ExitCode !== exit) exit = 125;
  } finally { cleanup(); process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal); }
  if (cleanupFailed) return 125; // Route treats this sentinel as UNKNOWN, never a settled failure.
  if (exit === 0) {
    const final = join(output, 'final.txt'); const st = lstatSync(final);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 4 * 1024 * 1024) return 125;
    copyFileSync(final, hostOutput);
  }
  return exit;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runContainer(JSON.parse(process.argv[2]), process.argv.slice(3)); }
  catch { process.stderr.write('OWNER_CONTAINER_EXECUTION_UNRESOLVED\n'); process.exitCode = 125; }
}
