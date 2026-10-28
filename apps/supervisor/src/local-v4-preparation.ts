import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync,
  opendirSync, readSync, realpathSync, type Stats,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { JobDependencies } from './jobs.ts';
import { readLocalGitInputTreeV4 } from './producer-results.ts';
import type { ServiceProducer } from './service-producer.ts';

type Preparation = Readonly<Pick<JobDependencies, 'resolveCommit' | 'createTaskWorktree' | 'removeTaskWorktree'>>;
type FileObservation = { bytes: Buffer; identity: string; digest: string };
type Repository = { path: string; identity: string; gitIdentity: string; config: FileObservation; commit: string; tree: string };
type Workspace = {
  path: string; repository: Repository; rootIdentity: string; identity: string;
  state: 'creating' | 'ready' | 'captured' | 'uncertain';
  admin?: string; adminIdentity?: string; adminRootIdentity?: string; pointer?: FileObservation; index?: FileObservation;
  entries?: Map<string, string>;
};
const captureMarkers = new WeakMap<Preparation, (repository: string, workspace: string) => void>();
const GIT = '/opt/homebrew/Cellar/git/2.48.1/bin/git';
const HELPERS = '/opt/homebrew/Cellar/git/2.48.1/libexec/git-core';
const pins = [
  { path: GIT, target: GIT, size: 3557248, hash: '7ed424dafb29f1d4e3df1ca215efcba044b19cc78cf8b8df5a74cbdbfcbf4899' },
  { path: '/opt/homebrew/opt/pcre2/lib/libpcre2-8.0.dylib', target: '/opt/homebrew/Cellar/pcre2/10.47_1/lib/libpcre2-8.0.dylib', size: 588224, hash: 'fc0491cc252c2938b6c37d1b6b4d7bfedffb9edb2519c47cef577637eddb73d5' },
  { path: '/opt/homebrew/opt/gettext/lib/libintl.8.dylib', target: '/opt/homebrew/Cellar/gettext/1.0/lib/libintl.8.dylib', size: 228800, hash: '0c6d618e75fea85cc3d631e164a71766fba9341d19ce1f723300c52e63037c51' },
] as const;
const controls = [
  '--no-pager', '--no-replace-objects', '--no-lazy-fetch', '--no-optional-locks',
  '-c', 'protocol.allow=never', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null', '-c', 'core.pager=cat',
  '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'submodule.recurse=false',
  '-c', 'core.commitGraph=false', '-c', 'core.multiPackIndex=false',
];
const environment: NodeJS.ProcessEnv = {
  PATH: HELPERS, GIT_EXEC_PATH: HELPERS, LANG: 'C', LC_ALL: 'C', XDG_CONFIG_HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_ATTR_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1',
  GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '', GIT_CEILING_DIRECTORIES: '/',
};
function refuse(): never { throw new Error('LOCAL_V4_PREPARATION_REFUSED'); }
function hold(): never { throw new Error('LOCAL_V4_PREPARATION_RETAINED_HOLD'); }
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const identity = (s: Stats) => [s.dev, s.ino, s.uid, s.mode].join(':');
const fullIdentity = (s: Stats) => [identity(s), s.size, s.mtimeMs, s.ctimeMs].join(':');
const pathString = (path: string) => typeof path === 'string' && path.length <= 4096 &&
  isAbsolute(path) && resolve(path) === path && !/[\x00-\x1f\x7f]/.test(path);
