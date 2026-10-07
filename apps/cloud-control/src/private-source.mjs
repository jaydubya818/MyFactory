import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundedFiles, fileTree } from './candidate-custody.mjs';
import { canonical, sha256 } from '../../../packages/hosted-routing/src/result.ts';

/*
 * Private source materialization for the external-alpha private workspaces.
 *
 * Chain (every link fails closed, every error is a controlled PRIVATE_SOURCE_* code):
 *   exact slot binding (owner/repo/base commit/base tree, all four must match the registry)
 *   -> single-repository read-only credential minted for that ONE repository
 *   -> authenticated retrieval of exactly that commit (no redirects, one protocol)
 *   -> object-level validation (no submodule/symlink/LFS/traversal/oversize/mode change)
 *   -> credential-free canonical snapshot whose git tree is recomputed from the bytes
 *   -> private custody (digest-addressed, no overwrite, readback verified)
 *   -> producer receives ONLY the snapshot bytes (no network, no credential)
 *   -> verifier re-validates the same custody bytes against the same binding.
 *
 * The credential never leaves withToken(): it is not returned, logged, put in an
 * error, in the snapshot, in the producer or verifier environment.
 */

export const privateSourceOwner = 'jaydubya818';
// Structural rule only (slot-numbered lower-case name). The actual repository names, base commits and trees are a
// digest-pinned DEPLOY-TIME input (external-alpha-registry.mjs); this public repository carries none of them.
export const privateSourceRepositoryPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{2}$/;
export const snapshotByteLimit = 700000;
export const fetchByteLimit = 4 * 1024 * 1024;
const sha1 = /^[0-9a-f]{40}$/;

/** Effects a private-source Work may ever perform. Publication, pull requests,
 * pushes, merges and deployment are not merely unconfigured: they are absent. */
export const privateSourceEffects = Object.freeze({
  allowed: Object.freeze(['PRIVATE_SOURCE_READ', 'PRIVATE_SNAPSHOT_CUSTODY_WRITE', 'CANDIDATE_CUSTODY_WRITE']),
  denied: Object.freeze(['PUBLICATION', 'PULL_REQUEST_CREATE', 'BRANCH_PUSH', 'MERGE', 'DEPLOYMENT', 'SOURCE_WRITE']),
});
export function assertPrivateSourceEffect(effect) {
  if (!privateSourceEffects.allowed.includes(effect)) throw Error('PRIVATE_SOURCE_EFFECT_DENIED');
  return effect;
}

/** The exact allow-list is supplied by the caller (loaded and digest-checked from deploy-time input). Slot, owner,
 * repository, base commit and base tree must all match an entry; anything else (MyEve, Relay, MyFactory, the canary,
 * other slots) is denied. There is deliberately NO built-in default: an absent registry denies everything. */
export function assertRegistry(registry) {
  const entries = Object.entries(registry ?? {});
  if (!entries.length || entries.length > 8) throw Error('PRIVATE_SOURCE_REGISTRY');
  const repos = new Set();
  for (const [slot, e] of entries) {
    if (!/^slot-[0-9]{1,2}$/.test(slot) || e?.slot !== slot || e.owner !== privateSourceOwner || !privateSourceRepositoryPattern.test(e.repo) || !sha1.test(e.commit) || !sha1.test(e.tree) || repos.has(e.repo))
      throw Error('PRIVATE_SOURCE_REGISTRY');
    repos.add(e.repo);
  }
  return registry;
}

/** The binding supplied by a Work is data, not authority: it must equal a registry entry. */
export function bindPrivateSource(binding, registry) {
  assertRegistry(registry);
  const keys = Object.keys(binding ?? {}).sort().join(',');
  if (keys !== 'commit,owner,repo,slot,tree') throw Error('PRIVATE_SOURCE_DENIED');
  const entry = Object.hasOwn(registry, binding.slot) ? registry[binding.slot] : undefined;
  if (!entry || entry.owner !== binding.owner || entry.repo !== binding.repo || entry.commit !== binding.commit || entry.tree !== binding.tree)
    throw Error('PRIVATE_SOURCE_DENIED');
  return entry;
}

// ---- credential ---------------------------------------------------------------------------------

