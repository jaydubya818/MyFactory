import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "hosted-signing-keyring.json";
const LEGACY_FILE = "hosted-receipt-key.pem";
const idPattern = /^ed25519-[a-f0-9]{32}$/;

function publicIdentity(publicKey) {
  const key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  const der = key.export({ format: "der", type: "spki" });
  return `ed25519-${createHash("sha256").update(der).digest("hex").slice(0, 32)}`;
}

function entry(privateKey, status = "active", changedAt = new Date().toISOString()) {
  const key = privateKey?.type === "private" ? privateKey : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Hosted signing key must be Ed25519");
  const publicKey = createPublicKey(key);
  return { id: publicIdentity(publicKey), version: "ed25519-v1", status,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }),
    ...(status === "active" ? { privateKeyPem: key.export({ format: "pem", type: "pkcs8" }) } : {}),
    changedAt };
}

export function validateHostedSigningKeyring(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.keys) || !value.keys.length ||
      typeof value.activeKeyId !== "string") throw new Error("Invalid hosted signing keyring");
  const ids = new Set();
  for (const key of value.keys) {
    if (!key || !idPattern.test(key.id) || ids.has(key.id) || key.version !== "ed25519-v1" ||
        !["active", "rotated", "revoked"].includes(key.status) ||
        typeof key.publicKeyPem !== "string" || !Number.isFinite(Date.parse(key.changedAt)))
      throw new Error("Invalid hosted signing key entry");
    if (createPublicKey(key.publicKeyPem).asymmetricKeyType !== "ed25519" ||
        publicIdentity(key.publicKeyPem) !== key.id) throw new Error("Hosted signing key identity mismatch");
    if (key.status === "active") {
      if (typeof key.privateKeyPem !== "string" ||
          publicIdentity(createPrivateKey(key.privateKeyPem)) !== key.id)
        throw new Error("Active hosted signing key has no matching private key");
    } else if (key.privateKeyPem !== undefined) throw new Error("Inactive hosted signing key retains private material");
    ids.add(key.id);
  }
  if (value.keys.filter(key => key.status === "active").length !== 1 ||
      !value.keys.some(key => key.id === value.activeKeyId && key.status === "active"))
    throw new Error("Invalid active hosted signing key");
  return value;
}

export function exportHostedTrustBundle(keyring) {
  validateHostedSigningKeyring(keyring);
  return { version: 1, activeKeyId: keyring.activeKeyId,
    keys: keyring.keys.map(({ id, version, status, publicKeyPem, changedAt }) =>
      ({ id, version, status, publicKeyPem, changedAt })) };
}

function save(path, value) {
  validateHostedSigningKeyring(value);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
  return value;
}

/** One-time migration preserves the original PEM as the active key. New
 * envelopes carry its derived identity; old receipt envelopes remain readable. */
export function loadHostedSigningKeyring(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, FILE);
  if (existsSync(path)) return validateHostedSigningKeyring(JSON.parse(readFileSync(path, "utf8")));
  const legacy = join(dataDir, LEGACY_FILE);
  const privateKey = existsSync(legacy)
    ? readFileSync(legacy, "utf8")
    : generateKeyPairSync("ed25519").privateKey;
  const active = entry(privateKey);
  const keyring = save(path, { version: 1, activeKeyId: active.id, keys: [active] });
  if (existsSync(legacy)) unlinkSync(legacy);
  return keyring;
}

export function rotateHostedSigningKey(dataDir) {
  const keyring = loadHostedSigningKeyring(dataDir);
  const changedAt = new Date().toISOString();
  const active = entry(generateKeyPairSync("ed25519").privateKey, "active", changedAt);
  return save(join(dataDir, FILE), { version: 1, activeKeyId: active.id,
    keys: [...keyring.keys.map(key => key.id === keyring.activeKeyId
      ? { id: key.id, version: key.version, status: "rotated", publicKeyPem: key.publicKeyPem, changedAt }
      : key), active] });
}

/** Revoking an inactive key keeps its public identity for historical audit.
 * The active key cannot be revoked without first rotating to a replacement. */
export function revokeHostedSigningKey(dataDir, keyId) {
  const keyring = loadHostedSigningKeyring(dataDir);
  if (keyId === keyring.activeKeyId) throw new Error("Rotate the active hosted signing key before revocation");
  if (!keyring.keys.some(key => key.id === keyId)) throw new Error("Unknown hosted signing key");
  return save(join(dataDir, FILE), { ...keyring, keys: keyring.keys.map(key => key.id === keyId
    ? { ...key, status: "revoked", changedAt: new Date().toISOString() } : key) });
}