const commitString = (commit: string) => typeof commit === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit);
function owner(s: Stats, hostOnly = true): void {
  if ((s.uid !== process.getuid!() && (hostOnly || s.uid !== 0)) || (s.mode & 0o022)) refuse();
}
function directory(path: string, hostOnly = true): string {
  if (!pathString(path) || realpathSync(path) !== path) refuse();
  const s = lstatSync(path); if (!s.isDirectory()) refuse(); owner(s, hostOnly); return identity(s);
}
function file(path: string, limit: number, hostOnly = true): FileObservation {
  if (realpathSync(path) !== path) refuse();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd); owner(before, hostOnly);
    if (!before.isFile() || before.size > limit) refuse();
    const bytes = Buffer.alloc(before.size + 1); let size = 0;
    while (size < bytes.length) { const count = readSync(fd, bytes, size, bytes.length - size, null); if (!count) break; size += count; }
    const after = fstatSync(fd);
    if (size !== before.size || fullIdentity(before) !== fullIdentity(after) || identity(lstatSync(path)) !== identity(after)) refuse();
    const observed = bytes.subarray(0, size); return { bytes: observed, identity: fullIdentity(after), digest: hash(observed) };
  } finally { closeSync(fd); }
}
function sameFile(path: string, expected: FileObservation, limit: number): void {
  const current = file(path, limit);
  if (current.identity !== expected.identity || current.digest !== expected.digest) hold();
}
function runtime(): void {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.versions.node !== '24.18.1') refuse();
  directory(HELPERS, false);
  for (const pin of pins) {
    if (realpathSync(pin.path) !== pin.target) refuse();
    const observed = file(pin.target, pin.size, false);
    if (observed.bytes.length !== pin.size || observed.digest !== pin.hash) refuse();
  }
  const helper = join(HELPERS, 'git'), link = lstatSync(helper);
  if (!link.isSymbolicLink() || ![0, process.getuid!()].includes(link.uid) || realpathSync(helper) !== GIT) refuse();
}
function groupAbsent(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(-pid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}

/** Fixed internal argv only. A delivered signal or parent exit is never cleanup evidence. */
async function command(repository: string, args: string[]): Promise<Buffer> {
  runtime();
  return new Promise((resolveResult, reject) => {
    const child = spawn(GIT, [...controls, '-C', repository, ...args], {
      cwd: '/', env: { ...environment }, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let failed = false, settled = false, size = 0; const output: Buffer[] = [];
    const finish = (success: boolean) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(closeDeadline);
      if (success) resolveResult(Buffer.concat(output)); else reject(new Error('LOCAL_V4_PREPARATION_RETAINED_HOLD'));
    };
    const interruptOwned = () => {
      failed = true;
      // Only interrupt while our child still owns this live process-group identity.
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Failure remains a retained HOLD. */ }
      }
    };
    let closeDeadline: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      interruptOwned(); closeDeadline = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy(); finish(false);
      }, 1000);
    }, 10_000);
    const observe = (bytes: Buffer, stdout: boolean) => {
      size += bytes.length;
      if (size > 1024 * 1024) { interruptOwned(); return; }
      if (stdout && !failed) output.push(bytes);
    };
    child.stdout.on('data', bytes => observe(bytes, true)); child.stderr.on('data', bytes => observe(bytes, false));
    child.stdout.on('error', () => { failed = true; }); child.stderr.on('error', () => { failed = true; });
    child.on('error', () => { failed = true; });
    child.on('close', (code, signal) => finish(!failed && code === 0 && signal === null && !!child.pid && groupAbsent(child.pid)));
  });
}
function text(bytes: Buffer): string { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }

