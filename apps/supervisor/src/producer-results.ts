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
export interface ProducerOptions { factoryId: string; currentKeyId: string; privateKey: string; keys: ResultKey[] }

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
    if (!executorVersion || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model)) throw new Error('Execution configuration unavailable');
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
      version:1, factoryId:this.options.factoryId, factoryVersion:digest({sourceDigest:loadedSource,configurationDigest}),
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
