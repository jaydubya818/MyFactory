import { canAccessRepository, type FactoryClient } from './connections.ts';
import { ActionError } from './actions.ts';
import type { FactoryStorage } from '../../../packages/storage/src/index.ts';
import type { ProducerResults } from './producer-results.ts';
import { digest } from '../../../packages/hosted-routing/src/result.ts';
import { EVIDENCE_KINDS, proofEvidenceReference, readEvidenceArtifact, type EvidenceKind, type EvidenceRef } from '../../../packages/verification/src/evidence.ts';

export interface EvidenceReadRequest {
  ownerScope: string; repository: string; workId: string; workGeneration: number;
  requestId: string; workOrderId: string; runId: string; candidateCommit: string;
  factoryVersion: string; evidenceReference: string; expectedDigest: string; evidenceKind: EvidenceKind;
}
export type TransportEvidenceMetadata = Omit<EvidenceRef, 'relativePath'>;
export type EvidenceTransportScope = Pick<EvidenceReadRequest, 'ownerScope' | 'repository' | 'workId' | 'workGeneration' | 'requestId'>;

function exactRequest(value: unknown): EvidenceReadRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ActionError('Exact evidence binding required', 'invalid_input');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !==
    'candidateCommit,evidenceKind,evidenceReference,expectedDigest,factoryVersion,ownerScope,repository,requestId,runId,workGeneration,workId,workOrderId' ||
    !Object.values(data).every(item => typeof item === 'string' || typeof item === 'number') ||
    !Number.isSafeInteger(data.workGeneration) || Number(data.workGeneration) < 1 ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(String(data.candidateCommit)) ||
    !/^[a-f0-9]{64}$/.test(String(data.factoryVersion)) ||
    !/^[a-f0-9]{64}$/.test(String(data.expectedDigest)) ||
    !/^factory-evidence:sha256:[a-f0-9]{64}$/.test(String(data.evidenceReference)) ||
    !EVIDENCE_KINDS.includes(data.evidenceKind as EvidenceKind))
    throw new ActionError('Exact evidence binding required', 'invalid_input');
  return data as unknown as EvidenceReadRequest;
}

/** One exact reference, for the MyEve Proof backend only. No path or listing input. */
export async function readBoundEvidence(client: FactoryClient, input: unknown, storage: FactoryStorage,
  producer: ProducerResults | undefined, dataDir: string, currentClient?: () => FactoryClient): Promise<{ scope: EvidenceTransportScope; ref: TransportEvidenceMetadata; proofReference: string; base64: string }> {
  const original = { id: client.id, ownerScope: client.ownerScope, purpose: client.purpose, tokenSha256: client.tokenSha256 };
  const current = () => {
    const fresh = currentClient?.() ?? client;
    if (fresh.id !== original.id || fresh.ownerScope !== original.ownerScope || fresh.purpose !== original.purpose || fresh.tokenSha256 !== original.tokenSha256 ||
        fresh.purpose !== 'myeve-proof' || !fresh.actions.includes('evidence.read') || !fresh.ownerScope ||
        typeof fresh.expiresAt !== 'string' || !Number.isFinite(Date.parse(fresh.expiresAt)) || Date.parse(fresh.expiresAt) <= Date.now())
      throw new ActionError('Evidence recipient is not authorized', 'forbidden', 403);
    return fresh;
  };
  client = current();
  const requested = exactRequest(input);
  const denied = () => new ActionError('Evidence not found for this binding', 'not_found', 404);
  if (requested.ownerScope !== client.ownerScope || !producer) throw denied();
  const order = storage.getWorkOrder(requested.workOrderId);
  const run = storage.getRun(requested.runId);
  if (!order || !run || run.workOrderId !== order.id || !canAccessRepository(client, order.repositoryPath)) throw denied();
  const events = storage.listEvents(order.id);
  const prepare = events.filter(event => event.type === 'factory.prepare_requested');
  const owners = events.filter(event => event.type === 'factory.owner_scope_bound');
  if (prepare.length !== 1 || owners.length !== 1) throw denied();
  const prepared = prepare[0].payload, owner = owners[0].payload;
  if (prepared.requestId !== requested.requestId || prepared.workId !== requested.workId ||
    prepared.workGeneration !== requested.workGeneration || prepared.repository !== requested.repository ||
    (prepared.input as { repositoryPath?: unknown } | undefined)?.repositoryPath !== order.repositoryPath ||
    owner.ownerScope !== client.ownerScope || owner.workId !== requested.workId ||
    owner.workGeneration !== requested.workGeneration || owner.repository !== requested.repository ||
    owner.requestId !== requested.requestId) throw denied();
  const snapshot = producer.snapshot(run);
  if (!snapshot || snapshot.requestId !== requested.requestId || snapshot.factoryVersion !== requested.factoryVersion ||
    snapshot.workOrderId !== order.id || snapshot.runId !== run.id || run.candidateCommit !== requested.candidateCommit) throw denied();
  if (events.filter(event => event.runId === run.id && event.type === 'run.signed_result').length !== 1)
    throw new ActionError('Candidate retained; waiting for evidence receipt', 'waiting_for_evidence', 409);
  const result = producer.read(run);
  if (result.state !== 'COMPLETED' || !result.result) throw denied();
  const records = events.filter(event => event.runId === run.id && event.type === 'run.evidence_collected');
  if (records.length !== 1 || !Array.isArray(records[0].payload.refs)) throw denied();
  const refs = records[0].payload.refs as (EvidenceRef & { proofReference: string })[];
  const matches = refs.filter(ref => ref.proofReference === requested.evidenceReference);
  if (matches.length !== 1) throw denied();
  const { proofReference, ...ref } = matches[0];
  if (ref.workOrderId !== order.id || ref.runId !== run.id || ref.candidateCommit !== requested.candidateCommit ||
    ref.factoryVersion !== requested.factoryVersion || ref.kind !== requested.evidenceKind ||
    ref.sha256 !== requested.expectedDigest || proofReference !== proofEvidenceReference(ref)) throw denied();
  const binding = digest({ order, run, events });
  try {
    const bytes = await readEvidenceArtifact(dataDir, {
      workOrderId: order.id, runId: run.id, candidateCommit: requested.candidateCommit,
      factoryVersion: requested.factoryVersion,
    }, ref);
    const fresh = current(), currentOrder = storage.getWorkOrder(order.id), currentRun = storage.getRun(run.id);
    if (!currentOrder || !currentRun || !canAccessRepository(fresh, currentOrder.repositoryPath) ||
        digest({ order: currentOrder, run: currentRun, events: storage.listEvents(order.id) }) !== binding) throw denied();
    const { relativePath: _storagePath, ...metadata } = ref;
    const { ownerScope, repository, workId, workGeneration, requestId } = requested;
    return { scope: { ownerScope, repository, workId, workGeneration, requestId },
      ref: metadata, proofReference, base64: bytes.toString('base64') };
  } catch (error) {
    if (error instanceof ActionError && [401, 403, 404].includes(error.status)) throw error;
    throw new ActionError('Evidence unavailable or changed', 'evidence_unavailable', 409);
  }
}
