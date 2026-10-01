import { isModelReference } from '../../contracts/src/model-reference.ts';
import { DatabaseSync } from 'node:sqlite';

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
  state: 'reserved' | 'dispatched' | 'unknown' | 'settled';
}
type OperationRow = {
  operation_id: string; work_id: string; work_generation: number;
  dispatch_identity: string; request_id: string; work_order_id: string;
  factory_version: string; run_id: string; model: string; pricing_revision: string;
  reserved_microusd: number; actual_microusd: number | null;
  provider_request_id: string | null; usage_json: string | null;
  state: SpendOperation['state']; phase: SpendPhase;
};
type BudgetRow = {
  work_generation: number; request_id: string; work_order_id: string;
  ceiling_microusd: number; deadline: string; cancelled_at: string | null;
  contract_version: string; pricing_revision: string | null; model: string | null; pricing_valid_until: string | null;
  per_operation_reserve_microusd: number; planned_productive_operations: number;
  planned_completion_operations: number; max_paid_operations: number;
  completion_reserve_microusd: number; authority_dispatch_identity: string | null;
  authority_factory_version: string | null; authority_run_id: string | null;
  authority_state: string; phase: SpendPhase;
};
function nonempty(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.includes('\0'))
    throw new TypeError(`${label} must be a bounded nonempty string`);
}
function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
}
function map(row: OperationRow): SpendOperation {
  return { operationId: row.operation_id, workId: row.work_id, workGeneration: row.work_generation,
    dispatchIdentity: row.dispatch_identity, requestId: row.request_id,
    workOrderId: row.work_order_id, factoryVersion: row.factory_version,
    runId: row.run_id, model: row.model, pricingRevision: row.pricing_revision,
    reservedMicrousd: row.reserved_microusd, actualMicrousd: row.actual_microusd,
    providerRequestId: row.provider_request_id,
    usage: row.usage_json ? JSON.parse(row.usage_json) as Record<string, number> : null,
    state: row.state, phase: row.phase };
}
function exposure(op: SpendOperation): number { return op.state === 'settled' ? op.actualMicrousd! : op.reservedMicrousd; }
function sameAttempt(op: SpendOperation, binding: SpendBinding): boolean {
  return op.workGeneration === binding.workGeneration && op.dispatchIdentity === binding.dispatchIdentity &&
    op.requestId === binding.requestId && op.workOrderId === binding.workOrderId &&
    op.factoryVersion === binding.factoryVersion && op.runId === binding.runId;
}

