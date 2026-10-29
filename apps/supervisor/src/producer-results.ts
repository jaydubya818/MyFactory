import { isModelReference } from '../../../packages/contracts/src/model-reference.ts';
import { createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FactoryStorage } from '../../../packages/storage/src/index.ts';
import type { Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import { DEFAULT_VERIFICATION_IMAGE } from '../../../packages/verification/src/index.ts';
import { LocalV4CandidatePolicy, candidatePolicyFailure } from './local-v4-candidate-policy.ts';
import { performance } from 'node:perf_hooks';
import { contextPolicyFailure, selectContextPhase, type ContextBasis, type ContextPhase } from './local-v4-context-policy.ts';
import { checkpointPolicyFailure, checkpointIdentity, selectCheckpointPhase, type CheckpointBasis, type CheckpointPhase } from './local-v4-checkpoint-policy.ts';
import { finalizationPolicyFailure, selectFinalizationPhase, type FinalizationBasis, type FinalizationPhase } from './local-v4-finalization-policy.ts';
import { verificationInputFailure, verificationInputHold, selectVerificationInputPhase,
  type VerificationInputBasis, type VerificationInputPhase } from './local-v4-verification-input-policy.ts';
import {
  canonical, digest, sha256, operationId, signResult, verifyResult, RESULT_PROTOCOL, MAX_ARTIFACT_BYTES,
  signLocalResultV4, verifyLocalResultV4, validateLocalResultManifestV4,
  type LocalExecutionSnapshotV4, type LocalResultManifestV4, type LocalResultV4Expected,
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
/** A read-only code identity fence; it grants no execution or verification. */
export function readCurrentProducerSourceIdentity(): string {
  if (sourceIdentity() !== loadedSource) throw new Error('Producer source changed; restart required');
  return loadedSource;
}
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

function producerArtifacts(dataDir: string,run: Run,checks: ReturnType<FactoryStorage['listChecks']>,
  candidateEvent: ReturnType<FactoryStorage['listEvents']>[number] | null,factoryId: string,localGit?: (args:string[])=>Buffer) {
  const manifest: Pick<ResultManifest,'candidate'|'evidence'|'artifacts'|'evidenceDigest'|'artifactDigest'>={
    candidate:null,evidence:[],artifacts:[],evidenceDigest:'',artifactDigest:''};
  const artifacts: SignedResult['artifacts']=[];
  let total=0;
  const add=(id: string,kind: ResultManifest['artifacts'][number]['kind'],bytes: Buffer,createdAt: string) => {
    total+=bytes.length;
    if (bytes.length > MAX_ARTIFACT_BYTES || total > 8*1024*1024) throw new Error('Artifact export size limit');
    manifest.artifacts.push({id,kind,producer:factoryId,runId:run.id,candidateCommit:run.candidateCommit!,sha256:sha256(bytes),size:bytes.length,createdAt});
    artifacts.push({id,base64:bytes.toString('base64')});
  };
  if (run.candidateCommit) {
    const p=candidateEvent?.payload;
    if (!p || p.candidateCommit !== run.candidateCommit || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(run.candidateCommit) || typeof p.candidateTree !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(p.candidateTree)) throw new Error('Candidate provenance missing');
    const readArtifact=(path: unknown): Buffer => {
      if (typeof path !== 'string') throw new Error('Artifact path missing');
      const base=realpathSync(join(dataDir,'artifacts',run.id)), actual=realpathSync(path);
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
    const object=(type: string,id: string) => localGit?localGit(['cat-file',type,id]):execFileSync('git',['-C',run.workspacePath,'cat-file',type,id],{maxBuffer:MAX_ARTIFACT_BYTES,timeout:10_000});
    const commit=object('commit',run.candidateCommit), tree=object('tree',p.candidateTree);
    const patchArgs=['show','--format=','--binary','--no-ext-diff','--no-textconv',run.candidateCommit];
    const actualPatch=localGit?localGit(patchArgs):execFileSync('git',['-C',run.workspacePath,...patchArgs],{maxBuffer:MAX_ARTIFACT_BYTES,timeout:10_000});
    if (!actualPatch.equals(patch)) throw new Error('Patch does not match candidate');
    add('candidate.commit','git-commit',commit,candidateEvent!.createdAt);
    add('candidate.tree','git-tree',tree,candidateEvent!.createdAt);
    add('candidate.patch','patch',patch,candidateEvent!.createdAt);
    manifest.candidate={commit:run.candidateCommit,tree:p.candidateTree,base:run.inputCommit,patchDigest:sha256(patch),commitArtifactId:'candidate.commit',treeArtifactId:'candidate.tree',patchArtifactId:'candidate.patch'};
    for (const c of checks) {
      if (c.runId !== run.id || c.candidateCommit !== run.candidateCommit || !c.logSha256) throw new Error('Check binding missing');
      const bytes=readArtifact(c.logPath); if (sha256(bytes) !== c.logSha256) throw new Error('Check log changed');
      const id=`check:${c.id}`; add(id,'check-log',bytes,c.finishedAt);
      manifest.evidence.push({id:c.id,producer:factoryId,runId:run.id,candidateCommit:c.candidateCommit,command:c.command,status:c.status,exitCode:c.exitCode,startedAt:c.startedAt,finishedAt:c.finishedAt,logArtifactId:id});
    }
  } else if (candidateEvent || checks.length) throw new Error('Orphaned candidate evidence');
  manifest.evidenceDigest=digest(manifest.evidence); manifest.artifactDigest=digest(manifest.artifacts);
  return {...manifest,bytes:artifacts};
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
  snapshot(run: Run): ExecutionSnapshot | null {
    const saved=readRunRecord<ExecutionSnapshot | LocalExecutionSnapshotV4>(this.storage,run,SNAPSHOT_EVENT);
    if (saved?.version===4) throw new Error('Local V4 snapshot requires the explicit V4 producer API');
    return saved;
  }
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
    this.snapshot(current);
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
    const stateDigest=digest({run,checks,candidates,execution});
    const manifest: ResultManifest={protocol:RESULT_PROTOCOL,keyId:this.options.currentKeyId,producer:execution.factoryId,operationId:operationId(execution),execution,
      status:status as ResultManifest['status'],candidate:null,evidence:[],artifacts:[],evidenceDigest:'',artifactDigest:'',completedAt:run.finishedAt,issuedAt:new Date().toISOString()};
    const {bytes:artifacts,...content}=producerArtifacts(this.dataDir,run,checks,candidateEvent,execution.factoryId);
    Object.assign(manifest,content);
    const result=signResult(manifest,artifacts,this.options.privateKey);
    verifyResult(result,{keys:this.options.keys,factoryId:execution.factoryId,requestId:execution.requestId,workOrderId:run.workOrderId,runId:run.id,factoryVersion:execution.factoryVersion});
    return this.storage.transaction(() => {
      const observed={run:this.storage.getRun(run.id),checks:this.storage.listChecks(run.id),candidates:this.storage.listEvents(run.workOrderId).filter(e => e.runId === run.id && e.type === 'run.candidate_committed'),execution:this.snapshot(run)};
      if (digest(observed) !== stateDigest) throw new Error('Attempt changed during result freeze');
      return saveRunRecord(this.storage,run,RESULT_EVENT,result);
    });
  }
}

/** Explicit direct local producer. This class is not accepted by legacy server,
 * dispatch or evidence APIs. Its caller must retain the original admitted Work
 * and trusted expected identity; returned result fields are never expectations. */
export interface LocalProducerAdmissionV4 { work: WorkOrder; expected: LocalResultV4Expected }
export const LOCAL_V4_ADMISSION_EVENT = 'run.local_v4_admission';
const LOCAL_V4_ADMISSION_SCHEMA = 'myfactory.local-producer-admission/v4';

/** Bounded plain data only. Inspect descriptors before reading values so a
 * malformed host input cannot run an accessor during admission capture. */
function localAdmissionJson<T>(value:T):T {
  let nodes=0,bytes=0;const active=new Set<object>();
  const denied=()=>{throw new Error('Bounded canonical local V4 admission required');};
  const visit=(item:unknown,depth:number):void=>{
    if(++nodes>8192||depth>16)denied();
    bytes+=8;if(bytes>256*1024)denied();
    if(typeof item==='string'){if(item.length>65536)denied();bytes+=Buffer.byteLength(item);if(bytes>256*1024)denied();return;}
    if(item===null||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return;
    if(!item||typeof item!=='object'||active.has(item))return denied();
    const array=Array.isArray(item);
    if(!array&&Object.getPrototypeOf(item)!==Object.prototype)return denied();
    if(array&&Number(Object.getOwnPropertyDescriptor(item,'length')?.value)>8192)return denied();
    const descriptors=Object.getOwnPropertyDescriptors(item),keys=Reflect.ownKeys(descriptors);
    active.add(item);
    if(array){
      const length=descriptors.length?.value;
      if(!Number.isSafeInteger(length)||length>8192||keys.length!==length+1)return denied();
      for(let i=0;i<length;i++){
        const d=descriptors[String(i)];if(!d||!d.enumerable||!Object.hasOwn(d,'value'))return denied();visit(d.value,depth+1);
      }
    }else for(const key of keys){
      if(typeof key!=='string')return denied();
      const d=descriptors[key];if(!d.enumerable||!Object.hasOwn(d,'value'))return denied();
      bytes+=Buffer.byteLength(key);if(bytes>256*1024)return denied();visit(d.value,depth+1);
    }
    active.delete(item);
  };
  visit(value,0);const encoded=canonical(value);
  if(Buffer.byteLength(encoded)>256*1024)throw new Error('Bounded canonical local V4 admission required');
  return JSON.parse(encoded) as T;
}
function localAdmissionFields(value:unknown,required:string[],optional:string[]=[]):asserts value is Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.hasOwn(value,key))||
    Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))throw new Error('Exact local V4 admission fields required');
}
function localAdmissionWork(value:unknown):asserts value is WorkOrder {
  localAdmissionFields(value,['id','title','description','kind','repositoryPath','baseRef','acceptanceCriteria','reproductionCommand','expectedFailureText','checkCommands','allowedPaths','workerProfile','state','createdAt','updatedAt'],['idempotencyKey','syncToLinear']);
  const strings=['id','title','description','repositoryPath','baseRef','createdAt','updatedAt'];
  if(strings.some(key=>typeof value[key]!=='string')||
    ['reproductionCommand','expectedFailureText'].some(key=>value[key]!==null&&typeof value[key]!=='string')||
    ['acceptanceCriteria','checkCommands','allowedPaths'].some(key=>!Array.isArray(value[key])||(value[key] as unknown[]).some(item=>typeof item!=='string'))||
    !['defect','feature','investigation'].includes(String(value.kind))||!['container','mac','browser'].includes(String(value.workerProfile))||
    !['needs_investigation','awaiting_clarification','queued','planning','implementing','verifying','ready_for_review','awaiting_approval','awaiting_human_login','awaiting_environment','failed','interrupted','cancelled'].includes(String(value.state))||
    Object.hasOwn(value,'idempotencyKey')&&typeof value.idempotencyKey!=='string'||Object.hasOwn(value,'syncToLinear')&&typeof value.syncToLinear!=='boolean')
    throw new Error('Exact original local V4 Work required');
}
export class LocalProducerResultsV4 {
  private readonly storage: FactoryStorage;
  private readonly dataDir: string;
  private readonly options: Omit<ProducerOptions,'sessionMetadata'>;
  #candidatePolicy: LocalV4CandidatePolicy;
  #candidateQueue: Promise<void> = Promise.resolve();
  constructor(storage: FactoryStorage,dataDir: string,options: Omit<ProducerOptions,'sessionMetadata'>) {
    if (Object.keys(options).sort().join(',')!=='currentKeyId,factoryId,keys,privateKey') throw new Error('Invalid explicit V4 signing options');
    new ProducerResults(storage,dataDir,options); // Reuse the exact configured-key validation only.
    this.storage=storage;this.dataDir=dataDir;this.options=structuredClone(options);
    this.#candidatePolicy = new LocalV4CandidatePolicy(dataDir);
  }
  private admissionRun(run:Run):Run {
    const supplied=localAdmissionJson(run),current=this.storage.getRun(supplied.id);
    const fields=['id','workOrderId','attemptNumber','inputCommit','workspacePath','workerProfile','startedAt'] as const;
    if(!current||fields.some(key=>current[key]!==supplied[key]))throw new Error('Exact immutable local V4 admission Run required');
    return current;
  }
  private admissionEvents(run:Run) {
    const events=this.storage.listEvents(run.workOrderId).filter(event=>event.runId===run.id);
    const selected=(type:string)=>{
      const rows=events.filter(event=>event.type===type);
      if(rows.length>1)throw new Error('Ambiguous immutable local V4 admission record');
      return rows[0];
    };
    return {admission:selected(LOCAL_V4_ADMISSION_EVENT),snapshot:selected(SNAPSHOT_EVENT),result:selected(RESULT_EVENT)};
  }
  private retainedAdmission(run:Run) {
    const current=this.admissionRun(run);
    const records=this.admissionEvents(current);
    if(!records.admission||!records.snapshot)throw new Error('Complete original local V4 admission pair required; cannot backfill');
    const saved:unknown=localAdmissionJson(records.admission.payload);
    localAdmissionFields(saved,['schema','work','expected']);
    if(saved.schema!==LOCAL_V4_ADMISSION_SCHEMA)throw new Error('Explicit original local V4 admission required');
    localAdmissionWork(saved.work);
    localAdmissionFields(saved.expected,['factoryId','factoryVersion','sourceDigest','configurationDigest','configuration','requestId','requestDigest','workOrderId','runId','attemptNumber','inputCommit','inputTree']);
    const admission:LocalProducerAdmissionV4={work:saved.work,expected:saved.expected as unknown as LocalResultV4Expected};
    const execution=this.snapshot(current,admission);
    if(!execution||saved.work.workerProfile!==current.workerProfile)throw new Error('Original local V4 admission binding changed');
    return {run:current,admission,execution};
  }
  /** New provenance capture only. Does not dispatch or grant Work authority. */
  captureAdmitted(work:WorkOrder,run:Run,model:string,executorVersion:string):LocalExecutionSnapshotV4 {
    const original=localAdmissionJson(work),supplied=localAdmissionJson(run);
    localAdmissionWork(original);
    return this.storage.transaction(()=>{
      const currentKey=()=>{
        const key=this.options.keys.find(value=>value.factoryId===this.options.factoryId&&value.keyId===this.options.currentKeyId)!,now=Date.now();
        if(key.revokedAt||key.retiredAt||!(Date.parse(key.activeFrom)<=now&&now<=Date.parse(key.notAfter)))
          throw new Error('Current producer signing key is unavailable for admission');
      };
      currentKey();
      const current=this.admissionRun(supplied);
      const records=this.admissionEvents(current);
      if(records.result)
        throw new Error('Completed local V4 capture cannot be repeated; use retained read');
      if(Boolean(records.admission)!==Boolean(records.snapshot))throw new Error('Complete original local V4 admission pair required; cannot backfill');
      if(records.admission){
        const saved=this.retainedAdmission(supplied);this.assertSource();
        if(canonical(original)!==canonical(saved.admission.work)||saved.execution.sourceDigest!==loadedSource||
          saved.execution.configuration.model!==model||saved.execution.configuration.executorVersion!==executorVersion)
          throw new Error('Conflicting original local V4 admission replay');
        currentKey();
        return saved.execution;
      }
      const execution=this.capture(original,supplied,model,executorVersion);
      const {version,workspace,capturedAt,...expected}=execution;
      const payload=localAdmissionJson({schema:LOCAL_V4_ADMISSION_SCHEMA,work:original,expected});
      // Only this method constructs the admission record. The shared generic
      // immutable writer still accepts only its original snapshot/result types.
      this.storage.appendEvent({workOrderId:current.workOrderId,runId:current.id,type:LOCAL_V4_ADMISSION_EVENT,payload});
      const joined=this.retainedAdmission(supplied);
      if(canonical(joined.execution)!==canonical(execution))throw new Error('Original local V4 capture changed');
      const result=localAdmissionJson(execution);
      currentKey();
      return result;
    });
  }
  admission(run:Run):LocalProducerAdmissionV4 {
    const supplied=localAdmissionJson(run);
    return this.storage.transaction(()=>this.retainedAdmission(supplied).admission);
  }
  /** Current implementation-visible basis only; original admission and host
   * events select immutable data, never a model-supplied root or phase grant. */
  contextBasis(run: Run, phaseValue: ContextPhase): ContextBasis {
    try {
      const phase = localAdmissionJson(phaseValue), current = this.admissionRun(run);
      const { admission, execution } = this.retainedAdmission(current);
      const work = this.storage.getWorkOrder(current.workOrderId);
      if (!work || current.state !== 'implementing' || current.finishedAt || current.candidateCommit ||
          work.state !== 'implementing' || execution.sourceDigest !== readCurrentProducerSourceIdentity()) throw contextPolicyFailure(null);
      const events = this.storage.listEvents(current.workOrderId).filter(event => event.runId === current.id);
      if (events.some(event => event.workOrderId !== current.workOrderId)) throw contextPolicyFailure(null);
      const selected = selectContextPhase(events, phase, execution.configuration.commands);
      if (canonical(this.snapshot(current, admission)) !== canonical(execution)) throw contextPolicyFailure(null);
      return localAdmissionJson({ run: current, work, execution, phase,
        tree: selected.tree ?? execution.inputTree, checkpointEventId: selected.checkpointEventId,
        productiveStep: selected.productiveStep,
        binding: digest({ current, work, admission, execution, phase, selected }) });
    } catch (error) { throw contextPolicyFailure(error); }
  }
  /** Read-only host phase join; settlement records confer no native authority. */
  checkpointBasis(run: Run, phaseValue: CheckpointPhase): CheckpointBasis {
    try {
      const phase = localAdmissionJson(phaseValue), current = this.admissionRun(run);
      const { admission, execution } = this.retainedAdmission(current), work = this.storage.getWorkOrder(current.workOrderId);
      if (!work || current.state !== 'implementing' || current.finishedAt || current.candidateCommit ||
          work.state !== 'implementing' || execution.sourceDigest !== readCurrentProducerSourceIdentity()) throw checkpointPolicyFailure(null);
      const events = this.storage.listEvents(current.workOrderId).filter(event => event.runId === current.id);
      if (events.some(event => event.workOrderId !== current.workOrderId)) throw checkpointPolicyFailure(null);
      const selected = selectCheckpointPhase(events, phase, execution.configuration.commands, checkpointIdentity(current, execution));
      if (canonical(this.snapshot(current, admission)) !== canonical(execution)) throw checkpointPolicyFailure(null);
      return localAdmissionJson({ run: current, work, execution, phase,
        binding: digest({ current, work, admission, execution, phase, selected }) });
    } catch (error) { throw checkpointPolicyFailure(error); }
  }
  /** Actual full current history, not a projected event stream, binds this read. */
  candidateBasis(run: Run, phaseValue: FinalizationPhase): FinalizationBasis {
    try {
      const phase = localAdmissionJson(phaseValue), current = this.admissionRun(run);
      const { admission, execution } = this.retainedAdmission(current), work = this.storage.getWorkOrder(current.workOrderId);
      if (!work || current.state !== 'implementing' || current.finishedAt || current.candidateCommit ||
          work.state !== 'implementing' || execution.sourceDigest !== readCurrentProducerSourceIdentity()) throw finalizationPolicyFailure(null);
      const events = this.storage.listEvents(current.workOrderId).filter(event => event.runId === current.id);
      const selected = selectFinalizationPhase(events, phase, current, execution);
      if (canonical(this.snapshot(current, admission)) !== canonical(execution)) throw finalizationPolicyFailure(null);
      return localAdmissionJson({ run: current, work, execution, phase, settledAt: selected.settledAt,
        binding: digest({ current, work, admission, execution, phase, events, selected }) });
    } catch (error) { throw finalizationPolicyFailure(error); }
  }
  verificationBasis(run:Run,phaseValue:VerificationInputPhase):VerificationInputBasis {
    try {
      const phase=localAdmissionJson(phaseValue),current=this.admissionRun(run);
      const {admission,execution}=this.retainedAdmission(current),work=this.storage.getWorkOrder(current.workOrderId);
      if(!work||current.finishedAt||!['planning','implementing','verifying'].includes(current.state)||
        current.state!=='verifying'&&current.candidateCommit||
        work.state!==current.state||execution.sourceDigest!==readCurrentProducerSourceIdentity()||
        canonical(this.snapshot(current,admission))!==canonical(execution))verificationInputHold();
      const allEvents=this.storage.listEvents(current.workOrderId),events=allEvents.filter(event=>event.runId===current.id);
      const checks=this.storage.listChecks(current.id);
      if(phase.kind!=='ENTRY'&&checks.length)verificationInputHold();
      const selected=selectVerificationInputPhase(events,phase,current,work,execution);
      return localAdmissionJson({run:current,work,execution,phase,selectedTree:selected.tree,selectedCommit:selected.commit,
        binding:digest({current,work,admission,execution,phase,events:allEvents,checks})});
    } catch(error){throw verificationInputFailure(error);}
  }
  readAdmitted(run:Run):ReturnType<LocalProducerResultsV4['read']> {
    const current=this.admissionRun(run);return this.read(current,this.admission(current));
  }
  finalizeAdmitted(run:Run):ReturnType<LocalProducerResultsV4['finalize']> {
    const current=this.admissionRun(run);return this.finalize(current,this.admission(current));
  }
  private assertSource(): void { if (sourceIdentity()!==loadedSource) throw new Error('Producer source changed; restart before attesting'); }
  private requestId(work: WorkOrder): string {
    const events=this.storage.listEvents(work.id),intake=events.filter(e=>e.type==='hosted.intake_received');
    if (intake.length>1) throw new Error('Ambiguous initiating request');
    const created=events.filter(e=>e.type==='workorder.created');
    if (created.length>1) throw new Error('Ambiguous initiating Work');
    const request=intake[0]?.payload.issueId??created[0]?.payload.requestId??`local-workorder:${work.id}`;
    if (typeof request!=='string'||!request) throw new Error('Request identity missing');
    return request;
  }
  capture(work: WorkOrder,run: Run,model: string,executorVersion: string): LocalExecutionSnapshotV4 {
    this.assertSource();
    const admittedWork=this.storage.getWorkOrder(work.id),admittedRun=this.storage.getRun(run.id);
    if (!admittedWork||!admittedRun||canonical(admittedWork)!==canonical(work)||canonical(admittedRun)!==canonical(run)
      ||run.workOrderId!==work.id||run.workerProfile!==work.workerProfile||run.finishedAt||run.candidateCommit
      ||run.state!=='planning') throw new Error('Exact stored Work and admission Run required');
    const key=this.options.keys.find(k=>k.factoryId===this.options.factoryId&&k.keyId===this.options.currentKeyId)!,now=Date.now();
    if (key.revokedAt||key.retiredAt||!(Date.parse(key.activeFrom)<=now&&now<=Date.parse(key.notAfter))) throw new Error('Current producer signing key is unavailable for admission');
    if (!executorVersion||!isModelReference(model)||(run.workerProfile!=='mac'&&run.workerProfile!=='container')) throw new Error('Execution configuration unavailable');
    const requestId=this.requestId(admittedWork),eventsBefore=digest(this.storage.listEvents(work.id));
    const input=readLocalGitInputTreeV4(admittedWork.repositoryPath,admittedRun.inputCommit);
    const configuration={model,executor:'codex-cli' as const,executorVersion,skillRevision:'fd8f20a879b507cf09feba08663a1edf7a949353',
      workerProfile:run.workerProfile,verificationImage:DEFAULT_VERIFICATION_IMAGE,nodeVersion:process.version,platform:process.platform,architecture:process.arch,
      commands:work.kind==='defect'&&work.reproductionCommand?[...new Set([work.reproductionCommand,...work.checkCommands])]:[...work.checkCommands],
      allowedPaths:[...work.allowedPaths],timeoutMs:30*60*1000};
    const configurationDigest=digest(configuration),snapshot:LocalExecutionSnapshotV4={version:4,...input,
      workspace:{kind:'GIT_WORKTREE',path:run.workspacePath,branch:null},factoryId:this.options.factoryId,
      factoryVersion:digest({sourceDigest:loadedSource,configurationDigest}),sourceDigest:loadedSource,configurationDigest,configuration,
      requestId,requestDigest:digest({requestId,work:admittedWork}),workOrderId:work.id,runId:run.id,attemptNumber:run.attemptNumber,capturedAt:run.startedAt};
    this.validateSnapshot(snapshot);
    return this.storage.transaction(()=>{
      if (canonical(this.storage.getWorkOrder(work.id))!==canonical(admittedWork)||canonical(this.storage.getRun(run.id))!==canonical(admittedRun)
        ||digest(this.storage.listEvents(work.id))!==eventsBefore||this.requestId(admittedWork)!==requestId) throw new Error('Admission changed during V4 capture');
      this.assertSource();
      const persistedAt=Date.now();
      if (!(Date.parse(key.activeFrom)<=persistedAt&&persistedAt<=Date.parse(key.notAfter))) throw new Error('Signing key expired during V4 capture');
      return saveRunRecord(this.storage,run,SNAPSHOT_EVENT,snapshot);
    });
  }
  private validateSnapshot(execution: LocalExecutionSnapshotV4): void {
    validateLocalResultManifestV4({protocol:RESULT_PROTOCOL,keyId:this.options.currentKeyId,producer:execution.factoryId,
      operationId:digest([RESULT_PROTOCOL,execution.factoryId,execution.requestId,execution.workOrderId,execution.runId]),execution,
      status:'FAILED',candidate:null,evidence:[],artifacts:[],evidenceDigest:digest([]),artifactDigest:digest([]),completedAt:execution.capturedAt,issuedAt:execution.capturedAt});
  }
  snapshot(run: Run,admission: LocalProducerAdmissionV4): LocalExecutionSnapshotV4 | null {
    const current=this.storage.getRun(run.id),work=this.storage.getWorkOrder(run.workOrderId),original=admission.work;
    const stable=(w:WorkOrder)=>{const {state,updatedAt,...input}=w;return input;};
    if (!current||!work||work.id!==original.id||current.workOrderId!==work.id||run.workOrderId!==work.id
      ||canonical(stable(work))!==canonical(stable(original))) throw new Error('V4 Work binding changed');
    const saved=readRunRecord<LocalExecutionSnapshotV4>(this.storage,current,SNAPSHOT_EVENT);
    if (!saved) return null;
    this.validateSnapshot(saved);
    const {version,workspace,capturedAt,...expected}=saved;
    if (canonical(expected)!==canonical(admission.expected)||saved.factoryId!==this.options.factoryId||saved.workOrderId!==work.id
      ||saved.runId!==current.id||saved.attemptNumber!==current.attemptNumber||saved.inputCommit!==current.inputCommit
      ||saved.capturedAt!==current.startedAt||saved.workspace.path!==current.workspacePath
      ||saved.configuration.workerProfile!==current.workerProfile||saved.requestId!==this.requestId(original)
      ||saved.requestDigest!==digest({requestId:saved.requestId,work:original})) throw new Error('V4 admission binding changed');
    return saved;
  }
  private savedResult(run: Run,admission: LocalProducerAdmissionV4): SignedResult | null {
    const result=readRunRecord<SignedResult>(this.storage,run,RESULT_EVENT);
    if (!result) return null;
    const execution=this.snapshot(run,admission);
    if (!execution) throw new Error('Signed result has no execution snapshot');
    const {manifest}=verifyLocalResultV4(result,{keys:this.options.keys,expected:admission.expected,historical:true});
    if (canonical(manifest.execution)!==canonical(execution)||manifest.status!==producerState(this.storage,run)
      ||manifest.completedAt!==run.finishedAt||(manifest.candidate?.commit??null)!==run.candidateCommit) throw new Error('Frozen result differs from saved attempt');
    return result;
  }
  private candidateBinding(run: Run, admission: LocalProducerAdmissionV4): string {
    return digest({ run: this.storage.getRun(run.id), work: this.storage.getWorkOrder(run.workOrderId),
      checks: this.storage.listChecks(run.id), events: this.storage.listEvents(run.workOrderId),
      execution: this.snapshot(run, admission), admission });
  }
  private currentKey(): void {
    const key = this.options.keys.find(value => value.factoryId === this.options.factoryId && value.keyId === this.options.currentKeyId);
    const now = Date.now();
    if (!key || key.revokedAt || key.retiredAt || !(Date.parse(key.activeFrom) <= now && now <= Date.parse(key.notAfter)))
      throw new Error('Current producer signing key is unavailable');
  }
  private observeCandidate(run: Run, admission: LocalProducerAdmissionV4, purpose: 'pre-ready' | 'read' | 'freeze', invocation: object, binding: string, deadline?: number) {
    const execution = this.snapshot(run, admission);
    const candidates = this.storage.listEvents(run.workOrderId).filter(event => event.runId === run.id && event.type === 'run.candidate_committed');
    const payload = candidates[0]?.payload;
    if (!execution || candidates.length !== 1 || !run.candidateCommit || payload?.candidateCommit !== run.candidateCommit ||
        typeof payload.candidateTree !== 'string' || typeof payload.diffPath !== 'string' || typeof payload.diffSha256 !== 'string')
      throw candidatePolicyFailure(null);
    return this.#candidatePolicy.observe({ repository: admission.work.repositoryPath, inputCommit: run.inputCommit,
      inputTree: execution.inputTree, candidateCommit: run.candidateCommit, candidateTree: payload.candidateTree,
      runId: run.id, diffPath: payload.diffPath, diffSha256: payload.diffSha256 }, purpose, binding, invocation, deadline);
  }
  /** Native work happens before the caller's synchronous ready transaction. The
   * returned one-use closure rechecks exact state/source/key inside that write. */
  async beforeReady(run: Run): Promise<() => void> {
    try {
      const admission = this.admission(run), current = this.storage.getRun(run.id);
      if (!current || canonical(current) !== canonical(run) || current.state !== 'verifying') throw candidatePolicyFailure(null);
      const execution = this.snapshot(current, admission);
      this.assertSource(); this.currentKey();
      if (execution?.sourceDigest !== loadedSource) throw candidatePolicyFailure(null);
      const invocation = Object.freeze({}), binding = this.candidateBinding(current, admission);
      const guard = await this.observeCandidate(current, admission, 'pre-ready', invocation, binding);
      return () => {
        try {
          this.assertSource(); this.currentKey();
          this.#candidatePolicy.consume(guard, 'pre-ready', this.candidateBinding(current, admission), invocation, current.id).assertCurrent();
        } catch (error) { throw candidatePolicyFailure(error); }
      };
    } catch (error) { throw candidatePolicyFailure(error); }
  }
  private candidateResult(run: Run, admission: LocalProducerAdmissionV4, purpose: 'read' | 'freeze'): Promise<SignedResult> {
    const deadline = performance.now() + 30000;
    const invocation = Object.freeze({});
    const result = this.#candidateQueue.then(() => this.observedCandidateResult(run, admission, purpose, invocation, deadline));
    this.#candidateQueue = result.then(() => undefined, () => undefined);
    return result;
  }
  private async observedCandidateResult(run: Run, admission: LocalProducerAdmissionV4, purpose: 'read' | 'freeze', invocation: object, deadline: number): Promise<SignedResult> {
    try {
      this.assertSource();
      const binding = this.candidateBinding(run, admission);
      const guard = await this.observeCandidate(run, admission, purpose, invocation, binding, deadline);
      return this.storage.transaction(() => {
        const current = this.storage.getRun(run.id);
        if (!current || canonical(current) !== canonical(run) || this.candidateBinding(current, admission) !== binding) throw candidatePolicyFailure(null);
        this.assertSource();
        const material = this.#candidatePolicy.consume(guard, purpose, binding, invocation, current.id);
        const execution = this.snapshot(current, admission);
        if (!execution) throw candidatePolicyFailure(null);
        const saved = this.savedResult(current, admission), status = producerState(this.storage, current);
        if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) || !current.finishedAt) throw candidatePolicyFailure(null);
        const checks = this.storage.listChecks(current.id);
        const candidates = this.storage.listEvents(current.workOrderId).filter(event => event.runId === current.id && event.type === 'run.candidate_committed');
        if (candidates.length !== 1) throw candidatePolicyFailure(null);
        const { bytes, ...content } = producerArtifacts(this.dataDir, current, checks, candidates[0], execution.factoryId, material.git);
        if (this.candidateBinding(current, admission) !== binding) throw candidatePolicyFailure(null);
        this.assertSource(); material.assertCurrent();
        if (saved) {
          const { manifest } = verifyLocalResultV4(saved, { keys: this.options.keys, expected: admission.expected, historical: true });
          const actual = { candidate: manifest.candidate, evidence: manifest.evidence, artifacts: manifest.artifacts,
            evidenceDigest: manifest.evidenceDigest, artifactDigest: manifest.artifactDigest };
          if (canonical(actual) !== canonical(content) || canonical(saved.artifacts) !== canonical(bytes)) throw candidatePolicyFailure(null);
          return saved;
        }
        if (execution.sourceDigest !== loadedSource) throw candidatePolicyFailure(null);
        this.currentKey();
        const manifest: LocalResultManifestV4 = { protocol: RESULT_PROTOCOL, keyId: this.options.currentKeyId, producer: execution.factoryId,
          operationId: digest([RESULT_PROTOCOL, execution.factoryId, execution.requestId, execution.workOrderId, execution.runId]), execution,
          status: status as LocalResultManifestV4['status'], ...content, completedAt: current.finishedAt, issuedAt: new Date().toISOString() };
        const result = signLocalResultV4(manifest, bytes, this.options.privateKey);
        verifyLocalResultV4(result, { keys: this.options.keys, expected: admission.expected });
        this.currentKey(); this.assertSource(); material.assertCurrent();
        if (this.candidateBinding(current, admission) !== binding) throw candidatePolicyFailure(null);
        return saveRunRecord(this.storage, current, RESULT_EVENT, result);
      });
    } catch (error) { throw candidatePolicyFailure(error); }
  }
  read(run: Run,admission: LocalProducerAdmissionV4): {state:ReturnType<typeof producerState>;result:SignedResult|null} | Promise<{state:ReturnType<typeof producerState>;result:SignedResult|null}> {
    const current=this.storage.getRun(run.id);
    if (!current||current.workOrderId!==run.workOrderId) throw new Error('Unknown attempt');
    if (!this.snapshot(current,admission)) throw new Error('Attempt has no execution snapshot; cannot backfill attestation');
    const state=producerState(this.storage,current);
    if (['UNKNOWN','RUNNING','STOPPING'].includes(state)) return {state,result:null};
    if (current.candidateCommit) return this.candidateResult(current, admission, 'read').then(result => ({ state, result }));
    return {state,result:this.savedResult(current,admission)??this.finalizeMetadata(current,admission)};
  }
  finalize(run: Run,admission: LocalProducerAdmissionV4): SignedResult | Promise<SignedResult> {
    const current = this.storage.getRun(run.id);
    if (!current || canonical(current) !== canonical(run)) throw new Error('Exact terminal Run required');
    if (current.candidateCommit) return this.candidateResult(current, admission, 'freeze');
    return this.finalizeMetadata(current, admission);
  }
  private finalizeMetadata(run: Run,admission: LocalProducerAdmissionV4): SignedResult {
    this.assertSource();
    const current=this.storage.getRun(run.id);
    if (!current||canonical(current)!==canonical(run)) throw new Error('Exact terminal Run required');
    if (current.candidateCommit) throw candidatePolicyFailure(null);
    const execution=this.snapshot(current,admission);
    if (!execution) throw new Error('Attempt has no execution snapshot; cannot backfill attestation');
    const saved=this.savedResult(current,admission);if(saved)return saved;
    if (execution.sourceDigest!==loadedSource) throw new Error('V4 source changed since admission');
    const status=producerState(this.storage,current);
    if (!['COMPLETED','FAILED','CANCELLED'].includes(status)||!current.finishedAt) throw new Error('Attempt outcome unresolved');
    const checks=this.storage.listChecks(current.id),candidates=this.storage.listEvents(current.workOrderId).filter(e=>e.runId===current.id&&e.type==='run.candidate_committed');
    if (candidates.length>1) throw new Error('Ambiguous candidate');
    const candidateEvent=candidates[0]??null,stateDigest=digest({run:current,checks,candidates,execution,work:this.storage.getWorkOrder(current.workOrderId)});
    const repository=admission.work.repositoryPath;
    const {bytes,...content}=producerArtifacts(this.dataDir,current,checks,candidateEvent,execution.factoryId,() => { throw candidatePolicyFailure(null); });
    const input=readLocalGitInputTreeV4(repository,current.inputCommit);
    if (input.inputTree!==execution.inputTree) throw new Error('Input tree changed during V4 freeze');
    const manifest:LocalResultManifestV4={protocol:RESULT_PROTOCOL,keyId:this.options.currentKeyId,producer:execution.factoryId,
      operationId:digest([RESULT_PROTOCOL,execution.factoryId,execution.requestId,execution.workOrderId,execution.runId]),execution,
      status:status as LocalResultManifestV4['status'],...content,completedAt:current.finishedAt,issuedAt:new Date().toISOString()};
    const result=signLocalResultV4(manifest,bytes,this.options.privateKey);
    verifyLocalResultV4(result,{keys:this.options.keys,expected:admission.expected});
    return this.storage.transaction(()=>{
      const observed={run:this.storage.getRun(current.id),checks:this.storage.listChecks(current.id),
        candidates:this.storage.listEvents(current.workOrderId).filter(e=>e.runId===current.id&&e.type==='run.candidate_committed'),
        execution:this.snapshot(current,admission),work:this.storage.getWorkOrder(current.workOrderId)};
      if (digest(observed)!==stateDigest) throw new Error('Attempt changed during result freeze');
      this.assertSource();
      return saveRunRecord(this.storage,current,RESULT_EVENT,result);
    });
  }
}

// Direct local V4 callers select a stable host-owned admitted repository and
// the exact commit. Legacy producers and services do not call this primitive.
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

/** Identity-only read of exact raw commit/tree objects, including packs.
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
