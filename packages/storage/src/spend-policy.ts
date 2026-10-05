import { isModelReference } from '../../contracts/src/model-reference.ts';

export type SpendPhase = 'productive' | 'completion';
export interface SpendPlan {
  version: 'WORK_LEDGER_V2';
  pricingRevision: string;
  model: string;
  validUntil: string;
  perOperationReserveMicrousd: number;
  plannedProductiveOperations: number;
  plannedCompletionOperations: number;
  maxPaidOperations: number;
  completionReserveMicrousd: number;
}
export interface SpendBinding {
  workId: string; workGeneration: number; dispatchIdentity: string;
  requestId: string; workOrderId: string; factoryVersion: string; runId: string;
}
export interface SpendReservation extends SpendBinding {
  operationId: string; model: string; pricingRevision: string;
  reservedMicrousd: number; phase: SpendPhase;
}
export interface SpendOperation extends SpendReservation {
  actualMicrousd: number | null; providerRequestId: string | null;
  usage: Record<string, number> | null;
  state: 'reserved' | 'dispatched' | 'unknown' | 'settled' | 'released';
}
export type OperationRow = {
  operation_id: string; work_id: string; work_generation: number;
  dispatch_identity: string; request_id: string; work_order_id: string;
  factory_version: string; run_id: string; model: string; pricing_revision: string;
  reserved_microusd: number; actual_microusd: number | null;
  provider_request_id: string | null; usage_json: string | null;
  state: SpendOperation['state']; phase: SpendPhase;
};
export type BudgetRow = {
  work_generation: number; request_id: string; work_order_id: string;
  ceiling_microusd: number; deadline: string; cancelled_at: string | null;
  contract_version: string; pricing_revision: string | null; model: string | null; pricing_valid_until: string | null;
  per_operation_reserve_microusd: number; planned_productive_operations: number;
  planned_completion_operations: number; max_paid_operations: number;
  completion_reserve_microusd: number; authority_dispatch_identity: string | null;
  authority_factory_version: string | null; authority_run_id: string | null;
  authority_state: string; phase: SpendPhase;
};
export function nonempty(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.includes('\0'))
    throw new TypeError(`${label} must be a bounded nonempty string`);
}
export function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
}
export function map(row: OperationRow): SpendOperation {
  return { operationId: row.operation_id, workId: row.work_id, workGeneration: row.work_generation,
    dispatchIdentity: row.dispatch_identity, requestId: row.request_id,
    workOrderId: row.work_order_id, factoryVersion: row.factory_version,
    runId: row.run_id, model: row.model, pricingRevision: row.pricing_revision,
    reservedMicrousd: row.reserved_microusd, actualMicrousd: row.actual_microusd,
    providerRequestId: row.provider_request_id,
    usage: row.usage_json ? JSON.parse(row.usage_json) as Record<string, number> : null,
    state: row.state, phase: row.phase };
}
export function exposure(op: SpendOperation): number { return op.state === 'released' ? 0 : op.state === 'settled' ? op.actualMicrousd! : op.reservedMicrousd; }
export function sameAttempt(op: SpendOperation, binding: SpendBinding): boolean {
  return op.workGeneration === binding.workGeneration && op.dispatchIdentity === binding.dispatchIdentity &&
    op.requestId === binding.requestId && op.workOrderId === binding.workOrderId &&
    op.factoryVersion === binding.factoryVersion && op.runId === binding.runId;
}

export function assertSpendBinding(b: BudgetRow | undefined, input: SpendBinding, phase: SpendPhase, now = Date.now()): asserts b is BudgetRow {
    if (!b || b.contract_version !== 'WORK_LEDGER_V2') throw new Error('V2 Work budget required for paid execution');
    if (b.cancelled_at || Date.parse(b.deadline) <= now) throw new Error('Post-cancel or expired paid start denied');
    if (!b.pricing_valid_until || Date.parse(b.pricing_valid_until) <= now) throw new Error('Pinned pricing expired before paid start');
    if (b.work_generation !== input.workGeneration || b.request_id !== input.requestId ||
      b.work_order_id !== input.workOrderId) throw new Error('Spend binding differs from active Work generation');
    if (b.authority_state !== 'active' || b.authority_dispatch_identity !== input.dispatchIdentity ||
      b.authority_factory_version !== input.factoryVersion || b.authority_run_id !== input.runId)
      throw new Error('Active exact Factory writer authority required');
    if (b.phase !== phase) throw new Error('Paid phase is not host authorized');
  }
