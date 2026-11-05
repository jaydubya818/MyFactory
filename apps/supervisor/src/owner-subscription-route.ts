import { randomBytes, randomUUID } from 'node:crypto';
import { assertTrustedExecutablePath } from './executable-trust.ts';
import { killOwnOrphan, lockFree, watchdogFor, OWNER_SUBSCRIPTION_LOCK_DIRECTORY, WATCHDOG_DEADLINE, WATCHDOG_REFUSED_LOCKED } from './owner-subscription-watchdog.ts';
import { isModelReference } from '../../../packages/contracts/src/model-reference.ts';
import { OWNER_SUBSCRIPTION_ROUTE, ownerSubscriptionExecutorVersion } from '../../../packages/contracts/src/owner-subscription-route.ts';
import { preflightOwnerLoginCodex, type CodexAdapter, type CodexPreflight, type CodexRunOptions, type CodexRunResult } from '../../../packages/agents/src/index.ts';
import { OWNER_SUBSCRIPTION_PRICING_REVISION, type SpendBinding, type SpendPhase, type SpendPlan } from '../../../packages/storage/src/spend-policy.ts';
import type { SpendLedger } from '../../../packages/storage/src/spend.ts';
import { ActionError } from './actions.ts';
import type { FactoryClient } from './connections.ts';

export { OWNER_SUBSCRIPTION_ROUTE, OWNER_SUBSCRIPTION_PRICING_REVISION };

/**
 * Host-only OWNER_SUBSCRIPTION_LOCAL execution route (Jay's explicit approval for the local private-beta rehearsal).
 *
 * Productive and completion Codex processes run with the operator's EXISTING authenticated Codex CLI (ChatGPT) login, with no
 * network gateway or provider credential. The existing Work ledger still admits every operation: one Codex process is one
 * ledger operation (reserve -> markDispatched -> process -> SUBSCRIPTION_UNMETERED), under the same single-use dispatch claim,
 * UNKNOWN fencing (a crash or unresolved process leaves the operation UNKNOWN and fences the Work), cancellation and ordered
 * revocation (`authorizeDispatch` before every ledger/process boundary). Each issued lease admits exactly one process.
 * Strict ceilings: at most two productive operations plus the one protected completion per Work; one subscription process at a
 * time on this MACHINE (an exclusive lock file under a fixed owner-only directory, shared by every host instance); and a hard
 * wall-clock cap per Work (`maxWorkSeconds` <= 600) from dispatch acceptance, whose expiry aborts the running Codex process group,
 * leaves its operation UNKNOWN, cancels the Work budget and stops the run like an owner stop. The route is selected only by trusted host configuration (never HTTP, request fields or environment), must
 * be bound to exact 127.0.0.1, serves exactly one owner client scope and requires an explicit `ownerOnly: true` acknowledgement.
 * Hosted/cloud surfaces refuse its markers. Usage is never priced: readers surface SUBSCRIPTION_UNMETERED, never $0.
 */