/** No eager filesystem/native effects: portable seeded read fixtures do not use preparation. */
export function createLocalV4Preparation(dataDir: string): Preparation {
  if (!pathString(dataDir)) refuse();
  const workspaces = join(dataDir, 'workspaces'), resolved = new Map<string, Repository>();
  const owned = new Map<string, Workspace>(), busy = new Set<string>(), quarantined = new Set<string>();
  const repositoryKey = (path: string, commit: string) => path + '\0' + commit;
  const checkRepository = (r: Repository) => {
    if (directory(r.path) !== r.identity || directory(join(r.path, '.git')) !== r.gitIdentity) hold();
    sameFile(join(r.path, '.git/config'), r.config, 16384);
  };
  const qualify = (path: string, commit: string): Repository => {
    runtime();
    const identity = directory(path), gitIdentity = directory(join(path, '.git')), config = file(join(path, '.git/config'), 16384);
    // Unchanged identity-only synchronous reader. Its internal read commands are
    // entry-guarded under stable host administration, not new group-settled calls.
    const input = readLocalGitInputTreeV4(path, commit);
    const r = { path, identity, gitIdentity, config, commit, tree: input.inputTree }; checkRepository(r); return r;
  };
  const exclusive = async <T>(repository: string, operation: () => Promise<T>): Promise<T> => {
    if (busy.has(repository) || quarantined.has(repository)) hold(); busy.add(repository);
    try { return await operation(); }
    catch { quarantined.add(repository); return hold(); }
    finally { busy.delete(repository); }
  };
  const root = () => { directory(dataDir); return directory(workspaces); };
  const inspect = (w: Workspace) => {
    checkRepository(w.repository);
    if (root() !== w.rootIdentity || directory(w.path) !== w.identity || !w.admin || directory(w.admin) !== w.adminIdentity ||
      directory(dirname(w.admin)) !== w.adminRootIdentity || !w.pointer || !w.index) hold();
    sameFile(join(w.path, '.git'), w.pointer, 16384); sameFile(join(w.admin, 'index'), w.index, 1024 * 1024);
    if (text(file(join(w.admin, 'HEAD'), 256).bytes) !== w.repository.commit + '\n' ||
      text(file(join(w.admin, 'commondir'), 256).bytes) !== '../..\n' ||
      text(file(join(w.admin, 'gitdir'), 8192).bytes) !== join(w.path, '.git') + '\n') hold();
  };
  const read = async (w: Workspace, args: string[]) => {
    inspect(w); const result = await command(w.path, args); inspect(w); return text(result);
  };
  const clean = async (w: Workspace) => {
    if ((await read(w, ['rev-parse', '--verify', 'HEAD'])) !== w.repository.commit + '\n' ||
      (await read(w, ['rev-parse', '--verify', 'HEAD^{tree}'])) !== w.repository.tree + '\n') hold();
    const staged = await read(w, ['ls-files', '--stage', '-z']); const entries = new Map<string, string>();
    if (staged && !staged.endsWith('\0')) hold();
    for (const entry of staged.split('\0').filter(Boolean)) {
      const match = /^(100644) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t([A-Za-z0-9_./@+-]+)$/.exec(entry);
      if (!match || entries.size >= 200 || match[2].length !== w.repository.commit.length ||
        match[3].startsWith('/') || match[3].split('/').some(part => !part || part === '.' || part === '..' || part === '.git') || entries.has(match[3])) hold();
      entries.set(match[3], match[2]);
    }
    if (w.entries && JSON.stringify([...entries]) !== JSON.stringify([...w.entries])) hold();
    for (const flag of ['-v', '-f']) {
      const flags = await read(w, ['ls-files', flag, '-z']);
      if (flags !== [...entries.keys()].map(path => 'H ' + path + '\0').join('')) hold();
    }
    await read(w, ['diff-index', '--cached', '--quiet', w.repository.commit, '--']);
    if (await read(w, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'])) hold();
    const listed = await read(w, ['worktree', 'list', '--porcelain', '-z']);
    const matches = listed.split('\0\0').filter(block => block.startsWith('worktree ' + w.path + '\0'));
    if (matches.length !== 1 || matches[0] !== 'worktree ' + w.path + '\0HEAD ' + w.repository.commit + '\0detached') hold();
    const seen = new Set<string>(); let count = 0, bytes = 0;
    const walk = (path: string, prefix: string) => {
      const before = directory(path), stream = opendirSync(path);
      try {
        for (;;) {
          const entry = stream.readSync(); if (!entry) break;
          if (++count > 1024) hold();
          if (!prefix && entry.name === '.git') continue;
          const name = prefix + entry.name, child = join(path, entry.name), stat = lstatSync(child);
          if (stat.isDirectory() && !stat.isSymbolicLink()) {
            if (![...entries.keys()].some(key => key.startsWith(name + '/'))) hold(); walk(child, name + '/');
          } else {
            const expected = entries.get(name); if (!expected || seen.has(name)) hold();
            const observed = file(child, 100000); bytes += observed.bytes.length; if (bytes > 500000) hold();
            const blob = createHash(w.repository.commit.length === 40 ? 'sha1' : 'sha256')
              .update('blob ' + observed.bytes.length + '\0').update(observed.bytes).digest('hex');
            if (blob !== expected) hold(); seen.add(name);
          }
        }
      } finally { stream.closeSync(); }
      if (directory(path) !== before) hold();
    };
    inspect(w); walk(w.path, ''); inspect(w);
    if (seen.size !== entries.size) hold(); w.entries = entries;
  };
  const preparation: Preparation = Object.freeze({
    async resolveCommit(repositoryPath: string, baseRef: string) {
      if (!pathString(repositoryPath) || !commitString(baseRef)) refuse();
      return exclusive(repositoryPath, async () => {
        if (resolved.size >= 128 && !resolved.has(repositoryKey(repositoryPath, baseRef))) hold();
        const r = qualify(repositoryPath, baseRef); resolved.set(repositoryKey(repositoryPath, baseRef), r); return r.commit;
      });
    },
    async createTaskWorktree(repositoryPath: string, inputCommit: string, workspacesDir: string) {
      if (!pathString(repositoryPath) || !commitString(inputCommit) || workspacesDir !== workspaces) refuse();
      const admitted = resolved.get(repositoryKey(repositoryPath, inputCommit)); if (!admitted) refuse();
      return exclusive(repositoryPath, async () => {
        if (owned.size >= 128) hold(); checkRepository(admitted);
        const current = qualify(repositoryPath, inputCommit); if (current.tree !== admitted.tree) hold();
        directory(dataDir);
        try { mkdirSync(workspaces, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') hold(); }
        const rootIdentity = root(), path = join(workspaces, randomUUID()); mkdirSync(path, { mode: 0o700 });
        const w: Workspace = { path, repository: current, rootIdentity, identity: directory(path), state: 'creating' }; owned.set(path, w);
        try {
          await command(repositoryPath, ['worktree', 'add', '--detach', '--no-guess-remote', '--', path, inputCommit]);
          checkRepository(current); if (root() !== rootIdentity || directory(path) !== w.identity) hold();
          const pointer = file(join(path, '.git'), 16384), admin = join(repositoryPath, '.git/worktrees', path.slice(workspaces.length + 1));
          if (text(pointer.bytes) !== 'gitdir: ' + admin + '\n') hold();
          w.adminRootIdentity = directory(dirname(admin)); w.admin = admin; w.adminIdentity = directory(admin);
          w.pointer = pointer; w.index = file(join(admin, 'index'), 1024 * 1024);
          await clean(w); w.state = 'ready'; return path;
        } catch { w.state = 'uncertain'; return hold(); }
      });
    },
    async removeTaskWorktree(repositoryPath: string, workspacePath: string) {
      const w = owned.get(workspacePath);
      if (!w || w.repository.path !== repositoryPath || w.state !== 'ready') hold();
      return exclusive(repositoryPath, async () => {
        try {
          await clean(w); inspect(w);
          await command(repositoryPath, ['worktree', 'remove', '--', workspacePath]);
          for (const path of [workspacePath, w.admin!]) {
            try { lstatSync(path); hold(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') hold(); }
          }
          checkRepository(w.repository); owned.delete(workspacePath);
        } catch { w.state = 'uncertain'; return hold(); }
      });
    },
  });
  captureMarkers.set(preparation, (repository, workspace) => {
    const w = owned.get(workspace);
    if (!w || w.repository.path !== repository || w.state !== 'ready') hold();
    // Irreversible even if the original producer throws. Later native process
    // custody is outside this unit; no permission callback can clear this HOLD.
    w.state = 'captured';
  });
  return preparation;
}

/** Fixed host composition; the marker can only deny physical cleanup. */
export function bindLocalV4PreparationCapture(preparation: Preparation, producer: ServiceProducer): ServiceProducer {
  const mark = captureMarkers.get(preparation); if (!mark) refuse();
  const bound: ServiceProducer = {
    capture(work, run, model, version) { mark(work.repositoryPath, run.workspacePath); return producer.capture(work, run, model, version); },
    snapshot(run) { return producer.snapshot(run); },
    read(run) { return producer.read(run); },
    finalize(run) { return producer.finalize(run); },
  };
  return Object.freeze(bound);
}
