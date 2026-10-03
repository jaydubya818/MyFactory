/** Canonical execution metadata. Availability and advertisement grant no authority. */
export const environmentTypes = ['CLOUD', 'OWNER_COMPUTER', 'LOCAL_FACTORY'] as const;
export type EnvironmentType = typeof environmentTypes[number];
/** Optional operator surfaces. Never add these to productive Work requirements. */
export const sessionCapabilityNames = ['session.headless', 'session.tmux', 'session.cmux',
  'session.interactiveAttach', 'session.browser', 'session.notifications'] as const;
/** Independently qualified execution capabilities, not agent roles or session surfaces.
 * CLOUD_COMPUTER is a future CLOUD profile; it is not an EnvironmentType. */
export const computerCapabilityNames = ['browser', 'desktop', 'screenshot', 'appInteraction'] as const;
export const capabilityNames = ['filesystem', 'shell', 'git', 'repositoryExecution',
  'backgroundExecution', 'candidateCustody', 'protectedVerification', ...computerCapabilityNames,
  ...sessionCapabilityNames] as const;
export type CapabilityName = typeof capabilityNames[number];
export interface EnvironmentCapability {
  name: CapabilityName;
  version: number;
  available: boolean;
}
export interface EnvironmentDescriptor {
  // Where execution occurs. Harness selection and specialist identity live outside this descriptor.
  schemaVersion: 1;
  id: string;
  name: string;
  type: EnvironmentType;
  ownerId: string;
  businessId: string | null;
  provider: string;
  runtime: string;
  factoryVersion: string | null;
  protocol: { min: number; max: number };
  capabilities: EnvironmentCapability[];
  connectivity: 'ONLINE' | 'OFFLINE';
  observedAt: number;
  capacity: number;
  revoked: boolean;
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('INVALID_ENVIRONMENT_DESCRIPTOR');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 160): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max ||
      /[\x00-\x1f\x7f]/.test(value)) throw Error('INVALID_ENVIRONMENT_TEXT');
}
function integer(value: unknown, min: number, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw Error('INVALID_ENVIRONMENT_NUMBER');
}

/** Exact V1 wire schema; no credential/endpoint/host-path fields accepted. */
export function parseEnvironment(value: unknown): EnvironmentDescriptor {
  const d = record(value, ['schemaVersion', 'id', 'name', 'type', 'ownerId', 'businessId', 'provider',
    'runtime', 'factoryVersion', 'protocol', 'capabilities', 'connectivity', 'observedAt', 'capacity', 'revoked']);
  if (d.schemaVersion !== 1 || !environmentTypes.includes(d.type as EnvironmentType) ||
      !['ONLINE', 'OFFLINE'].includes(d.connectivity as string) || typeof d.revoked !== 'boolean') throw Error('INVALID_ENVIRONMENT_ENUM');
  for (const field of ['id', 'name', 'ownerId', 'provider', 'runtime']) text(d[field]);
  if (d.type === 'CLOUD' && !/^sha256:[a-f0-9]{64}$/.test(d.runtime as string)) throw Error('IMMUTABLE_CLOUD_RUNTIME_REQUIRED');
  if (d.businessId !== null) text(d.businessId);
  if (d.factoryVersion !== null && (typeof d.factoryVersion !== 'string' || !/^[a-f0-9]{64}$/.test(d.factoryVersion))) throw Error('INVALID_FACTORY_VERSION');
  if (d.type !== 'OWNER_COMPUTER' && d.factoryVersion === null) throw Error('FACTORY_VERSION_REQUIRED');
  const protocol = record(d.protocol, ['min', 'max']);
  integer(protocol.min, 1, 1000); integer(protocol.max, protocol.min, 1000);
  integer(d.observedAt, 0, Number.MAX_SAFE_INTEGER); integer(d.capacity, 0, 1000);
  if (!Array.isArray(d.capabilities) || d.capabilities.length > capabilityNames.length) throw Error('INVALID_CAPABILITIES');
  const names = new Set();
  for (const value of d.capabilities) {
    const c = record(value, ['name', 'version', 'available']);
    if (!capabilityNames.includes(c.name as CapabilityName) || names.has(c.name) || typeof c.available !== 'boolean') throw Error('INVALID_CAPABILITY');
    integer(c.version, 1, 1000); names.add(c.name);
  }
  return structuredClone(d) as unknown as EnvironmentDescriptor;
}

export function negotiatedProtocol(descriptor: EnvironmentDescriptor): number | null {
  return descriptor.protocol.min <= 1 && descriptor.protocol.max >= 1 ? 1 : null;
}

/** Safe owner read model, intentionally omits internal runtime/version identities. */
export function environmentSummary(value: EnvironmentDescriptor, now: number) {
  const d = parseEnvironment(value);
  const online = d.connectivity === 'ONLINE' && d.observedAt <= now && now - d.observedAt < 30_000;
  return { id: d.id, name: d.name, type: d.type,
    status: d.revoked ? 'REVOKED' : !online ? 'OFFLINE' : negotiatedProtocol(d) === null ? 'UPDATE_REQUIRED' : 'ONLINE',
    capabilities: !online || d.revoked || negotiatedProtocol(d) === null ? [] :
      d.capabilities.filter(c => c.available && c.version === 1).map(c => c.name).sort() };
}
