import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, type Stats } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * Filesystem trust for anything the host executes (Codex executable, the owner-subscription watchdog and its interpreter): the
 * resolved file and every ancestor directory must not be replaceable by another local user. Checked at launcher start, in direct
 * supervisor composition, and again at EVERY execution entry (preflight and each Codex process). Grants no authority.
 */
export class ExecutableTrustRefused extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
const uid = () => process.getuid!();
const groupVerdicts = new Map<number, boolean>();
/**
 * A group-writable node is acceptable only when that group cannot contain another local user: every direct member and every user
 * whose primary group it is must be the operator or root, with no nested groups (e.g. Homebrew's `admin` group on a single-user Mac).
 * Any lookup failure refuses.
 */
function groupOnlyOperator(gid: number): boolean {
  if (groupVerdicts.has(gid)) return groupVerdicts.get(gid)!;
  let ok = false;
  try {
    const me = execFileSync('/usr/bin/id', ['-un'], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin' } }).trim();
    const allowed = (name: string) => name === me || name === 'root';
    if (process.platform === 'darwin') {
      const dscl = (...a: string[]) => execFileSync('/usr/bin/dscl', ['.', ...a], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin' } });
      const name = dscl('-search', '/Groups', 'PrimaryGroupID', String(gid)).split(/\s+/)[0];
      if (name) {
        const record = dscl('-read', `/Groups/${name}`);
        const members = /^GroupMembership:(.*)$/m.exec(record)?.[1].trim().split(/\s+/).filter(Boolean) ?? [];
        const primary = dscl('-list', '/Users', 'PrimaryGroupID').split('\n').map(l => l.trim().split(/\s+/)).filter(([, g]) => g === String(gid)).map(([u]) => u);
        ok = !/^NestedGroups:/m.test(record) && members.every(allowed) && primary.every(allowed);
      }
    } else {
      const group = readFileSync('/etc/group', 'utf8').split('\n').map(l => l.split(':')).find(f => f[2] === String(gid));
      const primary = readFileSync('/etc/passwd', 'utf8').split('\n').map(l => l.split(':')).filter(f => f[3] === String(gid)).map(f => f[0]);
      ok = !!group && (group[3] ?? '').split(',').filter(Boolean).every(allowed) && primary.every(allowed);
    }
  } catch { ok = false; }
  groupVerdicts.set(gid, ok);
  return ok;
}
/** Not replaceable by another local user: owned by the operator (or root); not world-writable (unless a sticky root-owned dir);
 *  group-writable only for a group that contains no other user. */
export function trustedNode(path: string, st: Stats, allowSticky: boolean): boolean {
  if (st.uid !== uid() && st.uid !== 0) return false;
  if ((st.mode & 0o002) !== 0) return allowSticky && st.isDirectory() && (st.mode & 0o1000) !== 0 && st.uid === 0;
  return (st.mode & 0o020) === 0 || groupOnlyOperator(st.gid);
}
export function trustedAncestors(path: string): boolean {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    let st; try { st = lstatSync(dir); } catch { return false; }
    if (!trustedNode(dir, st, true)) return false;
    if (dir === dirname(dir)) return true;
  }
}
export function assertTrustedExecutablePath(path: string) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) throw new ExecutableTrustRefused('HOST_CODEX_UNTRUSTED');
  let target; try { target = realpathSync(path); } catch { throw new ExecutableTrustRefused('HOST_CODEX_UNAVAILABLE'); }
  const st = lstatSync(target);
  if (!st.isFile() || (st.mode & 0o111) === 0 || !trustedNode(target, st, false) || !trustedAncestors(target)) throw new ExecutableTrustRefused('HOST_CODEX_UNTRUSTED');
  // The configured link itself (if any) must also sit in trusted directories.
  if (!trustedAncestors(path)) throw new ExecutableTrustRefused('HOST_CODEX_UNTRUSTED');
}
/** A non-executable file the host runs through a trusted interpreter (the watchdog script): same ownership and ancestor rules. */
export function assertTrustedFile(path: string) {
  let target; try { target = realpathSync(path); } catch { throw new ExecutableTrustRefused('HOST_CODEX_UNAVAILABLE'); }
  const st = lstatSync(target);
  if (!st.isFile() || !trustedNode(target, st, false) || !trustedAncestors(target)) throw new ExecutableTrustRefused('HOST_CODEX_UNTRUSTED');
}