export function assertReservation(budget: BudgetRow, ops: SpendOperation[], input: SpendReservation): void {
      if (budget.model !== input.model || budget.pricing_revision !== input.pricingRevision ||
        input.reservedMicrousd !== budget.per_operation_reserve_microusd)
        throw new Error('Pinned pricing or conservative reservation mismatch');
      if (ops.some(op => ['reserved', 'dispatched', 'unknown'].includes(op.state))) throw new Error('Unresolved reservation or UNKNOWN exposure blocks all new paid operations');
      if (ops.length >= budget.max_paid_operations ||
        ops.filter(op => op.phase === input.phase).length >=
          (input.phase === 'productive' ? budget.planned_productive_operations : budget.planned_completion_operations))
        throw new Error('Work paid operation limit reached');
      const total = ops.reduce((n, op) => n + exposure(op), 0);
      const phaseExposure = ops.filter(op => op.phase === input.phase).reduce((n, op) => n + exposure(op), 0);
      const phaseCap = input.phase === 'productive'
        ? budget.ceiling_microusd - budget.completion_reserve_microusd : budget.completion_reserve_microusd;
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(phaseExposure) ||
        input.reservedMicrousd > budget.ceiling_microusd - total || input.reservedMicrousd > phaseCap - phaseExposure)
        throw new Error('Hard Work ceiling or protected completion reserve exceeded');
}
export function assertCompletionOperations(operations: SpendOperation[], binding: SpendBinding): void {
      if (!operations.some(op => sameAttempt(op, binding) && op.phase === 'productive' && op.state === 'settled'))
        throw new Error('Productive paid operation missing before completion');
      if (operations.some(op => !['settled', 'released'].includes(op.state)))
        throw new Error('Outstanding paid operation blocks completion transition');
      if (operations.some(op => op.phase === 'completion'))
        throw new Error('Completion already consumed');
}
export function validateBudget(binding: Pick<SpendBinding, "workId" | "workGeneration" | "requestId" | "workOrderId">, ceilingMicrousd: number, deadline: string, plan: SpendPlan | undefined, now = Date.now()): void {
    const { workId, workGeneration, requestId, workOrderId } = binding;
    nonempty(workId, 'workId'); positive(workGeneration, 'workGeneration');
    nonempty(requestId, 'requestId'); nonempty(workOrderId, 'workOrderId');
    positive(ceilingMicrousd, 'ceilingMicrousd');
    if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= now) throw new Error('Spend deadline must be in the future');
    if (plan) {
      if (plan.version !== 'WORK_LEDGER_V2') throw new Error('Unsupported spend contract');
      nonempty(plan.pricingRevision, 'pricingRevision');
      if (!isModelReference(plan.model)) throw new Error('Invalid canonical model reference');
      if (!Number.isFinite(Date.parse(plan.validUntil)) || Date.parse(plan.validUntil) <= now) throw new Error('Qualified pricing has expired');
      for (const name of ['perOperationReserveMicrousd', 'plannedProductiveOperations',
        'plannedCompletionOperations', 'maxPaidOperations', 'completionReserveMicrousd'] as const) positive(plan[name], name);
      if (plan.maxPaidOperations !== plan.plannedProductiveOperations + plan.plannedCompletionOperations ||
        !Number.isSafeInteger(plan.plannedProductiveOperations * plan.perOperationReserveMicrousd) ||
        !Number.isSafeInteger(plan.plannedCompletionOperations * plan.perOperationReserveMicrousd) ||
        plan.plannedCompletionOperations * plan.perOperationReserveMicrousd > plan.completionReserveMicrousd ||
        plan.plannedProductiveOperations * plan.perOperationReserveMicrousd > ceilingMicrousd - plan.completionReserveMicrousd)
        throw new Error('Complete conservative paid operation plan exceeds Work ceiling or protected completion reserve');
    }
}
export function assertBindAuthority(b: BudgetRow | undefined, binding: SpendBinding, now = Date.now()): void {
      if (!b || b.contract_version !== 'WORK_LEDGER_V2' || b.cancelled_at || Date.parse(b.deadline) <= now ||
        !b.pricing_valid_until || Date.parse(b.pricing_valid_until) <= now ||
        b.work_generation !== binding.workGeneration || b.request_id !== binding.requestId || b.work_order_id !== binding.workOrderId ||
        b.authority_state === 'fenced') throw new Error('Active exact Work authority required');
      if (b.authority_dispatch_identity && (b.authority_dispatch_identity !== binding.dispatchIdentity ||
        b.authority_factory_version !== binding.factoryVersion || b.authority_run_id !== binding.runId))
        throw new Error('Work paid authority conflict');
}
export function matchesCurrent(b: BudgetRow, binding: SpendBinding): boolean {
    return b.work_generation === binding.workGeneration && b.request_id === binding.requestId &&
      b.work_order_id === binding.workOrderId &&
      (!b.authority_dispatch_identity || (b.authority_dispatch_identity === binding.dispatchIdentity &&
        b.authority_factory_version === binding.factoryVersion && b.authority_run_id === binding.runId));
  }
