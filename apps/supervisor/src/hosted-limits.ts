import { DatabaseSync } from 'node:sqlite';
import { OWNER_SUBSCRIPTION_PRICING_REVISION } from '../../../packages/storage/src/spend-policy.ts';
import type { SpendReservation } from '../../../packages/storage/src/spend.ts';
import type { GatewayLedger } from './spend-gateway.ts';

/**
 * Host-side limits for hosted/tester metered Works (Jay's approval, 2026-11-05): $1.30 per Work, 4 Works per person, and a $25
 * calendar-month guard. These are CEILINGS: host configuration may lower them, never raise them, and nothing in this process raises
 * or resets them automatically. The $25/month cap on the OpenAI project itself is set by Jay in the OpenAI dashboard (not code); the
 * guard here is an independent host-side refusal so the Mac stops admitting before the provider-side cap would be the only stop.
 *
 * Durable state is a separate `hosted-limits.sqlite` beside the Factory database. Existing accounts, conversations and accounting
 * records are never modified; the monthly guard only READS the existing spend ledger.
 */
export const APPROVED_HOSTED_LIMITS = Object.freeze({ maxWorkMicrousd: 1_300_000, maxWorksPerPerson: 4, monthlyBudgetMicrousd: 25_000_000 });
export type HostedLimits = { maxWorkMicrousd: number; maxWorksPerPerson: number; monthlyBudgetMicrousd: number };
export class HostedLimitRefused extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
const refuse = (code: string): never => { throw new HostedLimitRefused(code); };

/** Absent means the approved values. Each field must be a positive safe integer no larger than the approved ceiling. */
export function parseHostedLimits(raw: unknown): HostedLimits {
  if (raw === undefined) return { ...APPROVED_HOSTED_LIMITS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).sort().join(',') !== 'maxWorkMicrousd,maxWorksPerPerson,monthlyBudgetMicrousd') return refuse('HOSTED_LIMITS_SHAPE');
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(APPROVED_HOSTED_LIMITS) as (keyof HostedLimits)[]) {
    const v = r[key];
    if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) > APPROVED_HOSTED_LIMITS[key]) refuse('HOSTED_LIMITS_ABOVE_APPROVAL');
  }
  return { maxWorkMicrousd: r.maxWorkMicrousd as number, maxWorksPerPerson: r.maxWorksPerPerson as number, monthlyBudgetMicrousd: r.monthlyBudgetMicrousd as number };
}

/** UTC calendar month bounds (OpenAI project budgets are evaluated per UTC month). */
export function monthWindow(now: Date): { start: string; end: string; month: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString(), month: start.toISOString().slice(0, 7) };
}