/**
 * Credential type: GitHub App installation access token.
 *   - minted per materialization via POST /app/installations/{id}/access_tokens
 *     with body {repositories:[<one repo>], permissions:{contents:'read'}}
 *   - GitHub-enforced single-repository scope, contents:read (+implicit metadata:read), TTL <= 1h
 *   - revoked immediately after use via DELETE /installation/token
 *   - the long-lived App private key / App JWT exists only in the cloud-control materializer
 * The response is independently checked: a token that is broader than requested is refused.
 * Only these two API operations can ever be issued by this transport; every other
 * method/path (including pull-request creation) is denied before any I/O.
 */
export function guardedGithubApi(transport) {
  return async (method, path, init) => {
    const mint = method === 'POST' && /^\/app\/installations\/[0-9]{1,20}\/access_tokens$/.test(path);
    const revokeOp = method === 'DELETE' && path === '/installation/token';
    if (!mint && !revokeOp) throw Error('PRIVATE_SOURCE_EFFECT_DENIED');
    return transport(method, 'https://api.github.com' + path, init);
  };
}

async function revoke(api, token) {
  try { const r = await api('DELETE', '/installation/token', { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } }); return r?.status === 204; }
  catch { return false; }
}

export const githubReadCredentialKind = 'GITHUB_APP_INSTALLATION_TOKEN_SINGLE_REPO_CONTENTS_READ';
export function githubAppReadCredential({ installationId, appJwt, transport, now = Date.now }) {
  if (!/^[0-9]{1,20}$/.test(String(installationId)) || typeof appJwt !== 'function' || typeof transport !== 'function') throw Error('PRIVATE_SOURCE_CREDENTIAL_CONFIG');
  const api = guardedGithubApi(transport);
  return {
    kind: githubReadCredentialKind,
    async withToken(entry, use) {
      let token;
      try {
        const res = await api('POST', `/app/installations/${installationId}/access_tokens`, {
          headers: { authorization: `Bearer ${await appJwt()}`, accept: 'application/vnd.github+json' },
          body: JSON.stringify({ repositories: [entry.repo], permissions: { contents: 'read' } }),
        });
        const j = res?.json;
        if (typeof j?.token === 'string') token = j.token; // revoked below if it cannot be proven narrow
        const perms = Object.entries(j?.permissions ?? {}).sort().map(([k, v]) => `${k}=${v}`).join(',');
        const full = `${entry.owner}/${entry.repo}`;
        if (res?.status !== 201 || !/^ghs_[A-Za-z0-9_]{8,255}$/.test(j?.token ?? '') || j.repository_selection !== 'selected' ||
          !Array.isArray(j.repositories) || j.repositories.length !== 1 || j.repositories[0]?.full_name !== full ||
          !['contents=read', 'contents=read,metadata=read'].includes(perms) ||
          !Number.isFinite(Date.parse(j.expires_at)) || Date.parse(j.expires_at) <= now() || Date.parse(j.expires_at) > now() + 61 * 60000)
          throw Error('PRIVATE_SOURCE_CREDENTIAL_SCOPE');
      } catch (error) {
        if (token) await revoke(api, token);
        throw Error(error?.message === 'PRIVATE_SOURCE_CREDENTIAL_SCOPE' ? error.message : 'PRIVATE_SOURCE_CREDENTIAL_UNAVAILABLE');
      }
      let value, revoked = false;
      try { value = await use(token); }
      finally { revoked = await revoke(api, token); token = undefined; }
      return { value, revoked };
    },
  };
}

// ---- retrieval ----------------------------------------------------------------------------------

function run(file, args, { env, cwd, input, timeoutMs = 20000, maxBytes = fetchByteLimit + 65536, watch } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; let size = 0, done = false, poll;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); clearInterval(poll); error ? reject(error) : resolve(value); };
    const kill = code => { child.kill('SIGKILL'); finish(Error(code)); };
    const timer = setTimeout(() => kill('PRIVATE_SOURCE_TIMEOUT'), timeoutMs);
    if (watch) poll = setInterval(async () => { try { if (await watch() > fetchByteLimit) kill('PRIVATE_SOURCE_OVERSIZE'); } catch { /* directory churn */ } }, 20);
    child.stdout.on('data', c => { size += c.length; if (size > maxBytes) return kill('PRIVATE_SOURCE_OVERSIZE'); out.push(c); });
    child.stderr.on('data', () => {}); // never retained: stderr can echo URLs or headers
    child.on('error', () => finish(Error('PRIVATE_SOURCE_GIT_FAILED')));
    child.on('close', code => code === 0 ? finish(null, Buffer.concat(out)) : finish(Error('PRIVATE_SOURCE_GIT_FAILED')));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? undefined);
  });
}
async function dirBytes(dir) {
  let total = 0;
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) if (e.isFile()) total += (await stat(join(e.parentPath, e.name))).size;
  return total;
}

