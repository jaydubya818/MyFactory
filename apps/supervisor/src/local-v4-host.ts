import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalV4Supervisor, type ProductiveBinding } from './server.ts';
import { assertTrustedExecutablePath, ExecutableTrustRefused, trustedAncestors } from './executable-trust.ts';
import { FileReceiverWitness, type LocalOrderedEnrollment, type ReceiverScope } from './local-ordered-admission.ts';
import { readCurrentProducerSourceIdentity } from './producer-results.ts';
import { validatePrice, type SpendPrice } from './spend-gateway.ts';
import { createCodexAdapter, preflightOwnerLoginCodex } from '../../../packages/agents/src/index.ts';
import { digest } from '../../../packages/hosted-routing/src/result.ts';
import type { PolicyKey } from '../../../packages/capability-enforcement/src/ordering-wire.ts';
import { ownerSubscriptionExecutorVersion } from '../../../packages/contracts/src/owner-subscription-route.ts';
import { OWNER_SUBSCRIPTION_PRICING_REVISION } from '../../../packages/storage/src/spend-policy.ts';
import { parseOwnerSubscriptionRoute, subscriptionSpendContract, OwnerSubscriptionRefused, OWNER_SUBSCRIPTION_ROUTE, type OwnerSubscriptionRoute, type OwnerContainerProfile } from './owner-subscription-route.ts';
import { parseOwnerContainerProfile, containerExecutorVersion } from './owner-container-profile.mjs';
import { assertContainerAvailable } from './owner-container-worker.mjs';

/**
 * Trusted host composition of the ordered LOCAL_V4 supervisor (private beta: owner + named testers on one Mac).
 *
 * The host process is the only caller of `createLocalV4Supervisor` outside tests. Everything authority-bearing comes from a
 * reviewed JSON file plus 0600 material files outside the repository; nothing is read from HTTP, argv secrets or the environment.
 * It composes only existing authority: the ordered receiver (MyEve + Relay PERMIT pair, file witness), the productive binding
 * (host-pinned absolute Codex executable through the metered Work gateway, leased Docker verifier by immutable image ID) and the
 * existing SpendLedger. It adds no execution, spend, retry or feedback-round authority (strict LOCAL_V4 keeps one feedback round).
 * The enrolled Factory identity is computed with the producer's own V4 configuration formula for exactly one pinned request
 * profile; a mismatching native snapshot is refused by the receiver (fail closed), never adjusted.
 */
export const HOST_CONFIG_SCHEMA = 'myfactory-local-v4-host/v1';
export const HOST_FACTS_SCHEMA = 'myfactory-local-v4-host-facts/v1';
/** Mirrors LocalProducerResultsV4.capture; the host test cross-checks it against a real prepared snapshot. */
const SKILL_REVISION = 'fd8f20a879b507cf09feba08663a1edf7a949353';
const CONTROL_ACTIONS = ['factory.prepare', 'factory.dispatch', 'factory.observe', 'factory.stop'];
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface LocalV4HostConfig {
  schema: typeof HOST_CONFIG_SCHEMA;
  factoryId: string;
  port: number;
  dataDir: string;
  materialDir: string;
  witness: { path: string; epoch: string };
  worker: { codexExecutable: string; workerProfile: 'mac'; ownerContainer?: OwnerContainerProfile };
  verificationImage: string;
  profile: { checkCommands: string[]; allowedPaths: string[] };
  client: { id: string; name: string; ownerScope: string; repositoryPaths: string[] };
  enrollment: { scope: ReceiverScope; agentId: string; registryVersion: string; sourceKeyFiles: { myeve: string; relay: string } };
  /** Metered (default; unchanged) or the explicit opt-in owner-only OWNER_SUBSCRIPTION_LOCAL route (selected by `mode`). */
  provider: MeteredProviderConfig | OwnerSubscriptionRoute;
}
export interface MeteredProviderConfig { upstreamOrigin: string; credentialFile: string; price: SpendPrice }
export const isSubscriptionProvider = (p: LocalV4HostConfig['provider']): p is OwnerSubscriptionRoute => (p as OwnerSubscriptionRoute).mode === OWNER_SUBSCRIPTION_ROUTE;
export class HostConfigRefused extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
const refuse = (code: string): never => { throw new HostConfigRefused(code); };
const obj = (v: unknown, keys: string[], code: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) refuse(code);
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== [...keys].sort().join(',')) refuse(code);
  return o;
};
const str = (v: unknown, re: RegExp, code: string): string => typeof v === 'string' && re.test(v) ? v : refuse(code);
const abs = (v: unknown, code: string): string =>
  typeof v === 'string' && isAbsolute(v) && resolve(v) === v && !v.includes('\0') ? v : refuse(code);
