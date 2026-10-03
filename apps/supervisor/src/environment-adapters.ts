import { parseEnvironment, type EnvironmentDescriptor, type EnvironmentCapability } from '../../../packages/contracts/src/environment.ts';

/** Projection of authenticated, owner-scoped Sofie Local readback. Roots and
 * pairing secrets never enter an environment descriptor. Permission readback
 * is availability only: Action Gateway and qualification remain independent. */
export function ownerComputerEnvironment(input: {
  ownerId: string; businessId: string | null; deviceId: string; runtime: string;
  status: 'ready' | 'offline' | 'revoked'; lastSeenAt: string | null;
  permissions: { accessibility?: boolean; screenRecording?: boolean };
  filesystemAvailable: boolean; shellAvailable: boolean;
}): EnvironmentDescriptor {
  return parseEnvironment({ schemaVersion: 1, id: input.deviceId, name: 'Your Mac', type: 'OWNER_COMPUTER',
    ownerId: input.ownerId, businessId: input.businessId, provider: 'sofie-local-v1', runtime: input.runtime,
    factoryVersion: null, protocol: { min: 1, max: 1 },
    capabilities: [
      { name: 'filesystem', version: 1, available: input.filesystemAvailable },
      { name: 'shell', version: 1, available: input.shellAvailable },
      { name: 'screenshot', version: 1, available: input.permissions.screenRecording === true },
      { name: 'desktop', version: 1, available: input.permissions.accessibility === true },
    ], connectivity: input.status === 'ready' ? 'ONLINE' : 'OFFLINE',
    observedAt: input.lastSeenAt === null ? 0 : Date.parse(input.lastSeenAt),
    capacity: input.status === 'ready' ? 1 : 0, revoked: input.status === 'revoked' });
}

/** Local Factory is not the owner's computer connection. The existing provider
 * retains lifecycle ownership. Configuration supplies the exact admitted tuple;
 * neither provider health nor this projection qualifies it for production. */
export function localFactoryEnvironment(input: {
  id: string; ownerId: string; businessId: string | null; provider: string;
  runtime: string; factoryVersion: string; observedAt: number;
  ready: boolean; capacity: number;
}): EnvironmentDescriptor {
  const capabilities: EnvironmentCapability[] = ['filesystem', 'shell', 'git', 'repositoryExecution',
    'candidateCustody', 'protectedVerification'].map(name => ({
      name: name as EnvironmentCapability['name'], version: 1, available: input.ready,
    }));
  return parseEnvironment({ schemaVersion: 1, id: input.id, name: 'Local development', type: 'LOCAL_FACTORY',
    ownerId: input.ownerId, businessId: input.businessId, provider: input.provider, runtime: input.runtime,
    factoryVersion: input.factoryVersion, protocol: { min: 1, max: 1 }, capabilities,
    connectivity: input.ready ? 'ONLINE' : 'OFFLINE', observedAt: input.observedAt,
    capacity: input.capacity, revoked: false });
}