/** SQLite BEGIN IMMEDIATE serializes every Work paid admission across processes. */
export class SpendLedger {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    this.#db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true });
    this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    const version = this.#db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version < 8) { this.#db.close(); throw new Error('Spend migration 8 is required'); }
  }
  close(): void { this.#db.close(); }
  #write<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #budget(workId: string): BudgetRow | undefined {
    return this.#db.prepare('SELECT * FROM work_spend_budgets WHERE work_id = ?').get(workId) as BudgetRow | undefined;
  }
  #operations(workId: string): SpendOperation[] {
    return (this.#db.prepare('SELECT * FROM work_spend_operations WHERE work_id = ? ORDER BY created_at, operation_id')
      .all(workId) as unknown as OperationRow[]).map(map);
  }
  createBudget(binding: Pick<SpendBinding, 'workId' | 'workGeneration' | 'requestId' | 'workOrderId'>,
    ceilingMicrousd: number, deadline: string, plan?: SpendPlan): void {
    const { workId, workGeneration, requestId, workOrderId } = binding;
    nonempty(workId, 'workId'); positive(workGeneration, 'workGeneration');
    nonempty(requestId, 'requestId'); nonempty(workOrderId, 'workOrderId');
    positive(ceilingMicrousd, 'ceilingMicrousd');
    if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now()) throw new Error('Spend deadline must be in the future');
    if (plan) {
      if (plan.version !== 'WORK_LEDGER_V2') throw new Error('Unsupported spend contract');
      nonempty(plan.pricingRevision, 'pricingRevision');
      if (!isModelReference(plan.model)) throw new Error('Invalid canonical model reference');
      if (!Number.isFinite(Date.parse(plan.validUntil)) || Date.parse(plan.validUntil) <= Date.now()) throw new Error('Qualified pricing has expired');
      for (const name of ['perOperationReserveMicrousd', 'plannedProductiveOperations',
        'plannedCompletionOperations', 'maxPaidOperations', 'completionReserveMicrousd'] as const) positive(plan[name], name);
      if (plan.maxPaidOperations !== plan.plannedProductiveOperations + plan.plannedCompletionOperations ||
        !Number.isSafeInteger(plan.plannedProductiveOperations * plan.perOperationReserveMicrousd) ||
        !Number.isSafeInteger(plan.plannedCompletionOperations * plan.perOperationReserveMicrousd) ||
        plan.plannedCompletionOperations * plan.perOperationReserveMicrousd > plan.completionReserveMicrousd ||
        plan.plannedProductiveOperations * plan.perOperationReserveMicrousd > ceilingMicrousd - plan.completionReserveMicrousd)
        throw new Error('Complete conservative paid operation plan exceeds Work ceiling or protected completion reserve');
    }
    this.#write(() => {
      const previous = this.#budget(workId);
      if (previous) {
        if (previous.ceiling_microusd !== ceilingMicrousd || previous.cancelled_at ||
          workGeneration < previous.work_generation) throw new Error('Work ceiling or cancellation cannot reset');
        if (previous.contract_version !== (plan?.version ?? 'WORK_LEDGER_V1') ||
          (plan && (previous.pricing_revision !== plan.pricingRevision || previous.model !== plan.model ||
            previous.per_operation_reserve_microusd !== plan.perOperationReserveMicrousd ||
            previous.planned_productive_operations !== plan.plannedProductiveOperations ||
            previous.planned_completion_operations !== plan.plannedCompletionOperations ||
            previous.max_paid_operations !== plan.maxPaidOperations ||
            previous.completion_reserve_microusd !== plan.completionReserveMicrousd ||
            previous.pricing_valid_until !== plan.validUntil)))
          throw new Error('Work spend plan cannot reset');
        if (workGeneration === previous.work_generation) {
          if (previous.deadline !== deadline || previous.request_id !== requestId ||
            previous.work_order_id !== workOrderId) throw new Error('Work generation binding conflict');
          return;
        }
        if (this.#operations(workId).some(op => op.state === 'reserved' || op.state === 'dispatched'))
          throw new Error('Prior Work generation has active spend operations');
        this.#db.prepare(`UPDATE work_spend_budgets SET work_generation = ?, request_id = ?,
          work_order_id = ?, deadline = ?, authority_state = 'prepared', authority_dispatch_identity = NULL,
          authority_factory_version = NULL, authority_run_id = NULL, phase = 'productive' WHERE work_id = ?`)
          .run(workGeneration, requestId, workOrderId, deadline, workId);
        return;
      }
      this.#db.prepare(`INSERT INTO work_spend_budgets (work_id, work_generation, request_id, work_order_id,
        ceiling_microusd, deadline, cancelled_at, created_at, contract_version, pricing_revision, model, pricing_valid_until,
        per_operation_reserve_microusd, planned_productive_operations, planned_completion_operations,
        max_paid_operations, completion_reserve_microusd) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(workId, workGeneration, requestId, workOrderId, ceilingMicrousd, deadline, new Date().toISOString(),
          plan?.version ?? 'WORK_LEDGER_V1', plan?.pricingRevision ?? null, plan?.model ?? null, plan?.validUntil ?? null,
          plan?.perOperationReserveMicrousd ?? 0, plan?.plannedProductiveOperations ?? 0,
          plan?.plannedCompletionOperations ?? 0, plan?.maxPaidOperations ?? 0, plan?.completionReserveMicrousd ?? 0);
    });
  }
  bindAuthority(binding: SpendBinding): void {
    for (const [key, value] of Object.entries(binding)) key === 'workGeneration' ? positive(value as number, key) : nonempty(value as string, key);
    this.#write(() => {
      const b = this.#budget(binding.workId);
      if (!b || b.contract_version !== 'WORK_LEDGER_V2' || b.cancelled_at || Date.parse(b.deadline) <= Date.now() ||
        !b.pricing_valid_until || Date.parse(b.pricing_valid_until) <= Date.now() ||
        b.work_generation !== binding.workGeneration || b.request_id !== binding.requestId || b.work_order_id !== binding.workOrderId ||
        b.authority_state === 'fenced') throw new Error('Active exact Work authority required');
      if (b.authority_dispatch_identity && (b.authority_dispatch_identity !== binding.dispatchIdentity ||
        b.authority_factory_version !== binding.factoryVersion || b.authority_run_id !== binding.runId))
        throw new Error('Work paid authority conflict');
      this.#db.prepare(`UPDATE work_spend_budgets SET authority_dispatch_identity = ?, authority_factory_version = ?,
        authority_run_id = ?, authority_state = 'active' WHERE work_id = ?`)
        .run(binding.dispatchIdentity, binding.factoryVersion, binding.runId, binding.workId);
    });
  }
  beginCompletion(binding: SpendBinding): void {
    this.#write(() => {
      const b = this.#budget(binding.workId);
      this.#admitBinding(b, binding, 'productive');
      const operations = this.#operations(binding.workId);
      if (!operations.some(op => sameAttempt(op, binding) && op.phase === 'productive' && op.state === 'settled'))
        throw new Error('Productive paid operation missing before completion');
      if (operations.some(op => op.state !== 'settled'))
        throw new Error('Outstanding paid operation blocks completion transition');
      this.#db.prepare("UPDATE work_spend_budgets SET phase = 'completion' WHERE work_id = ?").run(binding.workId);
    });
  }
  assertCompleted(binding: SpendBinding): void {
    this.#write(() => {
      this.#admitBinding(this.#budget(binding.workId), binding, 'completion');
      const operations = this.#operations(binding.workId);
      if (!operations.some(op => sameAttempt(op, binding) && op.phase === 'completion' && op.state === 'settled') ||
        operations.some(op => op.state !== 'settled'))
        throw new Error('Mandatory completion spend and accounting are not settled');
    });
  }
  #matchesCurrent(b: BudgetRow, binding: SpendBinding): boolean {
    return b.work_generation === binding.workGeneration && b.request_id === binding.requestId &&
      b.work_order_id === binding.workOrderId &&
      (!b.authority_dispatch_identity || (b.authority_dispatch_identity === binding.dispatchIdentity &&
        b.authority_factory_version === binding.factoryVersion && b.authority_run_id === binding.runId));
  }
  fenceAuthority(binding: SpendBinding): boolean {
    return this.#write(() => {
      const b = this.#budget(binding.workId);
      if (!b) throw new Error('Work budget missing');
      if (!this.#matchesCurrent(b, binding)) return false;
      this.#db.prepare("UPDATE work_spend_budgets SET authority_state = 'fenced' WHERE work_id = ?")
        .run(binding.workId);
      return true;
    });
  }
  cancelBound(binding: SpendBinding): void {
    this.#write(() => {
      const b = this.#budget(binding.workId);
      if (!b || !this.#matchesCurrent(b, binding)) throw new Error('Stale Work authority cannot cancel current budget');
      this.#db.prepare("UPDATE work_spend_budgets SET cancelled_at = COALESCE(cancelled_at, ?), authority_state = 'fenced' WHERE work_id = ?")
        .run(new Date().toISOString(), binding.workId);
    });
  }
  cancel(workId: string): void {
    this.#write(() => {
      const result = this.#db.prepare("UPDATE work_spend_budgets SET cancelled_at = COALESCE(cancelled_at, ?), authority_state = 'fenced' WHERE work_id = ?")
        .run(new Date().toISOString(), workId);
      if (result.changes !== 1) throw new Error('Work budget missing');
    });
  }
  getOperation(operationId: string): SpendOperation | null {
    const row = this.#db.prepare('SELECT * FROM work_spend_operations WHERE operation_id = ?').get(operationId) as OperationRow | undefined;
    return row ? map(row) : null;
  }
  #admitBinding(b: BudgetRow | undefined, input: SpendBinding, phase: SpendPhase): asserts b is BudgetRow {
    if (!b || b.contract_version !== 'WORK_LEDGER_V2') throw new Error('V2 Work budget required for paid execution');
    if (b.cancelled_at || Date.parse(b.deadline) <= Date.now()) throw new Error('Post-cancel or expired paid start denied');
    if (!b.pricing_valid_until || Date.parse(b.pricing_valid_until) <= Date.now()) throw new Error('Pinned pricing expired before paid start');
    if (b.work_generation !== input.workGeneration || b.request_id !== input.requestId ||
      b.work_order_id !== input.workOrderId) throw new Error('Spend binding differs from active Work generation');
    if (b.authority_state !== 'active' || b.authority_dispatch_identity !== input.dispatchIdentity ||
      b.authority_factory_version !== input.factoryVersion || b.authority_run_id !== input.runId)
      throw new Error('Active exact Factory writer authority required');
    if (b.phase !== phase) throw new Error('Paid phase is not host authorized');
  }
  reserve(input: SpendReservation): SpendOperation {
    for (const [label, value] of Object.entries(input)) {
      if (label === 'workGeneration' || label === 'reservedMicrousd') positive(value as number, label);
      else nonempty(value as string, label);
    }
    if (input.phase !== 'productive' && input.phase !== 'completion') throw new Error('Invalid paid phase');
    return this.#write(() => {
      if (this.getOperation(input.operationId)) throw new Error('Spend operation already exists; replay cannot redispatch');
      const budget = this.#budget(input.workId);
      this.#admitBinding(budget, input, input.phase);
      if (budget.model !== input.model || budget.pricing_revision !== input.pricingRevision ||
        input.reservedMicrousd !== budget.per_operation_reserve_microusd)
        throw new Error('Pinned pricing or conservative reservation mismatch');
      const ops = this.#operations(input.workId);
      if (ops.some(op => op.state === 'unknown')) throw new Error('UNKNOWN exposure blocks all new paid operations');
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
      const now = new Date().toISOString();
      this.#db.prepare(`INSERT INTO work_spend_operations (operation_id, work_id, work_generation, dispatch_identity,
        request_id, work_order_id, factory_version, run_id, model, pricing_revision, reserved_microusd,
        actual_microusd, provider_request_id, usage_json, state, created_at, updated_at, phase)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'reserved', ?, ?, ?)`)
        .run(input.operationId, input.workId, input.workGeneration, input.dispatchIdentity, input.requestId,
          input.workOrderId, input.factoryVersion, input.runId, input.model, input.pricingRevision,
          input.reservedMicrousd, now, now, input.phase);
      return this.getOperation(input.operationId)!;
    });
  }
  markDispatched(operationId: string): void {
    this.#write(() => {
      const op = this.getOperation(operationId);
      if (!op || op.state !== 'reserved') throw new Error('Only a fresh reservation can cross the paid boundary');
      const b = this.#budget(op.workId);
      this.#admitBinding(b, op, op.phase);
      if (b.model !== op.model || b.pricing_revision !== op.pricingRevision ||
        b.per_operation_reserve_microusd !== op.reservedMicrousd) throw new Error('Pricing changed before dispatch');
      if (this.#operations(op.workId).some(other => other.operationId !== operationId && other.state === 'unknown'))
        throw new Error('UNKNOWN exposure blocks paid dispatch');
      this.#db.prepare("UPDATE work_spend_operations SET state = 'dispatched', updated_at = ? WHERE operation_id = ?")
        .run(new Date().toISOString(), operationId);
    });
  }
  settle(operationId: string, actualMicrousd: number, providerRequestId: string, usage: Record<string, number>): void {
    if (!Number.isSafeInteger(actualMicrousd) || actualMicrousd < 0) throw new RangeError('Invalid actual spend');
    nonempty(providerRequestId, 'providerRequestId');
    if (!usage || !Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens) ||
      usage.input_tokens < 0 || usage.output_tokens < 0) throw new Error('Authoritative usage is required');
    this.#write(() => {
      const op = this.getOperation(operationId);
      if (!op || !['dispatched', 'unknown'].includes(op.state)) throw new Error('Only dispatched or unknown operation can settle');
      if (actualMicrousd > op.reservedMicrousd) throw new Error('Actual cost exceeded reservation; retain UNKNOWN exposure');
      this.#db.prepare(`UPDATE work_spend_operations SET actual_microusd = ?, provider_request_id = ?,
        usage_json = ?, state = 'settled', updated_at = ? WHERE operation_id = ?`)
        .run(actualMicrousd, providerRequestId, JSON.stringify(usage), new Date().toISOString(), operationId);
    });
  }
  markUnknown(operationId: string): void {
    this.#write(() => {
      const op = this.getOperation(operationId);
      if (!op || op.state === 'settled') return;
      this.#db.prepare("UPDATE work_spend_operations SET state = 'unknown', updated_at = ? WHERE operation_id = ?")
        .run(new Date().toISOString(), operationId);
    });
  }
  recoverUnknown(): number {
    return this.#write(() => Number(this.#db.prepare(`UPDATE work_spend_operations SET state = 'unknown', updated_at = ?
      WHERE state IN ('reserved', 'dispatched')`).run(new Date().toISOString()).changes));
  }
  read(workId: string): {
    status: 'KNOWN' | 'UNKNOWN'; currency: 'USD'; unit: 'microUSD'; workId: string;
    workGeneration: number; requestId: string; workOrderId: string; deadline: string;
    ceilingMicrousd: number; settledMicrousd: number; retainedMicrousd: number;
    availableMicrousd: number; unknownExposureMicrousd: number;
    productiveAllowanceRemainingMicrousd: number; completionReserveMicrousd: number;
    completionReserveRemainingMicrousd: number; paidOperationsUsed: number;
    maxPaidOperations: number; plannedProductiveOperations: number; plannedCompletionOperations: number;
    completionOperationsUsed: number; completionOperationSlotsRemaining: number;
    perOperationReserveMicrousd: number; contractVersion: string; pricingRevision: string | null;
    pricingQualified: boolean; authorityState: string; accountingComplete: boolean;
    phase: SpendPhase; cancelled: boolean; operations: SpendOperation[];
  } | null {
    this.#db.exec('BEGIN');
    try {
      const budget = this.#budget(workId);
      if (!budget) { this.#db.exec('COMMIT'); return null; }
      const operations = this.#operations(workId);
      const settledMicrousd = operations.reduce((n, op) => n + (op.actualMicrousd ?? 0), 0);
      const retainedMicrousd = operations.reduce((n, op) => n + (op.state === 'settled' ? 0 : op.reservedMicrousd), 0);
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
          !!budget.pricing_valid_until && Date.parse(budget.pricing_valid_until) > Date.now(),
        authorityState: budget.authority_state, accountingComplete: operations.every(op => op.state === 'settled'),
        phase: budget.phase, cancelled: budget.cancelled_at !== null, operations };
      this.#db.exec('COMMIT');
      return result;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
}
