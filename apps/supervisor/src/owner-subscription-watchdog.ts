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
 *    exists. The lock descriptor is private to the watchdog (never inherited), and the watchdog stays until every member of its
 *    group is gone (a failed process scan counts as survivors): supervisor death does not release it, and there is no takeover logic;
 *  - receives the Work's REMAINING time (from the host's monotonic deadline), refuses (exit 124) when none is left, rechecks just
 *    before spawning Codex, and at the deadline kills its whole process group independently of the supervisor;
 *  - records {pgid, owner, deadline} in the lock file so a restarting host can kill ITS OWN orphaned group before anything else.
 */
export const WATCHDOG_REFUSED_LOCKED = 75;
export const WATCHDOG_DEADLINE = 124;
export const WATCHDOG_SOURCE = `import fcntl, json, os, signal, subprocess, sys, time
mode = sys.argv[1]
lock_path = sys.argv[2]
fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
# A momentary probe by another host must not refuse a launch; a real holder keeps the lock for the whole group lifetime.
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
owner, remaining_ms, nonce, codex = sys.argv[3], int(sys.argv[4]), sys.argv[5], sys.argv[6]
# The host passes the REMAINING milliseconds of the Work (computed from its own monotonic deadline, fixed once at the claim);
# no wall clock is read here, so clock changes cannot extend it.
deadline = time.monotonic() + remaining_ms / 1000.0
if remaining_ms <= 0:
    sys.exit(124)
# The watchdog must lead its own process group: it waits for, and kills, exactly that group. A caller that did not start it
# detached would otherwise make it wait on (or kill) the caller's own group.
if os.getpgrp() != os.getpid():
    os.setpgid(0, 0)
me, pgid = os.getpid(), os.getpgrp()
if pgid != me:
    sys.exit(70)
PS_ENV = {"PATH": "/usr/bin:/bin", "LC_ALL": "C"}
def ps(args):
    proc = subprocess.Popen(["/bin/ps"] + args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=PS_ENV, text=True)
    out, _ = proc.communicate(timeout=10)
    if proc.returncode != 0 or not out.strip():
        raise RuntimeError("ps failed")
    return proc.pid, out
try:
    _, start = ps(["-o", "lstart=", "-p", str(me)])
except Exception:
    start = ""
# Identity for startup recovery: pid == pgid, process start time and a per-launch nonce (also in this process's argv).
os.ftruncate(fd, 0)
os.pwrite(fd, json.dumps({"pid": me, "pgid": pgid, "owner": owner, "nonce": nonce, "start": start.strip(), "remainingMs": remaining_ms}).encode(), 0)
stopping = []
def on_term(signum, frame):
    stopping.append(signum)
signal.signal(signal.SIGTERM, on_term)
signal.signal(signal.SIGINT, on_term)
# Same allowlist as the owner-login child environment (the system interpreter shim may add toolchain variables).
allowed = ("PATH", "HOME", "CODEX_HOME", "TMPDIR", "LANG", "USER", "CI")
# Last deadline check immediately before Codex exists (identity probing above may have taken time).
if time.monotonic() >= deadline:
    sys.exit(124)
# The lock descriptor is NOT inherited (non-inheritable, close_fds): only the watchdog can unlock it, and it holds it until the
# whole group is gone.
child = subprocess.Popen([codex] + sys.argv[7:], close_fds=True, env={k: v for k, v in os.environ.items() if k in allowed})
def others():
    """True while any live member of this process group other than the watchdog (and its own ps probe) exists. Unknown = alive."""
    try:
        probe, out = ps(["-A", "-o", "pid=,pgid=,stat="])
    except Exception:
        return True                       # a failed or empty scan means members MAY survive: keep the lock and the deadline
    if not any(line.split()[:1] == [str(me)] for line in out.splitlines()):
        return True                       # a scan that does not even list the watchdog is not trusted
    for line in out.splitlines():
        f = line.split()
        if len(f) >= 3 and f[1] == str(pgid) and f[0] not in (str(me), str(probe)) and not f[2].startswith("Z"):
            return True
    return False
def kill_group(sig):
    try:
        os.killpg(pgid, sig)
    except OSError:
        pass
def expire():
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    kill_group(signal.SIGTERM)
    grace = time.monotonic() + 5
    while time.monotonic() < grace:
        child.poll()
        if not others():
            break
        time.sleep(0.1)
    kill_group(signal.SIGKILL)
    sys.exit(124)
status = None
while True:
    if status is None:
        rc = child.poll()
        if rc is not None:
            status = rc
    # The lock and the deadline cover the WHOLE group: the watchdog stays until every descendant is gone.
    if status is not None and not others():
        break
    if time.monotonic() >= deadline:
        expire()
    if stopping:
        stopping.clear()
        if status is None:
            try:
                child.terminate()
            except OSError:
                pass
    time.sleep(0.2)
if status < 0:
    # A signal death is reported as the same signal, never as an ordinary exit code.
    try:
        signal.signal(-status, signal.SIG_DFL)   # SIGKILL/SIGSTOP cannot be (and need not be) reset
    except (OSError, ValueError):
        pass
    os.kill(me, -status)
    time.sleep(1)
    sys.exit(128 - status)
sys.exit(status)
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
export type LockHolder = { pid: number; pgid: number; owner: string; nonce: string; start: string; remainingMs: number };
export function lockHolder(directory: string): LockHolder | null {
  try {
    const h = JSON.parse(readFileSync(join(directory, LOCK_FILE), 'utf8'));
    return Number.isSafeInteger(h?.pid) && h.pid > 1 && h.pgid === h.pid && typeof h.owner === 'string' && typeof h.nonce === 'string' &&
      /^[0-9a-f-]{36}$/.test(h.nonce) && typeof h.start === 'string' && h.start.length > 0 ? h : null;
  } catch { return null; }
}
/** Start time and argv of a live process, or null. */
function processIdentity(pid: number): { start: string; command: string } | null {
  try {
    const env = { PATH: '/usr/bin:/bin', LC_ALL: 'C' };
    const start = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env, timeout: 10_000 }).trim();
    const command = execFileSync('/bin/ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env, timeout: 10_000 }).trim();
    return start && command ? { start, command } : null;
  } catch { return null; }
}
const groupAlive = (pgid: number) => { try { process.kill(-pgid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/**
 * The lock is held, its metadata names this host as owner, and the named watchdog is provably the same launch: alive, pid == pgid,
 * the same process start time, and the per-launch nonce in its argv. Anything else is not ours to signal.
 */
function verifiedOwnHolder(directory: string, owner: string): LockHolder | 'FREE' | 'OTHER' | 'DOUBT' {
  if (lockFree(directory)) return 'FREE';
  const holder = lockHolder(directory);
  if (!holder) return 'DOUBT';
  if (holder.owner !== owner) return 'OTHER';
  const id = processIdentity(holder.pid);
  if (!id || id.start !== holder.start || !id.command.includes(` run ${join(directory, LOCK_FILE)} `) || !id.command.includes(` ${holder.nonce} `)) return 'DOUBT';
  return holder;
}
export type OrphanRecovery = { status: 'NONE' } | { status: 'OTHER_HOST' } | { status: 'KILLED'; pgid: number } | { status: 'UNVERIFIED' };
/**
 * Startup recovery, before anything else: kill THIS host's orphaned watchdog group only after its identity is proven, re-proving it
 * immediately before every signal. A lock held by another host is left alone. When in doubt nothing is signalled and the caller
 * refuses new work (UNVERIFIED). Throws if a verified orphan cannot be stopped.
 */
export function killOwnOrphan(directory: string, owner: string): OrphanRecovery {
  const first = verifiedOwnHolder(directory, owner);
  if (first === 'FREE') return { status: 'NONE' };
  if (first === 'OTHER') return { status: 'OTHER_HOST' };
  if (first === 'DOUBT') return { status: 'UNVERIFIED' };
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    const again = verifiedOwnHolder(directory, owner);
    if (again === 'FREE') return { status: 'KILLED', pgid: first.pgid };
    if (typeof again !== 'object' || again.nonce !== first.nonce || again.pid !== first.pid) return { status: 'UNVERIFIED' };
    try { process.kill(-first.pgid, signal); } catch { /* gone */ }
    for (let waited = 0; waited < 6000 && (groupAlive(first.pgid) || !lockFree(directory)); waited += 100) sleep(100);
    if (!groupAlive(first.pgid) && lockFree(directory)) return { status: 'KILLED', pgid: first.pgid };
  }
  throw new Error('Orphaned owner-subscription Codex group could not be stopped');
}
