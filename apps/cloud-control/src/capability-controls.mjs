import { canonical } from '../../../packages/hosted-routing/src/result.ts';
import { reconcileCloudWork } from './cloud-work-lifecycle.mjs';

/** Co-located qualification adapter. Server installation bindings and restricted
 * policy rows authenticate requests; returned JSON is not a portable grant. */
export async function applyFactoryCapabilityControl(store, clientId, requestId) {
  const scope = store.capabilityBindings?.[clientId];
  if (!scope || scope.environment !== 'qualification') throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');
  return store.transaction(async client => {
    await client.query("SELECT set_config('myeve.capability_owner',$1,true),set_config('myeve.capability_installation',$2,true)", [scope.ownerId, scope.installationId]);
    await client.query('SELECT capability_control.lock_admission_policy($1,$2,$3)', [scope.installationId, scope.ownerId, scope.agentId]);
    const installation = (await client.query('SELECT * FROM capability_control.installations WHERE id=$1', [scope.installationId])).rows[0];
    if (!installation?.active || installation.organization_id !== scope.organizationId || installation.environment !== scope.environment)
      throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');
    const request = (await client.query(`SELECT * FROM capability_control.control_requests
      WHERE installation_id=$1 AND owner_id=$2 AND request_id=$3`, [scope.installationId, scope.ownerId, requestId])).rows[0];
    if (!request || !['myfactory', 'work'].includes(request.capability_id)) throw Error('CAPABILITY_CONTROL_SCOPE');
    if (!['pause', 'revoke'].includes(request.operation)) throw Error('CAPABILITY_CONTROL_INVALID');
    const state = (await client.query('SELECT revision FROM capability_control.owner_state WHERE installation_id=$1 AND owner_id=$2', [scope.installationId, scope.ownerId])).rows[0];
    if (!state || state.revision < request.revision) throw Error('CAPABILITY_CONTROL_POLICY_RESTORED');
    const rows = (await client.query('SELECT * FROM factory.intake_receipts WHERE client_id=$1', [clientId])).rows;
    const receipts = [], unqualifiedRuns = [];
    for (const row of rows) {
      if (store.assertRecordScope) await store.assertRecordScope(client, row);
      const events = (await client.query('SELECT type,payload FROM factory.events WHERE run_id=$1 ORDER BY id', [row.run_id])).rows;
      const owners = events.filter(event => event.type === 'factory.owner_scope_bound');
      const admissions = events.filter(event => event.type === 'factory.capability_admitted');
      if (owners.length !== 1 || admissions.length !== 1 || owners[0].payload.ownerScope !== scope.ownerId
        || owners[0].payload.installationId !== scope.installationId || owners[0].payload.organizationId !== scope.organizationId
        || owners[0].payload.agentId !== scope.agentId) {
        // Older source did not persist every binding. Do not guess ownership or
        // roll back qualified controls for unrelated, exactly bound Runs.
        const unresolved = { runId: row.run_id, requestId: row.request_id, status: 'PENDING_BACKEND', reason: 'CAPABILITY_OWNER_SCOPE_UNQUALIFIED' };
        unqualifiedRuns.push(unresolved);
        continue;
      }
      const admission = admissions[0].payload;
      if (!Number.isSafeInteger(admission.policyRevision) || admission.workId !== row.work_id || admission.workGeneration !== row.work_generation)
        { unqualifiedRuns.push({ runId: row.run_id, requestId: row.request_id, status: 'PENDING_BACKEND', reason: 'CAPABILITY_ADMISSION_EVIDENCE_UNQUALIFIED' }); continue; }
      // A replay of an old control cannot affect Work admitted after re-enable.
      if (admission.policyRevision > request.revision) continue;
      const eventType = request.operation === 'revoke' ? 'factory.capability_revoked' : 'factory.capability_pause_requested';
      if (!events.some(event => event.type === eventType && event.payload.requestId === requestId)) {
        await store.event(client, row, eventType, { requestId, revision: request.revision, ...scope });
        if (request.operation === 'revoke' && !events.some(event => event.type === 'factory.stop_requested')) await store.event(client, row, 'factory.stop_requested', { source: 'capability-control', requestId, revision: request.revision });
      }
      if (request.operation === 'revoke') {
        await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced',cancelled_at=COALESCE(cancelled_at,clock_timestamp()::text) WHERE work_id=$1 AND work_generation=$2", [row.work_id, row.work_generation]);
        await client.query('UPDATE factory.execution_resources SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()),lease_expires_at=least(lease_expires_at,clock_timestamp()),updated_at=clock_timestamp() WHERE run_id=$1', [row.run_id]);
        await client.query('UPDATE factory.verification_resources SET lease_expires_at=least(lease_expires_at,clock_timestamp()),updated_at=clock_timestamp() WHERE run_id=$1', [row.run_id]);
      }
      const resource = (await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1', [row.run_id])).rows[0];
      const verifier = (await client.query('SELECT * FROM factory.verification_resources WHERE run_id=$1', [row.run_id])).rows[0];
      const clean = (!resource || resource.cleanup_confirmed) && (!verifier || verifier.cleanup_confirmed);
      /** @type {import('../../../packages/contracts/src/capability-lifecycle.ts').FactoryCapabilityLifecycleReceipt} */
      const receipt = { version: 1, ...scope, controlRequestId: requestId, policyRevision: request.revision,
        operation: request.operation, workId: row.work_id, workGeneration: row.work_generation, requestId: row.request_id,
        workOrderId: row.work_order_id, runId: row.run_id, factoryVersion: row.snapshot.factoryVersion,
        status: clean ? 'ACKNOWLEDGED' : 'PENDING_BACKEND',
        resourceStop: !resource && !verifier ? 'NOT_ALLOCATED' : clean ? 'STOP_CONFIRMED' : resource?.evidence?.cleanup === 'UNKNOWN' || verifier?.failure === 'VERIFIER_CLEANUP_UNKNOWN' || events.some(event => event.type === 'factory.verifier_cleanup_unknown' && event.payload.leaseOwner === verifier?.lease_owner) ? 'STOP_UNKNOWN' : 'STOP_PENDING',
        cleanup: clean ? 'CONFIRMED' : 'PENDING_BACKEND', accounting: 'PRESERVE_UNKNOWN' };
      if (request.operation === 'pause') receipt.suspension = clean ? 'PAUSE_CONFIRMED' : 'PAUSE_REQUESTED';
      const previous = events.filter(event => event.type === 'factory.capability_control_acknowledged' && event.payload.controlRequestId === requestId).at(-1);
      if (!previous || canonical(previous.payload) !== canonical(receipt)) await store.event(client, row, 'factory.capability_control_acknowledged', receipt);
      receipts.push(receipt);
    }
    const complete = unqualifiedRuns.length === 0 && receipts.every(receipt => receipt.status === 'ACKNOWLEDGED');
    return { status: complete ? 'ACKNOWLEDGED' : 'PENDING_BACKEND', admissionFence: 'APPLIED',
      ...(request.operation === 'revoke' ? { writers: unqualifiedRuns.length ? 'PARTIALLY_FENCED' : 'FENCED', executionAuthority: unqualifiedRuns.length ? 'PARTIALLY_INVALIDATED' : 'INVALIDATED' } : { suspension: complete ? 'PAUSE_CONFIRMED' : 'PAUSE_REQUESTED', ...(!complete ? { reason: 'SAFE_SUSPENSION_UNQUALIFIED' } : {}) }),
      cleanup: complete ? 'CONFIRMED' : 'PENDING_BACKEND', accounting: 'PRESERVE_UNKNOWN', runIds: receipts.map(receipt => receipt.runId), receipts, unqualifiedRuns, inventoryComplete: unqualifiedRuns.length === 0 };
  });
}

/** Stop and verification cleanup use the existing backend provider and leases.
 * A timeout is durable UNKNOWN, never a stop acknowledgment or paid settlement. */
export async function reconcileFactoryCapabilityControl(store, provider, clientId, requestId) {
  const requested = await applyFactoryCapabilityControl(store, clientId, requestId);
  for (const receipt of requested.receipts) {
    if (receipt.operation !== 'revoke' || receipt.status === 'ACKNOWLEDGED') continue;
    try { await reconcileCloudWork(store, provider, clientId, receipt.requestId); }
    catch {
      const row = await store.read(clientId, receipt.requestId);
      if (row.resource && !row.resource.cleanup_confirmed) await store.noteResource(row.run_id, row.resource.lease_owner, row.resource.lease_generation, { cleanup: 'UNKNOWN' });
      // Producer cleanup is not verifier cleanup. Retain uncertainty against the
      // exact original verifier lease even when the producer is already absent.
      if (row.verification && !row.verification.cleanup_confirmed) await store.transaction(async client => {
        const current = await store.record(client, clientId, receipt.requestId);
        await client.query("UPDATE factory.verification_resources SET failure=COALESCE(failure,'VERIFIER_CLEANUP_UNKNOWN'),updated_at=clock_timestamp() WHERE run_id=$1 AND lease_owner=$2 AND NOT cleanup_confirmed", [current.run_id, row.verification.lease_owner]);
        const prior = await client.query("SELECT 1 FROM factory.events WHERE run_id=$1 AND type='factory.verifier_cleanup_unknown' AND payload->>'leaseOwner'=$2", [current.run_id, row.verification.lease_owner]);
        if (!prior.rowCount) await store.event(client, current, 'factory.verifier_cleanup_unknown', { leaseOwner: row.verification.lease_owner, providerSessionId: row.verification.provider_session_id, controlRequestId: requestId });
      });
    }
  }
  return applyFactoryCapabilityControl(store, clientId, requestId);
}
