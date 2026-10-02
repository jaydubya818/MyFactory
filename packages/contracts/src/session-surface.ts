/** Optional presentation contract. No execution, lease, custody or publication authority. */
export const sessionSurfaceKinds = ['HEADLESS', 'TMUX', 'CMUX'] as const;
export type SessionSurfaceKind = typeof sessionSurfaceKinds[number];
export type InteractiveSessionSurface = Exclude<SessionSurfaceKind, 'HEADLESS'>;

/** Canonical IDs, never a host, path, command, native session name or credential. */
export interface SessionExecutionReference {
  workId: string;
  workGeneration: number;
  executionId: string;
  executionGeneration: number;
  environmentId: string;
  attemptId: string;
}
export interface SessionAttachmentRequest {
  schemaVersion: 1;
  surface: InteractiveSessionSurface;
  execution: SessionExecutionReference;
}

const referenceKeys = ['workId', 'workGeneration', 'executionId', 'executionGeneration', 'environmentId', 'attemptId'] as const;
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('INVALID_SESSION_ATTACHMENT');
  return value as Record<string, unknown>;
}

/** Reject caller-selected hosts, native sessions, shell commands and credential fields. */
export function parseSessionAttachmentRequest(value: unknown): SessionAttachmentRequest {
  const r = exact(value, ['schemaVersion', 'surface', 'execution']);
  if (r.schemaVersion !== 1 || !['TMUX', 'CMUX'].includes(r.surface as string)) throw Error('INVALID_SESSION_ATTACHMENT');
  const e = exact(r.execution, referenceKeys);
  for (const key of referenceKeys) {
    const value = e[key];
    if (key.endsWith('Generation')) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw Error('INVALID_SESSION_ATTACHMENT');
    } else if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
      throw Error('INVALID_SESSION_ATTACHMENT');
    }
  }
  return structuredClone(r) as unknown as SessionAttachmentRequest;
}

/** Obtained from existing authenticated operator/Work authorization, never request JSON. */
export interface SessionAttachmentScope {
  operatorId: string;
  ownerId: string;
  businessId: string | null;
  execution: SessionExecutionReference;
  surfaces: InteractiveSessionSurface[];
  expiresAt: number;
  revoked: boolean;
}
/** Obtained from current canonical storage on every attach/reconnect/detach. */
export interface SessionExecutionTruth {
  ownerId: string;
  businessId: string | null;
  execution: SessionExecutionReference;
  active: boolean;
  role: 'PRODUCER' | 'VERIFIER';
}

/** Identity/scope guard only: caller must ALSO check live environment qualification,
 * negotiated capabilities, policy, lease and revocation at effect time. No grant is minted. */
export function assertSessionAttachmentScope(
  value: unknown, scope: SessionAttachmentScope, current: SessionExecutionTruth, now: number,
): SessionAttachmentRequest {
  const request = parseSessionAttachmentRequest(value);
  const matches = (a: SessionExecutionReference, b: SessionExecutionReference) => referenceKeys.every(k => a[k] === b[k]);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(scope.expiresAt) || scope.expiresAt <= now ||
      scope.revoked !== false || !scope.operatorId || !scope.ownerId || current.active !== true || current.role !== 'PRODUCER' ||
      scope.ownerId !== current.ownerId || scope.businessId !== current.businessId ||
      !scope.surfaces.includes(request.surface) || !matches(request.execution, scope.execution) ||
      !matches(request.execution, current.execution)) throw Error('SESSION_ATTACHMENT_DENIED');
  return request;
}

export interface SessionSurfaceProjection {
  execution: SessionExecutionReference;
  /** Monotonic Current Truth revision; deduplicate notifications by execution + revision + attention. */
  revision: number;
  attention: 'NONE' | 'NEEDS_ATTENTION' | 'VERIFICATION_FAILED' | 'EXECUTION_COMPLETED' | 'INPUT_REQUIRED';
}
export interface SessionSurfaceReadback {
  execution: SessionExecutionReference;
  surface: SessionSurfaceKind;
  state: 'UNAVAILABLE' | 'ATTACHED' | 'DETACHED' | 'UNKNOWN';
  /** Opaque server-side handle. Native socket/path/host resolution stays provider-private. */
  attachmentId: string | null;
}
export interface SessionSurfaceAccess {
  request: SessionAttachmentRequest;
  scope: SessionAttachmentScope;
}

/** Contract only; no adapters or endpoints are enabled by this interface.
 * HEADLESS means no provider needs to be constructed or called in the productive path.
 * Effects may affect only an operator client. Never start/stop/resume productive execution.
 * Reconcile reads an existing eligible attachment; UNKNOWN never triggers worker creation.
 * Each effect must resolve current authority again; a stored Access is not a bearer grant.
 * Observe receives only sanitized canonical projections, not terminal-derived Work state.
 */
export interface SessionSurfaceProvider {
  readonly surface: SessionSurfaceKind;
  observe(projection: SessionSurfaceProjection): Promise<void>;
  attach(access: SessionSurfaceAccess): Promise<SessionSurfaceReadback>;
  detach(access: SessionSurfaceAccess, attachmentId: string): Promise<void>;
  reconcile(access: SessionSurfaceAccess, attachmentId: string): Promise<SessionSurfaceReadback>;
}
