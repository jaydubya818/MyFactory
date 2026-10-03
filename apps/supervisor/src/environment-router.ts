import { createHash } from 'node:crypto';
import { capabilityNames, environmentTypes, negotiatedProtocol, parseEnvironment,
  type CapabilityName, type EnvironmentDescriptor, type EnvironmentType } from '../../../packages/contracts/src/environment.ts';

export const routingPolicyVersion = 'environment-routing-v1';
export interface WorkRequirements {
  workId: string;
  generation: number;
  ownerId: string;
  businessId: string | null;
  repository: string | null;
  environmentType: EnvironmentType;
  environmentId: string | null;
  capabilities: CapabilityName[];
}
/** Supplied by trusted policy/qualification storage, never by worker advertisement. */
export interface EnvironmentQualification {
  identityDigest: string;
  capabilities: CapabilityName[];
  evidenceRef: string;
  qualifiedAt: number;
  expiresAt: number;
  status: 'QUALIFIED' | 'REVOKED';
}
/** This bounded routing grant is necessary, not sufficient: existing execution
 * admission, writer claim and Relay checks still run before any effect. */
export interface EnvironmentAuthority {
  workId: string;
  generation: number;
  ownerId: string;
  businessId: string | null;
  environmentIds: string[];
  capabilities: CapabilityName[];
  repositories: string[];
  expiresAt: number;
}
export interface EnvironmentBinding {
  environmentId: string;
  environmentType: EnvironmentType;
  identityDigest: string;
  factoryVersion: string | null;
  protocolVersion: 1;
  policyVersion: typeof routingPolicyVersion;
  requirementsDigest: string;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Dynamic heartbeat/capacity changes do not repin admitted identity. */
export function environmentIdentity(value: EnvironmentDescriptor): string {
  const d = parseEnvironment(value);
  return hash([d.id, d.type, d.ownerId, d.businessId, d.provider, d.runtime, d.factoryVersion,
    d.protocol.min, d.protocol.max]);
}
function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200;
}
function validCapabilities(values: unknown): values is CapabilityName[] {
  return Array.isArray(values) && values.length > 0 && values.length <= capabilityNames.length &&
    new Set(values).size === values.length && values.every(c => capabilityNames.includes(c));
}
export function requirementsDigest(w: WorkRequirements): string {
  if (!validText(w.workId) || !validText(w.ownerId) || (w.businessId !== null && !validText(w.businessId)) ||
      !Number.isSafeInteger(w.generation) || w.generation < 1 || !environmentTypes.includes(w.environmentType) ||
      (w.environmentId !== null && !validText(w.environmentId)) ||
      (w.repository !== null && !/^[-\w.]+\/[-\w.]+$/.test(w.repository)) || !validCapabilities(w.capabilities)) throw Error('INVALID_WORK_REQUIREMENTS');
  return hash([w.workId, w.generation, w.ownerId, w.businessId, w.repository, w.environmentType,
    w.environmentId, [...w.capabilities].sort()]);
}

/** Derivation accepts structured, backend-validated resources, not a model's
 * environment preference. The local qualification mode is operator-only. */
export function deriveRequirements(work: Omit<WorkRequirements, 'environmentType' | 'capabilities' | 'environmentId'>,
  resource: { kind: 'repository' } | { kind: 'owner-file' | 'owner-desktop'; environmentId: string } | { kind: 'local-qualification' }) {
  if (!resource || !['repository', 'owner-file', 'owner-desktop', 'local-qualification'].includes(resource.kind)) throw Error('INVALID_RESOURCE');
  if ((resource.kind === 'repository' || resource.kind === 'local-qualification') && !work.repository) throw Error('REPOSITORY_REQUIRED');
  const software: CapabilityName[] = ['filesystem', 'shell', 'git', 'repositoryExecution', 'candidateCustody', 'protectedVerification'];
  const local = resource.kind === 'owner-file' || resource.kind === 'owner-desktop';
  // Explicit projection prevents incidental agent/harness/profile metadata from becoming routing semantics.
  const requirements: WorkRequirements = { workId: work.workId, generation: work.generation,
    ownerId: work.ownerId, businessId: work.businessId, repository: work.repository,
    environmentType: local ? 'OWNER_COMPUTER' : resource.kind === 'local-qualification' ? 'LOCAL_FACTORY' : 'CLOUD',
    environmentId: local ? resource.environmentId : null,
    capabilities: local ? resource.kind === 'owner-file' ? ['filesystem'] : ['desktop'] :
      resource.kind === 'repository' ? [...software, 'backgroundExecution'] : software };
  requirementsDigest(requirements);
  return { requirements, reasons: requirements.capabilities.map(capability => ({ capability, resource: resource.kind })) };
}