const strings = (v: unknown, max: number, code: string, each: (s: string) => boolean = s => s.length > 0 && s.length <= 512): string[] =>
  Array.isArray(v) && v.length > 0 && v.length <= max && v.every(s => typeof s === 'string' && each(s)) && new Set(v).size === v.length ? v as string[] : refuse(code);
/** Real path of the nearest existing ancestor joined with the rest, so /tmp vs /private/tmp cannot hide containment. */
function real(p: string): string {
  let head = p; const tail: string[] = [];
  while (!existsSync(head)) { tail.unshift(head.slice(dirname(head).length + 1)); head = dirname(head); }
  return join(realpathSync(head), ...tail);
}
/** `..`-prefixed names (e.g. `<repo>/..material`) are inside; only a `..` path segment leaves the parent. */
const inside = (child: string, parent: string) => { const r = relative(real(parent), real(child)); return r === '' || r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r); };
export const isInsideForTest = inside;

/** P1 trust: the host config is an operator-owned regular file (no symlink), not group/world-writable, in a trusted directory, outside the repo. */
export function assertTrustedConfigFile(path: string) {
  let st; try { st = lstatSync(path); } catch { return refuse('HOST_CONFIG_MISSING'); }
  if (st.isSymbolicLink() || !st.isFile()) refuse('HOST_CONFIG_UNTRUSTED');
  if (st.uid !== process.getuid!() || (st.mode & 0o022) !== 0 || !trustedAncestors(path)) refuse('HOST_CONFIG_UNTRUSTED');
  if (inside(path, repoRoot)) refuse('HOST_CONFIG_PATH_INSIDE_REPOSITORY');
}
/** P1 trust before ANY execution (preflight included); shared with the route, which re-checks at every execution entry. */
export function assertTrustedExecutable(path: string) {
  try { assertTrustedExecutablePath(path); } catch (error) { refuse(error instanceof ExecutableTrustRefused ? error.code : 'HOST_CODEX_UNTRUSTED'); }
}
/** The preflight the route actually uses; the subscription route's children get the allowlisted environment. */
export async function hostPreflight(config: LocalV4HostConfig) {
  assertTrustedExecutable(config.worker.codexExecutable);
  if (config.worker.ownerContainer) { assertTrustedExecutable(config.worker.ownerContainer.dockerExecutable); assertContainerAvailable(config.worker.ownerContainer); }
  return isSubscriptionProvider(config.provider) ? preflightOwnerLoginCodex(config.worker.codexExecutable, config.worker.workerProfile)
    : createCodexAdapter(config.worker.codexExecutable, config.worker.workerProfile).preflightCodex();
}

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/, NAME = /^[A-Za-z0-9:_.-]{1,128}$/, HEX64 = /^[a-f0-9]{64}$/;
/** Strict parse; every unknown, missing or unqualified field refuses. Paths that hold state or material must be outside the repo. */
export function parseHostConfig(raw: unknown): LocalV4HostConfig {
  const c = obj(raw, ['schema', 'factoryId', 'port', 'dataDir', 'materialDir', 'witness', 'worker', 'verificationImage', 'profile', 'client', 'enrollment', 'provider'], 'HOST_CONFIG_SHAPE');
  if (c.schema !== HOST_CONFIG_SCHEMA) refuse('HOST_CONFIG_SCHEMA');
  const port = Number.isSafeInteger(c.port) && (c.port as number) >= 1024 && (c.port as number) <= 65535 ? c.port as number : refuse('HOST_CONFIG_PORT');
  const dataDir = abs(c.dataDir, 'HOST_CONFIG_DATA_DIR'), materialDir = abs(c.materialDir, 'HOST_CONFIG_MATERIAL_DIR');
  const w = obj(c.witness, ['path', 'epoch'], 'HOST_CONFIG_WITNESS');
  const witness = { path: abs(w.path, 'HOST_CONFIG_WITNESS'), epoch: str(w.epoch, NAME, 'HOST_CONFIG_WITNESS') };
  const wk = obj(c.worker, c.worker && Object.hasOwn(c.worker as object, 'ownerContainer') ? ['codexExecutable', 'workerProfile', 'ownerContainer'] : ['codexExecutable', 'workerProfile'], 'HOST_CONFIG_WORKER');
  if (wk.workerProfile !== 'mac') refuse('HOST_CONFIG_WORKER');
  const worker = { codexExecutable: abs(wk.codexExecutable, 'HOST_CONFIG_WORKER'), workerProfile: 'mac' as const,
    ...(Object.hasOwn(wk, 'ownerContainer') ? { ownerContainer: parseOwnerContainerProfile(wk.ownerContainer) } : {}) };
  const verificationImage = str(c.verificationImage, /^sha256:[a-f0-9]{64}$/, 'HOST_CONFIG_IMAGE');
  const pr = obj(c.profile, ['checkCommands', 'allowedPaths'], 'HOST_CONFIG_PROFILE');
  const profile = { checkCommands: strings(pr.checkCommands, 16, 'HOST_CONFIG_PROFILE'),
    allowedPaths: strings(pr.allowedPaths, 64, 'HOST_CONFIG_PROFILE', s => s.length > 0 && s.length <= 256 && !isAbsolute(s) && !s.split('/').includes('..')) };
  const cl = obj(c.client, ['id', 'name', 'ownerScope', 'repositoryPaths'], 'HOST_CONFIG_CLIENT');
  const client = { id: str(cl.id, /^[a-z0-9_-]{1,64}$/, 'HOST_CONFIG_CLIENT'), name: str(cl.name, /^[^\x00-\x1f]{1,80}$/, 'HOST_CONFIG_CLIENT'),
    ownerScope: str(cl.ownerScope, NAME, 'HOST_CONFIG_CLIENT'), repositoryPaths: strings(cl.repositoryPaths, 16, 'HOST_CONFIG_CLIENT', s => isAbsolute(s) && resolve(s) === s) };
  const en = obj(c.enrollment, ['scope', 'agentId', 'registryVersion', 'sourceKeyFiles'], 'HOST_CONFIG_ENROLLMENT');
  const sc = obj(en.scope, ['ownerId', 'organizationId', 'installationId', 'backendId', 'incarnation', 'enrollmentVersion'], 'HOST_CONFIG_SCOPE');
  const scope: ReceiverScope = { ownerId: str(sc.ownerId, NAME, 'HOST_CONFIG_SCOPE'), organizationId: str(sc.organizationId, NAME, 'HOST_CONFIG_SCOPE'),
    installationId: str(sc.installationId, NAME, 'HOST_CONFIG_SCOPE'), backendId: str(sc.backendId, NAME, 'HOST_CONFIG_SCOPE'),
    incarnation: str(sc.incarnation, NAME, 'HOST_CONFIG_SCOPE'),
    enrollmentVersion: Number.isSafeInteger(sc.enrollmentVersion) && (sc.enrollmentVersion as number) > 0 ? sc.enrollmentVersion as number : refuse('HOST_CONFIG_SCOPE') };
  if (scope.ownerId !== client.ownerScope) refuse('HOST_CONFIG_OWNER_SCOPE');
  const kf = obj(en.sourceKeyFiles, ['myeve', 'relay'], 'HOST_CONFIG_SOURCE_KEYS');
  const enrollment = { scope, agentId: str(en.agentId, NAME, 'HOST_CONFIG_ENROLLMENT'), registryVersion: str(en.registryVersion, NAME, 'HOST_CONFIG_ENROLLMENT'),
    sourceKeyFiles: { myeve: abs(kf.myeve, 'HOST_CONFIG_SOURCE_KEYS'), relay: abs(kf.relay, 'HOST_CONFIG_SOURCE_KEYS') } };
  if (c.provider && typeof c.provider === 'object' && 'mode' in (c.provider as object)) {
    let route: OwnerSubscriptionRoute;
    try { route = parseOwnerSubscriptionRoute(c.provider); } catch (error) { return refuse(error instanceof OwnerSubscriptionRefused ? 'HOST_CONFIG_' + error.code : 'HOST_CONFIG_PROVIDER'); }
    const factoryId = str(c.factoryId, ID, 'HOST_CONFIG_FACTORY_ID');
    if (route.clientId !== client.id || route.ownerScope !== client.ownerScope || route.ownerScope !== scope.ownerId) refuse('HOST_CONFIG_SUBSCRIPTION_OWNER_ONLY');
    for (const p of [dataDir, materialDir, witness.path]) if (inside(p, repoRoot)) refuse('HOST_CONFIG_PATH_INSIDE_REPOSITORY');
    if (inside(witness.path, dataDir) || inside(materialDir, dataDir) || inside(dataDir, materialDir)) refuse('HOST_CONFIG_PATH_OVERLAP');
    return { schema: HOST_CONFIG_SCHEMA, factoryId, port, dataDir, materialDir, witness, worker, verificationImage, profile, client, enrollment, provider: { ...route } };
  }
  const pv = obj(c.provider, ['upstreamOrigin', 'credentialFile', 'price'], 'HOST_CONFIG_PROVIDER');
  if (worker.ownerContainer) refuse('HOST_CONFIG_CONTAINER_REQUIRES_OWNER_ROUTE');
  const upstreamOrigin = str(pv.upstreamOrigin, /^(?:http:\/\/127\.0\.0\.1:\d{1,5}|https:\/\/api\.openai\.com)$/, 'HOST_CONFIG_PROVIDER');
  const price = obj(pv.price, ['revision', 'model', 'validUntil', 'contextLimitTokens', 'outputLimitTokens', 'inputMicrousdPerMillion', 'outputMicrousdPerMillion'], 'HOST_CONFIG_PRICE') as unknown as SpendPrice;
  try { validatePrice(price); } catch { refuse('HOST_CONFIG_PRICE'); }
  if (price.revision === OWNER_SUBSCRIPTION_PRICING_REVISION) refuse('HOST_CONFIG_PRICE');   // the operations-only revision is never a metered price card
  const provider = { upstreamOrigin, credentialFile: abs(pv.credentialFile, 'HOST_CONFIG_PROVIDER'), price: { ...price } };
  const factoryId = str(c.factoryId, ID, 'HOST_CONFIG_FACTORY_ID');
  for (const p of [dataDir, materialDir, witness.path, provider.credentialFile]) if (inside(p, repoRoot)) refuse('HOST_CONFIG_PATH_INSIDE_REPOSITORY');
  if (inside(witness.path, dataDir) || inside(materialDir, dataDir) || inside(dataDir, materialDir)) refuse('HOST_CONFIG_PATH_OVERLAP');
  return { schema: HOST_CONFIG_SCHEMA, factoryId, port, dataDir, materialDir, witness, worker, verificationImage, profile, client, enrollment, provider };
}

