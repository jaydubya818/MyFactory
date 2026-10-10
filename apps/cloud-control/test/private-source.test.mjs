import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import {
  bindPrivateSource, assertRegistry, githubAppReadCredential, guardedGithubApi, gitSourceFetcher,
  privateSourceCustody, materializePrivateSource, bindVerifierSource, validateSnapshotBytes, validateSourceFiles, buildSnapshot,
  privateSourceEffects, assertPrivateSourceEffect, privateSourceNetworkPolicy, materializePrivateSourceInSandbox, privateSourceMaterializationScript,
} from '../src/private-source.mjs';
import { cloudWorkProvider } from '../src/cloud-work-provider.mjs';
import { cloudHarnessIdentity } from '../src/cloud-harness-plan.mjs';
import { qualifiedImage } from '../src/infrastructure-plan.mjs';
import { sha256, canonical } from '../../../packages/hosted-routing/src/result.ts';

const root = mkdtempSync(join(tmpdir(), 'private-source-test-'));
test.after(() => rmSync(root, { recursive: true, force: true }));
const genv = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@invalid', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };
const g = (cwd, args, input) => execFileSync('git', args, { cwd, env: genv, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
let serial = 0;
/** Local bare repository standing in for a private GitHub repository. `prepare` may add odd entries. */
function makeRepo(files, prepare = () => {}) {
  const work = join(root, `work-${serial}`), bare = join(root, `bare-${serial++}.git`);
  mkdirSync(work); g(work, ['init', '-q', '-b', 'main']);
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(work, p)), { recursive: true }); writeFileSync(join(work, p), t); }
  prepare(work); g(work, ['add', '-A']); g(work, ['commit', '-q', '-m', 'base']);
  g(root, ['clone', '-q', '--bare', work, bare]); g(bare, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
  return { bare, commit: g(work, ['rev-parse', 'HEAD']), tree: g(work, ['rev-parse', 'HEAD^{tree}']), work };
}
const baseFiles = { 'README.md': '# Private alpha workspace\n', 'workspace/README.md': '# Your workspace\n', 'workspace/notes.md': '# Notes\n' };
function world(filesBy = {}) {
  const r1 = makeRepo(filesBy[1] ?? { ...baseFiles, 'slot.txt': 'one\n' }), r2 = makeRepo(filesBy[2] ?? { ...baseFiles, 'slot.txt': 'two\n' });
  const registry = Object.freeze({
    'slot-1': Object.freeze({ slot: 'slot-1', owner: 'fixture-org', repo: 'fixture-workspace-01', commit: r1.commit, tree: r1.tree }),
    'slot-2': Object.freeze({ slot: 'slot-2', owner: 'fixture-org', repo: 'fixture-workspace-02', commit: r2.commit, tree: r2.tree }),
  });
  const fetched = [];
  const fetcher = gitSourceFetcher({ protocol: 'file', testOnlyInsecureTransport: true, urlFor: e => { fetched.push(e.repo); return 'file://' + (e.repo.endsWith('01') ? r1 : r2).bare; } });
  return { registry, r1, r2, fetcher, fetched };
}
// ---- fakes -------------------------------------------------------------------------------------
function fakeGithub(mutate = j => j) {
  const calls = [], tokens = [];
  const transport = async (method, url, init) => {
    calls.push({ method, url, init });
    if (method === 'POST') {
      const body = JSON.parse(init.body), token = 'ghs_' + randomBytes(12).toString('hex'); tokens.push(token);
      return { status: 201, json: mutate({ token, expires_at: new Date(Date.now() + 3600e3).toISOString(), permissions: { contents: 'read', metadata: 'read' }, repository_selection: 'selected', repositories: [{ full_name: 'fixture-org/' + body.repositories[0] }] }, body) };
    }
    return { status: 204 };
  };
  return { calls, tokens, credential: githubAppReadCredential({ installationId: 12345, appJwt: () => 'app.jwt.value', transport }) };
}
function fakeBlob() {
  const m = new Map(), puts = [];
  return { m, puts,
    put: async (p, bytes, o) => { puts.push({ p, o }); if (m.has(p) && o.allowOverwrite === false) throw Error('exists'); m.set(p, Buffer.from(bytes)); },
    get: async p => m.has(p) ? { statusCode: 200, stream: Readable.from([m.get(p)]) } : { statusCode: 404 } };
}
const custodyOf = b => privateSourceCustody({ put: b.put, get: b.get, storeId: 'store_test' });
const codeOf = async p => { try { await p; } catch (e) { return e.message; } return 'NO_ERROR'; };
const bindingOf = e => ({ slot: e.slot, owner: e.owner, repo: e.repo, commit: e.commit, tree: e.tree });

