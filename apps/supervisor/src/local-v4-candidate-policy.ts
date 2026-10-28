import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ActionError } from './actions.ts';
import { createLocalV4Preparation, inspectLocalV4Candidate } from './local-v4-preparation.ts';

const PATCH_BYTES = 2 * 1024 * 1024;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const objectHash = (kind: string, bytes: Buffer) => createHash('sha1')
  .update(kind + ' ' + bytes.length + '\0').update(bytes).digest('hex');
const publicMessage = 'Candidate export is unavailable; investigation is required';
class PolicyError extends ActionError {
  readonly kind: 'unsupported' | 'uncertain';
  constructor(kind: 'unsupported' | 'uncertain') { super(publicMessage, 'candidate_policy_hold', 503); this.kind = kind; }
}
export function candidatePolicyKind(error: unknown): 'unsupported' | 'uncertain' | null {
  return error instanceof PolicyError ? error.kind : null;
}
export function candidatePolicyFailure(error: unknown): ActionError {
  return error instanceof PolicyError ? error : new PolicyError('uncertain');
}
function unsupported(): never { throw new PolicyError('unsupported'); }
function uncertain(): never { throw new PolicyError('uncertain'); }
function timely(deadline: number): void { if (!Number.isFinite(deadline) || performance.now() >= deadline) uncertain(); }
function text(bytes: Buffer, allowNul = false): string {
  const value = bytes.toString('utf8');
  if (!allowNul && bytes.includes(0) || !Buffer.from(value).equals(bytes)) unsupported();
  return value;
}
type TextTree = Readonly<{ inputCommit: string; inputTree: string; files: Readonly<Record<string, string>> }>;
export type CandidateMaterial = Readonly<{
  base: TextTree; candidate: TextTree; rawCommit: Buffer; rawTree: Buffer; patch: Buffer; numstat: Buffer;
}>;

/** Pure format validation. It cannot issue an accepted native material guard. */
export function validateLocalV4CandidateMaterial(material: CandidateMaterial): void {
  const { base, candidate, rawCommit, rawTree, patch, numstat } = material;
  if (!/^[a-f0-9]{40}$/.test(base.inputCommit) || !/^[a-f0-9]{40}$/.test(candidate.inputCommit) ||
      rawCommit.length > 65536 || rawTree.length > 65536 || objectHash('commit', rawCommit) !== candidate.inputCommit ||
      objectHash('tree', rawTree) !== candidate.inputTree || patch.length === 0 || patch.length > PATCH_BYTES || numstat.length > 65536) unsupported();
  const commit = text(rawCommit), split = commit.indexOf('\n\n'), headers = commit.slice(0, split).split('\n');
  if (split < 0 || headers[0] !== 'tree ' + candidate.inputTree ||
      headers.filter(line => /^tree(?:\s|$)/.test(line)).length !== 1 ||
      JSON.stringify(headers.filter(line => /^parent(?:\s|$)/.test(line))) !== JSON.stringify(['parent ' + base.inputCommit])) unsupported();
  const value = text(patch), stats = text(numstat, true);
  if (/^(?:GIT binary patch|Binary files .+ differ|copy (?:from|to) |rename (?:from|to) |(?:old|new) mode |(?:new|deleted) file mode (?!100644$))/m.test(value)) unsupported();
  const declared: string[] = [];
  for (const line of value.split('\n')) {
    if (!line.startsWith('diff ')) continue;
    const match = /^diff --git a\/([A-Za-z0-9_./-]+) b\/([A-Za-z0-9_./-]+)$/.exec(line);
    if (!match || match[1] !== match[2] || declared.length >= 200) unsupported();
    const path = match[1];
    if (path.length > 240 || path.startsWith('/') || path === '__proto__' || path.split('/').some(part => !part || ['.', '..', '.git'].includes(part.toLowerCase()))) unsupported();
    declared.push(path);
  }
  if (!declared.length || new Set(declared).size !== declared.length || !stats.endsWith('\0')) unsupported();
  const observed = stats.slice(0, -1).split('\0').map(row => {
    const match = /^(?:0|[1-9][0-9]*)\t(?:0|[1-9][0-9]*)\t([A-Za-z0-9_./-]+)$/.exec(row);
    if (!match) unsupported(); return match[1];
  });
  const changed = [...new Set([...Object.keys(base.files), ...Object.keys(candidate.files)])]
    .filter(path => base.files[path] !== candidate.files[path]).sort();
  if (!changed.length || changed.length > 200 || JSON.stringify([...declared].sort()) !== JSON.stringify(changed) ||
      JSON.stringify([...observed].sort()) !== JSON.stringify(changed) || new Set(observed).size !== observed.length) unsupported();
}

