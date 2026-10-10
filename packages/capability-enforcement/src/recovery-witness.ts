import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { PolicyConnection } from './postgres.ts';

export type RecoveryScope = { ownerId: string; organizationId: string; installationId: string };
export type RecoveryHead = RecoveryScope & { schema: 'capability-control.recovery-head.v1'; epoch: string; revision: number; digest: string };
export type RecoveryWitness = { directory: string; epoch: string };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value instanceof Date ? value.toISOString()
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;

export function configuredRecoveryWitness(env = process.env): RecoveryWitness | undefined {
  const directory = env.MYEVE_CAPABILITY_RECOVERY_WITNESS_DIRECTORY;
  const epoch = env.MYEVE_CAPABILITY_RECOVERY_EPOCH;
  if (!directory && !epoch) return undefined;
  if (!directory?.startsWith('/') || !epoch?.trim() || epoch.length > 255) throw Error('CAPABILITY_RECOVERY_CONFIGURATION');
  return { directory, epoch };
}

/** Enrollment is privileged database evidence; deleting process configuration cannot unenroll an owner. */
export async function assertRecoveryEnrollment(connection: PolicyConnection, scope: RecoveryScope, witness: RecoveryWitness | undefined) {
  const [enrollment] = (await connection.query(`SELECT epoch FROM capability_control.recovery_enrollments
    WHERE installation_id=$1 AND owner_id=$2`, [scope.installationId, scope.ownerId])).rows;
  if (enrollment && (!witness || enrollment.epoch !== witness.epoch)) throw Error('CAPABILITY_RECOVERY_WITNESS_REQUIRED');
  if (witness && !enrollment) throw Error('CAPABILITY_RECOVERY_ENROLLMENT_REQUIRED');
}

export async function recoveryHead(connection: PolicyConnection, scope: RecoveryScope, witness: RecoveryWitness): Promise<RecoveryHead> {
  const [state] = (await connection.query(`SELECT revision,preferences,budgets,controls FROM capability_control.owner_state
    WHERE installation_id=$1 AND owner_id=$2`, [scope.installationId, scope.ownerId])).rows;
  if (!state) throw Error('CAPABILITY_RECOVERY_ENROLLMENT_REQUIRED');
  const [installation] = (await connection.query('SELECT * FROM capability_control.installations WHERE id=$1 AND active', [scope.installationId])).rows;
  if (installation?.organization_id !== scope.organizationId) throw Error('CAPABILITY_RECOVERY_SCOPE');
  // These are existing privileged authority inputs, not another registry. Their changes
  // require trusted requalification; request handlers cannot reset the external witness.
  const inputs: Record<string, unknown> = { state, installation };
  for (const table of ['platform_owner_bindings', 'evidence', 'relay_agent_evidence', 'policy_destinations', 'recovery_enrollments']) {
    const rows = (await connection.query(`SELECT * FROM capability_control.${table} WHERE installation_id=$1 AND owner_id=$2`,
      [scope.installationId, scope.ownerId])).rows;
    inputs[table] = rows.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return { schema: 'capability-control.recovery-head.v1', ...scope, epoch: witness.epoch,
    revision: Number(state.revision), digest: digest(canonical(inputs)) };
}

async function filename(witness: RecoveryWitness, scope: RecoveryScope) {
  const directory = await lstat(witness.directory);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077)) throw Error('CAPABILITY_RECOVERY_CUSTODY');
  return join(witness.directory, digest([scope.organizationId, scope.installationId, scope.ownerId]) + '.json');
}
async function readHead(path: string): Promise<RecoveryHead> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077)) throw Error('CAPABILITY_RECOVERY_CUSTODY');
    const value = JSON.parse(await file.readFile('utf8'));
    if (value.schema !== 'capability-control.recovery-head.v1' || !Number.isSafeInteger(value.revision) || value.revision < 1
      || !/^[a-f0-9]{64}$/.test(value.digest) || ['epoch', 'ownerId', 'organizationId', 'installationId'].some(key => typeof value[key] !== 'string' || !value[key].length))
      throw Error('CAPABILITY_RECOVERY_CORRUPT');
    return value;
  } finally { await file.close(); }
}
function matches(actual: RecoveryHead, expected: RecoveryHead) {
  return ['schema', 'epoch', 'ownerId', 'organizationId', 'installationId', 'revision', 'digest']
    .every(key => actual[key as keyof RecoveryHead] === expected[key as keyof RecoveryHead]);
}
export async function assertRecoveryHead(witness: RecoveryWitness, expected: RecoveryHead) {
  let actual: RecoveryHead;
  try { actual = await readHead(await filename(witness, expected)); }
  catch { throw Error('CAPABILITY_RECOVERY_WITNESS_UNAVAILABLE'); }
  if (!matches(actual, expected)) throw Error('CAPABILITY_RECOVERY_QUARANTINED');
}

/** Provision only from a separately authorized controller against a verified current installation. Never called by request handlers. */
export async function initializeRecoveryWitness(witness: RecoveryWitness, head: RecoveryHead) {
  const path = await filename(witness, head);
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(head) + '\n'); await file.sync(); } finally { await file.close(); }
  const directory = await open(witness.directory, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Advance before the database commit. A failed/ambiguous commit quarantines instead of rolling the witness back. */
export async function advanceRecoveryWitness(witness: RecoveryWitness, previous: RecoveryHead, next: RecoveryHead) {
  if (matches(previous, next)) { await assertRecoveryHead(witness, previous); return; }
  if (next.revision <= previous.revision || ['epoch', 'ownerId', 'organizationId', 'installationId'].some(key => previous[key as keyof RecoveryHead] !== next[key as keyof RecoveryHead]))
    throw Error('CAPABILITY_RECOVERY_NON_MONOTONIC');
  const path = await filename(witness, previous), lock = await open(path + '.lock', 'wx', 0o600);
  const temporary = path + '.' + randomUUID();
  try {
    await assertRecoveryHead(witness, previous);
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(next) + '\n'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    const directory = await open(witness.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(temporary).catch(() => {}); await lock.close(); await unlink(path + '.lock'); }
}