// ---- tests -------------------------------------------------------------------------------------
test('there is no built-in registry: an absent registry denies everything, and the registry must pass its own invariants', () => {
  const w = world();
  assertRegistry(w.registry);
  assert.deepEqual(Object.keys(w.registry), ['slot-1', 'slot-2']);
  assert.notEqual(w.registry['slot-1'].repo, w.registry['slot-2'].repo);
  const b = bindingOf(w.registry['slot-1']);
  for (const absent of [undefined, null, {}, []]) assert.throws(() => bindPrivateSource(b, absent), /PRIVATE_SOURCE_REGISTRY/);
  assert.throws(() => bindPrivateSource(b), /PRIVATE_SOURCE_REGISTRY/);
  for (const bad of [{ ...w.registry, 'slot-3': { slot: 'slot-3', owner: 'fixture-org', repo: 'MyFactory', commit: 'a'.repeat(40), tree: 'b'.repeat(40) } },
    { 'slot-1': { slot: 'slot-1', owner: '../outside', repo: 'fixture-workspace-01', commit: 'a'.repeat(40), tree: 'b'.repeat(40) } },
    { 'slot-1': { slot: 'slot-1', owner: 'fixture-org', repo: 'Myeve', commit: 'a'.repeat(40), tree: 'b'.repeat(40) } },
    { 'slot-1': { slot: 'slot-1', owner: 'fixture-org', repo: 'relay', commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }])
    assert.throws(() => assertRegistry(bad), /PRIVATE_SOURCE_REGISTRY/);
});

test('happy path for both slots: exact snapshot, git-identical tree, private custody, credential revoked, producer gets only bytes', async () => {
  const w = world(), blob = fakeBlob(), gh = fakeGithub();
  for (const slot of ['slot-1', 'slot-2']) {
    const entry = w.registry[slot], out = await materializePrivateSource({ binding: bindingOf(entry), registry: w.registry, credential: gh.credential, fetcher: w.fetcher, custody: custodyOf(blob) });
    assert.equal(out.receipt.commit, entry.commit); assert.equal(out.receipt.tree, entry.tree); assert.equal(out.receipt.credentialRevoked, true);
    assert.equal(out.receipt.path, `factory/private-source/${slot}/${out.receipt.sha256}.json`);
    assert.deepEqual(Object.keys(out.producerInput).sort(), ['bytes', 'sha256']);
    assert.equal(sha256(out.producerInput.bytes), out.receipt.sha256);
    assert.deepEqual(out.effects, ['PRIVATE_SOURCE_READ', 'PRIVATE_SNAPSHOT_CUSTODY_WRITE']);
    const snap = JSON.parse(out.producerInput.bytes); assert.equal(snap.files['slot.txt'], slot === 'slot-1' ? 'one\n' : 'two\n');
    assert.equal(blob.puts.at(-1).o.access, 'private'); assert.equal(blob.puts.at(-1).o.allowOverwrite, false);
  }
  // exactly one single-repository read-only mint and one revoke per materialization
  const mints = gh.calls.filter(c => c.method === 'POST'), revokes = gh.calls.filter(c => c.method === 'DELETE');
  assert.equal(mints.length, 2); assert.equal(revokes.length, 2);
  assert.deepEqual(JSON.parse(mints[0].init.body), { repositories: ['fixture-workspace-01'], permissions: { contents: 'read' } });
  assert.deepEqual(JSON.parse(mints[1].init.body), { repositories: ['fixture-workspace-02'], permissions: { contents: 'read' } });
  for (const t of gh.tokens) assert.ok(!JSON.stringify([...blob.m.values()].map(String)).includes(t), 'token never reaches custody');
});

test('slot-1 binding cannot materialize slot-2 and vice versa; nothing is minted or fetched on denial', async () => {
  const w = world(), blob = fakeBlob(), gh = fakeGithub();
  const run = binding => codeOf(materializePrivateSource({ binding, registry: w.registry, credential: gh.credential, fetcher: w.fetcher, custody: custodyOf(blob) }));
  const s1 = bindingOf(w.registry['slot-1']), s2 = bindingOf(w.registry['slot-2']);
  for (const binding of [{ ...s1, repo: s2.repo }, { ...s1, repo: s2.repo, commit: s2.commit, tree: s2.tree }, { ...s2, repo: s1.repo }, { ...s2, repo: s1.repo, commit: s1.commit, tree: s1.tree },
    { ...s1, slot: 'slot-2' }, { ...s2, slot: 'slot-1' }, { ...s1, commit: s2.commit }, { ...s1, tree: 'f'.repeat(40) }, { ...s1, owner: 'other' }, { ...s1, extra: 'x' }, { slot: 'slot-3', owner: s1.owner, repo: 'fixture-workspace-03', commit: s1.commit, tree: s1.tree },
    { ...s1, slot: '__proto__' }, null, undefined, {}])
    assert.equal(await run(binding), 'PRIVATE_SOURCE_DENIED');
  assert.equal(gh.calls.length, 0, 'no credential was minted for a denied binding'); assert.deepEqual(w.fetched, []); assert.equal(blob.puts.length, 0);
});

test('MyEve, Relay, MyFactory, other repositories and the canary are denied before any credential or fetch', async () => {
  const w = world(), gh = fakeGithub(), blob = fakeBlob();
  const real = bindingOf(w.registry['slot-1']);
  for (const repo of ['Myeve', 'myeve', 'relay', 'MyFactory', 'fixture-workspace-03', 'factory-production-canary', 'RoofClaim_Recovery', 'fixture-workspace-01.git', '../fixture-workspace-01', 'fixture-workspace-01/../MyFactory'])
    assert.equal(await codeOf(materializePrivateSource({ binding: { ...real, repo }, registry: w.registry, credential: gh.credential, fetcher: w.fetcher, custody: custodyOf(blob) })), 'PRIVATE_SOURCE_DENIED', repo);
  assert.equal(gh.calls.length, 0); assert.deepEqual(w.fetched, []);
  // The canary's pinned public source cannot be bound either: its commit is not in the registry.
  assert.throws(() => bindPrivateSource({ slot: 'slot-1', owner: 'fixture-org', repo: 'fixture-workspace-01', commit: '8f1d9527d480a0cb500d188874b35398b0ebcbf1', tree: '32483deb1b36516d58dee7be7ae90b927f5e8b78' }, w.registry), /PRIVATE_SOURCE_DENIED/);
});

test('credential scope is verified, not assumed: broad/mis-scoped/expired tokens are refused and revoked', async () => {
  const w = world(), entry = w.registry['slot-1'];
  const bad = {
    twoRepos: j => ({ ...j, repositories: [...j.repositories, { full_name: 'fixture-org/Myeve' }] }),
    wrongRepo: j => ({ ...j, repositories: [{ full_name: 'fixture-org/fixture-workspace-02' }] }),
    allRepos: j => ({ ...j, repository_selection: 'all' }),
    writeScope: j => ({ ...j, permissions: { contents: 'write' } }),
    extraPerm: j => ({ ...j, permissions: { contents: 'read', pull_requests: 'write' } }),
    expired: j => ({ ...j, expires_at: new Date(Date.now() - 1000).toISOString() }),
    tooLong: j => ({ ...j, expires_at: new Date(Date.now() + 5 * 3600e3).toISOString() }),
    notAppToken: j => ({ ...j, token: 'ghp_' + 'a'.repeat(30) }),
  };
  for (const [name, mutate] of Object.entries(bad)) {
    const gh = fakeGithub(mutate); let used = false;
    assert.equal(await codeOf(gh.credential.withToken(entry, () => { used = true; })), 'PRIVATE_SOURCE_CREDENTIAL_SCOPE', name);
    assert.equal(used, false, name);
    if (name !== 'notAppToken') assert.equal(gh.calls.filter(c => c.method === 'DELETE').length, 1, name + ' revoked');
  }
  const failing = githubAppReadCredential({ installationId: 1, appJwt: () => 'j', transport: async () => { throw Error('boom ghs_secretsecret'); } });
  assert.equal(await codeOf(failing.withToken(entry, () => {})), 'PRIVATE_SOURCE_CREDENTIAL_UNAVAILABLE');
});

test('only token mint/revoke may be issued: pull request creation, pushes and merges are denied before I/O', async () => {
  let io = 0; const api = guardedGithubApi(async () => { io++; return { status: 200 }; });
  for (const [m, p] of [['POST', '/repos/fixture-org/fixture-workspace-01/pulls'], ['PUT', '/repos/fixture-org/fixture-workspace-01/pulls/1/merge'], ['POST', '/repos/fixture-org/fixture-workspace-01/git/refs'],
    ['POST', '/app/installations/1/access_tokens/../../repos'], ['GET', '/repos/fixture-org/MyFactory'], ['DELETE', '/repos/fixture-org/fixture-workspace-01']])
    assert.equal(await codeOf(api(m, p, {})), 'PRIVATE_SOURCE_EFFECT_DENIED', m + p);
  assert.equal(io, 0);
  assert.deepEqual([...privateSourceEffects.denied].sort(), ['BRANCH_PUSH', 'DEPLOYMENT', 'MERGE', 'PUBLICATION', 'PULL_REQUEST_CREATE', 'SOURCE_WRITE']);
  for (const e of privateSourceEffects.denied) assert.throws(() => assertPrivateSourceEffect(e), /PRIVATE_SOURCE_EFFECT_DENIED/);
  for (const e of privateSourceEffects.allowed) assert.equal(assertPrivateSourceEffect(e), e);
  assert.ok(privateSourceEffects.allowed.every(e => !/PUBLI|PULL|PUSH|MERGE|DEPLOY/.test(e)));
});

test('git is run without ambient credentials, helpers, global config or token in argv', async () => {
  const dir = mkdtempSync(join(root, 'fakegit-')), log = join(dir, 'log'), bin = join(dir, 'git');
  writeFileSync(bin, `#!/bin/sh\n{ echo "ARGS $*"; env; } >> ${log}\nexit 1\n`); chmodSync(bin, 0o755);
  const saved = { a: process.env.GITHUB_TOKEN, b: process.env.GH_TOKEN, c: process.env.GIT_ASKPASS };
  process.env.GITHUB_TOKEN = 'ghp_ambientAMBIENTambient'; process.env.GH_TOKEN = 'ghp_ambient2AMBIENT2'; process.env.GIT_ASKPASS = '/bin/echo';
  try {
    const e = world().registry['slot-1'];
    assert.equal(await codeOf(gitSourceFetcher({ gitBinary: bin }).retrieve(e, 'ghs_scopedTOKEN123456')), 'PRIVATE_SOURCE_GIT_FAILED');
  } finally { process.env.GITHUB_TOKEN = saved.a; process.env.GH_TOKEN = saved.b; process.env.GIT_ASKPASS = saved.c; if (saved.a === undefined) delete process.env.GITHUB_TOKEN; if (saved.b === undefined) delete process.env.GH_TOKEN; if (saved.c === undefined) delete process.env.GIT_ASKPASS; }
  const text = readFileSync(log, 'utf8');
  assert.ok(!/ambient/i.test(text), 'ambient credentials are not inherited');
  assert.ok(!/ARGS .*ghs_scopedTOKEN/.test(text), 'token never in argv');
  assert.match(text, /GIT_CONFIG_NOSYSTEM=1/); assert.match(text, /GIT_CONFIG_GLOBAL=\/dev\/null/); assert.match(text, /GIT_TERMINAL_PROMPT=0/); assert.match(text, /GIT_ALLOW_PROTOCOL=https/);
  assert.match(text, /^GIT_CONFIG_KEY_0=http\.followRedirects$/m); assert.match(text, /^GIT_CONFIG_VALUE_0=false$/m);
  assert.match(text, /^GIT_CONFIG_KEY_1=credential\.helper$/m); assert.match(text, /^GIT_CONFIG_VALUE_1=$/m); // empty helper list: ambient helpers disabled
  assert.throws(() => gitSourceFetcher({ protocol: 'file' }), /PRIVATE_SOURCE_PROTOCOL/); // insecure transports need the explicit test-only flag
  assert.throws(() => gitSourceFetcher({ protocol: 'ssh', testOnlyInsecureTransport: true }), /PRIVATE_SOURCE_PROTOCOL/);
});

test('redirects (including repository renames) are not followed and the credential header is not forwarded', async () => {
  const seenA = [], seenB = [];
  const b = http.createServer((req, res) => { seenB.push(req.headers); res.statusCode = 404; res.end(); });
  await new Promise(r => b.listen(0, '127.0.0.1', r));
  const a = http.createServer((req, res) => { seenA.push(req.headers); res.statusCode = 301; res.setHeader('location', `http://127.0.0.1:${b.address().port}/renamed/x.git/info/refs?service=git-upload-pack`); res.end(); });
  await new Promise(r => a.listen(0, '127.0.0.1', r));
  try {
    const entry = world().registry['slot-1'], token = 'ghs_redirectTOKEN0001';
    const fetcher = gitSourceFetcher({ protocol: 'http', testOnlyInsecureTransport: true, urlFor: () => `http://127.0.0.1:${a.address().port}/o/r.git`, timeoutMs: 8000 });
    assert.equal(await codeOf(fetcher.retrieve(entry, token)), 'PRIVATE_SOURCE_GIT_FAILED');
    assert.ok(seenA.length >= 1); assert.equal(seenA[0].authorization, 'Basic ' + Buffer.from('x-access-token:' + token).toString('base64'));
    assert.equal(seenB.length, 0, 'redirect target was never contacted');
  } finally { a.close(); b.close(); }
});

test('https-only default refuses plain http/file/ssh repository URLs at the protocol allow-list', async () => {
  const w = world();
  const fetcher = gitSourceFetcher({ urlFor: e => 'file://' + w.r1.bare, timeoutMs: 8000 }); // default protocol=https
  assert.equal(await codeOf(fetcher.retrieve(w.registry['slot-1'], undefined)), 'PRIVATE_SOURCE_GIT_FAILED');
});

test('object-level denials: submodule, symlink, executable bit, .gitmodules, LFS, binary, oversize, too many files, wrong tree/commit', async () => {
  const cases = {
    gitlink: [PRIVATE_FILES(), w => { const sub = join(w, 'vendor/sub'); mkdirSync(sub, { recursive: true }); g(sub, ['init', '-q', '-b', 'main']); writeFileSync(join(sub, 'x'), 'x'); g(sub, ['add', '-A']); g(sub, ['commit', '-q', '-m', 's']); }],
    symlink: [PRIVATE_FILES(), w => symlinkSync('/etc/passwd', join(w, 'escape'))],
    executable: [PRIVATE_FILES(), w => { chmodSync(join(w, 'README.md'), 0o755); }],
    binary: [PRIVATE_FILES(), w => writeFileSync(join(w, 'blob.dat'), Buffer.from([0xff, 0xfe, 0x00, 0x80]))],
    oversizeFile: [{ ...baseFiles, 'huge.txt': randomBytes(150000).toString('base64') }, () => {}],
    oversizeTotal: [Object.fromEntries([...Object.entries(baseFiles), ...Array.from({ length: 6 }, (_, i) => [`d/f${i}.txt`, randomBytes(70000).toString('base64').slice(0, 99000)])]), () => {}],
    tooManyFiles: [Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}.txt`, `${i}\n`])), () => {}],
    hugePack: [{ ...baseFiles }, w => writeFileSync(join(w, 'noise.txt'), randomBytes(5 * 1024 * 1024).toString('latin1'), 'latin1')],
  };
  function PRIVATE_FILES() { return { ...baseFiles }; }
  for (const [name, [files, prepare]] of Object.entries(cases)) {
    const repo = makeRepo(files, prepare), entry = { slot: 'slot-1', owner: 'fixture-org', repo: 'fixture-workspace-01', commit: repo.commit, tree: repo.tree };
    const fetcher = gitSourceFetcher({ protocol: 'file', testOnlyInsecureTransport: true, urlFor: () => 'file://' + repo.bare });
    const code = await codeOf(fetcher.retrieve(entry, undefined));
    assert.equal(code, ['oversizeFile', 'oversizeTotal', 'tooManyFiles', 'hugePack'].includes(name) ? 'PRIVATE_SOURCE_OVERSIZE' : 'PRIVATE_SOURCE_UNSUPPORTED_ENTRY', name);
  }
});

test('regular but forbidden contents are refused at snapshot construction (LFS, .gitmodules, collisions, traversal)', async () => {
  for (const [name, files, code] of [
    ['gitmodules', { ...baseFiles, '.gitmodules': 'x\n' }, 'PRIVATE_SOURCE_UNSUPPORTED_ENTRY'],
    ['lfs pointer', { ...baseFiles, 'a.bin': 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 1\n' }, 'PRIVATE_SOURCE_LFS'],
    ['lfs attributes', { ...baseFiles, '.gitattributes': '*.bin filter=lfs\n' }, 'PRIVATE_SOURCE_LFS'],
    ['case collision', { 'README.md': 'a', 'readme.md': 'b' }, 'PRIVATE_SOURCE_PATH_COLLISION'],
    ['nested .GIT', { 'a/.GIT/config': 'x' }, 'PRIVATE_SOURCE_UNSUPPORTED_ENTRY'],
  ]) assert.throws(() => validateSourceFiles(files), new RegExp(code), name);
  for (const path of ['../escape.txt', '/abs.txt', 'a/../../b.txt', 'a//b.txt', './a.txt', '.git/config', 'a\\b.txt', 'a/\0b', 'a/b/', '']) assert.throws(() => validateSourceFiles({ [path]: 'x' }), undefined, JSON.stringify(path));
  assert.throws(() => validateSourceFiles({ 'a.txt': 'x'.repeat(100001) }));
  assert.throws(() => validateSourceFiles({ 'a.txt': '\u0000' }));
  // end-to-end: a real repository carrying an LFS pointer is never snapshotted
  const repo = makeRepo({ ...baseFiles, 'a.bin': 'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 1\n' });
  const entry = { slot: 'slot-1', owner: 'fixture-org', repo: 'fixture-workspace-01', commit: repo.commit, tree: repo.tree };
  const got = await gitSourceFetcher({ protocol: 'file', testOnlyInsecureTransport: true, urlFor: () => 'file://' + repo.bare }).retrieve(entry);
  assert.throws(() => buildSnapshot(entry, got), /PRIVATE_SOURCE_LFS/);
});

test('path traversal tree entries (.. and .git) cannot be fetched or snapshotted', async () => {
  const repo = makeRepo(baseFiles);
  const blob = g(repo.work, ['hash-object', '-w', '--stdin'], 'evil\n');
  const bad = g(repo.work, ['mktree', '--missing'], `100644 blob ${blob}\t..\n100644 blob ${blob}\tok.txt\n`);
  const commit = g(repo.work, ['commit-tree', bad, '-m', 'x']);
  g(repo.work, ['update-ref', 'refs/heads/evil', commit]); g(repo.bare, ['fetch', '-q', repo.work, 'refs/heads/evil:refs/heads/evil']);
  const entry = { slot: 'slot-1', owner: 'fixture-org', repo: 'fixture-workspace-01', commit, tree: bad };
  assert.match(await codeOf(gitSourceFetcher({ protocol: 'file', testOnlyInsecureTransport: true, urlFor: () => 'file://' + repo.bare }).retrieve(entry)), /^PRIVATE_SOURCE_/);
});

test('binding mismatches in retrieved objects fail closed (wrong tree for commit, commit absent)', async () => {
  const w = world(), blob = fakeBlob(), gh = fakeGithub();
  const wrongTree = Object.freeze({ ...w.registry, 'slot-1': Object.freeze({ ...w.registry['slot-1'], tree: 'e'.repeat(40) }) });
  assert.equal(await codeOf(materializePrivateSource({ binding: bindingOf(wrongTree['slot-1']), registry: wrongTree, credential: gh.credential, fetcher: w.fetcher, custody: custodyOf(blob) })), 'PRIVATE_SOURCE_BINDING');
  const absent = Object.freeze({ ...w.registry, 'slot-1': Object.freeze({ ...w.registry['slot-1'], commit: 'd'.repeat(40) }) });
  assert.equal(await codeOf(materializePrivateSource({ binding: bindingOf(absent['slot-1']), registry: absent, credential: gh.credential, fetcher: w.fetcher, custody: custodyOf(blob) })), 'PRIVATE_SOURCE_GIT_FAILED');
  assert.equal(blob.puts.length, 0);
  assert.equal(gh.calls.filter(c => c.method === 'DELETE').length, gh.calls.filter(c => c.method === 'POST').length, 'credential revoked even on failure');
});

test('digest mismatch fails closed at custody readback, snapshot validation, and inside the producer', async () => {
  const w = world(), blob = fakeBlob(), gh = fakeGithub(), custody = custodyOf(blob), entry = w.registry['slot-1'];
  const out = await materializePrivateSource({ binding: bindingOf(entry), registry: w.registry, credential: gh.credential, fetcher: w.fetcher, custody });
  const good = out.producerInput.bytes;
  // 1. custody bytes altered after storage
  const snap = JSON.parse(good); snap.files['README.md'] += 'tampered\n';
  blob.m.set(out.receipt.path, Buffer.from(canonical(snap)));
  assert.equal(await codeOf(custody.read(entry, out.receipt)), 'PRIVATE_SOURCE_CUSTODY_READBACK');
  blob.m.set(out.receipt.path, Buffer.from(canonical({ ...snap })));
  // same length different bytes still caught by digest
  const sameLen = Buffer.from(good); sameLen[sameLen.indexOf(Buffer.from('Private alpha'))] ^= 0x01; blob.m.set(out.receipt.path, sameLen);
  assert.equal(await codeOf(custody.read(entry, out.receipt)), 'PRIVATE_SOURCE_DIGEST_MISMATCH');
  blob.m.set(out.receipt.path, good);
  // 2. receipt path / slot confusion
  assert.equal(await codeOf(custody.read(w.registry['slot-2'], out.receipt)), 'PRIVATE_SOURCE_CUSTODY_BINDING');
  assert.equal(await codeOf(custody.read(entry, { ...out.receipt, sha256: 'a'.repeat(64) })), 'PRIVATE_SOURCE_CUSTODY_BINDING');
  // 3. snapshot internal consistency: files changed but commit/tree kept; extra field; non-canonical; oversize
  const mut = fn => { const s = JSON.parse(good); fn(s); return Buffer.from(canonical(s)); };
  for (const [name, bytes, code] of [
    ['tree mismatch', mut(s => { s.files['workspace/notes.md'] = 'x\n'; }), 'PRIVATE_SOURCE_TREE_MISMATCH'],
    ['extra field', mut(s => { s.note = 'x'; }), 'PRIVATE_SOURCE_SNAPSHOT_INVALID'],
    ['other repository', mut(s => { s.repository = 'fixture-org/Myeve'; }), 'PRIVATE_SOURCE_BINDING'],
    ['other commit', mut(s => { s.commit = 'a'.repeat(40); }), 'PRIVATE_SOURCE_BINDING'],
    ['commit object swapped', mut(s => { s.commitBase64 = Buffer.from('tree ' + s.tree + '\n\nx').toString('base64'); }), 'PRIVATE_SOURCE_BINDING'],
    ['non-canonical', Buffer.from(JSON.stringify(JSON.parse(good), null, 1)), 'PRIVATE_SOURCE_SNAPSHOT_INVALID'],
    ['embedded token', mut(s => { s.files['x.txt'] = 'ghs_' + 'a'.repeat(30); }), /PRIVATE_SOURCE_(TREE_MISMATCH|CREDENTIAL_IN_SNAPSHOT)/],
    ['garbage', Buffer.from('not json'), 'PRIVATE_SOURCE_SNAPSHOT_INVALID'],
    ['oversize', Buffer.alloc(700001, 0x20), 'PRIVATE_SOURCE_OVERSIZE'],
  ]) assert.match(await codeOf((async () => validateSnapshotBytes(bytes, entry))()), code instanceof RegExp ? code : new RegExp('^' + code + '$'), name);
  assert.equal(validateSnapshotBytes(good, entry, out.receipt.sha256).sha256, out.receipt.sha256);
  // 4. producer: tampered bytes never get written
  const home = mkdtempSync(join(root, 'home-'));
  const sandbox = fakeSandbox();
  assert.equal(await codeOf(materializePrivateSourceInSandbox(sandbox, { snapshotBytes: sameLen, sha256: out.receipt.sha256, entry, home })), 'PRIVATE_SOURCE_DIGEST_MISMATCH');
  assert.ok(!existsSync(join(home, 'private-source')));
  // 5. in-producer TOCTOU guard: file replaced after the control-plane check is caught by the script's own digest check
  mkdirSync(join(home, 'private-source')); writeFileSync(join(home, 'private-source/snapshot.json'), sameLen);
  assert.throws(() => execFileSync('node', ['-e', privateSourceMaterializationScript({ sha256: out.receipt.sha256, commit: entry.commit, tree: entry.tree, home })], { stdio: 'pipe' }));
  assert.ok(!existsSync(join(home, 'workspace')));
});

function fakeSandbox({ userRuns = [] } = {}) {
  const user = {
    writeFiles: async files => { for (const f of files) { mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, f.content); } },
    runCommand: async ({ cmd, args }) => { userRuns.push(cmd); try { const out = execFileSync(cmd, args, { env: { PATH: process.env.PATH }, encoding: 'utf8', stdio: 'pipe' }); return { exitCode: 0, stdout: async () => out }; } catch { return { exitCode: 1 }; } },
  };
  return { createUser: async () => user, user };
}

test('producer rebuilds the exact base commit offline from only the snapshot; snapshot file is removed; workspace is clean', async () => {
  const w = world(), blob = fakeBlob(), gh = fakeGithub();
  for (const slot of ['slot-1', 'slot-2']) {
    const entry = w.registry[slot], out = await materializePrivateSource({ binding: bindingOf(entry), registry: w.registry, credential: gh.credential, fetcher: w.fetcher, custody: custodyOf(blob) });
    const home = mkdtempSync(join(root, 'producer-home-')), sandbox = fakeSandbox();
    const report = await materializePrivateSourceInSandbox(sandbox, { snapshotBytes: out.producerInput.bytes, sha256: out.producerInput.sha256, entry, home });
    assert.deepEqual(report, { commit: entry.commit, tree: entry.tree });
    const ws = join(home, 'workspace');
    assert.equal(g(ws, ['rev-parse', 'HEAD']), entry.commit); assert.equal(g(ws, ['rev-parse', 'HEAD^{tree}']), entry.tree); assert.equal(g(ws, ['status', '--porcelain']), '');
    assert.ok(!existsSync(join(home, 'private-source')), 'snapshot input removed');
    assert.equal(readFileSync(join(ws, 'slot.txt'), 'utf8'), slot === 'slot-1' ? 'one\n' : 'two\n');
    assert.equal(g(ws, ['log', '--oneline']).split('\n').length, 1); // shallow base, parents absent
  }
});

test('verifier independently re-reads custody and binds source and candidate identities', async () => {
  const w = world(), blob = fakeBlob(), gh = fakeGithub(), custody = custodyOf(blob), entry = w.registry['slot-1'];
  const out = await materializePrivateSource({ binding: bindingOf(entry), registry: w.registry, credential: gh.credential, fetcher: w.fetcher, custody });
  const snap = JSON.parse(out.producerInput.bytes);
  const candidate = { base: entry.commit, sourceFiles: snap.files };
  const ok = await bindVerifierSource({ binding: bindingOf(entry), registry: w.registry, custody, receipt: out.receipt, candidate });
  assert.equal(ok.sha256, out.receipt.sha256);
  const codeFor = (over, bind = bindingOf(entry), receipt = out.receipt) => codeOf(bindVerifierSource({ binding: bind, registry: w.registry, custody, receipt, candidate: { ...candidate, ...over } }));
  assert.equal(await codeFor({ base: 'a'.repeat(40) }), 'PRIVATE_SOURCE_VERIFIER_BINDING');
  assert.equal(await codeFor({ sourceFiles: { ...snap.files, 'README.md': 'changed\n' } }), 'PRIVATE_SOURCE_VERIFIER_BINDING');
  assert.equal(await codeFor({}, bindingOf(w.registry['slot-2'])), 'PRIVATE_SOURCE_CUSTODY_BINDING');
  assert.equal(await codeFor({}, { ...bindingOf(entry), repo: 'Myeve' }), 'PRIVATE_SOURCE_DENIED');
});

test('private mode in the Work provider: producer network never includes GitHub; source is snapshot-only; public mode untouched', async () => {
  assert.deepEqual(privateSourceNetworkPolicy.allow, ['registry.npmjs.org']);
  assert.ok(!JSON.stringify(privateSourceNetworkPolicy).includes('github'));
  const w = world(), blob = fakeBlob(), gh = fakeGithub(), entry = w.registry['slot-1'];
  const out = await materializePrivateSource({ binding: bindingOf(entry), registry: w.registry, credential: gh.credential, fetcher: w.fetcher, custody: custodyOf(blob) });
  const home = mkdtempSync(join(root, 'provider-home-')), calls = [], userRuns = [], sb = fakeSandbox({ userRuns });
  const sandbox = {
    image: qualifiedImage, createUser: sb.createUser,
    asUser: () => ({ writeFiles: async () => {}, runCommand: async () => ({ exitCode: 0, stdout: async () => JSON.stringify({ version: 'codex-cli ' + cloudHarnessIdentity.version, uid: 0 }) }) }),
    updateNetworkPolicy: async p => { calls.push(p); },
  };
  const source = { repository: `${entry.owner}/${entry.repo}`, commit: entry.commit, tree: entry.tree };
  const provider = cloudWorkProvider({ ledger: {}, plan: { source }, privateSource: { binding: bindingOf(entry), registry: w.registry, snapshot: out.producerInput, home } });
  const stages = [];
  const report = await provider.materialize(sandbox, async s => stages.push(s.startupStage));
  assert.equal(report.commit, entry.commit); assert.deepEqual(calls, ['deny-all']); assert.equal(stages.at(-1), 'SOURCE_READY');
  assert.ok(userRuns.every(c => c === 'node'), 'no git fetch / network client was run in the producer');
  // plan pointing at any other source is refused
  assert.throws(() => cloudWorkProvider({ ledger: {}, plan: { source: { ...source, commit: 'a'.repeat(40) } }, privateSource: { binding: bindingOf(entry), registry: w.registry, snapshot: out.producerInput } }), /PRIVATE_SOURCE_BINDING/);
  // a denied binding cannot even construct the provider
  assert.throws(() => cloudWorkProvider({ ledger: {}, privateSource: { binding: { ...bindingOf(entry), repo: 'MyFactory' }, registry: w.registry, snapshot: out.producerInput } }), /PRIVATE_SOURCE_DENIED/);
  assert.doesNotThrow(() => cloudWorkProvider({ ledger: {} })); // existing public/canary construction unchanged
});

test('credential and repository contents are absent from every producer/verifier-visible artifact and error', async () => {
  const w = world(), blob = fakeBlob(), gh = fakeGithub(), entry = w.registry['slot-1'];
  const out = await materializePrivateSource({ binding: bindingOf(entry), registry: w.registry, credential: gh.credential, fetcher: w.fetcher, custody: custodyOf(blob) });
  const visible = JSON.stringify(out.receipt) + out.producerInput.bytes.toString() + JSON.stringify(out.effects);
  for (const t of gh.tokens) assert.ok(!visible.includes(t));
  assert.ok(!/Authorization|x-access-token|app\.jwt/i.test(visible));
  const failing = fakeGithub(); const err = await codeOf(materializePrivateSource({ binding: bindingOf(entry), registry: w.registry, credential: failing.credential, fetcher: { retrieve: async (_e, token) => { throw Error('leak ' + token); } }, custody: custodyOf(fakeBlob()) }));
  assert.ok(!/leak|ghs_/.test(err), 'uncontrolled error text is never propagated');
});


test('actual private provider requires validated custody before SDK allocation; corruption never reaches transport',async()=>{
 const w=world(),blob=fakeBlob(),gh=fakeGithub(),entry=w.registry['slot-1'];
 const out=await materializePrivateSource({binding:bindingOf(entry),registry:w.registry,credential:gh.credential,fetcher:w.fetcher,custody:custodyOf(blob)});
 const receipt={repository:entry.owner+'/'+entry.repo,commit:entry.commit,tree:entry.tree,path:out.receipt.path,sha256:out.receipt.sha256,bytes:out.receipt.bytes};
 let allocations=0,sessionCommands=0;const session={sessionId:'sbx_fixture_admitted',runCommand:async()=>{sessionCommands++;},writeFiles:async()=>{},readFile:async()=>{},update:async()=>{}};
 const sdkSandbox={currentSession:()=>session,runCommand:()=>{throw Error('SDK_AUTO_RESUME_WRAPPER_REACHED');}};
 const sandboxApi={create:async()=>{allocations++;return sdkSandbox;}};
 const source={repository:receipt.repository,commit:entry.commit,tree:entry.tree};
 const provider=cloudWorkProvider({ledger:{},plan:{source},privateSource:{binding:bindingOf(entry),registry:w.registry,custody:custodyOf(blob),receipt},sandboxApi});
 const resource={run_id:'fixture',provider_name:'factory-run-fixture',deadline:new Date(Date.now()+100000).toISOString()};
 await assert.rejects(provider.allocate(resource),/PRIVATE_SOURCE_CUSTODY_UNAVAILABLE/);assert.equal(allocations,0);
 const original=Buffer.from(blob.m.get(receipt.path)),bad=Buffer.from(original);bad[bad.length-2]^=1;blob.m.set(receipt.path,bad);
 await assert.rejects(provider.prepareSource({request:{source}}),/PRIVATE_SOURCE_DIGEST_MISMATCH/);assert.equal(allocations,0);
 blob.m.set(receipt.path,original);const notes=[];await provider.prepareSource({request:{source}},async e=>notes.push(e));
 const admitted=await provider.allocate(resource);assert.equal(allocations,1);assert.equal(notes[0].privateSourceReceipt.sha256,receipt.sha256);
 await admitted.runCommand({cmd:'fixture-command'});assert.equal(sessionCommands,1);
 await assert.rejects(provider.prepareSource({request:{source:{...source,repository:'foreign/fixture-workspace-02'}}}),/PRIVATE_SOURCE_BINDING/);assert.equal(allocations,1);
 const unsafe=privateSourceCustody({put:async()=>{},get:async()=>{throw Error('secret provider URL');},storeId:'fixture'});
 assert.equal(await codeOf(unsafe.read(entry,receipt)),'PRIVATE_SOURCE_CUSTODY_UNAVAILABLE');
});

test('SDK-only cleanup confirms absence through injected transport after stop/delete without external contact',async()=>{
 const calls=[];let present=true;
 const sandbox={name:'factory-run-fixture',image:qualifiedImage,stop:async()=>calls.push('stop'),delete:async()=>{calls.push('delete');present=false;}};
 const sandboxApi={get:async()=>{calls.push('lookup');if(present)return sandbox;throw{response:{status:404}};}};
 const provider=cloudWorkProvider({ledger:{},sandboxApi});
 await provider.destroy({provider_name:sandbox.name},sandbox);
 assert.deepEqual(calls,['stop','delete','lookup']);
 const ambiguous=cloudWorkProvider({ledger:{},sandboxApi:{get:async()=>{throw{response:{status:503}};}}});
 await assert.rejects(ambiguous.destroy({provider_name:sandbox.name}));
});