type Purpose = 'pre-ready' | 'read' | 'freeze';
type CandidateInput = Readonly<{
  repository: string; inputCommit: string; inputTree: string; candidateCommit: string; candidateTree: string;
  runId: string; diffPath: string; diffSha256: string;
}>;
type Guard = Readonly<object>;
type GuardRecord = {
  purpose: Purpose; binding: string; invocation: object; deadline: number; material: CandidateMaterial;
  patchPath: string; patchDigest: string;
};

/** One fixed native issuer per producer. No public data-only constructor mints a
 * guard; raw buffers stay private, and each top-level call consumes once. */
export class LocalV4CandidatePolicy {
  #guards = new WeakMap<Guard, GuardRecord>();
  #preparation: ReturnType<typeof createLocalV4Preparation>;
  #dataDir: string;
  constructor(dataDir: string) { this.#dataDir = dataDir; this.#preparation = createLocalV4Preparation(dataDir); }

  #patch(path: string, runId: string): Buffer {
    const base = realpathSync(join(this.#dataDir, 'artifacts', runId)), actual = realpathSync(path);
    if (!actual.startsWith(base + sep)) uncertain();
    const fd = openSync(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      if (!before.isFile()) uncertain();
      if (before.size > PATCH_BYTES) unsupported();
      const bytes = Buffer.alloc(before.size + 1); let size = 0;
      while (size < bytes.length) { const count = readSync(fd, bytes, size, bytes.length - size, null); if (!count) break; size += count; }
      const after = fstatSync(fd);
      if (size !== before.size || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || realpathSync(path) !== actual) uncertain();
      return Buffer.from(bytes.subarray(0, size));
    } finally { closeSync(fd); }
  }

  async observe(input: CandidateInput, purpose: Purpose, binding: string, invocation: object, observationDeadline = performance.now() + 30000): Promise<Guard> {
    const deadline = Math.min(observationDeadline, performance.now() + 30000);
    try {
      timely(deadline);
      const retained = this.#patch(input.diffPath, input.runId);
      if (hash(retained) !== input.diffSha256) uncertain();
      const material = await inspectLocalV4Candidate(this.#preparation, input, deadline);
      timely(deadline); validateLocalV4CandidateMaterial(material);
      if (!retained.equals(material.patch) || !this.#patch(input.diffPath, input.runId).equals(retained)) uncertain();
      timely(deadline);
      const guard = Object.freeze(Object.create(null));
      this.#guards.set(guard, { purpose, binding, invocation, deadline, material,
        patchPath: input.diffPath, patchDigest: input.diffSha256 });
      return guard;
    } catch (error) {
      if (error instanceof PolicyError) throw error;
      if (error instanceof Error && error.message === 'LOCAL_V4_CANDIDATE_FORMAT_UNSUPPORTED') unsupported();
      uncertain();
    }
  }

  consume(guard: Guard, purpose: Purpose, binding: string, invocation: object, runId: string) {
    const record = this.#guards.get(guard); this.#guards.delete(guard);
    if (!record || record.purpose !== purpose || record.binding !== binding || record.invocation !== invocation) uncertain();
    timely(record.deadline);
    if (hash(this.#patch(record.patchPath, runId)) !== record.patchDigest) uncertain();
    const { material } = record;
    // The unchanged shared helper can request only these exact guarded objects.
    const git = (args: string[]): Buffer => {
      timely(record.deadline);
      const requests: [string[], Buffer][] = [
        [['cat-file', 'commit', material.candidate.inputCommit], material.rawCommit],
        [['cat-file', 'tree', material.candidate.inputTree], material.rawTree],
        [['show', '--format=', '--binary', '--no-ext-diff', '--no-textconv', material.candidate.inputCommit], material.patch],
      ];
      const found = requests.find(([request]) => JSON.stringify(request) === JSON.stringify(args));
      if (!found) uncertain(); return Buffer.from(found[1]);
    };
    return Object.freeze({ git, assertCurrent: () => timely(record.deadline) });
  }
}
