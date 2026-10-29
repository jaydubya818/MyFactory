import { createLocalV4SourceArtifacts } from './local-v4-source-artifact.ts';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync,
  opendirSync, readSync, realpathSync, writeSync, fsyncSync, type Stats,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { JobDependencies } from './jobs.ts';
import { readLocalGitInputTreeV4, readCurrentProducerSourceIdentity } from './producer-results.ts';
import type { ServiceProducer } from './service-producer.ts';
import { validateLocalV4TextTree, validateLocalV4RootTextTree, type TextObjectKind } from './local-v4-text-tree.ts';
import type { CandidateMaterial } from './local-v4-candidate-policy.ts';
import { contextPolicyFailure, contextFormatRefused, liveProgressPaths, sourceContext, type ContextBasis } from './local-v4-context-policy.ts';
import type { Run } from '../../../packages/contracts/src/index.ts';
import { digest,type LocalExecutionSnapshotV4 } from '../../../packages/hosted-routing/src/result.ts';
import { checkpointPolicyFailure, checkpointPolicyKind, checkpointFormatRefused, checkpointUncertain, planCheckpoint,
  type CheckpointBasis, type CheckpointResult } from './local-v4-checkpoint-policy.ts';
import { finalizationPolicyFailure, finalizationFormatRefused, finalizationUncertain, planFinalizationCommit,
  type FinalizationBasis, type FinalizationResult, type FinalizationFence } from './local-v4-finalization-policy.ts';
import { validateLocalV4CandidateMaterial, candidatePolicyKind } from './local-v4-candidate-policy.ts';
import { verificationInputFailure,verificationInputHold,verificationInputFence,verificationCheckpointKey,
  type VerificationInputBasis,type VerificationInputLease,type VerificationInputFence } from './local-v4-verification-input-policy.ts';

type Preparation = Readonly<Pick<JobDependencies, 'resolveCommit' | 'createTaskWorktree' | 'removeTaskWorktree'>>;
type FileObservation = { bytes: Buffer; identity: string; digest: string };
type Repository = { path: string; identity: string; gitIdentity: string; config: FileObservation; commit: string; tree: string; deadline?: number };
type Workspace = {
  path: string; repository: Repository; rootIdentity: string; identity: string;
  state: 'creating' | 'ready' | 'captured' | 'finalizing' | 'finalized' | 'uncertain';
  admin?: string; adminIdentity?: string; adminRootIdentity?: string; pointer?: FileObservation; index?: FileObservation;
  entries?: Map<string, string>;
};
const captureMarkers = new WeakMap<Preparation, (repository: string, workspace: string) => void>();
type CandidateInspection = Readonly<{ repository: string; inputCommit: string; inputTree: string; candidateCommit: string; candidateTree: string }>;
const candidateInspectors = new WeakMap<Preparation, (input: CandidateInspection, deadline: number) => Promise<CandidateMaterial>>();
type ContextControls = {
  capture(run: Run, snapshot: LocalExecutionSnapshotV4): void;
  read(basis: ContextBasis, deadline: number, progress: boolean): Promise<Readonly<Record<string, string>> | null>;
  checkpoint(basis: CheckpointBasis, deadline: number): Promise<CheckpointResult>;
  finalize(basis: FinalizationBasis, deadline: number, assertCurrent: FinalizationFence): Promise<FinalizationResult>;
  verificationReady(basis:VerificationInputBasis):void;
  verificationPrepare(basis:VerificationInputBasis,deadline:number,assertCurrent:VerificationInputFence):Promise<VerificationInputLease>;
  verificationClose(basis:VerificationInputBasis,lease:VerificationInputLease,deadline:number,assertCurrent:VerificationInputFence):void;
  verificationReject(lease:VerificationInputLease):void;
  verificationAccept(basis:VerificationInputBasis,lease:VerificationInputLease,assertCurrent:VerificationInputFence):void;
};
const contextControls = new WeakMap<Preparation, ContextControls>();
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
const commitString = (commit: string) => typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit);
function budget(deadline: number): void { if (!Number.isFinite(deadline) || performance.now() >= deadline) hold(); }
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
async function command(repository: string, args: string[], limits: { bytes?: number; deadline?: number; input?: Buffer } = {}): Promise<Buffer> {
  if (limits.input !== undefined && (!Buffer.isBuffer(limits.input) || args.length !== 6 ||
      args.slice(0, 5).join('\0') !== ['hash-object', '--no-filters', '--stdin', '-w', '-t'].join('\0') ||
      !['blob', 'tree', 'commit'].includes(args[5]) || limits.input.length > (args[5] === 'blob' ? 100000 : 65536))) refuse();
  const input = limits.input === undefined ? undefined : Buffer.from(limits.input);
  if (limits.deadline !== undefined) budget(limits.deadline);
  runtime();
  const outputLimit = limits.bytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 0 || outputLimit > 2 * 1024 * 1024) refuse();
  if (limits.deadline !== undefined) budget(limits.deadline);
  const timeout = limits.deadline === undefined ? 10000 : Math.max(1, Math.min(10000, Math.ceil(limits.deadline - performance.now())));
  return new Promise((resolveResult, reject) => {
    const argv = [...controls, '-C', repository, ...args], options = { cwd: '/', env: { ...environment }, detached: true };
    const child = input === undefined
      ? spawn(GIT, argv, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn(GIT, argv, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    let failed = false, settled = false, size = 0, inputFinished = input === undefined; const output: Buffer[] = [];
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
        child.stdout.destroy(); child.stderr.destroy(); if (input !== undefined) child.stdin?.destroy(); finish(false);
      }, 1000);
    }, timeout);
    const observe = (bytes: Buffer, stdout: boolean) => {
      size += bytes.length;
      if (size > outputLimit) { interruptOwned(); return; }
      if (stdout && !failed) output.push(bytes);
    };
    child.stdout.on('data', bytes => observe(bytes, true)); child.stderr.on('data', bytes => observe(bytes, false));
    child.stdout.on('error', () => { failed = true; }); child.stderr.on('error', () => { failed = true; });
    child.on('error', () => { failed = true; });
    if (input !== undefined) {
      if (!child.stdin) interruptOwned();
      else {
        child.stdin.once('finish', () => { inputFinished = true; });
        child.stdin.on('error', interruptOwned);
        child.stdin.once('close', () => { if (!inputFinished) interruptOwned(); });
        try { child.stdin.end(input); } catch { interruptOwned(); }
      }
    }
    child.on('close', (code, signal) => finish(!failed && inputFinished && code === 0 && signal === null && !!child.pid && groupAbsent(child.pid) &&
      (limits.deadline === undefined || performance.now() < limits.deadline)));
  });
}
function text(bytes: Buffer): string { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }

