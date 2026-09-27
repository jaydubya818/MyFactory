import { DatabaseSync } from 'node:sqlite';

export interface SpendBinding {
  workId: string;
  workGeneration: number;
  dispatchIdentity: string;
  requestId: string;
  workOrderId: string;
  factoryVersion: string;
  runId: string;
}

export interface SpendReservation extends SpendBinding {
  operationId: string;
  model: string;
  pricingRevision: string;
  reservedMicrousd: number;
}

export interface SpendOperation extends SpendReservation {
  actualMicrousd: number | null;
  providerRequestId: string | null;
  usage: Record<string, number> | null;
  state: 'reserved' | 'dispatched' | 'unknown' | 'settled';
}

type OperationRow = {
  operation_id: string; work_id: string; work_generation: number;
  dispatch_identity: string; request_id: string; work_order_id: string;
  factory_version: string; run_id: string; model: string; pricing_revision: string;
  reserved_microusd: number; actual_microusd: number | null;
  provider_request_id: string | null; usage_json: string | null;
  state: SpendOperation['state'];
};

function nonempty(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.includes('\0')) {
    throw new TypeError(`${label} must be a bounded nonempty string`);
  }
}
function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
}
function map(row: OperationRow): SpendOperation {
  return {
    operationId: row.operation_id, workId: row.work_id, workGeneration: row.work_generation,
    dispatchIdentity: row.dispatch_identity, requestId: row.request_id,
    workOrderId: row.work_order_id, factoryVersion: row.factory_version,
    runId: row.run_id, model: row.model, pricingRevision: row.pricing_revision,
    reservedMicrousd: row.reserved_microusd, actualMicrousd: row.actual_microusd,
    providerRequestId: row.provider_request_id,
    usage: row.usage_json ? JSON.parse(row.usage_json) as Record<string, number> : null,
    state: row.state,
  };
}

