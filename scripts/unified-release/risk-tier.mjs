const DEVELOPMENT = new Set(['SOURCE_EDIT', 'UNIT_TEST', 'SYNTHETIC_FIXTURE', 'LOCAL_POSTGRES', 'LOCAL_BROWSER', 'STATIC_ANALYSIS', 'DISPOSABLE_BUILD']);
const QUALIFICATION = new Set(['ISOLATED_CI', 'INDEPENDENT_REVIEW', 'FRESH_CLONE', 'EVIDENCE_CHECK']);
const PRODUCTION = new Set(['MERGE', 'DEPLOY', 'REAL_MIGRATION', 'PAID_EXECUTION', 'CREDENTIAL_CHANGE', 'TESTER_ACTIVATION', 'PUBLISH', 'CUSTODY_RETRY']);

/** A local planner decision, never an execution or spending credential. */
export function assessOperation(operation) {
  const deny = (reason) => ({ tier: 3, decision: 'CANONICAL_AUTHORIZATION_REQUIRED', reason, grantsExecutionAuthority: false });
  if (!operation || typeof operation !== 'object' || !Array.isArray(operation.effects) || !operation.effects.length) return deny('Explicit effect inventory required.');
  if (operation.effects.some((effect) => PRODUCTION.has(effect)) || operation.realUsers !== false || operation.realCredentials !== false || operation.protectedMaterial !== false || operation.costCeilingUsd !== 0) return deny('Real effects, credentials, protected material or spending require the owning authority.');
  if (operation.effects.every((effect) => DEVELOPMENT.has(effect))) {
    if (operation.environment !== 'DISPOSABLE_LOCAL') return deny('Development requires an explicitly disposable local environment.');
    return { tier: 1, decision: 'WITHIN_ENGINEERING_SCOPE', reason: 'Bounded local development under the existing user instruction.', grantsExecutionAuthority: false };
  }
  if (operation.effects.every((effect) => DEVELOPMENT.has(effect) || QUALIFICATION.has(effect))) {
    const q = operation.qualification;
    if (operation.environment !== 'ISOLATED_QUALIFICATION' || !q || !/^[a-f0-9]{40}$/.test(q.sourceSha ?? '') || !/^[a-f0-9]{64}$/.test(q.evidenceDigest ?? '') || q.reproducible !== true || q.cleanupVerified !== true || !Number.isSafeInteger(q.maxSeconds) || q.maxSeconds <= 0 || q.maxSeconds > 3600 || !q.implementer || !q.reviewer || q.implementer === q.reviewer) return { tier: 2, decision: 'QUALIFICATION_REQUIREMENTS_MISSING', reason: 'Exact source, bounded time, evidence integrity, independent review, reproducibility and cleanup are required.', grantsExecutionAuthority: false };
    return { tier: 2, decision: 'WITHIN_ENGINEERING_SCOPE', reason: 'Isolated verification conditions are satisfied.', grantsExecutionAuthority: false };
  }
  return deny('Unknown effects do not inherit development permission.');
}