const gitObjectId = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const lfsPointer = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/;

/** Pure validation of an already-read tree. Shared by retrieval and snapshot readback. */
export function validateSourceFiles(files) {
  boundedFiles(files); // count/size/charset/UTF-8/.git/.. /absolute/directory-collision
  const seen = new Set();
  for (const [path, text] of Object.entries(files)) {
    const folded = path.normalize('NFC').toLowerCase();
    if (seen.has(folded)) throw Error('PRIVATE_SOURCE_PATH_COLLISION');
    seen.add(folded);
    const parts = path.split('/');
    if (parts.some(p => ['.git', '.gitmodules'].includes(p.toLowerCase()))) throw Error('PRIVATE_SOURCE_UNSUPPORTED_ENTRY');
    if (parts.at(-1).toLowerCase() === '.gitattributes' && /\bfilter\s*=\s*lfs\b/.test(text)) throw Error('PRIVATE_SOURCE_LFS');
    if (lfsPointer.test(text)) throw Error('PRIVATE_SOURCE_LFS');
  }
  return files;
}

/**
 * Authenticated retrieval. The URL is derived from the validated registry entry
 * only. git is given: no ambient credential helper, no global/system config, no
 * redirects, a single allowed protocol, no lazy fetch, no hooks, no submodule
 * recursion, fsck of received objects, a byte watchdog and a wall-clock timeout.
 * Nothing is checked out; blobs are read as bytes from the object database.
 * (protocol 'file' exists only so deterministic tests can use local bare repositories.)
 */