/** Owner-only regular file (0600, current uid, no symlink); refuses anything else. */
function secretFile(path: string, code: string): string {
  let st; try { st = lstatSync(path); } catch { return refuse(code + '_MISSING'); }
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid!()) refuse(code + '_PERMISSIONS');
  return readFileSync(path, 'utf8');
}
const json = (text: string, code: string): any => { try { return JSON.parse(text); } catch { return refuse(code); } };
/** Public P-256 verification key only. MyFactory never holds MyEve's or Relay's private signing keys. */
export function readPublicPolicyKey(path: string, code: string): PolicyKey {
  const k = json(readFileSync(path, 'utf8'), code);
  const o = obj(k, ['keyId', 'jwk'], code), j = obj(o.jwk, Object.keys((o.jwk ?? {}) as object), code);
  if (typeof o.keyId !== 'string' || !o.keyId || j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.x !== 'string' || typeof j.y !== 'string' || 'd' in j) refuse(code);
  return { keyId: o.keyId as string, jwk: { kty: 'EC', crv: 'P-256', x: j.x as string, y: j.y as string } };
}
export const MATERIAL = { signer: 'receiver-signer.json', result: 'result-signing.json', token: 'client-token', facts: 'host-facts.json' } as const;

function writeExclusive(path: string, text: string, mode: number) { writeFileSync(path, text, { mode, flag: 'wx' }); chmodSync(path, mode); }
/** One-time host provisioning of the receiver signer, producer result-signing key and the client bearer token (all 0600). */
export async function provisionHostMaterial(config: LocalV4HostConfig, now = new Date()): Promise<{ created: string[] }> {
  mkdirSync(config.materialDir, { recursive: true, mode: 0o700 }); chmodSync(config.materialDir, 0o700);
  const created: string[] = [], at = (n: string) => join(config.materialDir, n);
  if (!existsSync(at(MATERIAL.signer))) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    writeExclusive(at(MATERIAL.signer), JSON.stringify({ keyId: `receiver-${config.factoryId}-${now.toISOString().slice(0, 10)}`, jwk: await crypto.subtle.exportKey('jwk', pair.privateKey) }), 0o600);
    created.push(MATERIAL.signer);
  }
  if (!existsSync(at(MATERIAL.result))) {
    const pair = generateKeyPairSync('ed25519'), keyId = `result-${now.toISOString().slice(0, 10)}`;
    const key = { factoryId: config.factoryId, keyId, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      activeFrom: now.toISOString(), notAfter: new Date(now.getTime() + 365 * 86400_000).toISOString() };
    writeExclusive(at(MATERIAL.result), JSON.stringify({ factoryId: config.factoryId, currentKeyId: keyId,
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), keys: [key] }), 0o600);
    created.push(MATERIAL.result);
  }
  if (!existsSync(at(MATERIAL.token))) { writeExclusive(at(MATERIAL.token), randomBytes(32).toString('hex') + '\n', 0o600); created.push(MATERIAL.token); }
  return { created };
}

