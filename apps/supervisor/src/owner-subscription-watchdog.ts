import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertTrustedExecutablePath, assertTrustedFile } from './executable-trust.ts';

/**
 * Machine-wide exclusivity and the per-Work wall clock for the OWNER_SUBSCRIPTION_LOCAL route, enforced OUTSIDE the supervisor.
 *
 * Every subscription Codex process is started through this watchdog (a fixed Python program from governed source, written
 * content-addressed into the owner-only lock directory and run with the system interpreter in isolated mode). The watchdog:
 *  - takes a KERNEL lock (flock LOCK_EX|LOCK_NB) on the one lock file; a second process anywhere on the machine exits 75 before Codex
 *    exists. The lock's open file description is inherited by Codex and its descendants, so it is held exactly as long as any of them
 *    lives: supervisor death does not release it, a crashed holder releases it automatically, and there is no takeover logic;
 *  - refuses (exit 124) at or after the absolute Work deadline, and at the deadline kills its whole process group (Codex included)
 *    independently of the supervisor;
 *  - records {pgid, owner, deadline} in the lock file so a restarting host can kill ITS OWN orphaned group before anything else.
 */
export const WATCHDOG_REFUSED_LOCKED = 75;
export const WATCHDOG_DEADLINE = 124;
export const WATCHDOG_SOURCE = `import fcntl, json, os, signal, subprocess, sys, time
mode = sys.argv[1]
lock_path = sys.argv[2]
fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
# A momentary probe by another host must not refuse a launch; a real holder keeps the lock for the whole process lifetime.
attempts = 1 if mode == "probe" else 20
for attempt in range(attempts):
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except OSError:
        if attempt == attempts - 1:
            sys.exit(75)
        time.sleep(0.05)
if mode == "probe":
    sys.exit(0)
owner, deadline_ms, codex = sys.argv[3], int(sys.argv[4]), sys.argv[5]
deadline = deadline_ms / 1000.0
if time.time() >= deadline:
    sys.exit(124)
os.ftruncate(fd, 0)
os.pwrite(fd, json.dumps({"pgid": os.getpgrp(), "pid": os.getpid(), "owner": owner, "deadlineMs": deadline_ms}).encode(), 0)
stopping = []
def on_term(signum, frame):
    stopping.append(signum)
signal.signal(signal.SIGTERM, on_term)
signal.signal(signal.SIGINT, on_term)
# Same allowlist as the owner-login child environment (the system interpreter shim may add toolchain variables).
allowed = ("PATH", "HOME", "CODEX_HOME", "TMPDIR", "LANG", "USER", "CI")
child = subprocess.Popen([codex] + sys.argv[6:], pass_fds=(fd,), env={k: v for k, v in os.environ.items() if k in allowed})
def kill_group(sig):
    try:
        os.killpg(os.getpgrp(), sig)
    except OSError:
        pass
while True:
    rc = child.poll()
    if rc is not None:
        sys.exit(rc if rc >= 0 else 128 - rc)
    if time.time() >= deadline:
        break
    if stopping:
        stopping.clear()
        try:
            child.terminate()
        except OSError:
            pass
    time.sleep(0.05)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
kill_group(signal.SIGTERM)
grace = time.time() + 5
while time.time() < grace and child.poll() is None:
    time.sleep(0.05)
kill_group(signal.SIGKILL)
sys.exit(124)
`;
export const WATCHDOG_SHA256 = createHash('sha256').update(WATCHDOG_SOURCE).digest('hex');
export const PYTHON = '/usr/bin/python3';
export const OWNER_SUBSCRIPTION_LOCK_DIRECTORY = join(homedir(), '.myfactory', 'owner-subscription');
export const LOCK_FILE = 'execution.lock';

function ownerOnlyDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const st = lstatSync(path);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid!()) throw new Error('Owner subscription lock directory is not owner-only');
  if ((st.mode & 0o077) !== 0) chmodSync(path, 0o700);
  if ((lstatSync(path).mode & 0o077) !== 0) throw new Error('Owner subscription lock directory is not owner-only');
}
/** Installs (content-addressed, read-only) and trust-checks the watchdog and its interpreter. Called at every execution entry. */
export function watchdogFor(directory: string): { python: string; script: string; lockFile: string } {
  ownerOnlyDirectory(directory);
  const script = join(directory, `watchdog-${WATCHDOG_SHA256.slice(0, 16)}.py`);
  if (!existsSync(script)) writeFileSync(script, WATCHDOG_SOURCE, { mode: 0o400, flag: 'wx' });
  const st = lstatSync(script);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid!() || (st.mode & 0o222 & ~0o200) !== 0 ||
      createHash('sha256').update(readFileSync(script)).digest('hex') !== WATCHDOG_SHA256) throw new Error('Owner subscription watchdog changed');
  assertTrustedFile(script);
  assertTrustedExecutablePath(PYTHON);
  return { python: PYTHON, script, lockFile: join(directory, LOCK_FILE) };
}
/** True when no process on this machine holds the execution lock (kernel probe; never takes it over). */
export function lockFree(directory: string): boolean {
  const w = watchdogFor(directory);
  try { execFileSync(w.python, ['-I', w.script, 'probe', w.lockFile], { stdio: 'ignore', timeout: 10_000, env: { PATH: '/usr/bin:/bin' } }); return true; }
  catch { return false; }
}
export function lockHolder(directory: string): { pgid: number; owner: string; deadlineMs: number } | null {
  try { const h = JSON.parse(readFileSync(join(directory, LOCK_FILE), 'utf8')); return Number.isSafeInteger(h?.pgid) && typeof h?.owner === 'string' ? h : null; }
  catch { return null; }
}
const groupAlive = (pgid: number) => { try { process.kill(-pgid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/**
 * Startup recovery, before anything else: if the lock is held by a watchdog group that THIS host (owner = its data directory)
 * started and the host died, kill that whole group (TERM, then KILL) and wait for the kernel lock to be released. A lock held by
 * another host is left alone. Throws if the orphan cannot be removed (the host must not start).
 */
export function killOwnOrphan(directory: string, owner: string): { killedPgid: number | null } {
  if (lockFree(directory)) return { killedPgid: null };
  const holder = lockHolder(directory);
  if (!holder || holder.owner !== owner || holder.pgid <= 1) return { killedPgid: null };
  let command = '';
  try { command = execFileSync('/bin/ps', ['-o', 'command=', '-p', String(holder.pgid)], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }); } catch { /* group leader gone */ }
  if (command && !command.includes('watchdog-')) return { killedPgid: null };
  for (const [signal, wait] of [['SIGTERM', 5000], ['SIGKILL', 5000]] as const) {
    try { process.kill(-holder.pgid, signal); } catch { /* gone */ }
    for (let waited = 0; waited < wait && (groupAlive(holder.pgid) || !lockFree(directory)); waited += 100) sleep(100);
    if (!groupAlive(holder.pgid) && lockFree(directory)) return { killedPgid: holder.pgid };
  }
  throw new Error('Orphaned owner-subscription Codex group could not be stopped');
}