/** No eager filesystem/native effects: portable seeded read fixtures do not use preparation. */
export function createLocalV4Preparation(dataDir: string, options: Readonly<{sourceArtifacts?:boolean}> = {}): Preparation {
  if (!pathString(dataDir)) refuse();
  const workspaces = join(dataDir, 'workspaces'), resolved = new Map<string, Repository>();
  const owned = new Map<string, Workspace>(), busy = new Set<string>(), quarantined = new Set<string>();
  const contextCaptures = new Map<string, string>();
  const materializeSource=options.sourceArtifacts===true;
  const verificationArtifacts = createLocalV4SourceArtifacts(dataDir);
  const checkpointOutputs=new Map<string,string>();
  const finalOutputs=new WeakMap<Workspace,{commit:string;tree:string;index:FileObservation;mainHead:FileObservation}>();
  const verificationKeys=new WeakMap<Workspace,Map<string,'preparing'|'open'|'consumed'|'uncertain'>>();
  const verificationLeases=new WeakMap<VerificationInputLease,{w:Workspace;key:string;binding:string;digest:string;phase:VerificationInputBasis['phase']}>();
  const finalizationOwners=new Map<string,object>();
  const finalizingWriters=new WeakMap<Workspace,{owner:object;context:string;tuple:string}>();
  const contextIdentity = (run: Run, snapshot: LocalExecutionSnapshotV4) => hash(Buffer.from(JSON.stringify([
    run.id, run.workOrderId, run.attemptNumber, run.inputCommit, run.workspacePath, run.workerProfile, run.startedAt,
    snapshot.factoryId, snapshot.factoryVersion, snapshot.sourceDigest, snapshot.configurationDigest, snapshot.inputTree,
  ])));
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
  const validateInput = async (r: Repository, deadline: number) => {
    const observe = async (args: string[], bytes: number) => {
      budget(deadline); checkRepository(r);
      const result = await command(r.path, args, { bytes, deadline });
      checkRepository(r); budget(deadline); return result;
    };
    const read = async (kind: TextObjectKind, id: string, maxBytes: number): Promise<Buffer> => {
      const maximum = kind === 'blob' ? 100000 : 65536;
      if (!['commit', 'tree', 'blob'].includes(kind) || !commitString(id) || maxBytes !== maximum) hold();
      if (text(await observe(['cat-file', '-t', id], 256)) !== kind + '\n') hold();
      const sizeText = text(await observe(['cat-file', '-s', id], 256));
      if (!/^(?:0|[1-9][0-9]*)\n$/.test(sizeText)) hold();
      const size = Number(sizeText.trim()); if (!Number.isSafeInteger(size) || size > maximum) hold();
      const raw = await observe(['cat-file', kind, id], size); if (raw.length !== size) hold(); return raw;
    };
    const input = await validateLocalV4TextTree(r.commit, read, deadline);
    if (input.inputTree !== r.tree) hold(); checkRepository(r); budget(deadline);
  };
  const root = () => { directory(dataDir); return directory(workspaces); };
  const inspect = (w: Workspace) => {
    if (w.state === 'creating') { if (w.repository.deadline === undefined) hold(); budget(w.repository.deadline); }
    checkRepository(w.repository);
    if (root() !== w.rootIdentity || directory(w.path) !== w.identity || !w.admin || directory(w.admin) !== w.adminIdentity ||
      directory(dirname(w.admin)) !== w.adminRootIdentity || !w.pointer || !w.index) hold();
    sameFile(join(w.path, '.git'), w.pointer, 16384); sameFile(join(w.admin, 'index'), w.index, 1024 * 1024);
    if (text(file(join(w.admin, 'HEAD'), 256).bytes) !== w.repository.commit + '\n' ||
      text(file(join(w.admin, 'commondir'), 256).bytes) !== '../..\n' ||
      text(file(join(w.admin, 'gitdir'), 8192).bytes) !== join(w.path, '.git') + '\n') hold();
  };
  const read = async (w: Workspace, args: string[]) => {
    inspect(w); const result = await command(w.path, args, { deadline: w.state === 'creating' ? w.repository.deadline : undefined });
    inspect(w); return text(result);
  };
  const verificationOwner=(basis:VerificationInputBasis) => {
    const w=owned.get(basis.run.workspacePath);
    if(!w||!['captured','finalized'].includes(w.state)||quarantined.has(w.repository.path)||
      contextCaptures.get(w.path)!==contextIdentity(basis.run,basis.execution)||
      basis.execution.sourceDigest!==readCurrentProducerSourceIdentity()||
      [...(verificationKeys.get(w)?.values()??[])].includes('uncertain'))verificationInputHold();
    if(w.state==='captured')inspect(w);
    else {
      const output=finalOutputs.get(w);checkRepository(w.repository);
      if(!output||root()!==w.rootIdentity||directory(w.path)!==w.identity||!w.admin||
        directory(w.admin)!==w.adminIdentity||directory(dirname(w.admin))!==w.adminRootIdentity||!w.pointer)verificationInputHold();
      sameFile(join(w.path,'.git'),w.pointer,16384);sameFile(join(w.admin,'index'),output.index,1024*1024);
      sameFile(join(w.repository.path,'.git/HEAD'),output.mainHead,256);
      if(text(file(join(w.admin,'HEAD'),256).bytes)!==output.commit+'\n'||
        text(file(join(w.admin,'commondir'),256).bytes)!=='../..\n'||
        text(file(join(w.admin,'gitdir'),8192).bytes)!==join(w.path,'.git')+'\n')verificationInputHold();
    }
    try{lstatSync(join(w.admin!,'config.worktree'));verificationInputHold();}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    return w;
  };
  const verificationSelection=(basis:VerificationInputBasis,w:Workspace) => {
    const phase=basis.phase;
    if(phase.kind==='ENTRY')verificationInputHold();
    if(phase.kind==='FINAL'){
      const output=finalOutputs.get(w);
      if(w.state!=='finalized'||!output||output.commit!==basis.run.candidateCommit||
        output.commit!==basis.selectedCommit||output.tree!==basis.selectedTree)verificationInputHold();
      return {key:basis.run.id+':final',tree:output.tree,commit:output.commit};
    }
    if(w.state!=='captured')verificationInputHold();
    if(phase.kind==='REPRODUCTION')return {key:basis.run.id+':reproduction',tree:w.repository.tree,commit:w.repository.commit};
    const key=verificationCheckpointKey(basis.run,basis.execution,phase),tree=checkpointOutputs.get(key);
    if(!tree)verificationInputHold();return {key,tree,commit:null};
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
          if (w.state === 'creating') { if (w.repository.deadline === undefined) hold(); budget(w.repository.deadline); }
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
  const scanWorkspace = (w: Workspace, deadline: number) => {
    budget(deadline); const files: Record<string, string> = Object.create(null), observations: string[] = [];
    let entries = 0, directories = 0, jsonBytes = 2;
    const walk = (path: string, prefix: string, depth: number) => {
      budget(deadline); if (++directories > 128) checkpointFormatRefused();
      directory(path); const before = fullIdentity(lstatSync(path)); observations.push(prefix + '\0dir\0' + before);
      const dir = opendirSync(path); let count = 0;
      try {
        for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
          budget(deadline);
          if (!prefix && entry.name === '.git') continue;
          if (++entries > 200 || depth + 1 > 16 || !/^[A-Za-z0-9_.-]+$/.test(entry.name) ||
              ['.', '..', '.git'].includes(entry.name.toLowerCase())) checkpointFormatRefused();
          const name = prefix + entry.name, full = join(path, entry.name); count++;
          if (name.length > 240 || name === '__proto__') checkpointFormatRefused();
          const stat = lstatSync(full);
          if (stat.isDirectory()) walk(full, name + '/', depth + 1);
          else {
            if (!stat.isFile() || (stat.mode & 0o111)) checkpointFormatRefused();
            const observed = file(full, 100000); let value: string;
            try { value = text(observed.bytes); } catch { checkpointFormatRefused(); }
            if (observed.bytes.includes(0)) checkpointFormatRefused();
            jsonBytes += (Object.keys(files).length ? 1 : 0) + Buffer.byteLength(JSON.stringify(name)) + 1 + Buffer.byteLength(JSON.stringify(value));
            if (jsonBytes > 500000) checkpointFormatRefused();
            Object.defineProperty(files, name, { value, enumerable: true });
            observations.push(name + '\0file\0' + observed.identity + '\0' + observed.digest);
          }
        }
      } finally { dir.closeSync(); }
      if (!count) checkpointFormatRefused();
      directory(path); if (fullIdentity(lstatSync(path)) !== before) checkpointUncertain();
    };
    walk(w.path, '', 0); budget(deadline);
    return { files: Object.freeze(files), identity: JSON.stringify(observations.sort()) };
  };
  const preparation: Preparation = Object.freeze({
    async resolveCommit(repositoryPath: string, baseRef: string) {
      if (!pathString(repositoryPath) || !commitString(baseRef)) refuse();
      return exclusive(repositoryPath, async () => {
        const key = repositoryKey(repositoryPath, baseRef), pending = resolved.get(key);
        if (pending) {
          if (pending.deadline === undefined) hold(); budget(pending.deadline); checkRepository(pending); return pending.commit;
        }
        if (resolved.size >= 128) hold();
        const deadline = performance.now() + 30000; budget(deadline);
        const r = qualify(repositoryPath, baseRef); budget(deadline); await validateInput(r, deadline);
        r.deadline = deadline; resolved.set(key, r); return r.commit;
      });
    },
    async createTaskWorktree(repositoryPath: string, inputCommit: string, workspacesDir: string) {
      if (!pathString(repositoryPath) || !commitString(inputCommit) || workspacesDir !== workspaces) refuse();
      if (quarantined.has(repositoryPath)) hold();
      const admitted = resolved.get(repositoryKey(repositoryPath, inputCommit)); if (!admitted) refuse();
      return exclusive(repositoryPath, async () => {
        const deadline = admitted.deadline; if (deadline === undefined) hold(); budget(deadline);
        if (owned.size >= 128) hold(); checkRepository(admitted);
        const current = qualify(repositoryPath, inputCommit); budget(deadline);
        if (current.tree !== admitted.tree) hold(); await validateInput(current, deadline); current.deadline = deadline;
        directory(dataDir);
        try { mkdirSync(workspaces, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') hold(); }
        const rootIdentity = root(), path = join(workspaces, randomUUID()); mkdirSync(path, { mode: 0o700 });
        const w: Workspace = { path, repository: current, rootIdentity, identity: directory(path), state: 'creating' }; owned.set(path, w);
        try {
          await command(repositoryPath, ['worktree', 'add', '--detach', '--no-guess-remote', '--', path, inputCommit], { deadline });
          budget(deadline);
          checkRepository(current); if (root() !== rootIdentity || directory(path) !== w.identity) hold();
          const pointer = file(join(path, '.git'), 16384), admin = join(repositoryPath, '.git/worktrees', path.slice(workspaces.length + 1));
          if (text(pointer.bytes) !== 'gitdir: ' + admin + '\n') hold();
          w.adminRootIdentity = directory(dirname(admin)); w.admin = admin; w.adminIdentity = directory(admin);
          w.pointer = pointer; w.index = file(join(admin, 'index'), 1024 * 1024);
          await clean(w); budget(deadline); w.repository.deadline = undefined; w.state = 'ready';
          resolved.delete(repositoryKey(repositoryPath, inputCommit)); return path;
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
  candidateInspectors.set(preparation, async (input, deadline) => {
    if (!pathString(input.repository) || ![input.inputCommit, input.inputTree, input.candidateCommit, input.candidateTree].every(commitString)) hold();
    // Read-only observation does not adopt a previous process's workspace or
    // permit physical cleanup. Original Work authority remains with the producer.
    if (busy.has(input.repository) || quarantined.has(input.repository)) hold();
    busy.add(input.repository);
    try {
      budget(deadline); const r = qualify(input.repository, input.inputCommit); budget(deadline);
      if (r.tree !== input.inputTree) hold();
      const observed = new Map<string, Buffer>();
      const observe = async (args: string[], bytes: number) => {
        budget(deadline); checkRepository(r);
        const value = await command(r.path, args, { bytes, deadline });
        checkRepository(r); budget(deadline); return value;
      };
      const unsupported = (): never => { throw new Error('LOCAL_V4_CANDIDATE_FORMAT_UNSUPPORTED'); };
      const read = async (kind: TextObjectKind, id: string, limit: number) => {
        if (!commitString(id) || limit !== (kind === 'blob' ? 100000 : 65536)) hold();
        if (text(await observe(['cat-file', '-t', id], 256)) !== kind + '\n') unsupported();
        const sizeText = text(await observe(['cat-file', '-s', id], 256));
        if (!/^(?:0|[1-9][0-9]*)\n$/.test(sizeText)) hold();
        const size = Number(sizeText.trim()); if (!Number.isSafeInteger(size)) hold();
        if (size > limit) unsupported();
        const raw = await observe(['cat-file', kind, id], size); if (raw.length !== size) hold();
        if ((kind === 'commit' && id === input.candidateCommit) || (kind === 'tree' && id === input.candidateTree)) observed.set(kind, Buffer.from(raw));
        return raw;
      };
      const tree = async (commit: string) => {
        try { return await validateLocalV4TextTree(commit, read, deadline); }
        catch (error) {
          budget(deadline);
          if (error instanceof Error && error.message === 'LOCAL_V4_TEXT_INPUT_REFUSED') unsupported();
          throw error;
        }
      };
      const base = await tree(input.inputCommit), candidate = await tree(input.candidateCommit);
      if (base.inputTree !== input.inputTree || candidate.inputTree !== input.candidateTree) hold();
      const rawCommit = observed.get('commit'), rawTree = observed.get('tree'); if (!rawCommit || !rawTree) hold();
      const patch = await observe(['show', '--format=', '--binary', '--no-ext-diff', '--no-textconv', input.candidateCommit], 2 * 1024 * 1024);
      const numstat = await observe(['show', '--format=', '--numstat', '-z', '--no-ext-diff', '--no-textconv', input.candidateCommit], 65536);
      checkRepository(r); budget(deadline);
      return Object.freeze({ base, candidate, rawCommit, rawTree, patch: Buffer.from(patch), numstat: Buffer.from(numstat) });
    } catch (error) { quarantined.add(input.repository); throw error; }
    finally { busy.delete(input.repository); }
  });
  contextControls.set(preparation, {
    capture(run, snapshot) {
      const w = owned.get(run.workspacePath);
      if (!w || w.state !== 'captured' || snapshot.version !== 4 || snapshot.workspace.path !== w.path ||
          run.inputCommit !== w.repository.commit || snapshot.inputCommit !== run.inputCommit || snapshot.inputTree !== w.repository.tree ||
          snapshot.runId !== run.id || snapshot.workOrderId !== run.workOrderId || snapshot.attemptNumber !== run.attemptNumber ||
          contextCaptures.has(w.path)) throw contextPolicyFailure(null);
      contextCaptures.set(w.path, contextIdentity(run, snapshot));
    },
    verificationReady(basis){
      const w=owned.get(basis.run.workspacePath);
      if(w?.state==='finalizing'){
        const writer=finalizingWriters.get(w);
        if(basis.phase.kind!=='ENTRY'||basis.run.state!=='implementing'||!writer||!busy.has(w.repository.path)||
          finalizationOwners.get(w.repository.path)!==writer.owner||contextCaptures.get(w.path)!==writer.context||
          contextIdentity(basis.run,basis.execution)!==writer.context||
          digest({run:basis.run,work:basis.work,execution:basis.execution})!==writer.tuple||
          basis.execution.sourceDigest!==readCurrentProducerSourceIdentity())verificationInputHold();
        checkRepository(w.repository);
        if(root()!==w.rootIdentity||directory(w.path)!==w.identity||!w.admin||directory(w.admin)!==w.adminIdentity||
          directory(dirname(w.admin))!==w.adminRootIdentity||!w.pointer)verificationInputHold();
        sameFile(join(w.path,'.git'),w.pointer,16384);
        if(text(file(join(w.admin,'commondir'),256).bytes)!=='../..\n'||
          text(file(join(w.admin,'gitdir'),8192).bytes)!==join(w.path,'.git')+'\n')verificationInputHold();
        return;
      }
      verificationOwner(basis);
    },
    async verificationPrepare(basis,deadline,assertCurrent){
      const w=verificationOwner(basis),selected=verificationSelection(basis,w);
      const keys=verificationKeys.get(w)??new Map<string,'preparing'|'open'|'consumed'|'uncertain'>();
      if(keys.size>=4||keys.has(selected.key)||[...keys.values()].some(value=>value==='preparing'||value==='open')||
        busy.has(w.repository.path))verificationInputHold();
      verificationKeys.set(w,keys);keys.set(selected.key,'preparing');busy.add(w.repository.path);
      const current=()=>{
        budget(deadline);verificationInputFence(assertCurrent);
        if(verificationOwner(basis)!==w||JSON.stringify(verificationSelection(basis,w))!==JSON.stringify(selected))verificationInputHold();
        budget(deadline);
      };
      const observe=async(args:string[],bytes:number)=>{current();const result=await command(w.repository.path,args,{bytes,deadline});current();return result;};
      const object=async(kind:TextObjectKind,id:string,limit:number)=>{
        if(!commitString(id)||limit!==(kind==='blob'?100000:65536))verificationInputHold();
        if(text(await observe(['cat-file','-t',id],256))!==kind+'\n')verificationInputHold();
        const length=text(await observe(['cat-file','-s',id],256));
        if(!/^(?:0|[1-9][0-9]*)\n$/.test(length))verificationInputHold();
        const size=Number(length.trim());if(!Number.isSafeInteger(size)||size>limit)verificationInputHold();
        const bytes=await observe(['cat-file',kind,id],size);if(bytes.length!==size)verificationInputHold();return bytes;
      };
      try{
        current();
        const graph=selected.commit?await validateLocalV4TextTree(selected.commit,object,deadline):
          await validateLocalV4RootTextTree(selected.tree,object,deadline);
        if(graph.inputTree!==selected.tree||Buffer.byteLength(JSON.stringify(graph.files))>500000)verificationInputHold();
        const metadata={schema:'local-v4-fixture-source/v1' as const,runId:basis.run.id,workOrderId:basis.run.workOrderId,
          kind:basis.phase.kind as 'REPRODUCTION'|'IMPLEMENTATION'|'FINAL',commit:selected.commit,tree:selected.tree};
        if(Buffer.byteLength(JSON.stringify(metadata))>8192)verificationInputHold();
        const source=Object.freeze({...metadata,files:Object.freeze({...graph.files})});
        const artifact=materializeSource?await verificationArtifacts.prepare(source,basis.binding,deadline,current):undefined;current();
        const lease=Object.freeze({source,...(artifact?{artifact}:{})});current();
        verificationLeases.set(lease,{w,key:selected.key,binding:basis.binding,
          digest:hash(Buffer.from(JSON.stringify(source))),phase:basis.phase});keys.set(selected.key,'open');return lease;
      }catch(error){keys.set(selected.key,'uncertain');throw verificationInputFailure(error);}
      finally{busy.delete(w.repository.path);}
    },
    verificationClose(basis,lease,deadline,assertCurrent){
      const record=verificationLeases.get(lease);
      if(!record)verificationInputHold();
      try{
        budget(deadline);verificationInputFence(assertCurrent);
        const w=verificationOwner(basis),selected=verificationSelection(basis,w);
        if(w!==record.w||selected.key!==record.key||record.binding!==basis.binding||
          verificationKeys.get(w)?.get(record.key)!=='open'||
          hash(Buffer.from(JSON.stringify(lease.source)))!==record.digest)verificationInputHold();
        if(materializeSource){if(!lease.artifact)verificationInputHold();verificationArtifacts.assert(lease.artifact,lease.source,basis.binding,assertCurrent);}
        verificationInputFence(assertCurrent);budget(deadline);verificationKeys.get(w)!.set(record.key,'consumed');
      }catch(error){verificationKeys.get(record.w)?.set(record.key,'uncertain');throw verificationInputFailure(error);}
    },
    verificationAccept(basis,lease,assertCurrent){
      const record=verificationLeases.get(lease);if(!record)verificationInputHold();
      verificationInputFence(assertCurrent);
      const w=verificationOwner(basis),selected=verificationSelection(basis,w);
      if(w!==record.w||selected.key!==record.key||record.binding!==basis.binding||
        verificationKeys.get(w)?.get(record.key)!=='consumed'||
        hash(Buffer.from(JSON.stringify(lease.source)))!==record.digest)verificationInputHold();
      if(materializeSource){if(!lease.artifact)verificationInputHold();verificationArtifacts.assert(lease.artifact,lease.source,basis.binding,assertCurrent);}
      verificationInputFence(assertCurrent);
    },
    verificationReject(lease){const record=verificationLeases.get(lease);if(record)verificationKeys.get(record.w)?.set(record.key,'uncertain');},
    async finalize(basis, deadline, assertCurrent) {
      const w = owned.get(basis.run.workspacePath);
      if (!w || w.state !== 'captured' || contextCaptures.get(w.path) !== contextIdentity(basis.run, basis.execution) ||
          typeof assertCurrent !== 'function' || busy.has(w.repository.path) || quarantined.has(w.repository.path)) finalizationUncertain();
      const repository = w.repository; busy.add(repository.path);
      const finalizationOwner=Object.freeze({});finalizationOwners.set(repository.path,finalizationOwner);
      let entered = false, phase: 'original' | 'head' | 'index' = 'original';
      let outputIndex: FileObservation | undefined, candidateId: string | undefined;
      let mainHead: FileObservation | undefined;
      let originalLog: {dir: string | null; value: FileObservation | null} | undefined;
      let finalLog: {dir: string | null; value: FileObservation | null} | undefined;
      const absent = (path: string) => {
        try { lstatSync(path); finalizationUncertain(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      };
      const fence = () => { budget(deadline); assertCurrent(); budget(deadline); };
      const core = () => {
        budget(deadline); checkRepository(repository);
        if (root() !== w.rootIdentity || directory(w.path) !== w.identity || !w.admin || directory(w.admin) !== w.adminIdentity ||
            directory(dirname(w.admin)) !== w.adminRootIdentity || !w.pointer || !w.index) finalizationUncertain();
        if (!mainHead) finalizationUncertain();
        sameFile(join(w.path, '.git'), w.pointer, 16384); sameFile(join(repository.path, '.git/HEAD'), mainHead, 256);
        if (text(file(join(w.admin, 'commondir'), 256).bytes) !== '../..\n' ||
            text(file(join(w.admin, 'gitdir'), 8192).bytes) !== join(w.path, '.git') + '\n' ||
            text(file(join(w.admin, 'HEAD'), 256).bytes) !== (phase === 'original' ? repository.commit : candidateId) + '\n' ||
            basis.execution.sourceDigest !== readCurrentProducerSourceIdentity()) finalizationUncertain();
        sameFile(join(w.admin, 'index'), phase === 'index' ? outputIndex! : w.index, 1024 * 1024);
        absent(join(w.admin, 'config.worktree'));
        const expectedLog = phase === 'original' ? originalLog : finalLog;
        if (expectedLog) {
          if (expectedLog.dir) { if (directory(logsDir) !== expectedLog.dir) finalizationUncertain(); }
          else absent(logsDir);
          if (expectedLog.value) sameFile(logPath, expectedLog.value, 65536);
          else if (expectedLog.dir) absent(logPath);
        }
      };
      const observe = async (args: string[], bytes: number, input?: Buffer) => {
        fence(); core(); const value = await command(repository.path, args, { bytes, deadline, ...(input === undefined ? {} : { input }) });
        core(); fence(); return value;
      };
      const object = async (kind: TextObjectKind, id: string, limit: number) => {
        if (!commitString(id) || limit !== (kind === 'blob' ? 100000 : 65536)) finalizationUncertain();
        if (text(await observe(['cat-file', '-t', id], 256)) !== kind + '\n') finalizationUncertain();
        const length = text(await observe(['cat-file', '-s', id], 256));
        if (!/^(?:0|[1-9][0-9]*)\n$/.test(length)) finalizationUncertain();
        const size = Number(length.trim()); if (!Number.isSafeInteger(size) || size > limit) finalizationUncertain();
        const bytes = await observe(['cat-file', kind, id], size); if (bytes.length !== size) finalizationUncertain(); return bytes;
      };
      const scan = () => { fence(); core(); const value = scanWorkspace(w, deadline); core(); fence(); return value; };
      const peers = () => {
        const names: string[] = [], heads: Record<string, string> = Object.create(null), dir = opendirSync(dirname(w.admin!));
        try {
          for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
            budget(deadline);
            if (names.length >= 128 || !/^[A-Za-z0-9_.-]{1,128}$/.test(entry.name)) finalizationUncertain();
            const path = join(dirname(w.admin!), entry.name); directory(path); names.push(entry.name);
            if (path !== w.admin) { const value = file(join(path, 'HEAD'), 256); heads[entry.name] = value.identity + '\0' + value.digest; }
          }
        } finally { dir.closeSync(); }
        return JSON.stringify({ names: names.sort(), heads: Object.entries(heads).sort() });
      };
      const logPath = join(w.admin!, 'logs/HEAD'), logsDir = join(w.admin!, 'logs');
      const log = () => {
        let dir: string;
        try { dir = directory(logsDir); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { dir: null, value: null }; }
        try { return { dir, value: file(logPath, 65536) }; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return { dir, value: null }; }
      };
      const statusArgs = ['--git-dir=' + w.admin!, '--work-tree=' + w.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all'];
      try {
        mainHead = file(join(repository.path, '.git/HEAD'), 256);
        fence(); core();
        absent(join(w.admin!, 'HEAD.lock')); absent(join(w.admin!, 'index.lock')); absent(logPath + '.lock');
        const oldLog = log(), oldPeers = peers(); originalLog = oldLog;
        const refs = await observe(['for-each-ref', '--format=%(refname)%00%(objectname)'], 65536);
        const base = await validateLocalV4TextTree(repository.commit, object, deadline);
        const expected = await validateLocalV4RootTextTree(basis.phase.expectedTree, object, deadline);
        if (base.inputTree !== repository.tree || base.inputTree !== basis.execution.inputTree) finalizationUncertain();
        const initial = scan(), plan = await planCheckpoint(initial.files, deadline);
        if (plan.tree !== expected.inputTree || JSON.stringify(Object.entries(expected.files).sort()) !== JSON.stringify(Object.entries(initial.files).sort())) finalizationUncertain();
        const status = await observe(statusArgs, 65536);
        let reported: string[];
        try { reported = liveProgressPaths(status, basis.execution.configuration.allowedPaths); }
        catch { finalizationFormatRefused(); }
        const changedPaths = [...new Set([...Object.keys(base.files), ...Object.keys(initial.files)])]
          .filter(path => base.files[path] !== initial.files[path]).sort();
        if (!changedPaths.length || JSON.stringify(changedPaths) !== JSON.stringify(reported.sort())) finalizationFormatRefused();
        const commitPlan = planFinalizationCommit(repository.commit, expected.inputTree, basis.settledAt); candidateId = commitPlan.commit;
        const patch = await observe(['diff', '--binary', '--no-ext-diff', '--no-textconv', repository.commit, expected.inputTree], 2 * 1024 * 1024);
        const numstat = await observe(['diff', '--numstat', '-z', '--no-ext-diff', '--no-textconv', repository.commit, expected.inputTree], 65536);
        const plannedCandidate = Object.freeze({ inputCommit: candidateId, ...expected });
        validateLocalV4CandidateMaterial({ base, candidate: plannedCandidate, rawCommit: commitPlan.bytes,
          rawTree: await object('tree', expected.inputTree, 65536), patch, numstat });
        const artifacts = join(dataDir, 'artifacts'), runArtifacts = join(artifacts, basis.run.id);
        if (!/^[a-f0-9-]{36}$/.test(basis.run.id)) finalizationUncertain();
        directory(dataDir); const artifactsIdentity = directory(artifacts), runArtifactsIdentity = directory(runArtifacts);
        if (scan().identity !== initial.identity || !status.equals(await observe(statusArgs, 65536)) || peers() !== oldPeers ||
            !refs.equals(await observe(['for-each-ref', '--format=%(refname)%00%(objectname)'], 65536))) finalizationUncertain();
        fence(); core(); entered = true; w.state = 'finalizing';
        finalizingWriters.set(w,Object.freeze({owner:finalizationOwner,context:contextIdentity(basis.run,basis.execution),
          tuple:digest({run:basis.run,work:basis.work,execution:basis.execution})}));
        if (text(await observe(['hash-object', '--no-filters', '--stdin', '-w', '-t', 'commit'], 256, commitPlan.bytes)) !== candidateId + '\n') finalizationUncertain();
        const actual = await validateLocalV4TextTree(candidateId, object, deadline);
        const rawCommit = await object('commit', candidateId, 65536), rawTree = await object('tree', actual.inputTree, 65536);
        const actualPatch = await observe(['show', '--format=', '--binary', '--no-ext-diff', '--no-textconv', candidateId], 2 * 1024 * 1024);
        const actualNumstat = await observe(['show', '--format=', '--numstat', '-z', '--no-ext-diff', '--no-textconv', candidateId], 65536);
        validateLocalV4CandidateMaterial({ base, candidate: actual, rawCommit, rawTree, patch: actualPatch, numstat: actualNumstat });
        if (actual.inputTree !== expected.inputTree || !rawCommit.equals(commitPlan.bytes) || !actualPatch.equals(patch) || !actualNumstat.equals(numstat)) finalizationUncertain();
        fence(); core();
        if (directory(artifacts) !== artifactsIdentity || directory(runArtifacts) !== runArtifactsIdentity) finalizationUncertain();
        const evidenceDir = join(runArtifacts, 'finalization-' + randomUUID()); mkdirSync(evidenceDir, { mode: 0o700 });
        const evidenceIdentity = directory(evidenceDir), diffPath = join(evidenceDir, 'candidate.patch');
        fence(); core();
        const fd = openSync(diffPath, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_WRONLY, 0o600);
        try {
          let offset = 0;
          while (offset < actualPatch.length) { fence(); core(); const count = writeSync(fd, actualPatch, offset, actualPatch.length - offset); if (count <= 0) finalizationUncertain(); offset += count; fence(); }
          fence(); core(); fsyncSync(fd); fence(); core();
          const value = fstatSync(fd); owner(value); if (!value.isFile() || value.size !== actualPatch.length || (value.mode & 0o777) !== 0o600) finalizationUncertain();
        } finally { closeSync(fd); }
        fence(); core(); const artifact = file(diffPath, 2 * 1024 * 1024);
        if (!artifact.bytes.equals(actualPatch) || directory(evidenceDir) !== evidenceIdentity || directory(artifacts) !== artifactsIdentity ||
            directory(runArtifacts) !== runArtifactsIdentity) finalizationUncertain();
        if (!artifact.bytes.equals(await observe(['show', '--format=', '--binary', '--no-ext-diff', '--no-textconv', candidateId], 2 * 1024 * 1024)) ||
            scan().identity !== initial.identity || !status.equals(await observe(statusArgs, 65536)) || peers() !== oldPeers ||
            !refs.equals(await observe(['for-each-ref', '--format=%(refname)%00%(objectname)'], 65536))) finalizationUncertain();
        fence(); core(); absent(join(w.admin!, 'HEAD.lock')); absent(join(w.admin!, 'index.lock')); absent(logPath + '.lock');
        const prefix = ['-c', 'user.name=Local Factory', '-c', 'user.email=factory@localhost.invalid', '--git-dir=' + w.admin!, '--work-tree=' + w.path];
        const cas = await command(repository.path, [...prefix, 'update-ref', '--no-deref', '-m', 'Factory candidate finalization', 'HEAD', candidateId, repository.commit], { bytes: 256, deadline });
        phase = 'head'; core(); fence(); if (cas.length) finalizationUncertain();
        const updatedLog = log();
        if (oldLog.dir && updatedLog.dir !== oldLog.dir || oldLog.value &&
            (!updatedLog.value || !updatedLog.value.bytes.subarray(0, oldLog.value.bytes.length).equals(oldLog.value.bytes))) finalizationUncertain();
        if (updatedLog.value) {
          const append = updatedLog.value.bytes.subarray(oldLog.value?.bytes.length ?? 0).toString('utf8');
          const line = new RegExp('^' + repository.commit + ' ' + candidateId + ' Local Factory <factory@localhost\\.invalid> [0-9]+ [+-][0-9]{4}\\tFactory candidate finalization\\n$');
          if (!line.test(append)) finalizationUncertain();
        }
        finalLog = updatedLog;
        fence(); core();
        const indexWrite = await command(repository.path, ['--git-dir=' + w.admin!, '--work-tree=' + w.path,
          'read-tree', '--no-sparse-checkout', candidateId], { bytes: 256, deadline });
        outputIndex = file(join(w.admin!, 'index'), 1024 * 1024); phase = 'index'; core(); fence(); if (indexWrite.length) finalizationUncertain();
        const index = text(await observe(['--git-dir=' + w.admin!, '--work-tree=' + w.path, 'ls-files', '--stage', '-z'], 65536));
        const wanted = Object.keys(actual.files).sort().map(path => '100644 ' + createHash('sha1').update('blob ' + Buffer.byteLength(actual.files[path]) + '\0').update(actual.files[path]).digest('hex') + ' 0\t' + path + '\0').join('');
        if (index !== wanted) finalizationUncertain();
        if ((await observe(statusArgs, 65536)).length !== 0 || scan().identity !== initial.identity || peers() !== oldPeers ||
            !refs.equals(await observe(['for-each-ref', '--format=%(refname)%00%(objectname)'], 65536))) finalizationUncertain();
        absent(join(w.admin!, 'HEAD.lock')); absent(join(w.admin!, 'index.lock')); absent(logPath + '.lock');
        if (updatedLog.dir && directory(logsDir) !== updatedLog.dir) finalizationUncertain();
        if (updatedLog.value) sameFile(logPath, updatedLog.value, 65536);
        else if (log().value !== null) finalizationUncertain();
        const finalTree = await validateLocalV4TextTree(candidateId, object, deadline);
        if (finalTree.inputTree !== expected.inputTree || !artifact.bytes.equals(await observe(['show', '--format=', '--binary', '--no-ext-diff', '--no-textconv', candidateId], 2 * 1024 * 1024))) finalizationUncertain();
        sameFile(diffPath, artifact, 2 * 1024 * 1024); fence(); core(); w.state = 'finalized';
        finalOutputs.set(w,{commit:candidateId,tree:actual.inputTree,index:outputIndex!,mainHead:mainHead!});
        return Object.freeze({ commit: candidateId, tree: actual.inputTree, changedPaths, diffPath, diffSha256: artifact.digest });
      } catch (error) {
        quarantined.add(repository.path);
        if (entered) { w.state = 'uncertain'; finalizationUncertain(); }
        if (checkpointPolicyKind(error) === 'unsupported' || candidatePolicyKind(error) === 'unsupported') finalizationFormatRefused();
        throw finalizationPolicyFailure(error);
      } finally {
        if(finalizingWriters.get(w)?.owner===finalizationOwner)finalizingWriters.delete(w);
        if(finalizationOwners.get(repository.path)===finalizationOwner)finalizationOwners.delete(repository.path);
        busy.delete(repository.path);
      }
    },
    async checkpoint(basis, deadline) {
      const w = owned.get(basis.run.workspacePath);
      if (!w || w.state !== 'captured' || contextCaptures.get(w.path) !== contextIdentity(basis.run, basis.execution) ||
          busy.has(w.repository.path) || quarantined.has(w.repository.path)) throw checkpointPolicyFailure(null);
      const repository = w.repository; busy.add(repository.path); let enteredWrites = false;
      const current = () => {
        budget(deadline); inspect(w);
        if (basis.execution.sourceDigest !== readCurrentProducerSourceIdentity()) checkpointUncertain();
        try { lstatSync(join(w.admin!, 'config.worktree')); checkpointUncertain(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      };
      const observe = async (args: string[], bytes: number, input?: Buffer) => {
        current(); const value = await command(repository.path, args, { bytes, deadline, ...(input === undefined ? {} : { input }) });
        current(); return value;
      };
      const object = async (kind: TextObjectKind, id: string, limit: number) => {
        if (!commitString(id) || limit !== (kind === 'blob' ? 100000 : 65536)) checkpointUncertain();
        if (text(await observe(['cat-file', '-t', id], 256)) !== kind + '\n') checkpointUncertain();
        const length = text(await observe(['cat-file', '-s', id], 256));
        if (!/^(?:0|[1-9][0-9]*)\n$/.test(length)) checkpointUncertain();
        const size = Number(length.trim()); if (!Number.isSafeInteger(size) || size > limit) checkpointUncertain();
        const value = await observe(['cat-file', kind, id], size); if (value.length !== size) checkpointUncertain(); return value;
      };
      const scan = () => { current(); const value = scanWorkspace(w, deadline); current(); return value; };
      try {
        current();
        const original = await validateLocalV4TextTree(repository.commit, object, deadline);
        if (original.inputTree !== basis.execution.inputTree || original.inputTree !== repository.tree) checkpointUncertain();
        const statusArgs = ['--git-dir=' + w.admin!, '--work-tree=' + w.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all'];
        const status = await observe(statusArgs, 65536);
        let statusPaths: string[];
        try { statusPaths = liveProgressPaths(status, basis.execution.configuration.allowedPaths); }
        catch { checkpointFormatRefused(); }
        const before = scan();
        const changedPaths = [...new Set([...Object.keys(original.files), ...Object.keys(before.files)])]
          .filter(path => original.files[path] !== before.files[path]).sort();
        // All source data must agree with genuine status, including ignored data.
        if (!changedPaths.length || JSON.stringify(changedPaths) !== JSON.stringify([...statusPaths].sort())) checkpointFormatRefused();
        const plan = await planCheckpoint(before.files, deadline);
        if (basis.phase.kind === 'RECHECK' && plan.tree !== basis.phase.expectedTree) checkpointUncertain();
        if (scan().identity !== before.identity || !status.equals(await observe(statusArgs, 65536))) checkpointUncertain();
        for (const planned of plan.objects) {
          current(); enteredWrites = true;
          const result = await observe(['hash-object', '--no-filters', '--stdin', '-w', '-t', planned.kind], 256, planned.bytes);
          if (text(result) !== planned.id + '\n') checkpointUncertain();
        }
        const actual = await validateLocalV4RootTextTree(plan.tree, object, deadline);
        if (JSON.stringify(Object.entries(actual.files).sort()) !== JSON.stringify(Object.entries(before.files).sort()) ||
            scan().identity !== before.identity || !status.equals(await observe(statusArgs, 65536))) checkpointUncertain();
        current();
        if(basis.phase.kind==='CAPTURE')checkpointOutputs.set(verificationCheckpointKey(basis.run,basis.execution,basis.phase),actual.inputTree);
        return Object.freeze({ tree: actual.inputTree, changedPaths });
      } catch (error) {
        quarantined.add(repository.path);
        if (enteredWrites) checkpointUncertain();
        throw checkpointPolicyFailure(error);
      } finally { busy.delete(repository.path); }
    },
    async read(basis, deadline, progress) {
      const w = owned.get(basis.run.workspacePath);
      if (!w || w.state !== 'captured' || contextCaptures.get(w.path) !== contextIdentity(basis.run, basis.execution) ||
          busy.has(w.repository.path) || quarantined.has(w.repository.path)) throw contextPolicyFailure(null);
      const repository = w.repository; busy.add(repository.path);
      const current = () => {
        budget(deadline); inspect(w);
        if (basis.execution.sourceDigest !== readCurrentProducerSourceIdentity()) throw contextPolicyFailure(null);
        try { lstatSync(join(w.admin!, 'config.worktree')); throw contextPolicyFailure(null); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      };
      const observe = async (args: string[], bytes: number) => {
        current(); const value = await command(repository.path, args, { bytes, deadline }); current(); return value;
      };
      const object = async (kind: TextObjectKind, id: string, limit: number) => {
        if (!commitString(id) || limit !== (kind === 'blob' ? 100000 : 65536)) throw contextPolicyFailure(null);
        if (text(await observe(['cat-file', '-t', id], 256)) !== kind + '\n') contextFormatRefused();
        const length = text(await observe(['cat-file', '-s', id], 256));
        if (!/^(?:0|[1-9][0-9]*)\n$/.test(length)) throw contextPolicyFailure(null);
        const size = Number(length.trim()); if (!Number.isSafeInteger(size) || size > limit) contextFormatRefused();
        const value = await observe(['cat-file', kind, id], size);
        if (value.length !== size) throw contextPolicyFailure(null); return value;
      };
      try {
        current();
        if (progress) {
          const args = ['--git-dir=' + w.admin!, '--work-tree=' + w.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all'];
          const before = await observe(args, 65536), paths = liveProgressPaths(before, basis.execution.configuration.allowedPaths);
          for (const path of paths) {
            let cursor = w.path;
            for (const segment of path.split('/')) {
              budget(deadline); cursor = join(cursor, segment);
              try { if (lstatSync(cursor).isSymbolicLink()) contextFormatRefused(); }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            }
          }
          if (!before.equals(await observe(args, 65536))) throw contextPolicyFailure(null);
          current(); return null;
        }
        const input = await validateLocalV4TextTree(repository.commit, object, deadline);
        if (input.inputTree !== repository.tree || input.inputTree !== basis.execution.inputTree) throw contextPolicyFailure(null);
        const selected = basis.tree === input.inputTree ? input : await validateLocalV4RootTextTree(basis.tree, object, deadline);
        current(); return selected.files;
      } catch (error) { quarantined.add(repository.path); throw contextPolicyFailure(error); }
      finally { busy.delete(repository.path); }
    },
  });
  return preparation;
}

/** Fixed host operation only. No argv, environment or native callback is exposed. */
export function inspectLocalV4Candidate(preparation: Preparation, input: CandidateInspection, deadline: number): Promise<CandidateMaterial> {
  const inspect = candidateInspectors.get(preparation); if (!inspect) hold();
  return inspect(input, deadline);
}

/** Fixed host composition; the marker can only deny physical cleanup. */
export function bindLocalV4PreparationCapture(preparation: Preparation, producer: ServiceProducer): ServiceProducer {
  const mark = captureMarkers.get(preparation); if (!mark) refuse();
  const controls = contextControls.get(preparation); if (!controls) refuse();
  const context = producer.contextBasis ? async (run: Run, phase: Parameters<NonNullable<ServiceProducer['contextBasis']>>[1]) => {
    try {
      const deadline = performance.now() + 30000, basis = producer.contextBasis!(run, phase);
      const files = await controls.read(basis, deadline, phase.kind === 'PROGRESS');
      if (producer.contextBasis!(run, phase).binding !== basis.binding) throw contextPolicyFailure(null);
      budget(deadline);
      const value = phase.kind === 'PROGRESS' ? '' : sourceContext(basis, files!);
      budget(deadline); return value;
    } catch (error) { throw contextPolicyFailure(error); }
  } : undefined;
  const checkpoint: ServiceProducer['checkpoint'] = producer.checkpointBasis ? async (run, phase) => {
    try {
      const deadline = performance.now() + 30000, basis = producer.checkpointBasis!(run, phase);
      const result = await controls.checkpoint(basis, deadline);
      if (producer.checkpointBasis!(run, phase).binding !== basis.binding) checkpointUncertain();
      budget(deadline); return result;
    } catch (error) { throw checkpointPolicyFailure(error); }
  } : undefined;
  const commitCandidate: ServiceProducer['commitCandidate'] = producer.candidateBasis ? async (run, phase, assertCurrent) => {
    try {
      if (typeof assertCurrent !== 'function') finalizationUncertain();
      const deadline = performance.now() + 30000, basis = producer.candidateBasis!(run, phase);
      const current = () => {
        budget(deadline); assertCurrent();
        if (producer.candidateBasis!(run, phase).binding !== basis.binding) finalizationUncertain();
        budget(deadline);
      };
      current(); const result = await controls.finalize(basis, deadline, current); current(); return result;
    } catch (error) { throw finalizationPolicyFailure(error); }
  } : undefined;
  const originalVerificationBasis=producer.verificationBasis;
  const inputPhases=new WeakMap<VerificationInputLease,VerificationInputBasis>();
  const verificationBasis=(run:Run,phase:VerificationInputBasis['phase'])=>{
    if(typeof originalVerificationBasis!=='function'||producer.verificationBasis!==originalVerificationBasis)verificationInputHold();
    return originalVerificationBasis.call(producer,run,phase);
  };
  const assertVerificationInputReady:ServiceProducer['assertVerificationInputReady']=originalVerificationBasis?run=>{
    try{controls.verificationReady(verificationBasis(run,{kind:'ENTRY'}));}catch(error){throw verificationInputFailure(error);}
  }:undefined;
  const prepareVerificationInput:ServiceProducer['prepareVerificationInput']=originalVerificationBasis?async(run,phase,assertCurrent)=>{
    let lease:VerificationInputLease|undefined;
    try{
      verificationInputFence(assertCurrent);
      const deadline=performance.now()+30000,basis=verificationBasis(run,phase);
      const current=()=>{verificationInputFence(assertCurrent);budget(deadline);
        if(verificationBasis(run,phase).binding!==basis.binding)verificationInputHold();budget(deadline);};
      current();lease=await controls.verificationPrepare(basis,deadline,current);current();
      inputPhases.set(lease,basis);return lease;
    }catch(error){if(lease)controls.verificationReject(lease);verificationInputFence(assertCurrent);throw verificationInputFailure(error);}
  }:undefined;
  const closeVerificationInput:ServiceProducer['closeVerificationInput']=originalVerificationBasis?async(run,lease,assertCurrent)=>{
    try{
      verificationInputFence(assertCurrent);const original=inputPhases.get(lease);if(!original)verificationInputHold();
      const deadline=performance.now()+30000,current=()=>{verificationInputFence(assertCurrent);budget(deadline);
        if(verificationBasis(run,original.phase).binding!==original.binding)verificationInputHold();budget(deadline);};
      current();controls.verificationClose(verificationBasis(run,original.phase),lease,deadline,current);current();
      // Denial-only receipt: retain the original phase after async close and
      // helper returns. The actual outer caller must invoke it after its last await.
      return ()=>{
        try{current();controls.verificationAccept(verificationBasis(run,original.phase),lease,current);current();}
        catch(error){controls.verificationReject(lease);verificationInputFence(assertCurrent);throw verificationInputFailure(error);}
      };
    }catch(error){controls.verificationReject(lease);verificationInputFence(assertCurrent);throw verificationInputFailure(error);}
  }:undefined;
  const bound: ServiceProducer = {
    capture(work, run, model, version) {
      mark(work.repositoryPath, run.workspacePath);
      const snapshot = producer.capture(work, run, model, version);
      if (context || checkpoint || commitCandidate || prepareVerificationInput) {
        if (snapshot.version !== 4) throw contextPolicyFailure(null);
        controls.capture(run, snapshot);
      }
      return snapshot;
    },
    snapshot(run) { return producer.snapshot(run); },
    read(run) { return producer.read(run); },
    finalize(run) { return producer.finalize(run); },
    ...(producer.beforeReady ? { beforeReady: (run: Parameters<NonNullable<ServiceProducer['beforeReady']>>[0]) => producer.beforeReady!(run) } : {}),
    ...(context ? { context: (run, phase) => context(run, phase), assertProgress: async (run: Run) => { await context(run, { kind: 'PROGRESS' }); } } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    ...(commitCandidate ? { commitCandidate } : {}),
    ...(assertVerificationInputReady&&prepareVerificationInput&&closeVerificationInput?
      {assertVerificationInputReady,prepareVerificationInput,closeVerificationInput}:{}),
  };
  return Object.freeze(bound);
}
