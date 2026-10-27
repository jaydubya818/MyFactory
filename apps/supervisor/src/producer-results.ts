import { isModelReference } from '../../../packages/contracts/src/model-reference.ts';
import { createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FactoryStorage } from '../../../packages/storage/src/index.ts';
import type { Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import { DEFAULT_VERIFICATION_IMAGE } from '../../../packages/verification/src/index.ts';
import {
  canonical, digest, sha256, operationId, signResult, verifyResult, RESULT_PROTOCOL, MAX_ARTIFACT_BYTES,
  type ExecutionConfiguration, type ExecutionSnapshot, type ResultKey, type ResultManifest, type SignedResult,
} from '../../../packages/hosted-routing/src/result.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
/** Loaded-code installation identity; changes during this process require a restart. No secrets included. */
export function sourceIdentity(): string {
  const files: Record<string, string> = {};
  function scan(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir,name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error('Runtime source symlink is not attestable');
      if (stat.isDirectory()) scan(path);
      else if (/\.(?:ts|mjs|js)$/.test(name)) files[relative(root,path)] = sha256(readFileSync(path));
    }
  }
  scan(join(root,'apps/supervisor/src'));
  for (const name of readdirSync(join(root,'packages')).sort()) {
    const src = join(root,'packages',name,'src'); if (existsSync(src)) scan(src);
  }
  for (const name of ['package.json','package-lock.json']) files[name] = sha256(readFileSync(join(root,name)));
  return digest(files);
}
const loadedSource = sourceIdentity();
export const SNAPSHOT_EVENT = 'run.execution_snapshot';
export const RESULT_EVENT = 'run.signed_result';
export interface ProducerOptions { sessionMetadata?: boolean; factoryId: string; currentKeyId: string; privateKey: string; keys: ResultKey[] }

/** Opt-in only. Reuses the hosted receipt private key; never creates or rotates a key. */
export function producerOptions(dataDir: string): ProducerOptions | undefined {
  const path = join(dataDir,'result-signing.json');
  if (!existsSync(path)) return undefined;
  const config = JSON.parse(readFileSync(path,'utf8'));
  if (Object.keys(config).sort().join(',') !== 'currentKeyId,factoryId,keys') throw new Error('Invalid result signing configuration');
  return {...config, privateKey:readFileSync(join(dataDir,'hosted-receipt-key.pem'),'utf8')};
}
export function readRunRecord<T>(storage: FactoryStorage, run: Run, type: string): T | null {
  const records = storage.listEvents(run.workOrderId).filter(e => e.runId === run.id && e.type === type);
  if (records.length > 1) throw new Error('Ambiguous immutable run record');
  return records.length ? structuredClone(records[0].payload) as T : null;
}
/** BEGIN IMMEDIATE serializes all connections; no schema migration or second store. */
export function saveRunRecord<T extends object>(storage: FactoryStorage, run: Run, type: string, payload: T): T {
  if (![SNAPSHOT_EVENT,RESULT_EVENT].includes(type)) throw new Error('Unsupported immutable record');
  return storage.transaction(() => {
    const saved = readRunRecord<T>(storage,run,type);
    if (saved) {
      if (canonical(saved) !== canonical(payload)) throw new Error('Conflicting immutable run record');
      return saved;
    }
    if (storage.getRun(run.id)?.workOrderId !== run.workOrderId) throw new Error('Run binding changed');
    storage.appendEvent({workOrderId:run.workOrderId, runId:run.id, type, payload:JSON.parse(canonical(payload))});
    return structuredClone(payload);
  });
}
export function producerState(storage: FactoryStorage, run: Run): 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'STOPPING' | 'UNKNOWN' | 'RUNNING' {
  if (run.state === 'interrupted') return 'UNKNOWN';
  if (run.state === 'cancelled') return 'CANCELLED';
  if (run.state === 'failed') return 'FAILED';
  if (run.state === 'ready_for_review') return 'COMPLETED';
  if (storage.listEvents(run.workOrderId).some(e => e.runId === run.id && e.type === 'run.cancel_requested')) return 'STOPPING';
  return 'RUNNING';
}

