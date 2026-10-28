// Tiny pure data fixtures only. No native malformed objects, compressed data,
// resource-growth, timeout, hook, child, provider or protected experiments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { validateLocalV4TextTree } from '../src/local-v4-text-tree.ts';
function fixture() {
  const objects = new Map(), calls = [];
  const put = (kind, value) => {
    const bytes = Buffer.from(value), id = createHash('sha1').update(kind + ' ' + bytes.length + '\0').update(bytes).digest('hex');
    objects.set(id, { kind, bytes }); return id;
  };
  const tree = entries => put('tree', Buffer.concat(entries.flatMap(([mode, name, id]) => [Buffer.from(mode + ' ' + name + '\0'), Buffer.from(id, 'hex')])));
  const finish = (root, header = 'tree ' + root) => put('commit', header + '\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nOrdinary pure fixture\n');
  const read = async (kind, id, limit) => {
    calls.push({ kind, id, limit }); const value = objects.get(id); assert(value); assert.equal(value.kind, kind);
    assert(value.bytes.length <= limit); return value.bytes;
  };
  return { objects, calls, put, tree, finish, read, validate: commit => validateLocalV4TextTree(commit, read, performance.now() + 30000) };
}
test('text input data: exact nested UTF8 and BOM bytes reconstruct the immutable root', async () => {
  const f = fixture(), content = '\ufeffcafé\n', blob = f.put('blob', content), nested = f.tree([['100644', 'sample.txt', blob]]);
  const root = f.tree([['40000', 'src', nested]]), commit = f.finish(root), result = await f.validate(commit);
  assert.equal(result.inputCommit, commit); assert.equal(result.inputTree, root); assert.equal(result.files['src/sample.txt'], content);
  assert.deepEqual(Object.keys(result.files), ['src/sample.txt']); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.files));
});
test('text input data: repeated blob identity counts and retains both logical file paths', async () => {
  const f = fixture(), blob = f.put('blob', 'same\n'), root = f.tree([['100644', 'a.txt', blob], ['100644', 'b.txt', blob]]);
  const result = await f.validate(f.finish(root)); assert.deepEqual(Object.keys(result.files), ['a.txt', 'b.txt']);
  assert.equal(f.calls.filter(call => call.kind === 'blob').length, 2);
});
test('text input data: Git directory ordering is distinct from plain name ordering', async () => {
  const f = fixture(), blob = f.put('blob', 'ordinary\n'), nested = f.tree([['100644', 'child.txt', blob]]);
  const root = f.tree([['100644', 'a.txt', blob], ['40000', 'a', nested]]), result = await f.validate(f.finish(root));
  assert.equal(result.inputTree, root); assert.deepEqual(Object.keys(result.files), ['a.txt', 'a/child.txt']);
});
test('text input data: changed raw bytes cannot retain the original typed blob identity', async () => {
  const f = fixture(), blob = f.put('blob', 'before\n'), root = f.tree([['100644', 'a.txt', blob]]), commit = f.finish(root);
  await assert.rejects(validateLocalV4TextTree(commit, async (kind, id, limit) => kind === 'blob' ? Buffer.from('after\n') : f.read(kind, id, limit), performance.now() + 30000), /TEXT_INPUT_REFUSED/);
});
test('text input data: wrong typed root identity refuses even when raw bytes are available', async () => {
  const f = fixture(), raw = Buffer.from('100644 sample.txt\0' + 'x'.repeat(20)), root = f.put('blob', raw), commit = f.finish(root);
  await assert.rejects(validateLocalV4TextTree(commit, async (_kind, id) => f.objects.get(id).bytes, performance.now() + 30000), /TEXT_INPUT_REFUSED/);
});
for (const [name, bytes] of [['NUL', Buffer.from([97, 0, 98])], ['invalid UTF8', Buffer.from([0xc3, 0x28])]]) test(`text input data: ${name} tiny blob refuses`, async () => {
  const f = fixture(), blob = f.put('blob', bytes), root = f.tree([['100644', 'sample.txt', blob]]);
  await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
test('text input data: top-level __proto__ refuses before blob reads for current consumer compatibility', async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), root = f.tree([['100644', '__proto__', blob]]);
  await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/); assert.equal(f.calls.filter(call => call.kind === 'blob').length, 0);
});
test('text input data: nested __proto__ is an ordinary full map key', async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), nested = f.tree([['100644', '__proto__', blob]]), root = f.tree([['40000', 'src', nested]]);
  const result = await f.validate(f.finish(root)); assert.equal(result.files['src/__proto__'], 'ok'); assert(Object.hasOwn(result.files, 'src/__proto__'));
});
test('text input data: distinct ASCII case file aliases refuse', async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), root = f.tree([['100644', 'A.txt', blob], ['100644', 'a.txt', blob]]);
  await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
test('text input data: folded file and directory prefix aliases refuse', async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), nested = f.tree([['100644', 'child.txt', blob]]);
  const root = f.tree([['100644', 'A', blob], ['40000', 'a', nested]]); await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
test('text input data: distinct folded directory prefixes refuse', async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), nested = f.tree([['100644', 'child.txt', blob]]);
  const root = f.tree([['40000', 'Dir', nested], ['40000', 'dir', nested]]); await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
for (const name of ['.git', '.Git', '.GIT', '.', '..', 'space name', 'dir/name', 'bad\\name']) test(`text input data: unsupported component ${JSON.stringify(name)} refuses`, async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), root = f.tree([['100644', name, blob]]); await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
for (const mode of ['100755', '120000', '160000', '040000']) test(`text input data: unsupported raw mode ${mode} refuses`, async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), root = f.tree([[mode, 'sample', blob]]); await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
test('text input data: duplicate raw entry refuses', async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), root = f.tree([['100644', 'sample', blob], ['100644', 'sample', blob]]);
  await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
test('text input data: noncanonical raw entry order refuses', async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), root = f.tree([['100644', 'b', blob], ['100644', 'a', blob]]);
  await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
test('text input data: truncated raw tree framing refuses', async () => {
  const f = fixture(), root = f.put('tree', Buffer.from('100644 sample\0short')); await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
test('text input data: hidden empty directory cannot disappear from reconstructed map', async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), empty = f.tree([]), root = f.tree([['40000', 'empty', empty], ['100644', 'sample', blob]]);
  await assert.rejects(f.validate(f.finish(root)), /TEXT_INPUT_REFUSED/);
});
test('text input data: duplicate commit tree header refuses', async () => {
  const f = fixture(), blob = f.put('blob', 'ok'), root = f.tree([['100644', 'sample', blob]]);
  await assert.rejects(f.validate(f.finish(root, 'tree ' + root + '\ntree ' + root)), /TEXT_INPUT_REFUSED/);
});
test('text input data: empty input is outside the admitted base profile', async () => {
  const f = fixture(); await assert.rejects(f.validate(f.finish(f.tree([]))), /TEXT_INPUT_REFUSED/);
});
