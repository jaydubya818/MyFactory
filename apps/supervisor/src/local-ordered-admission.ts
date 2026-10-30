import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { canonical, digest } from '../../../packages/hosted-routing/src/result.ts';
import {
  admissionActionDigest, policyMessageHash, signPolicyMessage, verifyPolicyMessage,
  type PolicyKey, type SignedPolicyMessage,
} from '../../../packages/capability-enforcement/src/ordering-wire.ts';
import { signFactoryPreparationTerminal } from '../../../packages/capability-enforcement/src/factory-preparation-terminal.ts';
import { ActionError } from './actions.ts';
import { issueOrderedAuthority, type OrderedAuthority } from './capability-admission.ts';
import type { FactoryClient } from './connections.ts';
import type { FactoryDispatchControl, PrepareRequest } from './dispatch-control.ts';
import type { FactoryStorage } from '../../../packages/storage/src/index.ts';

/**
 * Local ordered capability-admission receiver for the V4 local Factory (topology B).
 *
 * It serves the same wire contract as the hosted `OrderedFactoryAdmission`
 * (`/api/capability-admission/{challenge,prepare,readback,fence}`), for a LOCAL_V4 supervisor:
 *   - challenge: a signed CHALLENGE bound to the exact request, Work, mission, budget and Factory snapshot;
 *   - prepare: verifies the MyEve + Relay PERMIT pair against the latest enrolled fences, durably consumes both
 *     references (single use per Work generation) BEFORE any native effect, then runs the existing native
 *     preparation under receiver authority (budget created by the existing SpendLedger path), and records the outcome;
 *   - readback: the PREPARED readback only for an ADMITTED outcome; otherwise a signed terminal; never a new pair;
 *   - fence: signed policy fences (pause/revoke) with signed acknowledgements.
 * Receiver state is a hash-chained log whose head is advanced in an independent witness before every apply, so a
 * restored/rolled-back database is detected and fails closed. Native dispatch single-use, budget enforcement and
 * the proof/Result machinery are the existing ones; this module adds no execution, spend or custody authority.
 * Enrollment is host-supplied only (never HTTP or environment).
 */
export type ReceiverScope = { ownerId: string; organizationId: string; installationId: string; backendId: string; incarnation: string; enrollmentVersion: number };
const scopeKeys = ['ownerId', 'organizationId', 'installationId', 'backendId', 'incarnation', 'enrollmentVersion'] as const;
export type LocalOrderedEnrollment = {
  scope: ReceiverScope; agentId: string; registryVersion: string;
  /** Connection (connections.json id) the native preparation is made under; also the only HTTP caller admitted. */
  clientId: string;
  sourceKeys: { myeve: PolicyKey; relay: PolicyKey };
  /** Receiver signing key (challenge, fence acknowledgement and terminal envelopes); the client pins its public half. */
  signer: PolicyKey;
  /** Exact Factory identity MyEve binds; verified against the prepared native snapshot. */
  factory: { factoryId: string; factoryVersion: string; sourceDigest: string; configurationDigest: string };
};
export type ReceiverHead = { seq: number; digest: string };
export interface ReceiverWitness {
  read(): ReceiverHead | null;
  /** Compare-and-swap: succeeds only if the witness is exactly `prev` (null witness == genesis). */
  advance(prev: ReceiverHead, next: ReceiverHead): void;
}
const GENESIS: ReceiverHead = { seq: 0, digest: '0'.repeat(64) };
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const fail = (code: string, status = 503): never => { throw new ActionError(code, code.toLowerCase(), status); };

/** Durable witness outside the receiver database directory (provisioned by the host, e.g. a separate volume). */
export class FileReceiverWitness implements ReceiverWitness {
  private readonly path: string;
  private readonly epoch: string;
  constructor(path: string, epoch: string) {
    this.path = path; this.epoch = epoch;
    if (!isAbsolute(path) || !epoch.trim()) throw new Error('Receiver witness needs an absolute path and epoch');
  }
  read(): ReceiverHead | null {
    if (!existsSync(this.path)) return null;
    const row = JSON.parse(readFileSync(this.path, 'utf8'));
    if (row?.epoch !== this.epoch || !Number.isSafeInteger(row.seq) || !/^[a-f0-9]{64}$/.test(row.digest)) fail('FACTORY_RECEIVER_RESTORED');
    return { seq: row.seq, digest: row.digest };
  }
  advance(prev: ReceiverHead, next: ReceiverHead) {
    const current = this.read() ?? GENESIS;
    if (!same(current, prev) || next.seq <= prev.seq) fail('FACTORY_RECEIVER_RESTORED');
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = this.path + '.' + randomUUID() + '.tmp', fd = openSync(temp, 'wx', 0o600);
    try { writeSync(fd, JSON.stringify({ epoch: this.epoch, ...next })); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path);
  }
}

