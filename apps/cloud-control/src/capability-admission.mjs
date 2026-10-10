import { assertCapabilityAdmission } from '@myeve/capability-enforcement';

/** Server installation bindings only. CloudPrepare has no owner or installation fields. */
export function factoryCapabilityScope(bindings, grant) {
  const scope = bindings?.[grant.clientId];
  if (!scope || grant.ownerScope !== scope.ownerId)
    throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');
  return scope;
}

export async function assertFactoryCapability(client, bindings, grant, request) {
  const scope = factoryCapabilityScope(bindings, grant);
  return assertCapabilityAdmission(client, scope, {
    capabilityId: 'myfactory', workId: request.workId,
    workGeneration: request.workGeneration, budgetMicros: Math.ceil(request.maxSpendUsd * 1_000_000),
  });
}
