import { posix } from 'node:path';
import type { WorkOrder, Run } from './index.ts';

export const CLOUD_EXECUTION_PROTOCOL = 'MYFACTORY_EXECUTION_V2';
export interface RepositorySource { repository: string; commit: string; tree: string }
/** Same canonical entities and states; remote references replace local paths. */
export type CloudWorkOrder = Omit<WorkOrder,'repositoryPath'> & { source: RepositorySource };
export type CloudRun = Omit<Run,'workspacePath'> & { workspaceRef: string };
export interface CloudPrepareRequest {
  protocol: typeof CLOUD_EXECUTION_PROTOCOL;
  requestId: string; workId: string; workGeneration: number;
  repository: string; deadline: string; maxSpendUsd: number;
  source: RepositorySource;
  input: Pick<WorkOrder,'title'|'description'|'kind'|'acceptanceCriteria'|'checkCommands'|'allowedPaths'>;
}
export interface CloudSourceGrant {
  clientId: string;
  source: RepositorySource;
  commands: string[];
  allowedPaths: string[];
  maxDurationMs: number;
  maxSpendUsd: number;
  /** External-alpha only: the requestId is a deterministic version-8 uuid derived from the signed authority. */
  derivedRequestId?: true;
}
const uuid = (value: unknown): value is string => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const derivedUuid = (value: unknown): value is string => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function exact(value: unknown, keys: string[]): asserts value is Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).sort().join(',')!==keys.sort().join(',')) throw Error('INVALID_CLOUD_REQUEST');
}
function texts(value: unknown, max: number): asserts value is string[] {
  if(!Array.isArray(value)||value.length<1||value.length>max||value.some(v=>typeof v!=='string'||!v.trim()||v.length>2000)||new Set(value).size!==value.length)throw Error('INVALID_CLOUD_LIST');
}
export function parseCloudPrepare(value: unknown, grant: CloudSourceGrant, now: number): CloudPrepareRequest {
  exact(value,['protocol','requestId','workId','workGeneration','repository','deadline','maxSpendUsd','source','input']);
  if(value.protocol!==CLOUD_EXECUTION_PROTOCOL||!(uuid(value.requestId)||(grant.derivedRequestId===true&&derivedUuid(value.requestId)))||!uuid(value.workId)||!Number.isSafeInteger(value.workGeneration)||Number(value.workGeneration)<1||Buffer.byteLength(JSON.stringify(value))>32000)throw Error('INVALID_CLOUD_REQUEST');
  const deadline=typeof value.deadline==='string'?Date.parse(value.deadline):NaN;
  if(!Number.isFinite(deadline)||deadline<=now||deadline>now+grant.maxDurationMs||typeof value.maxSpendUsd!=='number'||!Number.isFinite(value.maxSpendUsd)||value.maxSpendUsd<=0||value.maxSpendUsd>grant.maxSpendUsd)throw Error('CLOUD_ENVELOPE_EXCEEDED');
  exact(value.source,['repository','commit','tree']);
  if(typeof value.repository!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(value.repository)||value.source.repository!==value.repository||value.repository!==grant.source.repository||value.source.commit!==grant.source.commit||value.source.tree!==grant.source.tree||!(/^[a-f0-9]{40}$/.test(String(value.source.commit))&&/^[a-f0-9]{40}$/.test(String(value.source.tree))))throw Error('CLOUD_SOURCE_NOT_GRANTED');
  exact(value.input,['title','description','kind','acceptanceCriteria','checkCommands','allowedPaths']);
  for(const key of ['title','description'])if(typeof value.input[key]!=='string'||!String(value.input[key]).trim()||String(value.input[key]).length>8000)throw Error('INVALID_CLOUD_REQUEST');
  if(!['feature','defect','investigation'].includes(String(value.input.kind)))throw Error('INVALID_CLOUD_REQUEST');
  texts(value.input.acceptanceCriteria,20);texts(value.input.checkCommands,20);texts(value.input.allowedPaths,100);
  if(value.input.allowedPaths.some(p=>p.startsWith('/')||p.includes('\\')||p.includes('\0')||p.split('/').some(s=>s==='..'||s==='.git')||posix.normalize(p)!==p))throw Error('INVALID_CLOUD_PATH');
  if(JSON.stringify(value.input.allowedPaths)!==JSON.stringify(grant.allowedPaths)||JSON.stringify(value.input.checkCommands)!==JSON.stringify(grant.commands))throw Error('CLOUD_CAPABILITIES_NOT_GRANTED');
  return structuredClone(value) as unknown as CloudPrepareRequest;
}
