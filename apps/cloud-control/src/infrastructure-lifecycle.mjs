// Qualification-only lifecycle, deliberately separate from canonical Work admission.
// The store serializes mutations and reserves the single unresolved allocation slot.
export async function executeInfrastructure(store, provider, id, now = Date.now) {
  const existing = await store.read(id);
  if (existing) return existing; // A repeated submission never dispatches again.
  const row = await store.reserve(id);
  let sandbox;
  let stage = 'ALLOCATION';
  try {
    sandbox = await provider.allocate(id, Math.floor(new Date(row.deadline).getTime() - now()));
    await store.update(id, { state: 'RUNNING', provider_session_id: sandbox.currentSession().sessionId });
    stage = 'EXECUTION';
    const bytes = await provider.execute(sandbox, command_id => store.update(id, { command_id }), async commandEvidence => store.update(id, { evidence: { ...(await store.read(id)).evidence, outcome: 'UNKNOWN', stage: 'EXECUTION', ...commandEvidence, modelOperations: 0 } }));
    stage = 'CUSTODY';
    const artifact = await provider.collect(id, bytes);
    await store.update(id, { state: 'COLLECTED', artifact_sha256: artifact.sha256, artifact_path: artifact.pathname, evidence: { outcome: 'PASS', stage: 'COLLECTED', artifactBytes: artifact.bytes, modelOperations: 0 } });
  } catch (error) {
    const code = /^[A-Z_]{3,80}$/.test(error.message ?? '') ? error.message : 'PROVIDER_OR_STORAGE_ERROR';
    const status = error.response?.status;
    await store.update(id, { state: 'UNKNOWN', evidence: { ...(await store.read(id)).evidence, outcome: 'UNKNOWN', stage, code, ...(Number.isInteger(status) ? {status} : {}), modelOperations: 0 } });
  } finally {
    // An allocation with no receipt may still complete after a 404. Keep its slot
    // fenced until explicit reconciliation after its original deadline + grace.
    if (sandbox) {
      try {
        await provider.destroy(row.provider_name, sandbox);
        await store.update(id, { state: 'DESTROYED', cleanup_confirmed: true });
      } catch {
        await store.update(id, { state: 'UNKNOWN', evidence: { outcome: 'UNKNOWN', stage: 'CLEANUP', modelOperations: 0 } });
      }
    }
  }
  return store.read(id);
}

export async function reconcileInfrastructure(store, provider, id, now = Date.now) {
  const row = await store.read(id);
  if (!row || row.cleanup_confirmed) return row;
  if (now() < new Date(row.deadline).getTime() + 30000) throw Error('RECONCILIATION_TOO_EARLY');
  // Recovery never re-runs a command or allocates another sandbox.
  await provider.destroy(row.provider_name);
  await store.update(id, { state: 'DESTROYED', cleanup_confirmed: true, evidence: { ...row.evidence, outcome: row.evidence.outcome ?? 'UNKNOWN', reconciled: true } });
  return store.read(id);
}