type Rec = { kind: string; key: string; payload: unknown };
type Stored = Rec & { seq: number; digest: string };
const link = (prev: string, rec: Rec) => createHash('sha256').update(prev + canonical({ kind: rec.kind, key: rec.key, payload: rec.payload })).digest('hex');

class ReceiverLog {
  readonly db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS receiver_records(seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, UNIQUE(kind,key));
      CREATE TABLE IF NOT EXISTS receiver_pending(id INTEGER PRIMARY KEY CHECK(id=1), prev TEXT NOT NULL, next TEXT NOT NULL, records TEXT NOT NULL);`);
  }
  rows(): Stored[] { return (this.db.prepare('SELECT seq,kind,key,payload,digest FROM receiver_records ORDER BY seq').all() as any[]).map(r => ({ ...r, payload: JSON.parse(r.payload) })); }
  head(): ReceiverHead {
    let prev = GENESIS.digest, seq = 0;
    for (const r of this.rows()) {
      if (r.seq !== seq + 1 || r.digest !== link(prev, r)) fail('FACTORY_RECEIVER_CORRUPT');
      prev = r.digest; seq = r.seq;
    }
    return { seq, digest: prev };
  }
  pending(): { prev: ReceiverHead; next: ReceiverHead; records: Rec[] } | null {
    const row = this.db.prepare('SELECT prev,next,records FROM receiver_pending WHERE id=1').get() as any;
    return row ? { prev: JSON.parse(row.prev), next: JSON.parse(row.next), records: JSON.parse(row.records) } : null;
  }
  plan(head: ReceiverHead, records: Rec[]): { prev: ReceiverHead; next: ReceiverHead; records: Rec[] } {
    let d = head.digest;
    for (const r of records) d = link(d, r);
    return { prev: head, next: { seq: head.seq + records.length, digest: d }, records };
  }
  savePending(plan: { prev: ReceiverHead; next: ReceiverHead; records: Rec[] }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.pending()) fail('FACTORY_RECEIVER_PENDING');
      this.db.prepare('INSERT INTO receiver_pending(id,prev,next,records) VALUES(1,?,?,?)').run(JSON.stringify(plan.prev), JSON.stringify(plan.next), JSON.stringify(plan.records));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  apply(plan: { prev: ReceiverHead; next: ReceiverHead; records: Rec[] }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.head();
      if (!same(current, plan.prev)) fail('FACTORY_RECEIVER_HEAD_CHANGED');
      let d = current.digest, seq = current.seq;
      const insert = this.db.prepare('INSERT INTO receiver_records(seq,kind,key,payload,digest) VALUES(?,?,?,?,?)');
      for (const r of plan.records) { d = link(d, r); seq++; insert.run(seq, r.kind, r.key, JSON.stringify(r.payload), d); }
      if (!same({ seq, digest: d }, plan.next)) fail('FACTORY_RECEIVER_CORRUPT');
      this.db.exec('DELETE FROM receiver_pending WHERE id=1');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private closed = false;
  close() { if (this.closed) return; this.closed = true; this.db.close(); }
}

type State = { head: ReceiverHead; rows: Stored[] };
const ofKind = (state: State, kind: string) => state.rows.filter(r => r.kind === kind);

export type LocalOrderedOptions = {
  enrollment: LocalOrderedEnrollment; witness: ReceiverWitness;
  /** Absolute path of the receiver database; must not be inside the witness location. */
  databasePath: string;
  control: FactoryDispatchControl; storage: FactoryStorage;
  /** Current connection for enrollment.clientId (re-read each call; revoked/expired connections fail). */
  client(): FactoryClient;
  now?: () => number;
};

export class LocalOrderedAdmission {
  readonly authority: OrderedAuthority = issueOrderedAuthority();
  private readonly log: ReceiverLog;
  private readonly enrollment: LocalOrderedEnrollment;
  private readonly inflight = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly o: LocalOrderedOptions;
  constructor(o: LocalOrderedOptions) {
    this.o = o;
    const e = o.enrollment;
    if (!e?.scope || scopeKeys.some(k => e.scope[k] === undefined || e.scope[k] === '') || !e.agentId || !e.registryVersion || !e.clientId
      || !e.sourceKeys?.myeve || !e.sourceKeys?.relay || !e.signer || !e.factory?.factoryId
      || ![e.factory.factoryVersion, e.factory.sourceDigest, e.factory.configurationDigest].every(v => /^[a-f0-9]{64}$/.test(v))
      || !isAbsolute(o.databasePath)) throw new Error('FACTORY_RECEIVER_ENROLLMENT');
    this.enrollment = Object.freeze(structuredClone(e));
    this.now = o.now ?? Date.now;
    this.log = new ReceiverLog(o.databasePath);
    // From now on ordinary preparation is refused and dispatch requires an ADMITTED ordered outcome.
    o.control.requireOrderedAdmission({ authority: this.authority, assertDispatch: id => this.assertDispatch(id) });
  }
  close() { this.log.close(); }
  /** Enrolled caller identity for the HTTP route. */
  get clientId() { return this.enrollment.clientId; }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  /** Reads state and proves the database is the exact witnessed one; rolls forward a persisted plan after a crash. */
  private state(): State {
    let head = this.log.head();
    const witness = this.o.witness.read() ?? GENESIS, pending = this.log.pending();
    if (pending) {
      if (!same(pending.prev, head)) fail('FACTORY_RECEIVER_RESTORED');
      if (same(witness, pending.prev)) this.o.witness.advance(pending.prev, pending.next);
      else if (!same(witness, pending.next)) fail('FACTORY_RECEIVER_RESTORED');
      this.log.apply(pending); head = this.log.head();
    } else if (!same(witness, head)) fail('FACTORY_RECEIVER_RESTORED');
    return { head, rows: this.log.rows() };
  }
  private commit(records: Rec[]) {
    const state = this.state();
    if (!records.length) return state;
    const plan = this.log.plan(state.head, records);
    this.log.savePending(plan);
    this.o.witness.advance(plan.prev, plan.next);
    this.log.apply(plan);
    return this.state();
  }

  private latestFence(state: State, authority: 'myeve' | 'relay') {
    return ofKind(state, 'fence').map(r => r.payload as any).filter(p => p.message.authority === authority)
      .sort((a, b) => a.message.version - b.message.version).at(-1);
  }
  /** pause/revoke controls on the capabilities this Factory executes under; any one blocks new admission and dispatch. */
  private restricted(state: State): boolean {
    const fence = this.latestFence(state, 'myeve');
    if (!fence) return false;
    for (const row of ofKind(state, 'fence')) {
      const m = (row.payload as any).message;
      if (m.authority !== 'myeve') continue;
      const controls = [...(m.controls ?? []), ...(['pause', 'revoke'].includes(m.operation) ? [{ capabilityId: m.capabilityId, operation: m.operation }] : [])];
      if (controls.some((c: any) => ['work', 'myfactory'].includes(c.capabilityId) && ['pause', 'revoke'].includes(c.operation))) return true;
    }
    return false;
  }
  private assertScope(message: Record<string, unknown>) {
    if (scopeKeys.some(k => message[k] !== this.enrollment.scope[k])) fail('FACTORY_POLICY_SCOPE');
  }
  private snapshot() { return { ...this.enrollment.factory, backendId: this.enrollment.scope.backendId, incarnation: this.enrollment.scope.incarnation, enrollmentVersion: this.enrollment.scope.enrollmentVersion }; }
  private shape(input: any): PrepareRequest {
    if (!input || typeof input !== 'object' || typeof input.requestId !== 'string' || typeof input.workId !== 'string'
      || !Number.isSafeInteger(input.workGeneration) || input.workGeneration < 1 || !Number.isFinite(input.maxSpendUsd) || input.maxSpendUsd <= 0
      || input.maxSpendUsd > 20 || typeof input.input !== 'object' || input.input === null) fail('FACTORY_REQUEST_INVALID', 400);
    return input as PrepareRequest;
  }
  private action(request: PrepareRequest, missionId: string) {
    return admissionActionDigest({ workId: request.workId, missionId, generation: request.workGeneration, nativeSnapshot: this.snapshot(), args: request });
  }
  private mission(missionId: unknown): string {
    if (typeof missionId !== 'string' || !missionId.length || missionId.length > 255) fail('FACTORY_MISSION_BINDING', 400);
    return missionId as string;
  }

  challenge(input: unknown, missionId: unknown): Promise<SignedPolicyMessage> {
    const request = this.shape(input), mission = this.mission(missionId);
    return this.serial(async () => {
      const state = this.state(), fence = this.latestFence(state, 'myeve');
      if (!fence) fail('FACTORY_POLICY_UNAVAILABLE');
      if (this.restricted(state)) fail('FACTORY_POLICY_RESTRICTED');
      if (ofKind(state, 'plan').some(r => (r.payload as any).requestId === request.requestId)) fail('FACTORY_PROOF_CONSUMED', 409);
      const now = this.now(), identity = Object.fromEntries([...scopeKeys, 'authority', 'version', 'policyId'].map(k => [k, fence.message[k]]));
      return signPolicyMessage({ ...identity, kind: 'CHALLENGE', referenceId: randomUUID(), capabilityId: 'myfactory',
        registryVersion: this.enrollment.registryVersion, agentId: this.enrollment.agentId, workId: request.workId, missionId: mission,
        workGeneration: request.workGeneration, actionDigest: await this.action(request, mission),
        budgetMicros: Math.ceil(request.maxSpendUsd * 1_000_000), issuedAt: now, expiresAt: now + 30_000 } as any, this.enrollment.signer);
    });
  }

  private async pair(request: PrepareRequest, missionId: string, envelopes: any, state: State, now: number) {
    const action = await this.action(request, missionId), pair: Record<string, any> = {};
    if (!envelopes || Object.keys(envelopes).sort().join(',') !== 'myeve,relay') fail('FACTORY_POLICY_PAIR', 400);
    for (const authority of ['myeve', 'relay'] as const) {
      const message: any = await verifyPolicyMessage(envelopes[authority], this.enrollment.sourceKeys[authority]);
      this.assertScope(message);
      const fence = this.latestFence(state, authority);
      if (!fence || message.kind !== 'PERMIT' || message.authority !== authority || message.version !== fence.message.version
        || message.policyId !== fence.message.policyId || message.agentId !== this.enrollment.agentId || message.capabilityId !== 'myfactory'
        || !message.requiredCapabilities.includes('work') || message.registryVersion !== this.enrollment.registryVersion
        || message.workId !== request.workId || message.workGeneration !== request.workGeneration || message.missionId !== missionId
        || message.actionDigest !== action || message.budgetMicros !== Math.ceil(request.maxSpendUsd * 1_000_000)
        || message.issuedAt > now || message.expiresAt <= now) fail('FACTORY_POLICY_STALE_OR_FOREIGN', 403);
      if (ofKind(state, 'reference').some(r => (r.payload as any).workId === request.workId && (r.payload as any).workGeneration === request.workGeneration)) fail('FACTORY_PROOF_CONSUMED', 409);
      pair[authority] = message;
    }
    if (pair.relay.sourcePermitHash !== await policyMessageHash(pair.myeve)) fail('FACTORY_POLICY_PAIR', 403);
    return pair;
  }

  async prepare(input: unknown, missionId: unknown, envelopes: unknown) {
    const request = this.shape(input), mission = this.mission(missionId);
    try { return await this.terminal(request, mission); }
    catch (error) { if (!['FACTORY_TERMINAL_UNAVAILABLE'].includes((error as Error).message)) throw error; }
    const admitted = await this.serial(async () => {
      const state = this.state(), now = this.now();
      if (ofKind(state, 'plan').some(r => (r.payload as any).requestId === request.requestId)) return false;
      if (this.restricted(state)) fail('FACTORY_POLICY_RESTRICTED', 403);
      const pair = await this.pair(request, mission, envelopes, state, now);
      const identity = { requestId: request.requestId, workId: request.workId, workGeneration: request.workGeneration, missionId: mission,
        nativeRequestDigest: digest(request), clientId: this.enrollment.clientId, snapshot: this.snapshot() };
      // Both references and the plan are durable and witnessed BEFORE any native effect: a pair can never be replayed.
      this.commit([
        ...(['myeve', 'relay'] as const).map(a => ({ kind: 'reference', key: `${a}:${pair[a].referenceId}`,
          payload: { ...pair[a], clientId: identity.clientId, requestId: request.requestId, nativeRequestDigest: identity.nativeRequestDigest, envelope: (envelopes as any)[a] } })),
        { kind: 'plan', key: request.requestId, payload: identity }]);
      this.inflight.add(request.requestId);
      return true;
    });
    if (admitted) {
      try { await this.nativeAdmission(request); }
      finally { this.inflight.delete(request.requestId); }
    }
    return this.terminal(request, mission);
  }

  /** Native preparation under receiver authority, then a witnessed outcome record. Never retried. */
  private async nativeAdmission(request: PrepareRequest) {
    let outcome: Record<string, unknown>;
    try {
      const readback: any = await this.o.control.prepare(this.o.client(), request, this.authority);
      outcome = this.admittedOutcome(request, readback);
    } catch (error) {
      const intake = this.o.storage.getIntake('gateb:' + this.enrollment.clientId, request.requestId);
      outcome = !intake && error instanceof ActionError
        ? { outcome: 'DEFINITELY_NOT_ADMITTED', reasonCode: 'NATIVE_REVALIDATION_FAILED', native: null }
        : { outcome: 'ADMISSION_UNCERTAIN', reasonCode: 'RESTORE_OR_COMMIT_AMBIGUITY', native: null };
    }
    await this.serial(async () => {
      const state = this.state();
      if (ofKind(state, 'outcome').some(r => r.key === request.requestId)) return;
      this.commit([{ kind: 'outcome', key: request.requestId, payload: outcome }]);
    });
  }
  private admittedOutcome(request: PrepareRequest, readback: any): Record<string, unknown> {
    const s = readback?.snapshot, f = this.enrollment.factory;
    if (readback?.state !== 'PREPARED' || !s || s.requestId !== request.requestId || s.factoryId !== f.factoryId || s.factoryVersion !== f.factoryVersion
      || s.sourceDigest !== f.sourceDigest || s.configurationDigest !== f.configurationDigest || s.version !== 4)
      return { outcome: 'ADMISSION_UNCERTAIN', reasonCode: 'RESTORE_OR_COMMIT_AMBIGUITY', native: null };
    return { outcome: 'ADMITTED', reasonCode: 'ADMITTED', native: { workOrderId: readback.workOrderId, runId: readback.runId } };
  }

  private plan(state: State, request: PrepareRequest, missionId: string) {
    const plan = ofKind(state, 'plan').find(r => (r.payload as any).requestId === request.requestId);
    if (!plan) throw new ActionError('FACTORY_TERMINAL_UNAVAILABLE', 'not_found', 404);
    const p = plan.payload as any;
    if (p.workId !== request.workId || p.workGeneration !== request.workGeneration || p.missionId !== missionId
      || p.nativeRequestDigest !== digest(request) || !same(p.snapshot, this.snapshot())) fail('FACTORY_TERMINAL_BINDING', 409);
    return plan;
  }

  /** Readback: PREPARED snapshot only for an ADMITTED outcome with intact native lineage; otherwise a signed terminal. */
  terminal(input: unknown, missionId: unknown): Promise<unknown> {
    const request = this.shape(input), mission = this.mission(missionId);
    return this.serial(async () => {
      let state = this.state();
      const plan = this.plan(state, request, mission);
      if (this.inflight.has(request.requestId)) fail('FACTORY_RECEIVER_PENDING');
      let outcome = ofKind(state, 'outcome').find(r => r.key === request.requestId);
      if (!outcome) {
        // Plan without outcome and nothing in flight == crash/restore between the witnessed plan and its outcome.
        // Never replay native admission: lineage can only confirm it, otherwise the result is uncertain.
        let record: Record<string, unknown> = { outcome: 'ADMISSION_UNCERTAIN', reasonCode: 'RESTORE_OR_COMMIT_AMBIGUITY', native: null };
        try { record = this.admittedOutcome(request, await this.o.control.read(this.o.client(), request.requestId)); } catch { /* uncertain */ }
        state = this.commit([{ kind: 'outcome', key: request.requestId, payload: record }]);
        outcome = ofKind(state, 'outcome').find(r => r.key === request.requestId)!;
      }
      const o = outcome.payload as any, p = plan.payload as any;
      if (o.outcome === 'ADMITTED') {
        const readback: any = await this.o.control.read(this.o.client(), request.requestId);
        const intake = this.o.storage.getIntake('gateb:' + this.enrollment.clientId, request.requestId);
        if (!intake || readback.workOrderId !== o.native.workOrderId || readback.runId !== o.native.runId || intake.input_digest === undefined) fail('FACTORY_NATIVE_LINEAGE_MISSING');
        return readback;
      }
      const now = this.now(), s = this.enrollment.scope;
      return signFactoryPreparationTerminal({ schema: 'factory-capability-preparation-terminal/v1', ...s, agentId: this.enrollment.agentId,
        clientId: p.clientId, requestId: p.requestId, workId: p.workId, generation: p.workGeneration, missionId: p.missionId, ...p.snapshot,
        nativeRequestDigest: p.nativeRequestDigest, planId: plan.key, planDigest: digest(plan.payload), receiverSequence: Math.max(1, outcome.seq),
        receiverHeadDigest: outcome.digest, outcome: o.outcome, reasonCode: o.reasonCode, nativeOutcomeDigest: digest(o), issuedAt: now, expiresAt: now + 30_000 } as any,
        this.enrollment.signer);
    });
  }

  /** Synchronous dispatch gate used by FactoryDispatchControl: only an ADMITTED outcome on an unrestricted, witness-current receiver. */
  assertDispatch(requestId: string) {
    const deny = (code: string): never => { throw new ActionError('Ordered capability admission is required', code, 403); };
    let state: State;
    try { state = this.state(); } catch { return deny('ordered_admission_unavailable'); }
    const outcome = ofKind(state, 'outcome').find(r => r.key === requestId);
    if (!ofKind(state, 'plan').some(r => r.key === requestId) || (outcome?.payload as any)?.outcome !== 'ADMITTED') deny('ordered_admission_required');
    if (this.restricted(state)) deny('capability_policy_restricted');
  }

  async receiveFence(envelope: SignedPolicyMessage) {
    const parsed = JSON.parse((envelope as any)?.message ?? 'null') as any;
    const key = this.enrollment.sourceKeys[parsed?.authority as 'myeve' | 'relay'];
    if (!key) fail('FACTORY_POLICY_SCOPE', 403);
    const message: any = await verifyPolicyMessage(envelope, key);
    if (message.kind !== 'FENCE') fail('FACTORY_POLICY_KIND', 400);
    this.assertScope(message);
    const hash = await policyMessageHash(message);
    const ack = await signPolicyMessage({ ...Object.fromEntries(scopeKeys.map(k => [k, message[k]])), authority: message.authority,
      version: message.version, policyId: message.policyId, kind: 'FENCE_ACK', fenceHash: hash } as any, this.enrollment.signer);
    return this.serial(async () => {
      const state = this.state(), latest = this.latestFence(state, message.authority);
      if (latest && message.version < latest.message.version) fail('FACTORY_POLICY_STALE', 409);
      if (latest && message.version === latest.message.version) {
        if (latest.hash !== hash) fail('FACTORY_POLICY_CONFLICT', 409);
        return latest.ack;
      }
      this.commit([{ kind: 'fence', key: `${message.authority}:${message.version}`, payload: { message, envelope, hash, ack } }]);
      return ack;
    });
  }
}

export function assertWitnessOutsideData(witnessPath: string, dataDir: string) {
  const rel = relative(resolve(dataDir), resolve(witnessPath));
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('Receiver witness must live outside the Factory data directory');
}
