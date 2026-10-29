import { createHash, randomUUID } from 'node:crypto';
import { constants, chmodSync, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, opendirSync, readSync, realpathSync, writeSync, type Stats } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { planCheckpoint } from './local-v4-checkpoint-policy.ts';
import { verificationInputFailure, verificationInputFence, verificationInputHold,
  type VerificationInputFence, type VerificationSourceData, type SourceArtifactDescriptor } from './local-v4-verification-input-policy.ts';

type Observation = { identity: string; size: number; sha256: string };
type ArtifactRecord = { source: VerificationSourceData; binding: string; container: string;
  directories: Map<string, { identity: string; children: string[] }>;
  files: Map<string, Observation>; manifest: Observation; descriptor: SourceArtifactDescriptor };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const stable = (s: Stats) => [s.dev, s.ino, s.uid, s.mode].join(':');
const full = (s: Stats) => [stable(s), s.nlink, s.size, s.mtimeMs, s.ctimeMs].join(':');
const sourceDigest = (source: VerificationSourceData) => sha256(Buffer.from(JSON.stringify(source)));

/** Owned source bytes only. This store cannot issue native, C or Result authority. */
export function createLocalV4SourceArtifacts(dataDir: string) {
  if (!isAbsolute(dataDir) || resolve(dataDir) !== dataDir || dataDir.length > 4096 || /[\x00-\x1f\x7f]/.test(dataDir)) verificationInputHold();
  const records = new WeakMap<SourceArtifactDescriptor, ArtifactRecord>();
  const issued = new Set<string>();
  const uncertain = new WeakSet<SourceArtifactDescriptor>();
  const scope = new Map<string, string>();
  const parent = join(dataDir, 'verification-inputs');
  let instance: string | undefined, failed = false;
  const directory = (path: string, sharedAncestor = false): string => {
    if (realpathSync(path) !== path) verificationInputHold();
    const s = lstatSync(path), uid = process.getuid!();
    if (!s.isDirectory() || (s.uid !== uid && (!sharedAncestor || s.uid !== 0)) ||
      ((s.mode & 0o022) !== 0 && (!sharedAncestor || !(s.mode & 0o1000)))) verificationInputHold();
    return stable(s);
  };
  const guard = (fence: VerificationInputFence) => {
    if (failed) verificationInputHold();
    verificationInputFence(fence);
    try{for (const [path, identity] of scope) if (directory(path, path !== dataDir && path !== parent && path !== instance) !== identity) verificationInputHold();}
    catch(error){failed=true;throw error;}
  };
  const step = <T>(fence: VerificationInputFence, operation: () => T): T => {
    guard(fence); const value = operation(); guard(fence); return value;
  };
  const initialize = (fence: VerificationInputFence) => {
    if (instance) return;
    let path = dataDir;
    for (let count = 0; ; count++) {
      if (count >= 128) verificationInputHold();
      const identity=directory(path,path!==dataDir);if(scope.has(path)&&scope.get(path)!==identity)verificationInputHold();scope.set(path,identity);
      if (path === '/') break;
      path = dirname(path);
    }
    step(fence, () => {
      try { mkdirSync(parent, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      scope.set(parent, directory(parent));
    });
    const fresh = join(parent, randomUUID());
    step(fence, () => mkdirSync(fresh, { mode: 0o700 }));
    instance = fresh; scope.set(instance, directory(instance));
  };
  const write = (path: string, bytes: Buffer, mode: number, fence: VerificationInputFence): Observation => {
    guard(fence);const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      guard(fence);
      const first = fstatSync(fd);
      if (!first.isFile() || first.uid !== process.getuid!() || first.nlink !== 1 || first.size !== 0 || (first.mode & 0o777) !== 0o600) verificationInputHold();
      let offset = 0;
      while (offset < bytes.length) {
        const count = step(fence, () => writeSync(fd, bytes, offset, bytes.length - offset));
        if (count <= 0) verificationInputHold(); offset += count;
      }
      step(fence, () => fsyncSync(fd)); step(fence, () => fchmodSync(fd, mode)); step(fence, () => fsyncSync(fd));
      const last = fstatSync(fd);
      if (last.size !== bytes.length || last.nlink !== 1 || last.uid !== process.getuid!() ||
        (last.mode & 0o777) !== mode || full(last) !== full(lstatSync(path)) || realpathSync(path) !== path) verificationInputHold();
      return { identity: full(last), size: bytes.length, sha256: sha256(bytes) };
    } finally { closeSync(fd); }
  };
  const read = (path: string, expected: Observation, limit: number, fence: VerificationInputFence): Buffer => {
    if (expected.size > limit) verificationInputHold();
    guard(fence);const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      guard(fence);
      const before = fstatSync(fd);
      if (!before.isFile() || before.uid !== process.getuid!() || before.nlink !== 1 || full(before) !== expected.identity) verificationInputHold();
      const bytes = Buffer.alloc(expected.size + 1); let offset = 0;
      while (offset < bytes.length) {
        const count = step(fence, () => readSync(fd, bytes, offset, bytes.length - offset, null));
        if (!count) break; offset += count;
      }
      const after = fstatSync(fd);
      if (offset !== expected.size || full(after) !== expected.identity || full(lstatSync(path)) !== expected.identity || realpathSync(path) !== path) verificationInputHold();
      const observed = bytes.subarray(0, offset);
      if (sha256(observed) !== expected.sha256) verificationInputHold(); return observed;
    } finally { closeSync(fd); }
  };
  const verify = (record: ArtifactRecord, source: VerificationSourceData, binding: string, fence: VerificationInputFence) => {
    guard(fence);
    if (record.binding !== binding || sourceDigest(record.source) !== sourceDigest(source)) verificationInputHold();
    for (const [path, expected] of record.directories) {
      step(fence, () => {
        if (directory(path) !== expected.identity) verificationInputHold();
        const handle = opendirSync(path), names: string[] = [];
        try {
          for (let item = handle.readSync(); item; item = handle.readSync()) {
            guard(fence);
            if (names.length >= 202 || !expected.children.includes(item.name)) verificationInputHold();
            names.push(item.name);
          }
        } finally { handle.closeSync(); }
        if (JSON.stringify(names.sort()) !== JSON.stringify(expected.children)) verificationInputHold();
      });
    }
    const manifest = read(join(record.container, 'manifest.json'), record.manifest, 131072, fence);
    if (sha256(manifest) !== record.descriptor.manifestSha256) verificationInputHold();
    const files: { [path: string]: string } = Object.create(null);
    for (const [path, expected] of record.files) {
      const bytes = read(join(record.descriptor.path, path), expected, 100000, fence);
      if (!bytes.equals(Buffer.from(source.files[path]))) verificationInputHold();
      files[path] = bytes.toString('utf8');
    }
    guard(fence); return files;
  };
  return Object.freeze({
    async prepare(source: VerificationSourceData, binding: string, deadline: number, assertCurrent: VerificationInputFence): Promise<SourceArtifactDescriptor> {
      const fence=()=>{verificationInputFence(assertCurrent);if(!Number.isFinite(deadline)||performance.now()>=deadline)verificationInputHold();};
      try {
        guard(fence);
        if (!Object.isFrozen(source) || !Object.isFrozen(source.files) || !/^[a-f0-9]{64}$/.test(binding) || issued.has(binding)) verificationInputHold();
        const {files:sourceFiles,...metadata}=source;
        if(source.schema!=='local-v4-fixture-source/v1'||Buffer.byteLength(JSON.stringify(metadata))>8192)verificationInputHold();
        for (const property of Object.values(Object.getOwnPropertyDescriptors(source.files))) if (typeof property.value !== 'string') verificationInputHold();
        issued.add(binding);
        const plan = await planCheckpoint(source.files, deadline); guard(fence);
        if (plan.tree !== source.tree || performance.now() >= deadline) verificationInputHold();
        initialize(fence);
        const container = join(instance!, randomUUID()), sourceRoot = join(container, 'source');
        step(fence, () => mkdirSync(container, { mode: 0o700 })); step(fence, () => mkdirSync(sourceRoot, { mode: 0o700 }));
        const children = new Map<string, Set<string>>([[sourceRoot, new Set()]]);
        const directories = new Set<string>([sourceRoot]);
        const paths = Object.keys(source.files).sort();
        for (const path of paths) {
          let absolute = sourceRoot; const parts = path.split('/');
          for (const part of parts.slice(0, -1)) {
            children.get(absolute)!.add(part); absolute = join(absolute, part);
            if (!directories.has(absolute)) {
              step(fence, () => mkdirSync(absolute, { mode: 0o700 })); directories.add(absolute); children.set(absolute, new Set());
            }
          }
          children.get(absolute)!.add(parts.at(-1)!);
        }
        const files = new Map<string, Observation>();
        for (const path of paths) files.set(path, write(join(sourceRoot, path), Buffer.from(source.files[path]), 0o444, fence));
        const manifestBytes = Buffer.from(JSON.stringify({ schema: 'local-v4-source-artifact/v1', binding, runId: source.runId,
          workOrderId: source.workOrderId, kind: source.kind, commit: source.commit, tree: source.tree,
          files: paths.map(path => ({ path, mode: '100644', size: files.get(path)!.size, sha256: files.get(path)!.sha256 })) }));
        if (manifestBytes.length > 131072) verificationInputHold();
        const manifest = write(join(container, 'manifest.json'), manifestBytes, 0o600, fence);
        for (const path of [...directories].sort((a, b) => b.length - a.length)) step(fence, () => chmodSync(path, 0o555));
        const observedDirectories = new Map<string, { identity: string; children: string[] }>();
        for (const path of directories) observedDirectories.set(path, { identity: directory(path), children: [...children.get(path)!].sort() });
        observedDirectories.set(container, { identity: directory(container), children: ['manifest.json', 'source'] });
        const descriptor = Object.freeze({ schema: 'local-v4-source-artifact/v1' as const, path: sourceRoot, tree: source.tree, manifestSha256: sha256(manifestBytes) });
        if (Buffer.byteLength(JSON.stringify(descriptor)) > 8192) verificationInputHold();
        const record = { source, binding, container, directories: observedDirectories, files, manifest, descriptor };
        const actual = verify(record, source, binding, fence);
        const readback = await planCheckpoint(actual, deadline); guard(fence);
        if (readback.tree !== source.tree) verificationInputHold(); records.set(descriptor, record); return descriptor;
      } catch (error) { throw verificationInputFailure(error); }
    },
    assert(descriptor: SourceArtifactDescriptor, source: VerificationSourceData, binding: string, fence: VerificationInputFence): void {
      try {
        const record = records.get(descriptor); if (!record||uncertain.has(descriptor)) verificationInputHold();
        verify(record, source, binding, fence);
      } catch (error) { if(records.has(descriptor))uncertain.add(descriptor);throw verificationInputFailure(error); }
    },
  });
}