/** Each transition uses BEGIN IMMEDIATE so independent supervisor processes share one ceiling. */
export class SpendLedger {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true });
    this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    const version = this.#db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version < 7) { this.#db.close(); throw new Error('Spend migration 7 is required'); }
  }

  close(): void { this.#db.close(); }

  #write<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }

  createBudget(binding: Pick<SpendBinding, 'workId' | 'workGeneration' | 'requestId' | 'workOrderId'>,
    ceilingMicrousd: number, deadline: string): void {
    const { workId, workGeneration, requestId, workOrderId } = binding;
    nonempty(workId, 'workId'); positive(workGeneration, 'workGeneration');
    nonempty(requestId, 'requestId'); nonempty(workOrderId, 'workOrderId');
    positive(ceilingMicrousd, 'ceilingMicrousd');
    if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now()) throw new Error('Spend deadline must be in the future');
    this.#write(() => {
      const previous = this.#db.prepare('SELECT * FROM work_spend_budgets WHERE work_id = ?').get(workId) as
        { work_generation: number; request_id: string; work_order_id: string;
          ceiling_microusd: number; deadline: string; cancelled_at: string | null } | undefined;
      if (previous) {
        if (previous.ceiling_microusd !== ceilingMicrousd || previous.cancelled_at ||
          workGeneration < previous.work_generation) throw new Error('Work ceiling or cancellation cannot reset');
        if (workGeneration === previous.work_generation) {
          if (previous.deadline !== deadline || previous.request_id !== requestId ||
            previous.work_order_id !== workOrderId) throw new Error('Work generation binding conflict');
          return;
        }
        const active = this.#db.prepare(`SELECT COUNT(*) AS n FROM work_spend_operations
          WHERE work_id = ? AND state IN ('reserved', 'dispatched')`).get(workId) as { n: number };
        if (active.n) throw new Error('Prior Work generation has active spend operations');
        this.#db.prepare(`UPDATE work_spend_budgets SET work_generation = ?, request_id = ?,
          work_order_id = ?, deadline = ? WHERE work_id = ?`)
          .run(workGeneration, requestId, workOrderId, deadline, workId);
        return;
      }
      this.#db.prepare('INSERT INTO work_spend_budgets VALUES (?, ?, ?, ?, ?, ?, NULL, ?)')
        .run(workId, workGeneration, requestId, workOrderId, ceilingMicrousd, deadline, new Date().toISOString());
    });
  }

  cancel(workId: string): void {
    this.#write(() => {
      const result = this.#db.prepare('UPDATE work_spend_budgets SET cancelled_at = COALESCE(cancelled_at, ?) WHERE work_id = ?')
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
    return this.#write(() => {
      // Replay of an operation is never permission to dispatch it again.
      if (this.getOperation(input.operationId)) throw new Error('Spend operation already exists');
      const budget = this.#db.prepare('SELECT * FROM work_spend_budgets WHERE work_id = ?').get(input.workId) as
        { work_generation: number; request_id: string; work_order_id: string;
          ceiling_microusd: number; deadline: string; cancelled_at: string | null } | undefined;
      if (!budget || budget.cancelled_at || Date.parse(budget.deadline) <= Date.now()) throw new Error('Work budget missing, cancelled, or expired');
      if (budget.work_generation !== input.workGeneration || budget.request_id !== input.requestId ||
        budget.work_order_id !== input.workOrderId) throw new Error('Spend reservation binding differs from active Work generation');
      const used = this.#db.prepare(`SELECT COALESCE(SUM(CASE WHEN state = 'settled' THEN actual_microusd ELSE reserved_microusd END), 0) AS exposure
        FROM work_spend_operations WHERE work_id = ?`).get(input.workId) as { exposure: number };
      if (!Number.isSafeInteger(used.exposure) || input.reservedMicrousd > budget.ceiling_microusd - used.exposure) {
        throw new Error('Hard Work spend ceiling exceeded');
      }
      const now = new Date().toISOString();
      this.#db.prepare(`INSERT INTO work_spend_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'reserved', ?, ?)`)
        .run(input.operationId, input.workId, input.workGeneration, input.dispatchIdentity, input.requestId,
          input.workOrderId, input.factoryVersion, input.runId, input.model, input.pricingRevision,
          input.reservedMicrousd, now, now);
      return this.getOperation(input.operationId)!;
    });
  }

  markDispatched(operationId: string): void {
    this.#write(() => {
      const op = this.getOperation(operationId);
      if (!op || op.state !== 'reserved') throw new Error('Only a fresh reservation can cross the paid boundary');
      const budget = this.#db.prepare('SELECT cancelled_at, deadline, work_generation, request_id, work_order_id FROM work_spend_budgets WHERE work_id = ?').get(op.workId) as
        { cancelled_at: string | null; deadline: string; work_generation: number;
          request_id: string; work_order_id: string } | undefined;
      if (!budget || budget.cancelled_at || Date.parse(budget.deadline) <= Date.now()) throw new Error('Post-cancel or expired paid start denied');
      if (budget.work_generation !== op.workGeneration || budget.request_id !== op.requestId ||
        budget.work_order_id !== op.workOrderId) throw new Error('Stale Work generation cannot start paid operation');
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

  read(workId: string): { status: 'KNOWN' | 'UNKNOWN'; currency: 'USD'; unit: 'microUSD'; workId: string;
    workGeneration: number; requestId: string; workOrderId: string; deadline: string;
    ceilingMicrousd: number; settledMicrousd: number; retainedMicrousd: number;
    availableMicrousd: number; cancelled: boolean; operations: SpendOperation[] } | null {
    this.#db.exec('BEGIN');
    try {
    const budget = this.#db.prepare('SELECT * FROM work_spend_budgets WHERE work_id = ?').get(workId) as
      { work_generation: number; request_id: string; work_order_id: string; deadline: string;
        ceiling_microusd: number; cancelled_at: string | null } | undefined;
    if (!budget) { this.#db.exec('COMMIT'); return null; }
    const operations = (this.#db.prepare('SELECT * FROM work_spend_operations WHERE work_id = ? ORDER BY created_at, operation_id')
      .all(workId) as unknown as OperationRow[]).map(map);
    const settledMicrousd = operations.reduce((n, op) => n + (op.actualMicrousd ?? 0), 0);
    const retainedMicrousd = operations.reduce((n, op) => n + (op.state === 'settled' ? 0 : op.reservedMicrousd), 0);
    const result = { status: (operations.some(op => op.state === 'unknown') ? 'UNKNOWN' : 'KNOWN') as 'KNOWN' | 'UNKNOWN',
      currency: 'USD' as const, unit: 'microUSD' as const, workId,
      workGeneration: budget.work_generation, requestId: budget.request_id,
      workOrderId: budget.work_order_id, deadline: budget.deadline,
      ceilingMicrousd: budget.ceiling_microusd, settledMicrousd, retainedMicrousd,
      availableMicrousd: budget.ceiling_microusd - settledMicrousd - retainedMicrousd,
      cancelled: budget.cancelled_at !== null, operations };
    this.#db.exec('COMMIT');
    return result;
    } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
}