type ResultSigning = { factoryId: string; currentKeyId: string; privateKey: string; keys: { factoryId: string; keyId: string; publicKey: string; activeFrom: string; notAfter: string }[] };
function readMaterial(config: LocalV4HostConfig) {
  const st = (() => { try { return lstatSync(config.materialDir); } catch { return refuse('HOST_MATERIAL_MISSING'); } })();
  if (!st.isDirectory() || (st.mode & 0o077) !== 0) refuse('HOST_MATERIAL_DIR_PERMISSIONS');
  const signer = json(secretFile(join(config.materialDir, MATERIAL.signer), 'HOST_MATERIAL_SIGNER'), 'HOST_MATERIAL_SIGNER') as PolicyKey;
  if (!signer?.keyId || signer.jwk?.kty !== 'EC' || signer.jwk.crv !== 'P-256' || !signer.jwk.d) refuse('HOST_MATERIAL_SIGNER');
  const result = json(secretFile(join(config.materialDir, MATERIAL.result), 'HOST_MATERIAL_RESULT'), 'HOST_MATERIAL_RESULT') as ResultSigning;
  const current = result?.keys?.find?.(k => k.keyId === result.currentKeyId && k.factoryId === config.factoryId);
  if (result?.factoryId !== config.factoryId || !current) refuse('HOST_MATERIAL_RESULT');
  try { if (!createPublicKey(createPrivateKey(result.privateKey)).equals(createPublicKey(current!.publicKey))) throw Error(); } catch { refuse('HOST_MATERIAL_RESULT'); }
  const token = secretFile(join(config.materialDir, MATERIAL.token), 'HOST_MATERIAL_TOKEN').trim();
  if (!HEX64.test(token)) refuse('HOST_MATERIAL_TOKEN');
  if (isSubscriptionProvider(config.provider)) return { signer, result, tokenSha256: createHash('sha256').update(token).digest('hex'), credential: null };
  const credential = secretFile(config.provider.credentialFile, 'HOST_PROVIDER_CREDENTIAL').trim();
  if (!credential || /[\r\n]/.test(credential)) refuse('HOST_PROVIDER_CREDENTIAL');
  return { signer, result, tokenSha256: createHash('sha256').update(token).digest('hex'), credential };
}

