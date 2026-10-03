import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export const EVIDENCE_KINDS = ['TestEvidence', 'ScreenshotEvidence', 'VideoEvidence', 'BrowserJourneyEvidence', 'AccessibilityEvidence', 'PerformanceEvidence', 'DiffEvidence'] as const;
export type EvidenceKind = typeof EVIDENCE_KINDS[number];
export interface EvidenceBinding {
  workOrderId: string;
  runId: string;
  candidateCommit: string;
  factoryVersion: string;
}
export interface EvidenceRef extends EvidenceBinding {
  id: string;
  kind: EvidenceKind;
  mediaType: string;
  sha256: string;
  size: number;
  relativePath: string;
  collectedAt: string;
  source: string;
}
export interface EvidencePolicy {
  requiredKinds: EvidenceKind[];
  policyRevision: string;
}
export function evidencePolicyFor(workerProfile: 'container' | 'mac' | 'browser'): EvidencePolicy {
  return { policyRevision: 'factory-verification-v1', requiredKinds: workerProfile === 'browser'
    ? ['TestEvidence', 'DiffEvidence', 'ScreenshotEvidence', 'BrowserJourneyEvidence']
    : ['TestEvidence', 'DiffEvidence'] };
}
export interface EvidenceEvaluation {
  status: 'SATISFIED' | 'MISSING' | 'INVALID';
  checkedRefs: string[];
  missingKinds: EvidenceKind[];
  reason: string | null;
}

/** Opaque reference for a consumer Proof. Resolving bytes requires a separately authorized transport. */
export function proofEvidenceReference(ref: Omit<EvidenceRef, 'relativePath'>): string {
  return `factory-evidence:sha256:${createHash('sha256').update(JSON.stringify({
    workOrderId: ref.workOrderId, runId: ref.runId, candidateCommit: ref.candidateCommit,
    factoryVersion: ref.factoryVersion, kind: ref.kind, sha256: ref.sha256,
  })).digest('hex')}`;
}

export const EVIDENCE_LIMITS: Record<EvidenceKind, number> = {
  TestEvidence: 512 * 1024,
  ScreenshotEvidence: 2 * 1024 * 1024,
  VideoEvidence: 8 * 1024 * 1024,
  BrowserJourneyEvidence: 256 * 1024,
  AccessibilityEvidence: 512 * 1024,
  PerformanceEvidence: 256 * 1024,
  DiffEvidence: 4 * 1024 * 1024,
};
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const validId = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const validCommit = (value: string) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);

function assertBinding(binding: EvidenceBinding): void {
  if (!validId(binding.workOrderId) || !validId(binding.runId) || !validCommit(binding.candidateCommit) || !/^[a-f0-9]{64}$/.test(binding.factoryVersion)) {
    throw new Error('Invalid evidence binding');
  }
}