export class ProducerResults {
  private readonly storage: FactoryStorage;
  private readonly dataDir: string;
  private readonly options: ProducerOptions;
  constructor(storage: FactoryStorage, dataDir: string, options: ProducerOptions) {
    this.storage=storage; this.dataDir=dataDir; this.options=structuredClone(options);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(options.factoryId)) throw new Error('Invalid Factory identity');
    const keys=options.keys.filter(k => k.factoryId === options.factoryId && k.keyId === options.currentKeyId);
    if (keys.length !== 1) throw new Error('Unknown or ambiguous current signing key');
    const actual=createPublicKey(options.privateKey), expected=createPublicKey(keys[0].publicKey);
    if (actual.asymmetricKeyType !== 'ed25519' || expected.asymmetricKeyType !== 'ed25519' ||
      !actual.export({type:'spki',format:'der'}).equals(expected.export({type:'spki',format:'der'}))) throw new Error('Signing key does not match configured producer');
  }
  private assertSource(): void { if (sourceIdentity() !== loadedSource) throw new Error('Producer source changed; restart before attesting'); }
  capture(work: WorkOrder, run: Run, model: string, executorVersion: string): ExecutionSnapshot {
    this.assertSource();
    const key=this.options.keys.find(k => k.factoryId === this.options.factoryId && k.keyId === this.options.currentKeyId)!;
    const now=Date.now();
    if (key.revokedAt || key.retiredAt || !(Date.parse(key.activeFrom) <= now && now <= Date.parse(key.notAfter))) {
      throw new Error('Current producer signing key is unavailable for admission');
    }
    if (!executorVersion || !isModelReference(model)) throw new Error('Execution configuration unavailable');
    const events=this.storage.listEvents(work.id);
    const intake=events.filter(e => e.type === 'hosted.intake_received');
    if (intake.length > 1) throw new Error('Ambiguous initiating request');
    const created=events.find(e => e.type === 'workorder.created');
    const requestId=intake[0]?.payload.issueId ?? created?.payload.requestId ?? `local-workorder:${work.id}`;
    if (typeof requestId !== 'string' || !requestId) throw new Error('Request identity missing');
    const configuration: ExecutionConfiguration = {
      model, executor:'codex-cli', executorVersion, skillRevision:'fd8f20a879b507cf09feba08663a1edf7a949353',
      workerProfile:run.workerProfile, verificationImage:DEFAULT_VERIFICATION_IMAGE,
      nodeVersion:process.version, platform:process.platform, architecture:process.arch,
      commands:work.kind === 'defect' && work.reproductionCommand ? [...new Set([work.reproductionCommand,...work.checkCommands])] : [...work.checkCommands],
      allowedPaths:[...work.allowedPaths], timeoutMs:30*60*1000,
    };
    const configurationDigest=digest(configuration);
    // Hash the admitted Work, not mutable current Factory state or a completion callback.
    const requestDigest=digest({requestId, work});
    const snapshot: ExecutionSnapshot = {
      version:this.options.sessionMetadata?3:1, ...(this.options.sessionMetadata?{workspace:{kind:'GIT_WORKTREE' as const,path:run.workspacePath,branch:null}}:{}), factoryId:this.options.factoryId, factoryVersion:digest({sourceDigest:loadedSource,configurationDigest}),
      sourceDigest:loadedSource, configurationDigest, configuration, requestId, requestDigest,
      workOrderId:work.id, runId:run.id, attemptNumber:run.attemptNumber, inputCommit:run.inputCommit, capturedAt:run.startedAt,
    };
    return saveRunRecord(this.storage,run,SNAPSHOT_EVENT,snapshot);
  }
  snapshot(run: Run): ExecutionSnapshot | null { return readRunRecord(this.storage,run,SNAPSHOT_EVENT); }
  private savedResult(run: Run): SignedResult | null {
    const result=readRunRecord<SignedResult>(this.storage,run,RESULT_EVENT);
    if (!result) return null;
    const execution=this.snapshot(run);
    if (!execution) throw new Error('Signed result has no execution snapshot');
    const {manifest}=verifyResult(result,{keys:this.options.keys,factoryId:this.options.factoryId,requestId:execution.requestId,
      workOrderId:run.workOrderId,runId:run.id,factoryVersion:execution.factoryVersion,historical:true});
    if (canonical(manifest.execution) !== canonical(execution) || manifest.status !== producerState(this.storage,run) ||
      manifest.completedAt !== run.finishedAt || (manifest.candidate?.commit ?? null) !== run.candidateCommit) throw new Error('Frozen result differs from saved attempt');
    return result;
  }
  read(run: Run): {state: ReturnType<typeof producerState>; result: SignedResult | null} {
    const current=this.storage.getRun(run.id);
    if (!current || current.workOrderId !== run.workOrderId) throw new Error('Unknown attempt');
    const state=producerState(this.storage,current);
    if (['UNKNOWN','RUNNING','STOPPING'].includes(state)) return {state,result:null};
    const saved=this.savedResult(current);
    return {state,result:saved ?? this.finalize(current)};
  }
  finalize(run: Run): SignedResult {
    this.assertSource();
    const saved=this.savedResult(run);
    if (saved) return saved;
    const execution=this.snapshot(run);
    if (!execution) throw new Error('Attempt has no execution snapshot; cannot backfill attestation');
    if (execution.factoryId !== this.options.factoryId || execution.workOrderId !== run.workOrderId || execution.runId !== run.id || execution.attemptNumber !== run.attemptNumber || execution.inputCommit !== run.inputCommit) throw new Error('Attempt snapshot binding changed');
    const status=producerState(this.storage,run);
    if (!['COMPLETED','FAILED','CANCELLED'].includes(status) || !run.finishedAt) throw new Error('Attempt outcome unresolved');
    const checks=this.storage.listChecks(run.id);
    const candidates=this.storage.listEvents(run.workOrderId).filter(e => e.runId === run.id && e.type === 'run.candidate_committed');
    if (candidates.length > 1) throw new Error('Ambiguous candidate');
    const candidateEvent=candidates[0] ?? null;
    const stateDigest=digest({run,checks,candidateEvent,execution});
    const manifest: ResultManifest={protocol:RESULT_PROTOCOL,keyId:this.options.currentKeyId,producer:execution.factoryId,operationId:operationId(execution),execution,
      status:status as ResultManifest['status'],candidate:null,evidence:[],artifacts:[],evidenceDigest:'',artifactDigest:'',completedAt:run.finishedAt,issuedAt:new Date().toISOString()};
    const artifacts: SignedResult['artifacts']=[];
    let total=0;
    const add=(id: string,kind: ResultManifest['artifacts'][number]['kind'],bytes: Buffer,createdAt: string) => {
      total+=bytes.length;
      if (bytes.length > MAX_ARTIFACT_BYTES || total > 8*1024*1024) throw new Error('Artifact export size limit');
      manifest.artifacts.push({id,kind,producer:execution.factoryId,runId:run.id,candidateCommit:run.candidateCommit!,sha256:sha256(bytes),size:bytes.length,createdAt});
      artifacts.push({id,base64:bytes.toString('base64')});
    };
    if (run.candidateCommit) {
      const p=candidateEvent?.payload;
      if (!p || p.candidateCommit !== run.candidateCommit || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(run.candidateCommit) || typeof p.candidateTree !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(p.candidateTree)) throw new Error('Candidate provenance missing');
      const readArtifact=(path: unknown): Buffer => {
        if (typeof path !== 'string') throw new Error('Artifact path missing');
        const base=realpathSync(join(this.dataDir,'artifacts',run.id)), actual=realpathSync(path);
        if (!actual.startsWith(base+sep)) throw new Error('Artifact outside attempt');
        const fd=openSync(actual,'r');
        try {
          const stat=fstatSync(fd);
          if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) throw new Error('Artifact outside attempt or oversized');
          const buffer=Buffer.alloc(MAX_ARTIFACT_BYTES+1); let size=0;
          while (size < buffer.length) {
            const count=readSync(fd,buffer,size,buffer.length-size,null); if (!count) break; size+=count;
          }
          if (size > MAX_ARTIFACT_BYTES || size !== stat.size || fstatSync(fd).size !== size) throw new Error('Artifact changed during bounded read');
          return buffer.subarray(0,size);
        } finally { closeSync(fd); }
      };
      const patch=readArtifact(p.diffPath);
      if (sha256(patch) !== p.diffSha256) throw new Error('Candidate patch changed');
      const object=(type: string,id: string) => execFileSync('git',['-C',run.workspacePath,'cat-file',type,id],{maxBuffer:MAX_ARTIFACT_BYTES,timeout:10_000});
      const commit=object('commit',run.candidateCommit), tree=object('tree',p.candidateTree);
      const actualPatch=execFileSync('git',['-C',run.workspacePath,'show','--format=','--binary','--no-ext-diff','--no-textconv',run.candidateCommit],{maxBuffer:MAX_ARTIFACT_BYTES,timeout:10_000});
      if (!actualPatch.equals(patch)) throw new Error('Patch does not match candidate');
      add('candidate.commit','git-commit',commit,candidateEvent!.createdAt);
      add('candidate.tree','git-tree',tree,candidateEvent!.createdAt);
      add('candidate.patch','patch',patch,candidateEvent!.createdAt);
      manifest.candidate={commit:run.candidateCommit,tree:p.candidateTree,base:run.inputCommit,patchDigest:sha256(patch),commitArtifactId:'candidate.commit',treeArtifactId:'candidate.tree',patchArtifactId:'candidate.patch'};
      for (const c of checks) {
        if (c.runId !== run.id || c.candidateCommit !== run.candidateCommit || !c.logSha256) throw new Error('Check binding missing');
        const bytes=readArtifact(c.logPath); if (sha256(bytes) !== c.logSha256) throw new Error('Check log changed');
        const id=`check:${c.id}`; add(id,'check-log',bytes,c.finishedAt);
        manifest.evidence.push({id:c.id,producer:execution.factoryId,runId:run.id,candidateCommit:c.candidateCommit,command:c.command,status:c.status,exitCode:c.exitCode,startedAt:c.startedAt,finishedAt:c.finishedAt,logArtifactId:id});
      }
    } else if (candidateEvent || checks.length) throw new Error('Orphaned candidate evidence');
    manifest.evidenceDigest=digest(manifest.evidence); manifest.artifactDigest=digest(manifest.artifacts);
    const result=signResult(manifest,artifacts,this.options.privateKey);
    verifyResult(result,{keys:this.options.keys,factoryId:execution.factoryId,requestId:execution.requestId,workOrderId:run.workOrderId,runId:run.id,factoryVersion:execution.factoryVersion});
    return this.storage.transaction(() => {
      const observed={run:this.storage.getRun(run.id),checks:this.storage.listChecks(run.id),candidateEvent:this.storage.listEvents(run.workOrderId).find(e => e.runId === run.id && e.type === 'run.candidate_committed') ?? null,execution:this.snapshot(run)};
      if (digest(observed) !== stateDigest) throw new Error('Attempt changed during result freeze');
      return saveRunRecord(this.storage,run,RESULT_EVENT,result);
    });
  }
}

