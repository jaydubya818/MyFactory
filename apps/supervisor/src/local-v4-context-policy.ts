import { posix } from 'node:path';
import type { FactoryEvent, Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import type { LocalExecutionSnapshotV4 } from '../../../packages/hosted-routing/src/result.ts';
import { ActionError } from './actions.ts';

export type ContextPhase = { kind: 'INITIAL' } | {
  kind: 'REPAIR'; checkpointEventId: number; productiveStep: 1; tree: string;
} | {
  kind: 'COMPLETION'; checkpointEventId: number; productiveStep: 1 | 2; tree: string;
  productiveClosedEventId: number; completionStartedEventId: number;
} | { kind: 'PROGRESS' };
export type ContextBasis = Readonly<{
  run: Run; work: WorkOrder; execution: LocalExecutionSnapshotV4; phase: ContextPhase;
  tree: string; checkpointEventId: number | null; productiveStep: 1 | 2 | null; binding: string;
}>;
const message = 'Local source context is unavailable; investigation is required';
class ContextError extends ActionError {
  readonly kind: 'unsupported' | 'uncertain';
  constructor(kind: 'unsupported' | 'uncertain') { super(message, 'local_context_hold', 503); this.kind = kind; }
}
export function contextPolicyKind(error: unknown) { return error instanceof ContextError ? error.kind : null; }
export function contextPolicyFailure(error: unknown): ActionError { return error instanceof ContextError ? error : new ContextError('uncertain'); }
export function contextFormatRefused(): never { throw new ContextError('unsupported'); }
function hold(): never { throw new ContextError('uncertain'); }
/** Only the caller's validated retained snapshot selects the profile. Missing
 * strict host composition cannot authorize an ambient legacy fallback. */
export function requireStrictSourceOperations(snapshot: {version: number} | null | undefined,
  operations?: {contextBasis?: unknown; context?: unknown; assertProgress?: unknown; checkpointBasis?: unknown; checkpoint?: unknown;
    candidateBasis?: unknown; commitCandidate?: unknown; verificationBasis?:unknown;
    assertVerificationInputReady?:unknown;prepareVerificationInput?:unknown;closeVerificationInput?:unknown}): boolean {
  const strict = snapshot?.version === 4 || typeof operations?.contextBasis === 'function' ||
    typeof operations?.context === 'function' || typeof operations?.assertProgress === 'function' ||
    typeof operations?.checkpointBasis === 'function' || typeof operations?.checkpoint === 'function' ||
    typeof operations?.candidateBasis === 'function' || typeof operations?.commitCandidate === 'function' ||
    typeof operations?.verificationBasis === 'function'||typeof operations?.assertVerificationInputReady === 'function'||
    typeof operations?.prepareVerificationInput === 'function'||typeof operations?.closeVerificationInput === 'function';
  if (strict) {
    if (snapshot?.version !== 4 || typeof operations?.context !== 'function' || typeof operations?.assertProgress !== 'function' ||
        typeof operations?.checkpoint !== 'function' || typeof operations?.commitCandidate !== 'function'||
        typeof operations?.assertVerificationInputReady!=='function'||typeof operations?.prepareVerificationInput!=='function'||
        typeof operations?.closeVerificationInput!=='function') hold();
    return true;
  }
  if (snapshot && ![1, 2, 3].includes(snapshot.version)) hold();
  return false;
}
const rowId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
const treeId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{40}$/.test(id);
const phaseTypes = ['run.implementation_checkpoint', 'run.productive_repair_admitted', 'run.productive_closed', 'run.completion_started'];

/** Pure current host-event selection; no root supplied by model or HTTP data. */
export function selectContextPhase(events: FactoryEvent[], phase: ContextPhase, commands: string[]) {
  if (!phase || typeof phase !== 'object' || Array.isArray(phase)) hold();
  const fields = phase.kind === 'INITIAL' || phase.kind === 'PROGRESS' ? ['kind'] : phase.kind === 'REPAIR'
    ? ['kind', 'checkpointEventId', 'productiveStep', 'tree'] : phase.kind === 'COMPLETION'
    ? ['kind', 'checkpointEventId', 'productiveStep', 'tree', 'productiveClosedEventId', 'completionStartedEventId'] : [];
  if (!fields.length || JSON.stringify(Object.keys(phase).sort()) !== JSON.stringify(fields.sort())) hold();
  if (!events.length || events.some((event, index) => !rowId(event.id) || index > 0 && event.id <= events[index - 1].id)) hold();
  const rows = (type: string) => events.filter(event => event.type === type);
  if (rows('run.implementing').length !== 1 || events.some(event => [
    'run.cancel_requested', 'factory.stop_requested', 'run.recovery_hold', 'factory.terminal',
    'run.candidate_committed', 'run.completion_result',
  ].includes(event.type))) hold();
  const relevant = events.filter(event => phaseTypes.includes(event.type) || event.type === 'run.implementing');
  const checkpoints = rows('run.implementation_checkpoint'), repairs = rows('run.productive_repair_admitted');
  const closed = rows('run.productive_closed'), started = rows('run.completion_started');
  if (phase.kind === 'INITIAL') {
    if (relevant.length !== 1) hold();
    return { tree: null, checkpointEventId: null, productiveStep: null, relevant };
  }
  const checkpoint = (event: FactoryEvent, step: number, passed: boolean) => {
    const p = event.payload;
    if (event.id <= rows('run.implementing')[0].id || p.contextVersion !== 1 || p.productiveStep !== step || p.exportStatus !== 'ready' || p.passed !== passed ||
        !treeId(p.tree) || !Array.isArray(p.checks) || !p.checks.length || p.checks.length !== commands.length ||
        p.checks.some((value: unknown, index: number) => !value || typeof value !== 'object' ||
          (value as Record<string, unknown>).command !== commands[index] ||
          !['passed', 'failed'].includes(String((value as Record<string, unknown>).status))) ||
        (passed ? p.checks.some(value => value.status !== 'passed') : !p.checks.some(value => value.status === 'failed'))) hold();
  };
  if (phase.kind === 'PROGRESS') {
    if (closed.length || started.length) hold();
    if (checkpoints.length || repairs.length) {
      if (checkpoints.length !== 1 || repairs.length !== 1) hold();
      const cp = checkpoints[0], repair = repairs[0]; checkpoint(cp, 1, false);
      if (repair.id <= cp.id || repair.payload.contextVersion !== 1 || repair.payload.productiveStep !== 2 ||
          repair.payload.checkpointEventId !== cp.id || repair.payload.checkedTree !== cp.payload.tree) hold();
    }
    return { tree: null, checkpointEventId: null, productiveStep: null, relevant };
  }
  if (!rowId(phase.checkpointEventId) || !treeId(phase.tree)) hold();
  const current = checkpoints.find(event => event.id === phase.checkpointEventId);
  if (!current || current.payload.tree !== phase.tree || current.payload.productiveStep !== phase.productiveStep ||
      current.id <= rows('run.implementing')[0].id) hold();
  if (phase.kind === 'REPAIR') {
    if (phase.productiveStep !== 1 || checkpoints.length !== 1 || repairs.length || closed.length || started.length) hold();
    checkpoint(current, 1, false);
  } else {
    if (![1, 2].includes(phase.productiveStep) || checkpoints.length !== phase.productiveStep || checkpoints.at(-1)?.id !== current.id ||
        closed.length !== 1 || started.length !== 1 || !rowId(phase.productiveClosedEventId) || !rowId(phase.completionStartedEventId)) hold();
    checkpoint(current, phase.productiveStep, true);
    if (phase.productiveStep === 1 ? repairs.length !== 0 : repairs.length !== 1) hold();
    if (phase.productiveStep === 2) {
      const prior = checkpoints[0], repair = repairs[0]; checkpoint(prior, 1, false);
      if (!(prior.id < repair.id && repair.id < current.id) || repair.payload.contextVersion !== 1 ||
          repair.payload.productiveStep !== 2 || repair.payload.checkpointEventId !== prior.id || repair.payload.checkedTree !== prior.payload.tree) hold();
    }
    const c = closed[0], s = started[0];
    if (c.id !== phase.productiveClosedEventId || s.id !== phase.completionStartedEventId || !(current.id < c.id && c.id < s.id) ||
        c.payload.contextVersion !== 1 || c.payload.checkpointEventId !== current.id || c.payload.productiveStep !== phase.productiveStep || c.payload.tree !== phase.tree ||
        s.payload.contextVersion !== 1 || s.payload.checkpointEventId !== current.id || s.payload.productiveClosedEventId !== c.id ||
        s.payload.productiveStep !== phase.productiveStep || s.payload.phase !== 'completion') hold();
  }
  return { tree: phase.tree, checkpointEventId: current.id, productiveStep: phase.productiveStep, relevant };
}

function path(path: string): boolean {
  return path.length > 0 && path.length <= 240 && !path.startsWith('/') && /^[A-Za-z0-9_./-]+$/.test(path) &&
    path.split('/').length <= 16 && !path.split('/').some(part => !part || ['.', '..', '.git'].includes(part.toLowerCase()));
}
function allowed(path: string, scopes: string[]) {
  return scopes.some(scope => {
    const normalized = posix.normalize(scope.replaceAll('\\', '/'));
    if (normalized.endsWith('/**')) return path.startsWith(normalized.slice(0, -2));
    return normalized.endsWith('/') ? path.startsWith(normalized) : path === normalized;
  });
}
/** Same live path/scope rule, with explicit finite profile bounds. No file data. */
export function liveProgressPaths(bytes: Buffer, scopes: string[]): string[] {
  const raw = bytes.toString('utf8');
  if (bytes.length > 65536 || !Buffer.from(raw).equals(bytes) || !raw.endsWith('\0')) contextFormatRefused();
  const records = raw.slice(0, -1).split('\0'), paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.length < 4 || record[2] !== ' ' || !/^[ MADRCU?!]{2}$/.test(record.slice(0, 2))) contextFormatRefused();
    paths.push(record.slice(3));
    if (/[RC]/.test(record.slice(0, 2))) { const prior = records[++i]; if (!prior) contextFormatRefused(); paths.push(prior); }
    if (paths.length > 200) contextFormatRefused();
  }
  const unique = [...new Set(paths)];
  if (!unique.length || unique.some(value => !path(value) || !allowed(value, scopes))) contextFormatRefused();
  return unique;
}