export function gitSourceFetcher({ gitBinary = 'git', protocol = 'https', urlFor = e => `https://github.com/${e.owner}/${e.repo}.git`, timeoutMs = 25000, testOnlyInsecureTransport = false } = {}) {
  if (!['https', 'file', 'http'].includes(protocol) || (protocol !== 'https' && testOnlyInsecureTransport !== true)) throw Error('PRIVATE_SOURCE_PROTOCOL');
  return {
    async retrieve(entry, token) {
      const dir = await mkdtemp(join(tmpdir(), 'factory-private-source-'));
      try {
        const gitdir = join(dir, 'repo.git');
        const pairs = [['http.followRedirects', 'false'], ['credential.helper', ''], ['core.hooksPath', '/dev/null'], ['transfer.fsckObjects', 'true'], ['fetch.recurseSubmodules', 'false'], ['protocol.version', '2'], ['core.fsmonitor', 'false']];
        if (token) pairs.push(['http.extraHeader', 'Authorization: Basic ' + Buffer.from('x-access-token:' + token).toString('base64')]);
        const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: protocol, GIT_LFS_SKIP_SMUDGE: '1', LC_ALL: 'C', GIT_CONFIG_COUNT: String(pairs.length) };
        pairs.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
        const git = (args, o) => run(gitBinary, ['--git-dir', gitdir, ...args], { env, cwd: dir, timeoutMs, ...o });
        await run(gitBinary, ['init', '--bare', '-q', gitdir], { env, cwd: dir });
        await git(['fetch', '--depth=1', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', urlFor(entry), entry.commit], { watch: () => dirBytes(gitdir) });
        if ((await git(['cat-file', '-t', entry.commit])).toString().trim() !== 'commit') throw Error('PRIVATE_SOURCE_BINDING');
        const commitBytes = await git(['cat-file', 'commit', entry.commit]);
        if (gitObjectId('commit', commitBytes) !== entry.commit || !commitBytes.toString('utf8').startsWith(`tree ${entry.tree}\n`)) throw Error('PRIVATE_SOURCE_BINDING');
        const listing = (await git(['ls-tree', '-r', '-z', '--long', entry.commit])).toString('utf8').split('\0').filter(Boolean);
        if (!listing.length || listing.length > 200) throw Error('PRIVATE_SOURCE_OVERSIZE');
        const wanted = []; let total = 0;
        for (const line of listing) {
          const m = /^([0-7]{6}) (blob|commit|tree) ([0-9a-f]{40}) +(-|[0-9]+)\t([\s\S]+)$/.exec(line);
          if (!m) throw Error('PRIVATE_SOURCE_UNSUPPORTED_ENTRY');
          const [, mode, type, id, size, path] = m;
          if (mode !== '100644' || type !== 'blob') throw Error('PRIVATE_SOURCE_UNSUPPORTED_ENTRY'); // symlink 120000, gitlink 160000, exec 100755
          if (Number(size) > 100000) throw Error('PRIVATE_SOURCE_OVERSIZE');
          total += Number(size); if (total > 500000) throw Error('PRIVATE_SOURCE_OVERSIZE');
          wanted.push({ id, size: Number(size), path });
        }
        const raw = await git(['cat-file', '--batch'], { input: wanted.map(w => w.id).join('\n') + '\n', maxBytes: total + wanted.length * 100 + 4096 });
        const files = {}; let at = 0;
        for (const w of wanted) {
          const eol = raw.indexOf(10, at); if (eol < 0) throw Error('PRIVATE_SOURCE_GIT_FAILED');
          const head = raw.subarray(at, eol).toString('ascii').split(' ');
          if (head[0] !== w.id || head[1] !== 'blob' || Number(head[2]) !== w.size) throw Error('PRIVATE_SOURCE_BINDING');
          const body = raw.subarray(eol + 1, eol + 1 + w.size);
          if (body.length !== w.size || gitObjectId('blob', body) !== w.id) throw Error('PRIVATE_SOURCE_BINDING');
          const text = body.toString('utf8');
          if (!Buffer.from(text).equals(body)) throw Error('PRIVATE_SOURCE_UNSUPPORTED_ENTRY');
          files[w.path] = text; at = eol + 1 + w.size + 1;
        }
        return { commitBytes, files };
      } catch (error) {
        throw Error(/^PRIVATE_SOURCE_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'PRIVATE_SOURCE_GIT_FAILED');
      } finally { await rm(dir, { recursive: true, force: true }); }
    },
  };
}

// ---- snapshot -----------------------------------------------------------------------------------

/** Parse + fully re-validate snapshot bytes against a registry entry. Used at
 * creation, at custody readback, by the verifier and (digest part) in the producer. */
export function validateSnapshotBytes(bytes, entry, expectedSha256) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > snapshotByteLimit) throw Error('PRIVATE_SOURCE_OVERSIZE');
  if (expectedSha256 !== undefined && sha256(bytes) !== expectedSha256) throw Error('PRIVATE_SOURCE_DIGEST_MISMATCH');
  let s; try { s = JSON.parse(bytes.toString('utf8')); } catch { throw Error('PRIVATE_SOURCE_SNAPSHOT_INVALID'); }
  if (!s || Object.keys(s).sort().join(',') !== 'commit,commitBase64,files,kind,repository,tree,version' || s.version !== 1 || s.kind !== 'PRIVATE_SOURCE_SNAPSHOT')
    throw Error('PRIVATE_SOURCE_SNAPSHOT_INVALID');
  let canon; try { canon = Buffer.from(canonical(s)); } catch { throw Error('PRIVATE_SOURCE_SNAPSHOT_INVALID'); }
  if (!canon.equals(bytes)) throw Error('PRIVATE_SOURCE_SNAPSHOT_INVALID');
  if (s.repository !== `${entry.owner}/${entry.repo}` || s.commit !== entry.commit || s.tree !== entry.tree) throw Error('PRIVATE_SOURCE_BINDING');
  const commit = Buffer.from(s.commitBase64, 'base64');
  if (commit.toString('base64') !== s.commitBase64 || gitObjectId('commit', commit) !== s.commit || !commit.toString('utf8').startsWith(`tree ${s.tree}\n`)) throw Error('PRIVATE_SOURCE_BINDING');
  validateSourceFiles(s.files);
  if (fileTree(s.files).sha !== s.tree) throw Error('PRIVATE_SOURCE_TREE_MISMATCH');
  if (/ghs_[A-Za-z0-9_]{8,}|ghp_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}/.test(bytes.toString('utf8'))) throw Error('PRIVATE_SOURCE_CREDENTIAL_IN_SNAPSHOT');
  return { snapshot: s, sha256: sha256(bytes), size: bytes.length };
}