type Decision = { state: 'SELECTED' | 'BOUND'; binding: EnvironmentBinding } |
  { state: 'WAITING_FOR_ENVIRONMENT' | 'DENIED'; reason: string };
export function routeEnvironment(work: WorkRequirements, environments: EnvironmentDescriptor[],
  qualifications: EnvironmentQualification[], authority: EnvironmentAuthority, now: number,
  pinned?: EnvironmentBinding): Decision {
  const digest = requirementsDigest(work);
  if (!Number.isSafeInteger(now) || now < 0 || !authority || authority.workId !== work.workId || authority.generation !== work.generation ||
      authority.ownerId !== work.ownerId || authority.businessId !== work.businessId ||
      !Number.isSafeInteger(authority.expiresAt) || authority.expiresAt <= now ||
      !Array.isArray(authority.environmentIds) || !validCapabilities(authority.capabilities) ||
      !Array.isArray(authority.repositories) || !work.capabilities.every(c => authority.capabilities.includes(c)) ||
      (work.repository !== null && !authority.repositories.includes(work.repository))) return { state: 'DENIED', reason: 'WORK_AUTHORITY_REQUIRED' };
  if (pinned) {
    // This is readback only. Availability/qualification changes must not select
    // a new environment or replay execution; the attempt reconciler owns recovery.
    if (pinned.requirementsDigest !== digest || pinned.environmentType !== work.environmentType ||
        !authority.environmentIds.includes(pinned.environmentId)) return { state: 'DENIED', reason: 'PINNED_WORK_MISMATCH' };
    return { state: 'BOUND', binding: structuredClone(pinned) };
  }
  const candidates = environments.map(parseEnvironment).filter(d => d.ownerId === work.ownerId && d.businessId === work.businessId);
  if (new Set(candidates.map(d => d.id)).size !== candidates.length) return { state: 'DENIED', reason: 'AMBIGUOUS_ENVIRONMENT_IDENTITY' };
  for (const d of candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (d.type !== work.environmentType || (work.environmentId !== null && d.id !== work.environmentId) ||
        !authority.environmentIds.includes(d.id) || d.revoked || d.connectivity !== 'ONLINE' || d.capacity < 1 ||
        d.observedAt > now || now - d.observedAt >= 30_000 || negotiatedProtocol(d) === null) continue;
    const identityDigest = environmentIdentity(d);
    const records = qualifications.filter(q => q.identityDigest === identityDigest);
    if (records.length !== 1) continue;
    const q = records[0];
    if (q.status !== 'QUALIFIED' || !validText(q.evidenceRef) || !Number.isSafeInteger(q.qualifiedAt) || q.qualifiedAt > now ||
        !Number.isSafeInteger(q.expiresAt) || q.expiresAt <= now || !validCapabilities(q.capabilities) ||
        !work.capabilities.every(name => q.capabilities.includes(name) &&
          d.capabilities.some(c => c.name === name && c.version === 1 && c.available))) continue;
    return { state: 'SELECTED', binding: { environmentId: d.id, environmentType: d.type, identityDigest,
      factoryVersion: d.factoryVersion, protocolVersion: 1, policyVersion: routingPolicyVersion, requirementsDigest: digest } };
  }
  return { state: 'WAITING_FOR_ENVIRONMENT', reason: work.environmentType === 'OWNER_COMPUTER' ? 'Waiting for your Mac' :
    work.environmentType === 'CLOUD' ? 'Waiting for cloud execution' : 'Waiting for local qualification environment' };
}