/** Complete <=64KiB source data. It is not a Result, proof or execution grant. */
export function sourceContext(basis: ContextBasis, files: Readonly<Record<string, string>>): string {
  if (!treeId(basis.execution.inputCommit) || !treeId(basis.tree)) contextFormatRefused();
  const inventory = Object.keys(files).sort(), selected: Record<string, string | null> = Object.create(null);
  if (!inventory.length || inventory.length > 200) contextFormatRefused();
  const scopes = basis.execution.configuration.allowedPaths;
  for (const name of inventory) {
    const text = files[name];
    if (!path(name) || typeof text !== 'string' || Buffer.byteLength(text) > 100000 || text.includes('\0') ||
        Buffer.from(text).toString('utf8') !== text) contextFormatRefused();
    if (scopes.some(p => p.endsWith('/**') ? name.startsWith(p.slice(0, -2)) : p.endsWith('/') ? name.startsWith(p) : p === name) ||
        /(^|\/)README(?:\.[^/]*)?$|(^|\/)package\.json$|^(test|tests)\//i.test(name)) selected[name] = files[name];
  }
  for (const name of scopes.filter(value => !value.includes('*') && !value.endsWith('/'))) {
    if (!path(name)) contextFormatRefused(); if (!Object.hasOwn(selected, name)) selected[name] = null;
  }
  const checkpoint = basis.checkpointEventId;
  if (checkpoint === null ? basis.productiveStep !== null || basis.tree !== basis.execution.inputTree :
      !rowId(checkpoint) || ![1, 2].includes(basis.productiveStep!)) contextFormatRefused();
  const value = JSON.stringify({ schema: 'LOCAL_V4_SOURCE_CONTEXT_V1', base: basis.execution.inputCommit, tree: basis.tree,
    basis: { kind: checkpoint === null ? 'ADMITTED_INPUT' : 'HOST_IMPLEMENTATION_CHECKPOINT',
      checkpointEventId: checkpoint === null ? null : String(checkpoint), productiveStep: basis.productiveStep }, inventory, files: selected });
  if (Buffer.byteLength(value) > 65536 || value.includes('\\u0000')) contextFormatRefused();
  return value;
}