export interface OwnerSubscriptionRoute {
  mode: typeof OWNER_SUBSCRIPTION_ROUTE;
  ownerOnly: true;
  bindHost: '127.0.0.1';
  ownerScope: string;
  clientId: string;
  model: string;
  /** Approval expiry of this route; budgets refuse to admit after it. At most 30 days ahead. */
  validUntil: string;
  /** Productive Codex processes per Work (1 or 2; strict LOCAL_V4 keeps one feedback round). Completion is always exactly 1. */
  maxProductiveOperations: 1 | 2;
  maxConcurrentRuns: 1;
  /** Hard wall-clock limit per Work from dispatch acceptance (1..600 seconds). */
  maxWorkSeconds: number;
}
export class OwnerSubscriptionRefused extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
const refuse = (code: string): never => { throw new OwnerSubscriptionRefused(code); };
const ROUTE_KEYS = ['mode', 'ownerOnly', 'bindHost', 'ownerScope', 'clientId', 'model', 'validUntil', 'maxProductiveOperations', 'maxConcurrentRuns', 'maxWorkSeconds'];
/** `owner:<name>` or exactly one lowercase owner principal UUID (MyEve's owner id). No wildcard, no mapping. */
const OWNER_SCOPE = /^(?:owner:[A-Za-z0-9:_.-]{1,122}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Strict parse: unknown or missing fields, a non-owner scope, a non-loopback bind or a missing acknowledgement refuse. */
export function parseOwnerSubscriptionRoute(raw: unknown, now = Date.now()): OwnerSubscriptionRoute {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse('SUBSCRIPTION_ROUTE_SHAPE');
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).sort().join(',') !== [...ROUTE_KEYS].sort().join(',')) refuse('SUBSCRIPTION_ROUTE_SHAPE');
  if (r.mode !== OWNER_SUBSCRIPTION_ROUTE) refuse('SUBSCRIPTION_ROUTE_MODE');
  if (r.ownerOnly !== true) refuse('SUBSCRIPTION_ROUTE_OWNER_ACK');
  if (r.bindHost !== '127.0.0.1') refuse('SUBSCRIPTION_ROUTE_LOOPBACK');
  if (typeof r.ownerScope !== 'string' || !OWNER_SCOPE.test(r.ownerScope)) refuse('SUBSCRIPTION_ROUTE_OWNER_SCOPE');
  if (typeof r.clientId !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(r.clientId)) refuse('SUBSCRIPTION_ROUTE_CLIENT');
  if (!isModelReference(r.model)) refuse('SUBSCRIPTION_ROUTE_MODEL');
  const until = typeof r.validUntil === 'string' ? Date.parse(r.validUntil) : NaN;
  if (!Number.isFinite(until) || until <= now || until > now + 30 * 86400_000) refuse('SUBSCRIPTION_ROUTE_EXPIRY');
  if (r.maxProductiveOperations !== 1 && r.maxProductiveOperations !== 2) refuse('SUBSCRIPTION_ROUTE_OPERATIONS');
  if (r.maxConcurrentRuns !== 1) refuse('SUBSCRIPTION_ROUTE_CONCURRENCY');
  if (!Number.isSafeInteger(r.maxWorkSeconds) || (r.maxWorkSeconds as number) < 1 || (r.maxWorkSeconds as number) > 600) refuse('SUBSCRIPTION_ROUTE_WORK_SECONDS');
  return { mode: OWNER_SUBSCRIPTION_ROUTE, ownerOnly: true, bindHost: '127.0.0.1', ownerScope: r.ownerScope as string,
    clientId: r.clientId as string, model: r.model as string, validUntil: r.validUntil as string,
    maxProductiveOperations: r.maxProductiveOperations as 1 | 2, maxConcurrentRuns: 1, maxWorkSeconds: r.maxWorkSeconds as number };
}

/** The exact prepare-time spend contract MyEve sends for this route (operation units, not money). */
export function subscriptionSpendContract(route: OwnerSubscriptionRoute, plannedProductiveOperations: number = route.maxProductiveOperations) {
  return { version: 'WORK_LEDGER_V2' as const, pricingRevision: OWNER_SUBSCRIPTION_PRICING_REVISION, plannedProductiveOperations,
    plannedCompletionOperations: 1, maxPaidOperations: plannedProductiveOperations + 1, completionReserveMicrousd: 1 };
}

/** True only when the pinned executable reports the operator's ChatGPT login (allowlisted environment for every child). */
export async function ownerLoginStatus(executablePath: string): Promise<boolean> {
  try { return (await preflightOwnerLoginCodex(executablePath)).authenticated; } catch { return false; }
}

export { OWNER_SUBSCRIPTION_LOCK_DIRECTORY };
const monotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);
interface WorkClock { controller: AbortController; expired: string | null; retired: boolean; deadlineMono: number; timer: ReturnType<typeof setTimeout>;
  onExpire: (reason: string) => void; isTerminal: () => boolean }
interface Lease { binding: SpendBinding; phase: SpendPhase; used: boolean; authorizeDispatch: () => void;
  onDecision: (evidence: Record<string, unknown>) => void }
export const SUBSCRIPTION_BASE_URL = 'owner-subscription://local';

