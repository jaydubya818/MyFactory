// Trusted PID 1. A different uid runs Codex; it cannot stop this deadline guardian.
// Exiting PID 1 makes the kernel destroy every process in the PID namespace, including setsid children.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const config = JSON.parse(readFileSync('/run/factory/invocation.json', 'utf8'));
if (!Number.isSafeInteger(config.workerUid) || config.workerUid < 1 || !Number.isSafeInteger(config.workerGid) || config.workerGid < 0) process.exit(125);
const left = Math.min(config.remainingMs, config.deadlineUnixMs - Date.now(), 600_000);
if (!Number.isSafeInteger(config.remainingMs) || !Number.isSafeInteger(config.deadlineUnixMs) || left <= 0) process.exit(124);
const timer = setTimeout(() => process.exit(124), left);
// Re-check wall time after a paused VM resumes; a suspended VM must not regain its old remaining allowance.
const wallTimer = setInterval(() => { if (Date.now() >= config.deadlineUnixMs) process.exit(124); }, 25);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(124));
const child = spawn('/usr/local/bin/codex', config.argv, {
  uid: config.workerUid, gid: config.workerGid, cwd: '/workspace', stdio: 'inherit',
  env: { PATH: '/usr/local/bin:/usr/bin:/bin:/node_modules/.bin', HOME: '/home/worker', CODEX_HOME: '/home/worker/.codex',
    TMPDIR: '/tmp', LANG: 'C.UTF-8', CI: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0',
    PLAYWRIGHT_BROWSERS_PATH: '/opt/qdev-dashboard/browsers', NODE_OPTIONS: '--v8-pool-size=1', UV_THREADPOOL_SIZE: '1' },
});
child.once('error', () => process.exit(125));
child.once('close', (code, signal) => { clearTimeout(timer); clearInterval(wallTimer); process.exit(signal ? 125 : code ?? 125); });
