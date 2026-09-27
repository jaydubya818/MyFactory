import type { HostedSigningKeyring } from "./index.mjs";
export function validateHostedSigningKeyring(value: unknown): HostedSigningKeyring;
export function loadHostedSigningKeyring(dataDir: string): HostedSigningKeyring;
export function exportHostedTrustBundle(keyring: HostedSigningKeyring): HostedSigningKeyring;
export function rotateHostedSigningKey(dataDir: string): HostedSigningKeyring;
export function revokeHostedSigningKey(dataDir: string, keyId: string): HostedSigningKeyring;