export class OwnerSubscriptionOperations {
  readonly route: OwnerSubscriptionRoute;
  readonly #ledger: SpendLedger;
  readonly #adapter: CodexAdapter;
  readonly #executable: string;
  readonly #leases = new Map<string, Lease>();
  readonly #works = new Map<string, WorkClock>();
  readonly #lockDirectory: string;
  readonly #preflight: () => Promise<CodexPreflight>;
  readonly #owner: string;
  #active = 0;
  #disabled: string | null = null;
  /** `seams` are test-only (never reachable from host configuration): the default lock directory is fixed. */
  constructor(route: OwnerSubscriptionRoute, ledger: SpendLedger, adapter: CodexAdapter, executablePath: string,
    stateDirectory: string, seams: { lockDirectory?: string; preflight?: () => Promise<CodexPreflight> } = {}) {
    this.route = parseOwnerSubscriptionRoute(route);
    if (typeof executablePath !== 'string' || !executablePath.startsWith('/')) throw new OwnerSubscriptionRefused('SUBSCRIPTION_ROUTE_EXECUTABLE');
    if (typeof stateDirectory !== 'string' || !stateDirectory.startsWith('/')) throw new OwnerSubscriptionRefused('SUBSCRIPTION_ROUTE_STATE');
    assertTrustedExecutablePath(executablePath);   // direct composition is checked too, not only the launcher
    this.#owner = stateDirectory;
    this.#ledger = ledger; this.#adapter = adapter; this.#executable = executablePath;
    this.#lockDirectory = seams.lockDirectory ?? OWNER_SUBSCRIPTION_LOCK_DIRECTORY;
    this.#preflight = seams.preflight ?? (() => preflightOwnerLoginCodex(this.#executable));
    Object.freeze(this.route);
  }
  /** Permanently disables the route in this process (e.g. a non-loopback listener). Nothing further is admitted. */
  disable(reason: string) { this.#disabled ??= reason; this.#leases.clear(); for (const id of [...this.#works.keys()]) this.expireWork(id, 'ROUTE_DISABLED'); }
  get lockDirectory() { return this.#lockDirectory; }
  /** Startup recovery, before the host listens: kill this host's own orphaned watchdog/Codex group (never another host's). */
  recoverOrphans() {
    const outcome = killOwnOrphan(this.#lockDirectory, this.#owner);
    // When the holder's identity cannot be proven nothing is signalled; this host refuses new work instead (fail closed).
    if (outcome.status === 'UNVERIFIED') this.disable('unverified execution lock holder');
    return outcome;
  }
  /**
   * Starts the Work's wall-clock cap when execution ACCEPTED the dispatch claim (idempotent, never reset). The same absolute deadline
   * is handed to the watchdog, which enforces it even if this supervisor dies. Expiry of a non-terminal Work aborts the running process
   * group, revokes the Work's leases and calls `onExpire`; for a terminal Work it only retires the clock.
   */
  startWork(workId: string, hooks: { onExpire: (reason: string) => void; isTerminal: () => boolean; requestDeadline?: string }) {
    const existing = this.#works.get(workId);
    if (existing) { if (existing.expired || existing.retired) throw new ActionError('Owner subscription Work time limit reached', 'dispatch_denied', 409); return; }
    // Allowance = min(maxWorkSeconds, the authorized request deadline). The wall clock is read exactly once, here; the result is a
    // monotonic deadline and every later operation (and its watchdog) receives only the remaining monotonic time.
    const cap = this.route.maxWorkSeconds * 1000;
    const requestLeft = hooks.requestDeadline === undefined ? cap : Date.parse(hooks.requestDeadline) - Date.now();
    const allowance = Math.max(0, Math.min(cap, Number.isFinite(requestLeft) ? requestLeft : 0));
    const clock: WorkClock = { controller: new AbortController(), expired: null, retired: false, deadlineMono: monotonicMs() + allowance,
      onExpire: hooks.onExpire, isTerminal: hooks.isTerminal,
      timer: setTimeout(() => this.expireWork(workId, 'WORK_TIME_LIMIT'), allowance) };
    clock.timer.unref?.();
    this.#works.set(workId, clock);
  }
  /** Terminal Work: the timer is retired and can never cancel or stop it afterwards. */
  retireWork(workId: string) {
    const clock = this.#works.get(workId);
    if (!clock || clock.expired || clock.retired) return;
    clock.retired = true; clearTimeout(clock.timer);
    for (const [token, lease] of this.#leases) if (lease.binding.workId === workId) this.#leases.delete(token);
  }
  workDeadline(workId: string) { return this.#works.get(workId)?.deadlineMono ?? null; }
  workRemainingMs(workId: string) { const c = this.#works.get(workId); return c ? Math.max(0, Math.floor(c.deadlineMono - monotonicMs())) : null; }
  expireWork(workId: string, reason: string) {
    const clock = this.#works.get(workId);
    if (!clock || clock.expired || clock.retired) return;
    let terminal = false; try { terminal = clock.isTerminal(); } catch { terminal = false; }
    if (terminal) { this.retireWork(workId); return; }
    clock.expired = reason; clearTimeout(clock.timer); clock.controller.abort();
    for (const [token, lease] of this.#leases) if (lease.binding.workId === workId) this.#leases.delete(token);
    try { clock.onExpire(reason); } catch { /* the ledger fence below the process already holds */ }
  }
  workExpired(workId: string) { return this.#works.get(workId)?.expired ?? null; }
  workRetired(workId: string) { return this.#works.get(workId)?.retired ?? false; }
  get disabled() { return this.#disabled; }
  availability() {
    return { mode: OWNER_SUBSCRIPTION_ROUTE, spendEnforced: true, metering: 'SUBSCRIPTION_UNMETERED', ownerOnly: true,
      reason: this.#disabled ? 'Owner subscription route disabled: ' + this.#disabled
        : 'Owner-only local route: the operator\'s Codex login; every operation admitted by the Work ledger and recorded SUBSCRIPTION_UNMETERED (never $0)',
      limits: { maxProductiveOperations: this.route.maxProductiveOperations, plannedCompletionOperations: 1,
        maxOperationsPerWork: this.route.maxProductiveOperations + 1, maxConcurrentRuns: 1,
        concurrencyScope: 'MACHINE', maxWorkSeconds: this.route.maxWorkSeconds },
      owner: { clientId: this.route.clientId, ownerScope: this.route.ownerScope }, bindHost: this.route.bindHost,
      spendContract: subscriptionSpendContract(this.route), validUntil: this.route.validUntil, enabled: !this.#disabled };
  }
  /** Exactly the configured owner client and scope. Proof readers, testers and every other connection are refused. */
  assertOwner(client: FactoryClient) {
    if (this.#disabled) throw new ActionError('Owner subscription route is disabled', 'spend_unqualified', 503);
    if (client.id !== this.route.clientId || client.ownerScope !== this.route.ownerScope || client.purpose !== undefined)
      throw new ActionError('Owner subscription route is owner-only', 'forbidden', 403);
  }
  /** Operations-only plan for an exact prepare request; anything else refuses before a budget exists. */
  plan(contract: unknown): { plan: SpendPlan; ceiling: number } {
    const c = contract as Record<string, unknown> | undefined;
    const planned = c?.plannedProductiveOperations;
    if (!c || typeof planned !== 'number' || !Number.isSafeInteger(planned) || planned < 1 || planned > this.route.maxProductiveOperations ||
        JSON.stringify(Object.entries(c).sort()) !== JSON.stringify(Object.entries(subscriptionSpendContract(this.route, planned)).sort()))
      throw new ActionError('Exact owner-subscription operations plan required', 'spend_unqualified', 409);
    if (Date.parse(this.route.validUntil) <= Date.now()) throw new ActionError('Owner subscription route approval expired', 'spend_unqualified', 409);
    return { ceiling: planned + 1, plan: { version: 'WORK_LEDGER_V2', pricingRevision: OWNER_SUBSCRIPTION_PRICING_REVISION, model: this.route.model,
      validUntil: this.route.validUntil, perOperationReserveMicrousd: 1, plannedProductiveOperations: planned,
      plannedCompletionOperations: 1, maxPaidOperations: planned + 1, completionReserveMicrousd: 1 } };
  }
  /** One single-use lease = one Codex process. The token is a local lookup key only; it is never a network credential. */
  issue(binding: SpendBinding, phase: SpendPhase, authorizeDispatch: () => void, onDecision: Lease['onDecision']) {
    if (this.#disabled) throw new ActionError('Owner subscription route is disabled', 'spend_unqualified', 503);
    const clock = this.#works.get(binding.workId);
    if (clock && (clock.expired || clock.retired)) throw new ActionError('Owner subscription Work clock is not running', 'dispatch_denied', 409);
    const childToken = randomBytes(32).toString('hex');
    this.#leases.set(childToken, { binding: { ...binding }, phase, used: false, authorizeDispatch, onDecision });
    return { baseUrl: SUBSCRIPTION_BASE_URL, childToken };
  }
  revoke(childToken: string | undefined) { if (childToken) this.#leases.delete(childToken); }

  /** Preflight requires the ChatGPT login (an API-key login refuses) and binds the route into the executor version. */
  preflightCodex = async (): Promise<CodexPreflight> => {
    assertTrustedExecutablePath(this.#executable);   // every execution entry, including preparation and dispatch preflights
    const base = await this.#preflight();
    if (!base.binaryAvailable || !base.version || !/^codex-cli \S+$/.test(base.version)) return { ...base, authenticated: false };
    return { ...base, version: ownerSubscriptionExecutorVersion(base.version), authenticated: base.authenticated,
      error: base.authenticated ? base.error : base.error ?? 'Owner ChatGPT Codex login required' };
  };

  /** Worker for both phases. Admission happens here, before the process exists; the outcome is recorded after it ends. */
  runCodex = async (options: CodexRunOptions): Promise<CodexRunResult> => {
    if (this.#disabled) throw new Error('Owner subscription route is disabled');
    const token = options?.gateway?.childToken, lease = token ? this.#leases.get(token) : undefined;
    if (!lease || options.gateway?.baseUrl !== SUBSCRIPTION_BASE_URL) throw new Error('Owner subscription lease required');
    if (lease.used) throw new Error('Owner subscription lease is single-use');
    if ((lease.phase === 'completion') !== (options.sandbox === 'read-only')) throw new Error('Owner subscription phase mismatch');
    const clock = this.#works.get(lease.binding.workId);
    if (!clock || clock.expired || clock.retired || monotonicMs() >= clock.deadlineMono) throw new Error('Owner subscription Work time limit reached');
    if (this.#active >= this.route.maxConcurrentRuns) throw new Error('Owner subscription concurrency limit reached');
    // Every execution entry re-checks trust; the machine-wide kernel lock is probed before any ledger exposure (the watchdog
    // takes it for real; a race lost after dispatch is recorded UNKNOWN, never retried).
    assertTrustedExecutablePath(this.#executable);
    const watchdog = watchdogFor(this.#lockDirectory);
    if (!lockFree(this.#lockDirectory)) throw new Error('Owner subscription machine-wide concurrency limit reached');
    lease.used = true; this.#active += 1;
    let operationId: string | null = null, dispatched = false;
    const decision = (code: string, extra: Record<string, unknown> = {}) => {
      try { lease.onDecision({ code, stage: lease.phase, status: 0, upstreamStatus: null, operationId, elapsedMs: 0, retryable: false, route: OWNER_SUBSCRIPTION_ROUTE, ...extra }); } catch { /* evidence only */ }
    };
    try {
      lease.authorizeDispatch();
      const id = randomUUID();
      this.#ledger.reserve({ ...lease.binding, operationId: id, model: this.route.model, pricingRevision: OWNER_SUBSCRIPTION_PRICING_REVISION,
        reservedMicrousd: 1, phase: lease.phase });
      operationId = id;
      lease.authorizeDispatch();
      this.#ledger.markDispatched(id);
      dispatched = true;
      lease.authorizeDispatch();   // already dispatched: a denial here keeps the operation fenced UNKNOWN, never resent
    } catch (error) {
      if (operationId && !dispatched) { try { this.#ledger.releaseUndispatched(operationId); } catch { try { this.#ledger.markUnknown(operationId); } catch {} } }
      else if (operationId) { try { this.#ledger.markUnknown(operationId); } catch {} }
      this.#active -= 1; this.revoke(token);
      decision('LOCAL_ADMISSION_DENIED');
      throw error;
    }
    const { gateway: _gateway, boundedProductiveContext: _bounded, productiveEndSignal: _end, sessionHome: _home, ...plain } = options;
    let result: CodexRunResult | undefined;
    try {
      result = await this.#adapter.runCodex({ ...plain, ownerLogin: true,
        ownerLoginWatchdog: { ...watchdog, owner: this.#owner, remainingMs: Math.max(0, Math.floor(clock.deadlineMono - monotonicMs())), deadlineMonoMs: clock.deadlineMono, nonce: randomUUID() },
        signal: plain.signal ? AbortSignal.any([plain.signal, clock.controller.signal]) : clock.controller.signal });
      return result;
    } finally {
      this.#active -= 1; this.revoke(token);
      // A process that ended on its own is recorded unmetered. A timeout, abort or adapter exception is unresolved: UNKNOWN + fence.
      const outcome = result?.status ?? null;
      // A watchdog refusal (lock race, exit 75) or deadline kill (124), or any end at/after the deadline, is unresolved too.
      const watchdogEnded = result && (result.exitCode === WATCHDOG_REFUSED_LOCKED || result.exitCode === WATCHDOG_DEADLINE ||
        result.exitSignal !== null || (result.exitCode !== null && result.exitCode >= 128) || monotonicMs() >= clock.deadlineMono);
      if (result && !watchdogEnded && ['completed', 'failed', 'yielded'].includes(result.status)) {
        try { this.#ledger.settleSubscriptionUnmetered(operationId!, { outcome: result.status, threadId: result.threadId }); decision('SUBSCRIPTION_UNMETERED', { outcome }); }
        catch (error) { try { this.#ledger.markUnknown(operationId!); } catch {} decision('PROVIDER_OUTCOME_UNKNOWN', { outcome, recordError: String((error as Error)?.message ?? error).slice(0, 200) }); }
      } else { try { this.#ledger.markUnknown(operationId!); } catch {} decision('PROVIDER_OUTCOME_UNKNOWN', { outcome, ...(clock.expired ? { expired: clock.expired } : {}) }); }
    }
  };
}