export function buildSnapshot(entry, retrieved) {
  const snapshot = { version: 1, kind: 'PRIVATE_SOURCE_SNAPSHOT', repository: `${entry.owner}/${entry.repo}`, commit: entry.commit, tree: entry.tree, commitBase64: retrieved.commitBytes.toString('base64'), files: retrieved.files };
  const bytes = Buffer.from(canonical(snapshot));
  return { bytes, ...validateSnapshotBytes(bytes, entry) };
}

// ---- custody ------------------------------------------------------------------------------------

async function readAll(stream, limit) {
  const chunks = []; let n = 0;
  for await (const c of stream) { const b = Buffer.from(c); n += b.length; if (n > limit) throw Error('PRIVATE_SOURCE_OVERSIZE'); chunks.push(b); }
  return Buffer.concat(chunks);
}
/** Digest-addressed private blob custody. put/get are injected (Vercel Blob in production). */
export function privateSourceCustody({ put, get, storeId, prefix = 'factory/private-source', options = async () => ({}) }) {
  const path = (slot, digest) => `${prefix}/${slot}/${digest}.json`;
  return {
    path,
    async store(entry, snapshot) {
      const p = path(entry.slot, snapshot.sha256);
      await put(p, snapshot.bytes, { access: 'private', storeId, ...(await options()), addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
      const read = await this.read(entry, { path: p, sha256: snapshot.sha256, bytes: snapshot.bytes.length });
      if (!read.bytes.equals(snapshot.bytes)) throw Error('PRIVATE_SOURCE_CUSTODY_READBACK');
      return { slot: entry.slot, path: p, sha256: snapshot.sha256, bytes: snapshot.bytes.length };
    },
    /** Never trusts a receipt: path is recomputed from slot+digest, bytes are re-digested and re-validated. */
    async read(entry, receipt) {
      if (!/^[a-f0-9]{64}$/.test(receipt?.sha256 ?? '') || receipt.path !== path(entry.slot, receipt.sha256)) throw Error('PRIVATE_SOURCE_CUSTODY_BINDING');
      const saved = await get(receipt.path, { access: 'private', storeId, ...(await options()), useCache: false });
      if (saved?.statusCode !== 200 || !saved.stream) throw Error('PRIVATE_SOURCE_CUSTODY_UNAVAILABLE');
      let bytes; try { bytes = await readAll(saved.stream, snapshotByteLimit); } catch { throw Error('PRIVATE_SOURCE_CUSTODY_READBACK'); }
      if (bytes.length !== receipt.bytes) throw Error('PRIVATE_SOURCE_CUSTODY_READBACK');
      const v = validateSnapshotBytes(bytes, entry, receipt.sha256);
      return { bytes, ...v };
    },
  };
}

// ---- orchestration ------------------------------------------------------------------------------

/** The only entry point that touches a credential. Returns a receipt plus the
 * snapshot bytes for the producer; the credential is gone by the time it returns. */
export async function materializePrivateSource({ binding, registry, credential, fetcher = gitSourceFetcher(), custody }) {
  const entry = bindPrivateSource(binding, registry);
  assertPrivateSourceEffect('PRIVATE_SOURCE_READ');
  let got, snapshot, receipt;
  try {
    got = await credential.withToken(entry, token => fetcher.retrieve(entry, token));
    snapshot = buildSnapshot(entry, got.value);
    assertPrivateSourceEffect('PRIVATE_SNAPSHOT_CUSTODY_WRITE');
    receipt = await custody.store(entry, snapshot);
  } catch (error) {
    // Only controlled codes escape; dependency exception text may contain credentials or source.
    throw Error(/^PRIVATE_SOURCE_[A-Z_]{1,60}$/.test(error?.message ?? '') ? error.message : 'PRIVATE_SOURCE_MATERIALIZATION_FAILED');
  }
  return {
    receipt: { ...receipt, repository: snapshot.snapshot.repository, commit: entry.commit, tree: entry.tree, credentialKind: credential.kind, credentialRevoked: got.revoked },
    // What the producer is allowed to receive: bytes + digest. Nothing else.
    producerInput: Object.freeze({ bytes: snapshot.bytes, sha256: snapshot.sha256 }),
    effects: Object.freeze(['PRIVATE_SOURCE_READ', 'PRIVATE_SNAPSHOT_CUSTODY_WRITE']),
  };
}

/** Verifier-side independent binding: re-read the same custody bytes with the
 * verifier's own binding and require the candidate's recorded base to be identical. */
export async function bindVerifierSource({ binding, registry, custody, receipt, candidate }) {
  const entry = bindPrivateSource(binding, registry);
  const read = await custody.read(entry, receipt);
  if (candidate.base !== entry.commit || fileTree(candidate.sourceFiles).sha !== entry.tree || canonical(candidate.sourceFiles) !== canonical(read.snapshot.files))
    throw Error('PRIVATE_SOURCE_VERIFIER_BINDING');
  return { entry, snapshot: read.snapshot, sha256: read.sha256 };
}

// ---- producer side ------------------------------------------------------------------------------

/** Network posture for a private-source producer: only the pinned harness package
 * registry while installing; GitHub is never reachable; deny-all afterwards. */
export const privateSourceNetworkPolicy = Object.freeze({ allow: Object.freeze(['registry.npmjs.org']) });

export function privateSourceMaterializationScript({ sha256: expected, commit, tree, home = '/home/factoryproducer' }) {
  return `
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),path=require('node:path');
const home=${JSON.stringify(home)},snap=home+'/private-source/snapshot.json',cwd=home+'/workspace';
const bytes=fs.readFileSync(snap);
if(crypto.createHash('sha256').update(bytes).digest('hex')!==${JSON.stringify(expected)})throw Error('PRIVATE_SOURCE_DIGEST_MISMATCH');
const s=JSON.parse(bytes.toString('utf8'));
if(s.commit!==${JSON.stringify(commit)}||s.tree!==${JSON.stringify(tree)}||s.kind!=='PRIVATE_SOURCE_SNAPSHOT')throw Error('SOURCE_MISMATCH');
fs.mkdirSync(cwd,{mode:0o755});
for(const [p,t] of Object.entries(s.files)){
 if(p.startsWith('/')||p.split('/').some(x=>!x||x==='.'||x==='..'||x.toLowerCase()==='.git'))throw Error('SOURCE_MISMATCH');
 const target=path.join(cwd,p);if(!target.startsWith(cwd+'/'))throw Error('SOURCE_MISMATCH');
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o755});fs.writeFileSync(target,t,{flag:'wx',mode:0o644});
}
const env={PATH:process.env.PATH,HOME:home,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
const git=(args,input)=>cp.execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,env,input,encoding:'utf8',timeout:20000,maxBuffer:256000}).trim();
git(['init','-q','-b','main']);git(['add','-A']);
if(git(['write-tree'])!==s.tree)throw Error('SOURCE_MISMATCH');
const commit=git(['hash-object','-t','commit','-w','--stdin'],Buffer.from(s.commitBase64,'base64'));
if(commit!==s.commit)throw Error('SOURCE_MISMATCH');
git(['update-ref','refs/heads/main',commit]);fs.writeFileSync(cwd+'/.git/shallow',commit+'\\n');
fs.rmSync(home+'/private-source',{recursive:true,force:true});
if(git(['rev-parse','HEAD'])!==commit||git(['rev-parse','HEAD^{tree}'])!==s.tree||git(['status','--porcelain']))throw Error('SOURCE_MISMATCH');
process.stdout.write(JSON.stringify({commit,tree:s.tree}));
`;
}

/** Writes ONLY the validated snapshot into the producer resource and rebuilds the
 * exact base commit offline. No GitHub reachability, no credential, no other file. */
export async function materializePrivateSourceInSandbox(sandbox, { snapshotBytes, sha256: expected, entry, home = '/home/factoryproducer', user }) {
  const v = validateSnapshotBytes(snapshotBytes, entry, expected);
  const producer = user ?? await sandbox.createUser('factoryproducer', { signal: AbortSignal.timeout(15000) });
  await producer.writeFiles([{ path: `${home}/private-source/snapshot.json`, content: snapshotBytes, mode: 0o600 }], { signal: AbortSignal.timeout(15000) });
  const done = await producer.runCommand({ cmd: 'node', args: ['-e', privateSourceMaterializationScript({ sha256: v.sha256, commit: entry.commit, tree: entry.tree, home })], timeoutMs: 30000, signal: AbortSignal.timeout(35000) });
  if (done.exitCode !== 0) throw Error('SOURCE_MATERIALIZATION_FAILED');
  const report = JSON.parse(await done.stdout({ signal: AbortSignal.timeout(15000) }));
  if (report.commit !== entry.commit || report.tree !== entry.tree) throw Error('SOURCE_MISMATCH');
  return report;
}
