import { createHash } from 'node:crypto';
import type { FactoryEvent, Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import type { LocalExecutionSnapshotV4 } from '../../../packages/hosted-routing/src/result.ts';
import { ActionError } from './actions.ts';
import { checkpointIdentity, selectCheckpointPhase } from './local-v4-checkpoint-policy.ts';
import { selectContextPhase } from './local-v4-context-policy.ts';

export type FinalizationPhase = Readonly<{
  kind: 'FINALIZE'; productiveStep: 1 | 2; checkpointEventId: number;
  productiveClosedEventId: number; completionStartedEventId: number;
  completionResultEventId: number; settlementEventId: number; expectedTree: string;
}>;
export type FinalizationBasis = Readonly<{
  run: Run; work: WorkOrder; execution: LocalExecutionSnapshotV4;
  phase: FinalizationPhase; settledAt: string; binding: string;
}>;
/** Denial only. The fixed Jobs closure cannot supply native arguments/results. */
export type FinalizationFence = () => void;
export type FinalizationResult = Readonly<{
  commit: string; tree: string; changedPaths: string[]; diffPath: string; diffSha256: string;
}>;
class FinalizationError extends ActionError {
  readonly kind: 'unsupported' | 'uncertain';
  constructor(kind: 'unsupported' | 'uncertain') {
    super('Local candidate finalization is unavailable; investigation is required', 'local_finalization_hold', 503);
    this.kind = kind;
  }
}
export const finalizationPolicyKind = (error: unknown) => error instanceof FinalizationError ? error.kind : null;
export function finalizationPolicyFailure(error: unknown): ActionError {
  return error instanceof FinalizationError ? error : new FinalizationError('uncertain');
}
export function finalizationUncertain(): never { throw new FinalizationError('uncertain'); }
export function finalizationFormatRefused(): never { throw new FinalizationError('unsupported'); }
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const gitId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const fields = ['kind', 'productiveStep', 'checkpointEventId', 'productiveClosedEventId', 'completionStartedEventId',
  'completionResultEventId', 'settlementEventId', 'expectedTree'].sort();

/** Exact views preserve both existing parsers; the full stream remains bound. */
export function selectFinalizationPhase(events: FactoryEvent[], phase: FinalizationPhase, run: Run, execution: LocalExecutionSnapshotV4) {
  const hold = finalizationUncertain;
  if (!phase || typeof phase !== 'object' || Array.isArray(phase) || phase.kind !== 'FINALIZE' ||
      JSON.stringify(Object.keys(phase).sort()) !== JSON.stringify(fields) || ![1, 2].includes(phase.productiveStep) ||
      !gitId(phase.expectedTree) || fields.filter(key => key.endsWith('EventId')).some(key => !id(phase[key as keyof FinalizationPhase]))) hold();
  if (!events.length || events.some((event, index) => !id(event.id) || index > 0 && event.id <= events[index - 1].id ||
      event.runId !== run.id || event.workOrderId !== run.workOrderId)) hold();
  const rows = (type: string) => events.filter(event => event.type === type);
  const expectedCounts: Record<string, number> = {
    'run.implementing': 1, 'run.agent_result': phase.productiveStep, 'run.implementation_settled': phase.productiveStep,
    'run.implementation_checkpoint': phase.productiveStep, 'run.productive_repair_admitted': phase.productiveStep - 1,
    'run.productive_closed': 1, 'run.completion_started': 1, 'run.completion_result': 1, 'run.finalization_settled': 1,
  };
  if (Object.entries(expectedCounts).some(([type, count]) => rows(type).length !== count) || events.some(event => [
    'run.cancel_requested', 'factory.stop_requested', 'run.recovery_hold', 'run.recovery_cleared', 'factory.terminal',
    'run.candidate_committed', 'run.agent_failed', 'run.check_completed', 'run.evidence_collected',
    'run.ready_for_review', 'run.signed_result', 'run.failed', 'run.cancelled', 'run.interrupted',
  ].includes(event.type))) hold();
  const checkpoint = rows('run.implementation_checkpoint').at(-1)!, closed = rows('run.productive_closed')[0];
  const started = rows('run.completion_started')[0], result = rows('run.completion_result')[0], settled = rows('run.finalization_settled')[0];
  if (checkpoint.id !== phase.checkpointEventId || closed.id !== phase.productiveClosedEventId ||
      started.id !== phase.completionStartedEventId || result.id !== phase.completionResultEventId || settled.id !== phase.settlementEventId ||
      !(checkpoint.id < closed.id && closed.id < started.id && started.id < result.id && result.id < settled.id) ||
      checkpoint.payload.passed !== true || checkpoint.payload.tree !== phase.expectedTree) hold();
  const links = { productiveStep: phase.productiveStep, checkpointEventId: checkpoint.id,
    productiveClosedEventId: closed.id, completionStartedEventId: started.id };
  if (result.payload.finalizationVersion !== 1 || result.payload.completionEligible !== true || result.payload.status !== 'completed' ||
      settled.payload.finalizationVersion !== 1 || settled.payload.completionResultEventId !== result.id ||
      settled.payload.expectedTree !== phase.expectedTree || Object.entries(links).some(([key, value]) =>
        result.payload[key] !== value || settled.payload[key] !== value) ||
      Object.entries(checkpointIdentity(run, execution)).some(([key, value]) => settled.payload[key] !== value)) hold();
  const processes = rows('agent.completion_process_started');
  if (settled.payload.provenance === 'EXISTING_COMPLETION_NATIVE_GUARD_RETURNED') {
    if (processes.length !== 1 || processes[0].id !== settled.payload.completionProcessEventId ||
        !(started.id < processes[0].id && processes[0].id < result.id) || !id(processes[0].payload.pid)) hold();
  } else if (settled.payload.provenance !== 'TRUSTED_IN_PROCESS_COMPLETION_RETURNED' ||
      settled.payload.completionProcessEventId !== null || processes.length) hold();
  if (events.some(event => event.type.startsWith('agent.') && event.type !== 'agent.completion_process_started' && event.id > checkpoint.id)) hold();
  try {
    const prefix = events.filter(event => event.id <= checkpoint.id);
    const productive = selectCheckpointPhase(prefix, { kind: 'RECHECK', productiveStep: phase.productiveStep,
      agentResultEventId: checkpoint.payload.agentResultEventId as number, settlementEventId: checkpoint.payload.settlementEventId as number,
      checkpointEventId: checkpoint.id, expectedTree: phase.expectedTree }, execution.configuration.commands, checkpointIdentity(run, execution));
    const context = selectContextPhase(events.filter(event => event.id !== result.id && event.id !== settled.id), {
      kind: 'COMPLETION', productiveStep: phase.productiveStep, checkpointEventId: checkpoint.id, tree: phase.expectedTree,
      productiveClosedEventId: closed.id, completionStartedEventId: started.id,
    }, execution.configuration.commands);
    // Counts above prevent a later productive phase being hidden by the prefix.
    if (events.some(event => ['run.agent_result', 'run.implementation_settled', 'run.implementation_checkpoint',
      'run.productive_repair_admitted'].includes(event.type) && event.id > checkpoint.id)) hold();
    return { productive, context, settledAt: settled.createdAt };
  } catch (error) { throw finalizationPolicyFailure(error); }
}

/** Fixed host bytes only. Predicted IDs are data until genuine native readback. */
export function planFinalizationCommit(input: string, tree: string, settledAt: string) {
  if (!gitId(input) || !gitId(tree) || typeof settledAt !== 'string') finalizationUncertain();
  const seconds = Math.floor(Date.parse(settledAt) / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 0) finalizationUncertain();
  const actor = 'Local Factory <factory@localhost.invalid> ' + seconds + ' +0000';
  const bytes = Buffer.from(`tree ${tree}\nparent ${input}\nauthor ${actor}\ncommitter ${actor}\n\nFactory candidate change\n`);
  if (bytes.length > 65536) finalizationFormatRefused();
  return { bytes, commit: createHash('sha1').update('commit ' + bytes.length + '\0').update(bytes).digest('hex') };
}
