import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { FactoryEvent, Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import type { LocalExecutionSnapshotV4 } from '../../../packages/hosted-routing/src/result.ts';
import { ActionError } from './actions.ts';
import { validateLocalV4RootTextTree } from './local-v4-text-tree.ts';

export type CheckpointPhase = {
  kind: 'CAPTURE'; productiveStep: 1 | 2; agentResultEventId: number; settlementEventId: number;
} | {
  kind: 'RECHECK'; productiveStep: 1 | 2; agentResultEventId: number; settlementEventId: number;
  checkpointEventId: number; expectedTree: string;
};
export type CheckpointBasis = Readonly<{
  run: Run; work: WorkOrder; execution: LocalExecutionSnapshotV4; phase: CheckpointPhase; binding: string;
}>;
export type CheckpointResult = Readonly<{ tree: string; changedPaths: string[] }>;
class CheckpointError extends ActionError {
  readonly kind: 'unsupported' | 'uncertain';
  constructor(kind: 'unsupported' | 'uncertain') {
    super('Local implementation checkpoint is unavailable; investigation is required', 'local_checkpoint_hold', 503);
    this.kind = kind;
  }
}
export const checkpointPolicyKind = (error: unknown) => error instanceof CheckpointError ? error.kind : null;
export function checkpointPolicyFailure(error: unknown): ActionError {
  return error instanceof CheckpointError ? error : new CheckpointError('uncertain');
}
export function checkpointUncertain(): never { throw new CheckpointError('uncertain'); }
export function checkpointFormatRefused(): never { throw new CheckpointError('unsupported'); }
const rowId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const treeId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A durable host control-flow join, never a worker-absence or execution grant. */
export function checkpointIdentity(run: Run, execution: LocalExecutionSnapshotV4) {
  return { sourceDigest: execution.sourceDigest, configurationDigest: execution.configurationDigest,
    inputCommit: run.inputCommit, inputTree: execution.inputTree, workspacePath: run.workspacePath,
    attemptNumber: run.attemptNumber };
}
export function selectCheckpointPhase(events: FactoryEvent[], phase: CheckpointPhase, commands: string[],
  identity: ReturnType<typeof checkpointIdentity>) {
  const hold = checkpointUncertain;
  if (!phase || typeof phase !== 'object' || Array.isArray(phase)) hold();
  const fields = ['kind', 'productiveStep', 'agentResultEventId', 'settlementEventId',
    ...(phase.kind === 'RECHECK' ? ['checkpointEventId', 'expectedTree'] : [])].sort();
  if (!['CAPTURE', 'RECHECK'].includes(phase.kind) || !same(Object.keys(phase).sort(), fields) ||
      ![1, 2].includes(phase.productiveStep) || !rowId(phase.agentResultEventId) || !rowId(phase.settlementEventId)) hold();
  if (!events.length || events.some((event, index) => !rowId(event.id) || index > 0 && event.id <= events[index - 1].id)) hold();
  const rows = (type: string) => events.filter(event => event.type === type);
  const implementing = rows('run.implementing'), results = rows('run.agent_result'), settlements = rows('run.implementation_settled');
  const checkpoints = rows('run.implementation_checkpoint'), repairs = rows('run.productive_repair_admitted');
  if (implementing.length !== 1 || events.some(event => [
    'run.cancel_requested', 'factory.stop_requested', 'run.recovery_hold', 'factory.terminal',
    'run.productive_closed', 'run.completion_started', 'run.completion_result', 'run.candidate_committed',
    'run.agent_failed',
  ].includes(event.type)) || results.length !== phase.productiveStep || settlements.length !== phase.productiveStep ||
      checkpoints.length !== phase.productiveStep - (phase.kind === 'CAPTURE' ? 1 : 0) || repairs.length !== phase.productiveStep - 1) hold();
  const check = (cp: FactoryEvent, step: number, passed?: boolean) => {
    const p = cp.payload;
    if (p.checkpointVersion !== 1 || p.contextVersion !== 1 || p.productiveStep !== step || p.exportStatus !== 'ready' ||
        !treeId(p.tree) || typeof p.passed !== 'boolean' || passed !== undefined && p.passed !== passed ||
        !commands.length || !Array.isArray(p.checks) || p.checks.length !== commands.length ||
        p.checks.some((value: unknown, index: number) => !value || typeof value !== 'object' ||
          (value as Record<string, unknown>).command !== commands[index] ||
          !['passed', 'failed'].includes(String((value as Record<string, unknown>).status))) ||
        p.passed !== p.checks.every(value => value.status === 'passed')) hold();
  };
  for (let step = 1; step <= phase.productiveStep; step++) {
    const result = results[step - 1], settled = settlements[step - 1], cp = checkpoints[step - 1];
    if (result.payload.checkpointVersion !== 1 || result.payload.productiveStep !== step || result.payload.implementationEligible !== true ||
        settled.payload.checkpointVersion !== 1 || settled.payload.productiveStep !== step || settled.payload.agentResultEventId !== result.id ||
        !['EXISTING_NATIVE_GUARD_RETURNED', 'TRUSTED_IN_PROCESS_CALLBACK_RETURNED'].includes(String(settled.payload.provenance)) ||
        Object.entries(identity).some(([key, value]) => settled.payload[key] !== value) ||
        !(implementing[0].id < result.id && result.id < settled.id)) hold();
    if (cp) {
      check(cp, step, step < phase.productiveStep ? false : undefined);
      if (cp.payload.agentResultEventId !== result.id || cp.payload.settlementEventId !== settled.id || cp.id <= settled.id) hold();
    }
    if (step < phase.productiveStep) {
      const repair = repairs[step - 1];
      if (!cp || !(cp.id < repair.id && repair.id < results[step].id) || repair.payload.contextVersion !== 1 ||
          repair.payload.productiveStep !== 2 || repair.payload.checkpointEventId !== cp.id || repair.payload.checkedTree !== cp.payload.tree) hold();
    }
  }
  if (results.at(-1)?.id !== phase.agentResultEventId || settlements.at(-1)?.id !== phase.settlementEventId) hold();
  if (phase.kind === 'RECHECK') {
    const cp = checkpoints.at(-1);
    if (!rowId(phase.checkpointEventId) || !treeId(phase.expectedTree) || cp?.id !== phase.checkpointEventId || cp.payload.tree !== phase.expectedTree) hold();
  }
  return [...implementing, ...results, ...settlements, ...checkpoints, ...repairs].sort((a, b) => a.id - b.id);
}

type PlannedObject = Readonly<{ kind: 'blob' | 'tree'; id: string; bytes: Buffer }>;
const objectId = (kind: 'blob' | 'tree', bytes: Buffer) => createHash('sha1')
  .update(kind + ' ' + bytes.length + '\0').update(bytes).digest('hex');
/** Detached complete data graph. B1 remains the independent canonical validator. */
export async function planCheckpoint(files: Readonly<Record<string, string>>, deadline: number) {
  const budget = () => { if (!Number.isFinite(deadline) || performance.now() >= deadline) checkpointUncertain(); };
  budget(); const paths = Object.keys(files), objects = new Map<string, PlannedObject>();
  if (!paths.length || paths.length > 200 || Buffer.byteLength(JSON.stringify(files)) > 500000) checkpointFormatRefused();
  for (const path of paths) {
    budget(); const value = files[path];
    if (path.length > 240 || path.split('/').length > 16 || path === '__proto__' ||
        path.split('/').some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || ['.', '..', '.git'].includes(part.toLowerCase())) ||
        typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value) > 100000 || Buffer.from(value).toString('utf8') !== value) checkpointFormatRefused();
  }
  const add = (kind: 'blob' | 'tree', bytes: Buffer) => {
    budget(); if (bytes.length > (kind === 'blob' ? 100000 : 65536)) checkpointFormatRefused();
    const id = objectId(kind, bytes); objects.set(id, Object.freeze({ kind, id, bytes: Buffer.from(bytes) })); return id;
  };
  const tree = (prefix: string): string => {
    budget(); const children = new Map<string, boolean>();
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length), slash = rest.indexOf('/'), name = slash < 0 ? rest : rest.slice(0, slash), directory = slash >= 0;
      if (children.has(name) && children.get(name) !== directory) checkpointFormatRefused(); children.set(name, directory);
    }
    const entries = [...children].map(([name, directory]) => ({ name, directory })).sort((a, b) =>
      Buffer.compare(Buffer.from(a.name + (a.directory ? '/' : '')), Buffer.from(b.name + (b.directory ? '/' : ''))));
    const raw = entries.flatMap(entry => {
      const id = entry.directory ? tree(prefix + entry.name + '/') : add('blob', Buffer.from(files[prefix + entry.name]));
      return [Buffer.from((entry.directory ? '40000' : '100644') + ' ' + entry.name + '\0'), Buffer.from(id, 'hex')];
    });
    return add('tree', Buffer.concat(raw));
  };
  const root = tree('');
  try {
    const validated = await validateLocalV4RootTextTree(root, async (kind, id, limit) => {
      const object = objects.get(id);
      if (!object || object.kind !== kind || object.bytes.length > limit) checkpointFormatRefused(); return Buffer.from(object.bytes);
    }, deadline);
    if (!same(Object.entries(validated.files).sort(), Object.entries(files).sort())) checkpointFormatRefused();
  } catch (error) { budget(); if (checkpointPolicyKind(error)) throw error; checkpointFormatRefused(); }
  budget(); return { tree: root, objects: [...objects.values()] };
}