/** The exact V4 execution configuration the producer captures for the pinned profile (kind `feature`, worker `mac`). */
export function hostExecutionConfiguration(config: LocalV4HostConfig, executorVersion: string) {
  // The subscription route is bound into the identity through the executor version, exactly as its preflight reports it.
  const subscription = isSubscriptionProvider(config.provider);
  return { model: subscription ? (config.provider as OwnerSubscriptionRoute).model : (config.provider as MeteredProviderConfig).price.model,
    executor: 'codex-cli' as const, executorVersion: subscription ? (config.worker.ownerContainer ? containerExecutorVersion(executorVersion, config.worker.ownerContainer) : ownerSubscriptionExecutorVersion(executorVersion)) : executorVersion, skillRevision: SKILL_REVISION,
    workerProfile: config.worker.workerProfile, verificationImage: config.verificationImage, nodeVersion: process.version,
    platform: process.platform, architecture: process.arch, commands: [...config.profile.checkCommands],
    allowedPaths: [...config.profile.allowedPaths], timeoutMs: 30 * 60 * 1000 };
}
export function hostFactoryIdentity(config: LocalV4HostConfig, executorVersion: string) {
  const configuration = hostExecutionConfiguration(config, executorVersion), sourceDigest = readCurrentProducerSourceIdentity();
  const configurationDigest = digest(configuration);
  return { factoryId: config.factoryId, factoryVersion: digest({ sourceDigest, configurationDigest }), sourceDigest, configurationDigest, configuration };
}
const publicJwk = (k: PolicyKey): PolicyKey => ({ keyId: k.keyId, jwk: { kty: k.jwk.kty, crv: k.jwk.crv, x: k.jwk.x, y: k.jwk.y } });
const atomicWrite = (path: string, text: string, mode: number) => { const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, text, { mode }); chmodSync(tmp, mode); renameSync(tmp, path); };

