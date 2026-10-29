import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export type TextObjectKind = 'commit' | 'tree' | 'blob';
export type TextObjectReader = (kind: TextObjectKind, sha: string, maxBytes: number) => Promise<Buffer>;
const sha = (kind: TextObjectKind, bytes: Buffer) => createHash('sha1')
  .update(kind + ' ' + bytes.length + '\0').update(bytes).digest('hex');
function refuse(): never { throw new Error('LOCAL_V4_TEXT_INPUT_REFUSED'); }
function budget(deadline: number): void {
  if (!Number.isFinite(deadline) || performance.now() >= deadline) refuse();
}
const compare = (a: { name: string; directory: boolean }, b: { name: string; directory: boolean }) =>
  Buffer.compare(Buffer.from(a.name + (a.directory ? '/' : '')), Buffer.from(b.name + (b.directory ? '/' : '')));

/** Pure typed-data validation. Only the fixed host preparation closure supplies
 * native reads; this parser grants no Work, execution or source authority. */
function objectReader(read: TextObjectReader, deadline: number) {
  if (typeof read !== 'function') refuse();
  budget(deadline);
  return async (kind: TextObjectKind, id: string, limit: number) => {
    budget(deadline);
    if (!/^[a-f0-9]{40}$/.test(id)) refuse();
    const raw = await read(kind, id, limit); budget(deadline);
    if (!Buffer.isBuffer(raw) || raw.length > limit) refuse();
    const bytes = Buffer.from(raw);
    if (sha(kind, bytes) !== id) refuse();
    return bytes;
  };
}
export async function validateLocalV4TextTree(commit: string, read: TextObjectReader, deadline: number) {
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit)) refuse();
  const object = objectReader(read, deadline);
  const rawCommit = await object('commit', commit, 65536), split = rawCommit.indexOf('\n\n');
  if (split < 0 || rawCommit.subarray(0, split).includes(0)) refuse();
  const headers = rawCommit.subarray(0, split).toString('utf8').split('\n');
  if (!/^tree [a-f0-9]{40}$/.test(headers[0]) || headers.filter(line => /^tree(?:\s|$)/.test(line)).length !== 1) refuse();
  const root = await validateLocalV4RootTextTree(headers[0].slice(5), read, deadline);
  return Object.freeze({ inputCommit: commit, ...root });
}

/** Pure root graph only. This entry never invents a commit or execution basis. */
export async function validateLocalV4RootTextTree(inputTree: string, read: TextObjectReader, deadline: number) {
  if (typeof inputTree !== 'string' || !/^[a-f0-9]{40}$/.test(inputTree)) refuse();
  const object = objectReader(read, deadline), files: Record<string, string> = Object.create(null);
  const folded = new Map<string, { path: string; directory: boolean }>();
  let entries = 0, directories = 0, fileCount = 0, metadata = 0, jsonBytes = 2;
  const activeTrees = new Set<string>();
  const walk = async (id: string, prefix: string, depth: number): Promise<void> => {
    budget(deadline);
    if (++directories > 128 || activeTrees.has(id)) refuse(); activeTrees.add(id);
    const raw = await object('tree', id, 65536); metadata += raw.length; if (metadata > 524288) refuse();
    let offset = 0, previous: { name: string; directory: boolean } | undefined;
    const names = new Set<string>();
    while (offset < raw.length) {
      budget(deadline);
      if (++entries > 200 || depth + 1 > 16) refuse();
      const space = raw.indexOf(32, offset), nul = raw.indexOf(0, space + 1);
      if (space <= offset || space - offset > 6 || nul <= space + 1 || nul - space - 1 > 240 || nul + 21 > raw.length) refuse();
      const modeBytes = raw.subarray(offset, space); if (modeBytes.some(byte => byte > 127)) refuse();
      const mode = modeBytes.toString('ascii'), nameBytes = raw.subarray(space + 1, nul);
      if (nameBytes.some(byte => byte > 127)) refuse();
      const name = nameBytes.toString('ascii'), directory = mode === '40000', path = prefix + name;
      if (!['40000', '100644'].includes(mode) || !/^[A-Za-z0-9_.-]+$/.test(name) ||
        ['.', '..', '.git'].includes(name.toLowerCase()) || path.length > 240 || path === '__proto__' || names.has(name)) refuse();
      const entry = { name, directory };
      if (previous && compare(previous, entry) >= 0) refuse(); previous = entry; names.add(name);
      const alias = folded.get(path.toLowerCase());
      if (alias && (alias.path !== path || alias.directory !== directory)) refuse();
      folded.set(path.toLowerCase(), { path, directory });
      const child = raw.subarray(nul + 1, nul + 21).toString('hex'); offset = nul + 21;
      if (directory) await walk(child, path + '/', depth + 1);
      else {
        if (++fileCount > 200) refuse();
        const bytes = await object('blob', child, 100000), value = bytes.toString('utf8');
        if (bytes.includes(0) || !Buffer.from(value).equals(bytes)) refuse();
        jsonBytes += (fileCount > 1 ? 1 : 0) + Buffer.byteLength(JSON.stringify(path)) + 1 + Buffer.byteLength(JSON.stringify(value));
        if (jsonBytes > 500000) refuse();
        Object.defineProperty(files, path, { value, enumerable: true });
      }
    }
    if (offset !== raw.length) refuse(); activeTrees.delete(id); budget(deadline);
  };
  await walk(inputTree, '', 0);
  if (!fileCount || Buffer.byteLength(JSON.stringify(files)) !== jsonBytes) refuse();
  // Independently reconstruct the complete canonical map, including Git's
  // directory ordering. Hidden empty directories or omitted entries cannot pass.
  const reconstruct = (prefix: string): string => {
    budget(deadline); const children = new Map<string, boolean>();
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length), slash = rest.indexOf('/');
      children.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
    }
    const data = [...children].map(([name, directory]) => ({ name, directory })).sort(compare).flatMap(entry => {
      const child = entry.directory ? reconstruct(prefix + entry.name + '/') : sha('blob', Buffer.from(files[prefix + entry.name]));
      return [Buffer.from((entry.directory ? '40000' : '100644') + ' ' + entry.name + '\0'), Buffer.from(child, 'hex')];
    });
    return sha('tree', Buffer.concat(data));
  };
  if (reconstruct('') !== inputTree) refuse(); budget(deadline);
  return Object.freeze({ inputTree, files: Object.freeze(files) });
}
