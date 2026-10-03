import { DatabaseSync } from 'node:sqlite';
import { nonempty, positive, map, sameAttempt, assertSpendBinding, assertReservation, assertCompletionOperations, validateBudget, assertBindAuthority, matchesCurrent, spendSummary, type OperationRow, type BudgetRow, type SpendPhase, type SpendPlan, type SpendBinding, type SpendReservation, type SpendOperation } from './spend-policy.ts';
export type { SpendPhase, SpendPlan, SpendBinding, SpendReservation, SpendOperation } from './spend-policy.ts';

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
    validateBudget(binding, ceilingMicrousd, deadline, plan);
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
      assertBindAuthority(b, binding);
      this.#db.prepare(`UPDATE work_spend_budgets SET authority_dispatch_identity = ?, authority_factory_version = ?,
        authority_run_id = ?, authority_state = 'active' WHERE work_id = ?`)
        .run(binding.dispatchIdentity, binding.factoryVersion, binding.runId, binding.workId);
    });
  }
  assertCompletionEligible(binding: SpendBinding): void {
      const b = this.#budget(binding.workId);
      assertSpendBinding(b, binding, 'productive');
      const operations = this.#operations(binding.workId);
      assertCompletionOperations(operations, binding);
  }
  beginCompletion(binding: SpendBinding): void {
    this.#write(() => {
      this.assertCompletionEligible(binding);
      this.#db.prepare("UPDATE work_spend_budgets SET phase = 'completion' WHERE work_id = ?").run(binding.workId);
    });
  }
  assertCompleted(binding: SpendBinding): void {
    this.#write(() => {
      assertSpendBinding(this.#budget(binding.workId), binding, 'completion');
      const operations = this.#operations(binding.workId);
      if (!operations.some(op => sameAttempt(op, binding) && op.phase === 'completion' && op.state === 'settled') ||
        operations.some(op => op.state !== 'settled'))
        throw new Error('Mandatory completion spend and accounting are not settled');
    });
  }
  fenceAuthority(binding: SpendBinding): boolean {
    return this.#write(() => {
      const b = this.#budget(binding.workId);
      if (!b) throw new Error('Work budget missing');
      if (!matchesCurrent(b, binding)) return false;
      this.#db.prepare("UPDATE work_spend_budgets SET authority_state = 'fenced' WHERE work_id = ?")
        .run(binding.workId);
      return true;
    });
  }
  cancelBound(binding: SpendBinding): void {
    this.#write(() => {
      const b = this.#budget(binding.workId);
      if (!b || !matchesCurrent(b, binding)) throw new Error('Stale Work authority cannot cancel current budget');
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
  reserve(input: SpendReservation): SpendOperation {
    for (const [label, value] of Object.entries(input)) {
      if (label === 'workGeneration' || label === 'reservedMicrousd') positive(value as number, label);
      else nonempty(value as string, label);
    }
    if (input.phase !== 'productive' && input.phase !== 'completion') throw new Error('Invalid paid phase');
    return this.#write(() => {
      if (this.getOperation(input.operationId)) throw new Error('Spend operation already exists; replay cannot redispatch');
      const budget = this.#budget(input.workId);
      assertSpendBinding(budget, input, input.phase);
      assertReservation(budget, this.#operations(input.workId), input);
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
      assertSpendBinding(b, op, op.phase);
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
      const result = spendSummary(workId, budget, operations);
      this.#db.exec('COMMIT');
      return result;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
}