function dockerImageId(image: string): string | null {
  try { return execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
export interface HostDependencies {
  /** Docker presence check for the pinned image ID (default: `docker image inspect`). The leased verifier re-checks at run time. */
  inspectImage?: (image: string) => string | null;
}

/** Composes and starts the ordered LOCAL_V4 supervisor on exact loopback; refuses (before listening) on any missing piece. */
export async function startLocalV4Host(config: LocalV4HostConfig, deps: HostDependencies = {}) {
  const material = readMaterial(config);
  const sourceKeys = { myeve: readPublicPolicyKey(config.enrollment.sourceKeyFiles.myeve, 'HOST_SOURCE_KEY_MYEVE'),
    relay: readPublicPolicyKey(config.enrollment.sourceKeyFiles.relay, 'HOST_SOURCE_KEY_RELAY') };
  if ((deps.inspectImage ?? dockerImageId)(config.verificationImage) !== config.verificationImage) refuse('HOST_VERIFICATION_IMAGE_UNAVAILABLE');
  const subscription = isSubscriptionProvider(config.provider) ? config.provider : null;
  const preflight = await hostPreflight(config);
  if (!preflight.binaryAvailable || !preflight.version) refuse('HOST_CODEX_UNAVAILABLE');
  if (!preflight.authenticated) refuse(subscription ? 'HOST_CODEX_OWNER_LOGIN_REQUIRED' : 'HOST_CODEX_UNAVAILABLE');
  const identity = hostFactoryIdentity(config, preflight.version!);

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 }); chmodSync(config.dataDir, 0o700);
  mkdirSync(dirname(config.witness.path), { recursive: true, mode: 0o700 });
  atomicWrite(join(config.dataDir, 'connections.json'), JSON.stringify({ clients: [{ id: config.client.id, name: config.client.name,
    tokenSha256: material.tokenSha256, repositoryPaths: config.client.repositoryPaths, ownerScope: config.client.ownerScope, actions: CONTROL_ACTIONS }] }, null, 2), 0o600);
  const enrollment: LocalOrderedEnrollment = { scope: config.enrollment.scope, agentId: config.enrollment.agentId, registryVersion: config.enrollment.registryVersion,
    clientId: config.client.id, sourceKeys, signer: material.signer,
    factory: { factoryId: identity.factoryId, factoryVersion: identity.factoryVersion, sourceDigest: identity.sourceDigest, configurationDigest: identity.configurationDigest } };
  const credential = material.credential;
  const metered = subscription ? null : config.provider as MeteredProviderConfig;
  const productiveBinding: ProductiveBinding | undefined = metered ? {
    provider: { upstreamOrigin: metered.upstreamOrigin, price: { ...metered.price }, authorize: async () => credential! },
    codexExecutable: config.worker.codexExecutable, workerProfile: config.worker.workerProfile, verificationImage: config.verificationImage } : undefined;
  const supervisor = createLocalV4Supervisor({ dataDir: config.dataDir, deskPort: config.port, resultSigning: material.result,
    orderedAdmission: { enrollment, witness: new FileReceiverWitness(config.witness.path, config.witness.epoch), witnessPath: config.witness.path },
    ...(productiveBinding ? { productiveBinding } : { ownerSubscriptionBinding: { route: { ...subscription! }, codexExecutable: config.worker.codexExecutable,
      workerProfile: config.worker.workerProfile, verificationImage: config.verificationImage,
      ...(config.worker.ownerContainer ? { container: config.worker.ownerContainer } : {}) } }) });
  try {
    await new Promise<void>((ok, fail) => { supervisor.server.once('error', fail); supervisor.server.listen(config.port, '127.0.0.1', () => ok()); });
    if (subscription && (supervisor.ownerSubscription?.disabled || !supervisor.server.listening)) refuse('HOST_SUBSCRIPTION_LOOPBACK');
  } catch (error) { await supervisor.close().catch(() => {}); throw error; }
  const address = supervisor.server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : config.port}`;
  const facts = {
    schema: HOST_FACTS_SCHEMA, origin, connectPrefix: '/api/connect/v1', capabilityAdmissionPrefix: '/api/capability-admission',
    readiness: { health: '/api/health', authenticated: '/api/connect/v1/actions',
      expectedExecution: subscription ? { mode: OWNER_SUBSCRIPTION_ROUTE, spendEnforced: true, metering: 'SUBSCRIPTION_UNMETERED' } : { mode: 'LIVE', spendEnforced: true }, controls: CONTROL_ACTIONS },
    client: { id: config.client.id, ownerScope: config.client.ownerScope, repositoryPaths: config.client.repositoryPaths, tokenFile: join(config.materialDir, MATERIAL.token) },
    factory: { factoryId: identity.factoryId, factoryVersion: identity.factoryVersion, sourceDigest: identity.sourceDigest, configurationDigest: identity.configurationDigest },
    configuration: identity.configuration, profile: config.profile,
    enrollment: { ...config.enrollment.scope, agentId: config.enrollment.agentId, registryVersion: config.enrollment.registryVersion, clientId: config.client.id,
      sourceKeyIds: { myeve: sourceKeys.myeve.keyId, relay: sourceKeys.relay.keyId } },
    receiverSigner: publicJwk(material.signer),
    resultKeys: material.result.keys.map(({ factoryId, keyId, publicKey, activeFrom, notAfter }) => ({ factoryId, keyId, publicKey, activeFrom, notAfter })),
    provider: metered ? { upstreamOrigin: metered.upstreamOrigin, price: metered.price } : {
      mode: OWNER_SUBSCRIPTION_ROUTE, ownerOnly: true, bindHost: subscription!.bindHost, ownerScope: subscription!.ownerScope, clientId: subscription!.clientId,
      model: subscription!.model, validUntil: subscription!.validUntil, metering: 'SUBSCRIPTION_UNMETERED', credential: 'OPERATOR_CODEX_CHATGPT_LOGIN',
      limits: { maxProductiveOperations: subscription!.maxProductiveOperations, plannedCompletionOperations: 1,
        maxOperationsPerWork: subscription!.maxProductiveOperations + 1, maxConcurrentRuns: subscription!.maxConcurrentRuns,
        concurrencyScope: 'MACHINE', maxWorkSeconds: subscription!.maxWorkSeconds },
      spendContract: subscriptionSpendContract(subscription!),
      spendReadContract: 'spend.status is SUBSCRIPTION_UNMETERED (or UNKNOWN, fenced); metering=SUBSCRIPTION_UNMETERED, costKnown=false, currency=null, every *Microusd field null. Never settle as $0.' },
    feedback: { strictLocalV4MaxRounds: 1 }, pid: process.pid, startedAt: new Date().toISOString(),
  };
  atomicWrite(join(config.materialDir, MATERIAL.facts), JSON.stringify(facts, null, 2) + '\n', 0o644);
  return { supervisor, origin, facts, close: () => supervisor.close() };
}

export function loadHostConfig(path: string): LocalV4HostConfig {
  if (!isAbsolute(path)) refuse('HOST_CONFIG_PATH');
  assertTrustedConfigFile(path);
  let text; try { text = readFileSync(path, 'utf8'); } catch { return refuse('HOST_CONFIG_MISSING'); }
  return parseHostConfig(json(text, 'HOST_CONFIG_JSON'));
}
