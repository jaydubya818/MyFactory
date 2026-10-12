// Evidence association only. Owning systems remain the identity and authorization authorities.
export const INSTALLATION_SLOTS = ['PLATFORM_OWNER', 'TESTER_1', 'TESTER_2'];
export const INSTALLATION_FIELDS = ['identity', 'ownerBinding', 'clerkApplication', 'missionControlWorkspace', 'myappsRegistry', 'relayConfiguration', 'capabilityPolicy', 'factoryVersion'];
export const GOLDEN_STAGES = ['AUTHENTICATE', 'SOFIE_PROPOSAL', 'OWNER_APPROVAL', 'MISSION', 'WORKORDER', 'FACTORY_ADMISSION', 'EXECUTE', 'VERIFY', 'RESULT_PROOF', 'INSTALL_APPROVAL', 'MYAPPS_INSTALL', 'OWNER_ACCEPTANCE', 'RELAY_ACTIVITY', 'FOLLOW_UP', 'UPDATE', 'ROLLBACK', 'RECONNECT'];
export const NEGATIVE_CASES = ['UNAUTHORIZED_OWNER', 'CROSS_OWNER', 'REVOKED_CAPABILITY', 'EXPIRED_POLICY', 'STALE_LEASE', 'DUPLICATE_WORK', 'DUPLICATE_WORKORDER', 'BUDGET_EXHAUSTION', 'EXPIRED_PRICING', 'UNKNOWN_EXPOSURE', 'FAILED_VERIFICATION', 'INVALID_PROOF', 'MISSING_INSTALL_APPROVAL', 'FAILED_MIGRATION', 'ROLLBACK', 'INTERRUPTED_EXECUTION', 'RESTART_RECONNECT'];
export const JOURNEY_IDENTITIES = ['owner', 'installation', 'conversation', 'mission', 'work', 'workOrder', 'factoryExecution', 'result', 'proof', 'application', 'capabilityPolicy', 'factoryVersion'];
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function pointerValue(record, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw Error('CANONICAL_POINTER_INVALID');
  let current = record;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) throw Error('CANONICAL_POINTER_MISSING');
    current = current[key];
  }
  return current;
}

export function resolveInstallation(installation, record) {
  if (!INSTALLATION_SLOTS.includes(installation.slot) || !exactKeys(installation.canonicalPointers, INSTALLATION_FIELDS)) throw Error('INSTALLATION_CANONICAL_BINDING_INVALID');
  const bindings = {};
  for (const field of INSTALLATION_FIELDS) {
    const value = pointerValue(record, installation.canonicalPointers[field]);
    if (!nonempty(value) || value !== installation[field]) throw Error('INSTALLATION_CANONICAL_VALUE_MISMATCH');
    bindings[field] = value;
  }
  return bindings;
}

const sameSources = (actual, expected) => exactKeys(actual, Object.keys(expected)) && Object.entries(expected).every(([id, sha]) => actual[id] === sha);
const sameReference = (actual, expected) => exactKeys(actual, ['root','path','sha256']) && ['root','path','sha256'].every(key => actual[key] === expected?.[key]);

export function verifyInstallationQualification(receipt, {releaseId, sourceShas, slot, bindings, canonicalRecord}) {
  return receipt?.schema === 'unified-installation-qualification/v1' && receipt.status === 'PASS' && receipt.releaseId === releaseId && receipt.slot === slot && sameSources(receipt.sourceShas, sourceShas) && sameReference(receipt.canonicalRecord, canonicalRecord) && exactKeys(receipt.bindings, INSTALLATION_FIELDS) && INSTALLATION_FIELDS.every(field => receipt.bindings[field] === bindings[field]);
}

/** No identity is inferred from a receipt's own declarations. Expected bindings are mandatory. */
export function verifyGoldenReceipt(receipt, expected) {
  const errors = [];
  if (!expected || !nonempty(expected.releaseId) || !INSTALLATION_SLOTS.includes(expected.slot) || !expected.sourceShas || !Object.keys(expected.sourceShas).length || !Object.values(expected.sourceShas).every(sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha)) || !['owner', 'installation', 'capabilityPolicy', 'factoryVersion'].every(key => nonempty(expected.identity?.[key]))) return ['Authoritative release and installation expectations required.'];
  if (receipt?.schema !== 'unified-installed-journey/v1' || receipt?.environment !== 'APPROVED_NONPRODUCTION' || receipt?.synthetic !== false) return ['Installed nonproduction receipt required.'];
  if (!sameSources(receipt.sourceShas, expected.sourceShas)) errors.push('Journey source tuple differs from selected release.');
  if (receipt.releaseId !== expected.releaseId || receipt.slot !== expected.slot) errors.push('Journey release or cohort slot differs from the selected release.');
  if (!receipt.canonicalIdentity || JOURNEY_IDENTITIES.some(id => !nonempty(receipt.canonicalIdentity[id]))) return [...errors, 'Complete canonical identity tuple required.'];
  for (const [key, value] of Object.entries(expected.identity)) if (receipt.canonicalIdentity[key] !== value) errors.push(`Selected installation: ${key} differs from authoritative binding`);
  if (!Array.isArray(receipt.stages) || !Array.isArray(receipt.negativeCases)) return [...errors, 'Stage and negative-case arrays required.'];
  for (const stage of GOLDEN_STAGES) {
    const rows = receipt.stages.filter(item => item?.stage === stage);
    if (rows.length !== 1 || rows[0].status !== 'PASS') { errors.push(`Missing or duplicate passing stage ${stage}`); continue; }
    for (const id of JOURNEY_IDENTITIES) if (rows[0].identity?.[id] !== receipt.canonicalIdentity[id]) errors.push(`${stage}: ${id} differs from canonical identity`);
  }
  for (const name of NEGATIVE_CASES) {
    const rows = receipt.negativeCases.filter(row => row?.id === name);
    if (rows.length !== 1 || rows[0].status !== 'PASS') errors.push(`Missing, duplicate or failed negative case ${name}`);
  }
  if (receipt.cleanup !== 'VERIFIED' || receipt.independentVerification !== 'PASS') errors.push('Cleanup and independent verification must pass.');
  return errors;
}

export function verifyGoldenCohort(receipt, {releaseId, sourceShas, installations}) {
  if (receipt?.schema !== 'unified-installed-cohort/v1' || receipt.releaseId !== releaseId || !Array.isArray(receipt.journeys) || receipt.journeys.length !== INSTALLATION_SLOTS.length) return ['Complete selected-release cohort receipt required.'];
  const errors = [];
  if (!exactKeys(receipt.sourceShas, Object.keys(sourceShas)) || Object.entries(sourceShas).some(([id, sha]) => receipt.sourceShas[id] !== sha)) errors.push('Journey source tuple differs from selected release.');
  for (const slot of INSTALLATION_SLOTS) {
    const binding = installations.get(slot), rows = receipt.journeys.filter(row => row?.slot === slot);
    if (!binding || rows.length !== 1) { errors.push(`${slot}: missing authoritative binding or unique journey`); continue; }
    errors.push(...verifyGoldenReceipt(rows[0], {releaseId, sourceShas, slot, identity:{owner:binding.ownerBinding, installation:binding.identity, capabilityPolicy:binding.capabilityPolicy, factoryVersion:binding.factoryVersion}}).map(message => `${slot}: ${message}`));
  }
  return errors;
}
