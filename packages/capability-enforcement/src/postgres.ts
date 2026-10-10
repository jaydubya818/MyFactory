import { z } from 'zod';
import { capabilityRegistry, resolveCapabilities, type PolicySnapshot } from '@mission-control/capability-control';
import { assertRecoveryEnrollment, configuredRecoveryWitness, recoveryHead, assertRecoveryHead } from './recovery-witness.ts';

export interface PolicyConnection { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, any>[] }> }
export class CapabilityAdmissionError extends Error {
  readonly code = 'CAPABILITY_ADMISSION_DENIED';
  readonly reason: string;
  constructor(reason: string) { super(`Capability admission denied: ${reason}`); this.reason = reason; }
}
const scopeSchema = z.object({ ownerId:z.string().trim().min(1), organizationId:z.string().trim().min(1),
  installationId:z.string().trim().min(1), environment:z.enum(['development','qualification']), agentId:z.string().trim().min(1) }).strict();
export type AdmissionScope = z.infer<typeof scopeSchema>;
const requestSchema = z.object({ capabilityId:z.string().min(1), workId:z.string().min(1),
  workGeneration:z.number().int().positive(), budgetMicros:z.number().int().nonnegative().max(1e12),
  expectedRevision:z.number().int().positive().optional() }).strict();
export type AdmissionRequest = z.infer<typeof requestSchema>;
const factsSchema = z.record(z.string(),z.object({supported:z.boolean(),deployed:z.boolean(),entitled:z.boolean(),
  administrator:z.enum(['ALLOW','DENY','PENDING_APPROVAL']),setup:z.record(z.string(),z.boolean()),
  qualification:z.record(z.string(),z.enum(['QUALIFIED','UNQUALIFIED'])),lifecycle:z.enum(['ACTIVE','PAUSED','REVOKED']),selectedAlternative:z.string().optional()}).strict());
const finiteTime = (value: unknown) => new Date(String(value)).getTime();
function deny(reason:string):never { throw new CapabilityAdmissionError(reason); }