export function spendSummary(workId: string, budget: BudgetRow, operations: SpendOperation[], now = Date.now()) {
      const settledMicrousd = operations.reduce((n, op) => n + (op.actualMicrousd ?? 0), 0);
      const retainedMicrousd = operations.reduce((n, op) => n + (['settled', 'released'].includes(op.state) ? 0 : op.reservedMicrousd), 0);
      const unknownExposureMicrousd = operations.reduce((n, op) => n + (op.state === 'unknown' ? op.reservedMicrousd : 0), 0);
      const completionOperations = operations.filter(op => op.phase === 'completion');
      const completionExposure = completionOperations.reduce((n, op) => n + exposure(op), 0);
      const completionReserveRemainingMicrousd = Math.max(0, budget.completion_reserve_microusd - completionExposure);
      const productiveExposure = operations.filter(op => op.phase === 'productive').reduce((n, op) => n + exposure(op), 0);
      const result = { status: (unknownExposureMicrousd > 0 ? 'UNKNOWN' : 'KNOWN') as 'UNKNOWN' | 'KNOWN',
        currency: 'USD' as const, unit: 'microUSD' as const, workId,
        workGeneration: budget.work_generation, requestId: budget.request_id, workOrderId: budget.work_order_id,
        deadline: budget.deadline, ceilingMicrousd: budget.ceiling_microusd,
        settledMicrousd, retainedMicrousd, availableMicrousd: budget.ceiling_microusd - settledMicrousd - retainedMicrousd,
        unknownExposureMicrousd,
        productiveAllowanceRemainingMicrousd: Math.max(0, budget.ceiling_microusd - budget.completion_reserve_microusd - productiveExposure),
        completionReserveMicrousd: budget.completion_reserve_microusd, completionReserveRemainingMicrousd,
        paidOperationsUsed: operations.length, maxPaidOperations: budget.max_paid_operations,
        plannedProductiveOperations: budget.planned_productive_operations,
        plannedCompletionOperations: budget.planned_completion_operations,
        completionOperationsUsed: completionOperations.length,
        completionOperationSlotsRemaining: Math.max(0, budget.planned_completion_operations - completionOperations.length),
        perOperationReserveMicrousd: budget.per_operation_reserve_microusd,
        contractVersion: budget.contract_version, pricingRevision: budget.pricing_revision,
        pricingQualified: budget.contract_version === 'WORK_LEDGER_V2' && !!budget.pricing_revision &&
          !!budget.pricing_valid_until && Date.parse(budget.pricing_valid_until) > now,
        authorityState: budget.authority_state, accountingComplete: operations.every(op => ['settled', 'released'].includes(op.state)),
        phase: budget.phase, cancelled: budget.cancelled_at !== null, operations };
return result;
}