// Inactive primitive: no producer/service calls it. A future admitted host caller
// must select a local, stable, host-owned repository and the exact input commit.
// These guards do not provide atomic revocation against a concurrent repository
// administrator. Returned object identity proves no Work/owner/source authority.
import { createHash as localGitHashV4 } from 'node:crypto';
import { constants as localGitFsV4, opendirSync as localGitOpenDirectoryV4 } from 'node:fs';
import { isAbsolute as localGitIsAbsoluteV4 } from 'node:path';

const LOCAL_GIT_INPUT_V4 = {
  executable: '/opt/homebrew/Cellar/git/2.48.1/bin/git',
  executableSha256: '7ed424dafb29f1d4e3df1ca215efcba044b19cc78cf8b8df5a74cbdbfcbf4899',
  version: 'git version 2.48.1\n',
  objectBytes: 4 * 1024 * 1024,
  timeoutMs: 10_000,
  metadataBytes: 16 * 1024,
} as const;

function localGitInputFileV4(path: string, limit: number): Buffer {
  if (realpathSync(path) !== path) throw new Error('Git input path redirection is unsupported');
  const fd = openSync(path, localGitFsV4.O_RDONLY | localGitFsV4.O_NOFOLLOW | localGitFsV4.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > limit) throw new Error('Git input file type or size limit');
    const buffer = Buffer.alloc(limit + 1); let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(fd);
    if (size > limit || size !== before.size || after.size !== size || after.ino !== before.ino || after.dev !== before.dev ||
      after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('Git input file changed during bounded read');
    return buffer.subarray(0, size);
  } finally { closeSync(fd); }
}