/** Requires the caller's pinned admission transaction. The result is audit metadata, never a portable grant. */
export async function assertCapabilityAdmission(connection:PolicyConnection, rawScope:AdmissionScope, rawRequest:AdmissionRequest) {
  const scope=scopeSchema.parse(rawScope),request=requestSchema.parse(rawRequest);
  if (!capabilityRegistry.capabilities.some(item=>item.id===request.capabilityId)) deny('UNKNOWN_CAPABILITY');
  const [{transaction_id:transactionId}] = (await connection.query('SELECT txid_current()::text AS transaction_id')).rows;
  const [role]=(await connection.query(`SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreaterole
    OR has_schema_privilege(current_user,'capability_control','CREATE')
    OR has_table_privilege(current_user,'capability_control.installations','INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege(current_user,'capability_control.platform_owner_bindings','INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege(current_user,'capability_control.evidence','INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege(current_user,'capability_control.relay_agent_evidence','INSERT,UPDATE,DELETE,TRUNCATE') AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`)).rows;
  if(!role || role.unsafe!==false)deny('RUNTIME_ROLE_UNQUALIFIED');
  await connection.query("SELECT set_config('myeve.capability_owner',$1,true),set_config('myeve.capability_installation',$2,true)",[scope.ownerId,scope.installationId]);
  await connection.query('SELECT capability_control.lock_admission_policy($1,$2,$3)',[scope.installationId,scope.ownerId,scope.agentId]);
  const witness = configuredRecoveryWitness();
  if (scope.environment === 'development' && !witness) deny('RECOVERY_WITNESS_REQUIRED');
  await assertRecoveryEnrollment(connection, scope, witness);
  if (witness) await assertRecoveryHead(witness, await recoveryHead(connection, scope, witness));
  const [state]=(await connection.query(`SELECT s.*,i.organization_id,i.environment,i.active,
      b.id AS binding_id,b.organization_id AS binding_organization,b.status AS binding_status,b.expires_at AS binding_expires,
      b.revision AS binding_revision,b.administration_record_id,b.membership_record_id,b.installation_record_id,b.audit_record_id,
      e.organization_id AS evidence_organization,e.registry_version,e.facts,e.observed_at,e.expires_at,
      a.organization_id AS agent_organization,a.capability_ids,a.status AS agent_status,a.expires_at AS agent_expires,a.revision AS agent_revision,
      clock_timestamp() AS checked_at,txid_current()::text AS transaction_id
    FROM capability_control.owner_state s JOIN capability_control.installations i ON i.id=s.installation_id
    LEFT JOIN capability_control.platform_owner_bindings b USING(installation_id,owner_id)
    LEFT JOIN capability_control.evidence e USING(installation_id,owner_id)
    LEFT JOIN capability_control.relay_agent_evidence a ON a.installation_id=s.installation_id AND a.owner_id=s.owner_id AND a.agent_id=$3
    WHERE s.installation_id=$1 AND s.owner_id=$2`,[scope.installationId,scope.ownerId,scope.agentId])).rows;
  if(!state || state.transaction_id!==transactionId)deny('PINNED_TRANSACTION_REQUIRED');
  if(!state.active || state.organization_id!==scope.organizationId || state.environment!==scope.environment)deny('INSTALLATION_SCOPE');
  const now=finiteTime(state.checked_at);
  if(state.registry_version!==capabilityRegistry.version || state.evidence_organization!==scope.organizationId
    || !(finiteTime(state.observed_at)<=now && finiteTime(state.expires_at)>now))deny('POLICY_EVIDENCE_STALE');
  if(state.agent_organization!==scope.organizationId || state.agent_status!=='ACTIVE' || !(finiteTime(state.agent_expires)>now))deny('AGENT_POLICY_UNAVAILABLE');
  if(request.expectedRevision!==undefined && request.expectedRevision!==Number(state.revision))deny('POLICY_REVISION_STALE');
  const preferences=z.record(z.string(),z.enum(['ENABLED','DISABLED'])).parse(state.preferences);
  const controls=z.record(z.string(),z.enum(['PAUSE_REQUESTED','REVOKE_REQUESTED'])).parse(state.controls);
  const budgets=z.record(z.string(),z.number().int().nonnegative().max(1e12)).parse(state.budgets);
  const allowed=new Set(z.array(z.string()).parse(state.capability_ids));
  const facts=factsSchema.parse(state.facts);
  let snapshot:PolicySnapshot={registryVersion:capabilityRegistry.version,revision:Number(state.revision),observedAt:now,expiresAt:finiteTime(state.expires_at),
    scope:{ownerId:scope.ownerId,organizationId:scope.organizationId,installationId:scope.installationId,environment:scope.environment},preferences,ordinaryDefaults:{},facts};
  if(state.binding_id && state.binding_organization===scope.organizationId && state.binding_status==='ACTIVE')snapshot={...snapshot,platformOwnerPolicy:{
    ...snapshot.scope,id:state.binding_id,revision:Number(state.binding_revision),status:'ACTIVE',expiresAt:finiteTime(state.binding_expires),
    administrationRecordId:state.administration_record_id,membershipRecordId:state.membership_record_id,
    installationRecordId:state.installation_record_id,auditRecordId:state.audit_record_id}};
  const required=new Set<string>();
  function include(id:string){if(required.has(id))return;required.add(id);const descriptor=capabilityRegistry.capabilities.find(item=>item.id===id)!;
    descriptor.dependencies.forEach(include);const alternative=facts[id]?.selectedAlternative;if(alternative&&descriptor.alternativeDependencies.includes(alternative))include(alternative);}
  include('work');
  include(request.capabilityId);
  for(const item of resolveCapabilities(capabilityRegistry,snapshot,now).filter(item=>required.has(item.id))){
    if(controls[item.id])deny(`CONTROL_PENDING:${item.id}`);
    if(item.preference!=='ENABLED'||item.availability!=='AVAILABLE'||item.readiness!=='READY'||item.lifecycle!=='ACTIVE')deny(`POLICY_BLOCKED:${item.id}`);
    if(!allowed.has(item.id))deny(`AGENT_DENIED:${item.id}`);
    if(budgets[item.id]!==undefined&&request.budgetMicros>budgets[item.id])deny(`BUDGET_EXCEEDED:${item.id}`);
  }
  return {registryVersion:capabilityRegistry.version,policyRevision:Number(state.revision),agentRevision:Number(state.agent_revision),
    capabilityId:request.capabilityId,workId:request.workId,workGeneration:request.workGeneration,transactionId,
    requiredCapabilities:[...required].sort()};
}

/** Invoke inside BEGIN/COMMIT; a failure rolls back the backend admission with policy checks. */
export async function withCapabilityAdmission<T>(connection: PolicyConnection, scope: AdmissionScope,
  request: AdmissionRequest, admit: (evidence: Awaited<ReturnType<typeof assertCapabilityAdmission>>) => Promise<T>): Promise<T> {
  const evidence = await assertCapabilityAdmission(connection, scope, request);
  const result = await admit(evidence);
  // Expiry can pass while backend checks run, even though policy rows remain locked.
  await assertCapabilityAdmission(connection, scope, { ...request, expectedRevision: evidence.policyRevision });
  return result;
}
