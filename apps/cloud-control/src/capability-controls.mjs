/** Co-located qualification adapter. Cross-database control transport is not enabled. */
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
    if (request.operation === 'pause') return { status: 'PENDING_BACKEND', reason: 'SAFE_SUSPENSION_UNQUALIFIED', accounting: 'PRESERVE_UNKNOWN' };
    if (request.operation !== 'revoke') throw Error('CAPABILITY_CONTROL_INVALID');
    const rows = (await client.query('SELECT * FROM factory.intake_receipts WHERE client_id=$1', [clientId])).rows;
    const fenced = [];
    for (const row of rows) {
      if (store.assertRecordScope) await store.assertRecordScope(client, row);
      const owner = (await client.query("SELECT payload FROM factory.events WHERE run_id=$1 AND type='factory.owner_scope_bound'", [row.run_id])).rows;
      if (owner.length !== 1 || owner[0].payload.ownerScope !== scope.ownerId) throw Error('CAPABILITY_OWNER_SCOPE_CHANGED');
      const previous = (await client.query("SELECT 1 FROM factory.events WHERE run_id=$1 AND type='factory.capability_revoked' AND payload->>'requestId'=$2", [row.run_id, requestId])).rows;
      if (!previous.length) {
        await store.event(client, row, 'factory.stop_requested', { source: 'capability-control', requestId, revision: request.revision });
        await store.event(client, row, 'factory.capability_revoked', { requestId, revision: request.revision, ownerId: scope.ownerId });
      }
      await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced',cancelled_at=COALESCE(cancelled_at,clock_timestamp()::text) WHERE work_id=$1 AND work_generation=$2", [row.work_id, row.work_generation]);
      await client.query('UPDATE factory.execution_resources SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()),lease_expires_at=least(lease_expires_at,clock_timestamp()),updated_at=clock_timestamp() WHERE run_id=$1', [row.run_id]);
      await client.query('UPDATE factory.verification_resources SET lease_expires_at=least(lease_expires_at,clock_timestamp()),updated_at=clock_timestamp() WHERE run_id=$1', [row.run_id]);
      fenced.push(row.run_id);
    }
    // Resource reconciliation owns cleanup evidence. Fencing cannot settle spend or prove a stop.
    return { status: 'PENDING_BACKEND', admissionFence: 'APPLIED', writers: 'FENCED',
      executionAuthority: 'INVALIDATED', cleanup: 'PENDING_BACKEND', accounting: 'PRESERVE_UNKNOWN', runIds: fenced };
  });
}