export class HostedSpendGuard {
  readonly limits: HostedLimits;
  readonly #db: DatabaseSync;
  readonly #spend: DatabaseSync;
  readonly #now: () => Date;
  constructor(limitsPath: string, spendDatabasePath: string, limits: HostedLimits, now: () => Date = () => new Date()) {
    this.limits = parseHostedLimits(limits);
    this.#now = now;
    this.#db = new DatabaseSync(limitsPath, { timeout: 5000 });
    this.#db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS hosted_work_admissions (work_id TEXT PRIMARY KEY, person_key TEXT NOT NULL, client_id TEXT NOT NULL,
        owner_scope TEXT NOT NULL, ceiling_microusd INTEGER NOT NULL, admitted_at TEXT NOT NULL, month TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS hosted_work_admissions_person ON hosted_work_admissions(person_key);`);
    this.#spend = new DatabaseSync(spendDatabasePath, { readOnly: true, timeout: 5000 });
  }
  close() { this.#db.close(); this.#spend.close(); }
  static personKey(clientId: string, ownerScope: string) { return JSON.stringify([clientId, ownerScope]); }
  /**
   * Metered exposure attributed to this UTC month by EXPOSURE time, not creation time: an operation counts in every month its exposure
   * touches. Settled operations count their actual from creation to settlement; reserved, dispatched and UNKNOWN reservations count in
   * every month from their creation onward until they resolve (a reservation made before midnight and dispatched after counts in the new
   * month). Conservative by design: an operation spanning midnight counts in both months. Subscription operation units never count.
   */
  recordedMonthMicrousd(): number {
    const { start, end } = monthWindow(this.#now());
    const row = this.#spend.prepare(`SELECT COALESCE(SUM(CASE WHEN state = 'settled' THEN COALESCE(actual_microusd, reserved_microusd)
        WHEN state IN ('reserved','dispatched','unknown') THEN reserved_microusd ELSE 0 END), 0) AS total
      FROM work_spend_operations WHERE created_at < ? AND (state IN ('reserved','dispatched','unknown') OR updated_at >= ?)
        AND (pricing_revision IS NULL OR pricing_revision != ?)`)
      .get(end, start, OWNER_SUBSCRIPTION_PRICING_REVISION) as { total: number | bigint };
    return Number(row.total);
  }
  /** At the paid boundary (the reservation is already recorded): the current month, including it, must still be within budget. */
  assertDispatchWithinMonth() {
    if (this.recordedMonthMicrousd() > this.limits.monthlyBudgetMicrousd) refuse('HOSTED_MONTHLY_BUDGET');
  }
  worksAdmitted(clientId: string, ownerScope: string): number {
    return Number((this.#db.prepare('SELECT COUNT(*) AS n FROM hosted_work_admissions WHERE person_key = ?')
      .get(HostedSpendGuard.personKey(clientId, ownerScope)) as { n: number | bigint }).n);
  }
  /**
   * Admission before any Work order or budget exists. A replay of an admitted Work (same workId and person) is not counted again.
   * An admission is durable once recorded, even if a later preparation step fails: slots are never given back automatically.
   */
  admit(input: { clientId: string; ownerScope: string; workId: string; ceilingMicrousd: number }): 'ADMITTED' | 'REPLAY' {
    const { clientId, ownerScope, workId, ceilingMicrousd } = input;
    if (typeof clientId !== 'string' || !clientId || typeof ownerScope !== 'string' || !ownerScope || typeof workId !== 'string' || !workId) refuse('HOSTED_PERSON_REQUIRED');
    if (!Number.isSafeInteger(ceilingMicrousd) || ceilingMicrousd < 1 || ceilingMicrousd > this.limits.maxWorkMicrousd) refuse('HOSTED_WORK_CEILING');
    const person = HostedSpendGuard.personKey(clientId, ownerScope);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.#db.prepare('SELECT person_key, ceiling_microusd FROM hosted_work_admissions WHERE work_id = ?').get(workId) as { person_key: string; ceiling_microusd: number } | undefined;
      if (prior) {
        if (prior.person_key !== person || prior.ceiling_microusd !== ceilingMicrousd) refuse('HOSTED_WORK_BINDING_CONFLICT');
        this.#db.exec('COMMIT'); return 'REPLAY';
      }
      if (this.worksAdmitted(clientId, ownerScope) >= this.limits.maxWorksPerPerson) refuse('HOSTED_PERSON_WORK_LIMIT');
      if (this.recordedMonthMicrousd() + ceilingMicrousd > this.limits.monthlyBudgetMicrousd) refuse('HOSTED_MONTHLY_BUDGET');
      const now = this.#now();
      this.#db.prepare('INSERT INTO hosted_work_admissions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(workId, person, clientId, ownerScope, ceilingMicrousd, now.toISOString(), monthWindow(now).month);
      this.#db.exec('COMMIT'); return 'ADMITTED';
    } catch (error) { try { this.#db.exec('ROLLBACK'); } catch { /* already closed */ } throw error; }
  }
  /** Before every paid reservation (synchronously ahead of the ledger write): the month total including it must stay within budget. */
  assertReservation(reservedMicrousd: number) {
    if (!Number.isSafeInteger(reservedMicrousd) || reservedMicrousd < 1) refuse('HOSTED_RESERVATION_INVALID');
    if (this.recordedMonthMicrousd() + reservedMicrousd > this.limits.monthlyBudgetMicrousd) refuse('HOSTED_MONTHLY_BUDGET');
  }
  /** The ledger handed to metered spend gateways: identical except that `reserve` first passes the monthly guard. */
  wrapLedger<L extends GatewayLedger>(ledger: L): GatewayLedger {
    return {
      read: (...a) => ledger.read(...a),
      // Rechecked at dispatch so an admission or reservation straddling midnight is judged against the month the exposure lands in.
      markDispatched: (...a) => { this.assertDispatchWithinMonth(); return ledger.markDispatched(...a); }, settle: (...a) => ledger.settle(...a),
      markUnknown: (...a) => ledger.markUnknown(...a), releaseUndispatched: (...a) => ledger.releaseUndispatched(...a),
      assertCompletionEligible: (...a) => ledger.assertCompletionEligible(...a),
      reserve: (input: SpendReservation) => {
        if (input?.pricingRevision === OWNER_SUBSCRIPTION_PRICING_REVISION) refuse('HOSTED_SUBSCRIPTION_REVISION_REFUSED');
        this.assertReservation(input.reservedMicrousd); return ledger.reserve(input);
      },
    };
  }
}