/** The root must be the persistent Factory data directory, never a task worktree. */
export async function storeEvidence(root: string, binding: EvidenceBinding, kind: EvidenceKind, mediaType: string, source: string, bytes: Uint8Array): Promise<EvidenceRef> {
  assertBinding(binding);
  if (!EVIDENCE_KINDS.includes(kind) || !mediaType || !source || bytes.length > EVIDENCE_LIMITS[kind] || bytes.length === 0) throw new Error('Invalid evidence artifact');
  const id = randomUUID();
  const relativePath = join('evidence', binding.runId, `${id}-${sha(bytes)}`);
  const destination = resolve(root, relativePath);
  const directory = resolve(root, 'evidence', binding.runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(resolve(root, 'evidence'))).isDirectory() || !(await lstat(directory)).isDirectory())
    throw new Error('Evidence store contains a symlink or non-directory');
  const temporary = `${destination}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await rename(temporary, destination);
  const ref = { ...binding, id, kind, mediaType, sha256: sha(bytes), size: bytes.length, relativePath, collectedAt: new Date().toISOString(), source };
  const metadata = await open(`${destination}.json`, 'wx', 0o600);
  try { await metadata.writeFile(JSON.stringify(ref)); await metadata.sync(); } finally { await metadata.close(); }
  return ref;
}

export async function listEvidence(root: string, runId: string): Promise<EvidenceRef[]> {
  if (!validId(runId)) throw new Error('Invalid run identity');
  const directory = resolve(root, 'evidence', runId);
  try {
    if (!(await lstat(resolve(root, 'evidence'))).isDirectory() || !(await lstat(directory)).isDirectory())
      throw new Error('Evidence store contains a symlink or non-directory');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  let files: string[];
  try { files = await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const refs: EvidenceRef[] = [];
  for (const name of files.filter(name => name.endsWith('.json')).sort()) {
    if (!/^[a-f0-9-]{36}-[a-f0-9]{64}\.json$/.test(name)) throw new Error('Unexpected evidence metadata name');
    const path = join(directory, name);
    if (!(await lstat(path)).isFile()) throw new Error('Evidence metadata is not a regular file');
    refs.push(JSON.parse(await readFile(path, 'utf8')) as EvidenceRef);
  }
  return refs;
}

export async function evaluateEvidence(root: string, binding: EvidenceBinding, policy: EvidencePolicy, refs: EvidenceRef[]): Promise<EvidenceEvaluation> {
  assertBinding(binding);
  if (!policy.policyRevision || policy.requiredKinds.some(kind => !EVIDENCE_KINDS.includes(kind))) throw new Error('Invalid evidence policy');
  const checkedRefs: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.id) || !validId(ref.id) || !EVIDENCE_KINDS.includes(ref.kind) ||
      ref.workOrderId !== binding.workOrderId || ref.runId !== binding.runId || ref.candidateCommit !== binding.candidateCommit || ref.factoryVersion !== binding.factoryVersion ||
      !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.size) || ref.size <= 0 || ref.size > EVIDENCE_LIMITS[ref.kind]) {
      return { status: 'INVALID', checkedRefs, missingKinds: [], reason: 'Evidence provenance or metadata mismatch' };
    }
    seen.add(ref.id);
    const directory = resolve(root, 'evidence', binding.runId);
    const path = resolve(root, ref.relativePath);
    if (!path.startsWith(directory + sep) || ref.relativePath !== join('evidence', binding.runId, `${ref.id}-${ref.sha256}`))
      return { status: 'INVALID', checkedRefs, missingKinds: [], reason: 'Evidence path escapes durable store' };
    try {
      if (!(await lstat(resolve(root, 'evidence'))).isDirectory() || !(await lstat(directory)).isDirectory()) throw new Error('Evidence directory changed');
      const details = await lstat(path);
      const bytes = await readFile(path);
      if (!details.isFile() || details.size !== ref.size || sha(bytes) !== ref.sha256) throw new Error('Artifact changed');
      if (ref.kind === 'ScreenshotEvidence' &&
        (ref.mediaType !== 'image/png' || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))) throw new Error('Invalid screenshot');
      if (ref.kind === 'BrowserJourneyEvidence') {
        if (ref.mediaType !== 'application/json') throw new Error('Invalid journey media type');
        const observed = JSON.parse(bytes.toString('utf8')) as { httpStatus?: number; assertions?: { found?: boolean }[] };
        if (typeof observed.httpStatus !== 'number' || observed.httpStatus < 200 || observed.httpStatus >= 400 ||
          !Array.isArray(observed.assertions) || observed.assertions.length === 0 || observed.assertions.some(assertion => assertion.found !== true))
          throw new Error('Browser journey assertions failed');
      }
      const metadataPath = `${path}.json`;
      if (!(await lstat(metadataPath)).isFile() || JSON.stringify(JSON.parse(await readFile(metadataPath, 'utf8'))) !== JSON.stringify(ref))
        throw new Error('Evidence metadata changed');
    } catch {
      return { status: 'INVALID', checkedRefs, missingKinds: [], reason: `Evidence artifact missing or changed: ${ref.id}` };
    }
    checkedRefs.push(ref.id);
  }
  const missingKinds = [...new Set(policy.requiredKinds)].filter(kind => !refs.some(ref => ref.kind === kind));
  return { status: missingKinds.length ? 'MISSING' : 'SATISFIED', checkedRefs, missingKinds, reason: missingKinds.length ? 'Required evidence was not collected' : null };
}

/** One bounded, exact artifact. Callers must authorize Work and resolve the ref from its immutable event first. */
export async function readEvidenceArtifact(root: string, binding: EvidenceBinding, ref: EvidenceRef): Promise<Buffer> {
  const evaluation = await evaluateEvidence(root, binding, { policyRevision: 'transport-v1', requiredKinds: [ref.kind] }, [ref]);
  if (evaluation.status !== 'SATISFIED') throw new Error(`Evidence read denied: ${evaluation.reason}`);
  const path = resolve(root, ref.relativePath);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== ref.size || before.size > EVIDENCE_LIMITS[ref.kind]) throw new Error('Evidence size changed');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== ref.size || after.size !== ref.size || sha(bytes) !== ref.sha256) throw new Error('Evidence changed during read');
    return bytes;
  } finally { await handle.close(); }
}