function localGitInputDirectoryV4(path: string, limit: number): string[] {
  if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new Error('Git input directory redirection is unsupported');
  const directory = localGitOpenDirectoryV4(path), names: string[] = [];
  try {
    for (;;) {
      const entry = directory.readSync(); if (!entry) return names.sort();
      if (names.length >= limit || entry.isSymbolicLink()) throw new Error('Git input directory bound or redirection');
      names.push(entry.name);
    }
  } finally { directory.closeSync(); }
}

/** Unused identity-only read of exact raw commit/tree objects, including packs.
 * Supports SHA-1/SHA-256 regular working repositories on the pinned host Git.
 * Linked/bare layouts, includes, alternates, promisor/unknown config fail closed;
 * no writes, network, ref resolution, retries or alternate-executable fallback.
 * Caller must keep repository layout/config/object store stable for this call. */
export function readLocalGitInputTreeV4(trustedRepository: string, expectedCommit: string): { inputCommit: string; inputTree: string } {
  if (typeof trustedRepository !== 'string' || trustedRepository.length > 4096 || !localGitIsAbsoluteV4(trustedRepository) || trustedRepository.includes('\0') ||
    typeof expectedCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedCommit)) throw new Error('Unsupported exact Git input identity');
  const env: NodeJS.ProcessEnv = {
    PATH: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '', GIT_CEILING_DIRECTORIES: '/',
  };
  const git = (args: string[], input?: Buffer, maxBuffer: number = LOCAL_GIT_INPUT_V4.metadataBytes * 4, timeout: number = LOCAL_GIT_INPUT_V4.timeoutMs): Buffer => {
    try {
      return execFileSync(LOCAL_GIT_INPUT_V4.executable, ['--no-pager', '--no-replace-objects', '--no-lazy-fetch', '--no-optional-locks',
        '-c', 'protocol.allow=never', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
        '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.commitGraph=false', '-c', 'core.multiPackIndex=false', ...args], {
        cwd: '/', env, input, timeout, killSignal: 'SIGKILL', maxBuffer, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { throw new Error('Bounded pinned Git input command failed; no fallback'); }
  };
  if (existsSync('/.git') || sha256(localGitInputFileV4(LOCAL_GIT_INPUT_V4.executable, LOCAL_GIT_INPUT_V4.objectBytes)) !== LOCAL_GIT_INPUT_V4.executableSha256 ||
    git(['--version']).toString('utf8') !== LOCAL_GIT_INPUT_V4.version) throw new Error('Unsupported trusted Git executable or root discovery');
  if (realpathSync(trustedRepository) !== trustedRepository || !lstatSync(trustedRepository).isDirectory()) throw new Error('Trusted local Git repository directory required');
  const gitDir = join(trustedRepository, '.git'), objects = join(gitDir, 'objects');
  const guard = (): Buffer => {
    const names = localGitInputDirectoryV4(gitDir, 128);
    if (names.some(name => ['commondir', 'config.worktree', 'shallow'].includes(name)) || existsSync(join(gitDir, 'info', 'grafts'))) throw new Error('Unsupported Git repository layout');
    const stores = localGitInputDirectoryV4(objects, 258), packs = new Set<string>();
    if (stores.includes('pack')) {
      const path = join(objects, 'pack');
      for (const file of localGitInputDirectoryV4(path, 1024)) {
        if (!/^pack-[a-f0-9]{40}(?:[a-f0-9]{24})?\.(?:pack|idx|rev|bitmap|keep)$/.test(file) || !lstatSync(join(path, file)).isFile()) throw new Error('Promisor or redirected Git packs are unsupported');
        if (file.endsWith('.pack')) packs.add(file);
      }
    }
    for (const name of stores) {
      if (!/^[a-f0-9]{2}$/.test(name) && !['info', 'pack'].includes(name)) throw new Error('Unsupported Git object store');
      const path = join(objects, name);
      if (name === 'info') {
        const info = localGitInputDirectoryV4(path, 1);
        if (info.some(file => file !== 'packs')) throw new Error('Alternate or auxiliary Git object stores are unsupported');
        if (info.length) {
          // Normal repack writes this inert catalog. Never use it to select a
          // path/store: each exact entry must already name a validated pack.
          const lines = localGitInputFileV4(join(path, 'packs'), LOCAL_GIT_INPUT_V4.metadataBytes).toString('utf8').split('\n');
          if (lines.pop() !== '') throw new Error('Invalid Git pack catalog framing');
          if (lines.at(-1) === '') lines.pop();
          const listed = new Set<string>(), pattern = new RegExp(`^P (pack-[a-f0-9]{${expectedCommit.length}}\\.pack)$`);
          for (const line of lines) {
            const match = pattern.exec(line);
            if (!match || !packs.has(match[1]) || listed.has(match[1])) throw new Error('Invalid, duplicate or missing Git pack catalog entry');
            listed.add(match[1]);
          }
          if (listed.size !== packs.size) throw new Error('Incomplete Git pack catalog');
        }
      } else if (name !== 'pack' && !lstatSync(path).isDirectory()) throw new Error('Unsupported Git object directory');
    }
    return localGitInputFileV4(join(gitDir, 'config'), LOCAL_GIT_INPUT_V4.metadataBytes);
  };
  const configuration = guard();
  // Parse bounded inert stdin outside the repository; never follow includes.
  const fields = git(['config', '--no-includes', '--file', '-', '--null', '--list'], configuration).toString('utf8').split('\0');
  if (fields.pop() !== '') throw new Error('Invalid Git configuration framing');
  const config = new Map<string, string>();
  for (const field of fields) {
    const at = field.indexOf('\n'), name = field.slice(0, at), value = field.slice(at + 1);
    const allowed = ['core.filemode', 'core.logallrefupdates', 'core.ignorecase', 'core.precomposeunicode'].includes(name) ? /^(true|false)$/.test(value) :
      name === 'core.repositoryformatversion' ? /^(0|1)$/.test(value) : name === 'core.bare' ? value === 'false' :
      name === 'extensions.objectformat' ? value === 'sha256' :
      /^(?:user\.(?:name|email)|remote\.[A-Za-z0-9_./-]+\.(?:url|fetch)|branch\.[A-Za-z0-9_./-]+\.(?:remote|merge))$/.test(name) && value.length > 0 && value.length <= 4096 && !/[\0\r\n]/.test(value);
    if (at < 1 || !allowed || config.has(name)) throw new Error('Unsupported Git input configuration');
    config.set(name, value);
  }
  const format = config.get('core.repositoryformatversion') === '0' && !config.has('extensions.objectformat') ? 'sha1' :
    config.get('core.repositoryformatversion') === '1' && config.get('extensions.objectformat') === 'sha256' ? 'sha256' : null;
  if (!format || config.get('core.bare') !== 'false' || expectedCommit.length !== (format === 'sha1' ? 40 : 64)) throw new Error('Unsupported or mixed Git object format');
  const args = ['--git-dir=' + gitDir];
  if (git([...args, 'rev-parse', '--show-object-format=storage']).toString('utf8') !== format + '\n') throw new Error('Git repository format mismatch');
  const object = (id: string, kind: 'commit' | 'tree'): Buffer => {
    const deadline = Date.now() + LOCAL_GIT_INPUT_V4.timeoutMs;
    const remaining = (): number => { const ms = deadline - Date.now(); if (ms <= 0) throw new Error('Git input object timeout'); return ms; };
    if (!guard().equals(configuration)) throw new Error('Git input configuration changed');
    const loose = join(objects, id.slice(0, 2), id.slice(2));
    if (existsSync(loose) && (realpathSync(loose) !== loose || !lstatSync(loose).isFile())) throw new Error('Redirected Git object');
    const input = Buffer.from(id + '\n');
    const metadata = git([...args, 'cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], input, 256, remaining()).toString('utf8');
    const match = new RegExp(`^${id} ${kind} (0|[1-9][0-9]*)\\n$`).exec(metadata);
    if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) > LOCAL_GIT_INPUT_V4.objectBytes) throw new Error('Missing, wrong-kind or oversized Git object');
    const size = Number(match[1]), raw = git([...args, 'cat-file', '--batch'], input, LOCAL_GIT_INPUT_V4.objectBytes + 256, remaining());
    const header = Buffer.from(metadata), bytes = raw.subarray(header.length, header.length + size);
    if (!raw.subarray(0, header.length).equals(header) || raw.length !== header.length + size + 1 || raw.at(-1) !== 10 ||
      localGitHashV4(format).update(`${kind} ${size}\0`).update(bytes).digest('hex') !== id) throw new Error('Git object raw framing or typed hash mismatch');
    remaining();
    return bytes;
  };
  const commit = object(expectedCommit, 'commit'), split = commit.indexOf('\n\n');
  if (split < 0 || commit.subarray(0, split).includes(0)) throw new Error('Invalid Git commit headers');
  const headers = commit.subarray(0, split).toString('utf8').split('\n'), treePattern = new RegExp(`^tree [a-f0-9]{${expectedCommit.length}}$`);
  if (!treePattern.test(headers[0]) || headers.filter(line => /^tree(?:\s|$)/.test(line)).length !== 1) throw new Error('Unique valid input tree header required');
  const inputTree = headers[0].slice(5); object(inputTree, 'tree');
  if (!guard().equals(configuration)) throw new Error('Git input configuration changed');
  return { inputCommit: expectedCommit, inputTree };
}
