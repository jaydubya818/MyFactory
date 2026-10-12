import { canonical } from '../../../packages/hosted-routing/src/result.ts';
import { reconcileCloudWork } from './cloud-work-lifecycle.mjs';

const scopeKeys = ['agentId', 'environment', 'installationId', 'organizationId', 'ownerId'];
const qualifiedScope = scope => scope && typeof scope === 'object'
  && Object.keys(scope).sort().join(',') === scopeKeys.join(',')
  && scopeKeys.every(key => typeof scope[key] === 'string' && scope[key].trim() === scope[key] && scope[key].length > 0)
  && scope.environment === 'qualification';

function retainedScope(row, events) {
  const owners = events.filter(event => event.type === 'factory.owner_scope_bound');
  if (owners.length !== 1) return null;
  const owner = owners[0].payload;
  if (!owner || owner.workId !== row.work_id || owner.workGeneration !== row.work_generation
    || owner.requestId !== row.request_id || owner.repository !== row.request.repository) return null;
  const scope = { ownerId: owner.ownerScope, organizationId: owner.organizationId,
    installationId: owner.installationId, agentId: owner.agentId, environment: owner.environment };
  return qualifiedScope(scope) ? scope : null;
}

function retainedAdmission(row, events) {
  const admissions = events.filter(event => event.type === 'factory.capability_admitted');
  if (admissions.length !== 1) return null;
  const admission = admissions[0].payload;
  return admission?.capabilityId === 'myfactory' && Number.isSafeInteger(admission.policyRevision)
    && admission.policyRevision > 0 && admission.workId === row.work_id
    && admission.workGeneration === row.work_generation ? admission : null;
}

async function canonicalControl(client, scope, requestId) {
  await client.query("SELECT set_config('myeve.capability_owner',$1,true),set_config('myeve.capability_installation',$2,true)", [scope.ownerId, scope.installationId]);
  await client.query('SELECT capability_control.lock_admission_policy($1,$2,$3)', [scope.installationId, scope.ownerId, scope.agentId]);
  const installation = (await client.query('SELECT * FROM capability_control.installations WHERE id=$1', [scope.installationId])).rows[0];
  // Inactivity denies new admission, not fencing or cleanup of existing Work.
  if (!installation || installation.organization_id !== scope.organizationId || installation.environment !== scope.environment)
    throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');
  const request = (await client.query(`SELECT * FROM capability_control.control_requests
    WHERE installation_id=$1 AND owner_id=$2 AND request_id=$3`, [scope.installationId, scope.ownerId, requestId])).rows[0];
  if (!request) return null;
  if (!['myfactory', 'work'].includes(request.capability_id)) throw Error('CAPABILITY_CONTROL_SCOPE');
  if (!['pause', 'revoke'].includes(request.operation) || !Number.isSafeInteger(request.revision) || request.revision < 1)
    throw Error('CAPABILITY_CONTROL_INVALID');
  const state = (await client.query('SELECT revision FROM capability_control.owner_state WHERE installation_id=$1 AND owner_id=$2', [scope.installationId, scope.ownerId])).rows[0];
  if (!state || state.revision < request.revision) throw Error('CAPABILITY_CONTROL_POLICY_RESTORED');
  return request;
}

async function controlInventory(store, client, clientId) {
  const rows = (await client.query('SELECT * FROM factory.intake_receipts WHERE client_id=$1', [clientId])).rows;
  const histories = new Map();
  for (const row of rows) {
    if (row.client_id !== clientId) throw Error('CAPABILITY_CONTROL_SCOPE');
    if (store.assertRecordScope) await store.assertRecordScope(client, row);
    histories.set(row.run_id, (await client.query('SELECT type,payload FROM factory.events WHERE run_id=$1 ORDER BY id', [row.run_id])).rows);
  }
  return {rows, histories};
}

/** Co-located qualification adapter. Server installation bindings and restricted
 * policy rows authenticate requests; returned JSON is not a portable grant. */
export async function applyFactoryCapabilityControl(store, clientId, requestId) {
  const binding = store.capabilityBindings?.[clientId];
  if (binding !== undefined && !qualifiedScope(binding)) throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');
  // Without a current binding, a trusted server must still authenticate each
  // original intake. Caller-supplied client IDs and event contents are not grants.
  if (!binding && typeof store.assertRecordScope !== 'function') throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');
  return store.transaction(async client => {
    // Pre-lock reads discover candidate scopes only; never use them to assert a
    // complete inventory or to apply a control after waiting for policy locks.
    const discovery = await controlInventory(store, client, clientId), candidates = new Map();
    for (const row of discovery.rows) {
      const events = discovery.histories.get(row.run_id);
      const scope = retainedScope(row, events);
      if (scope && retainedAdmission(row, events)) candidates.set(canonical(scope), scope);
    }
    const scopes = binding ? [binding] : [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([,scope]) => scope);
    if (!scopes.length) throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');
    const matches = [];
    for (const scope of scopes) {
      const request = await canonicalControl(client, scope, requestId);
      if (request) matches.push({scope, request});
    }
    // A control must select one canonical scope, never the first returned row.
    if (matches.length !== 1) throw Error('CAPABILITY_CONTROL_SCOPE');
    const {scope, request} = matches[0];
    await client.query("SELECT set_config('myeve.capability_owner',$1,true),set_config('myeve.capability_installation',$2,true)", [scope.ownerId, scope.installationId]);
    const {rows, histories} = await controlInventory(store, client, clientId);
    const receipts = [], unqualifiedRuns = [];
    for (const row of rows) {
      const events = histories.get(row.run_id), retained = retainedScope(row, events);
      if (!retained || canonical(retained) !== canonical(scope)) {
        // Older source did not persist every binding. Do not guess ownership or
        // roll back qualified controls for unrelated, exactly bound Runs.
        const unresolved = { runId: row.run_id, requestId: row.request_id, status: 'PENDING_BACKEND', reason: 'CAPABILITY_OWNER_SCOPE_UNQUALIFIED' };
        unqualifiedRuns.push(unresolved);
        continue;
      }
      const admission = retainedAdmission(row, events);
      if (!admission)
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
