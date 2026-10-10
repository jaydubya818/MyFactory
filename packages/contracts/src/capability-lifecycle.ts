/** Observational backend evidence. Authentication must come from the existing
 * enrolled Factory/Fabric transport or signed execution Result, never this JSON.
 * Mission/Attempt ownership stays in MissionControl's exact execution mapping. */
export interface FactoryCapabilityLifecycleReceipt {
  version: 1;
  ownerId: string;
  organizationId: string;
  installationId: string;
  agentId: string;
  environment: 'qualification';
  controlRequestId: string;
  policyRevision: number;
  operation: 'pause' | 'revoke';
  workId: string;
  workGeneration: number;
  requestId: string;
  workOrderId: string;
  runId: string;
  factoryVersion: string;
  status: 'ACKNOWLEDGED' | 'PENDING_BACKEND';
  resourceStop: 'NOT_ALLOCATED' | 'STOP_CONFIRMED' | 'STOP_PENDING' | 'STOP_UNKNOWN';
  cleanup: 'CONFIRMED' | 'PENDING_BACKEND';
  accounting: 'PRESERVE_UNKNOWN';
  suspension?: 'PAUSE_CONFIRMED' | 'PAUSE_REQUESTED';
}
