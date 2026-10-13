import type {PolicyKey, SignedPolicyMessage} from './ordering-wire.ts';

export const terminalSchema = 'factory-capability-preparation-terminal/v1' as const;
export type FactoryPreparationTerminal = {
  schema: typeof terminalSchema;
  ownerId: string; organizationId: string; installationId: string; agentId: string;
  clientId: string; backendId: string; incarnation: string; enrollmentVersion: number;
  requestId: string; workId: string; generation: number; missionId: string;
  factoryId: string; factoryVersion: string; sourceDigest: string; configurationDigest: string;
  nativeRequestDigest: string; planId: string; planDigest: string;
  receiverSequence: number; receiverHeadDigest: string;
  outcome: 'DEFINITELY_NOT_ADMITTED' | 'ADMISSION_UNCERTAIN';
  reasonCode: 'POLICY_CHANGED' | 'EXECUTION_AUTHORITY_DENIED' | 'DEADLINE_EXPIRED'
    | 'LOCK_TIMEOUT' | 'NATIVE_REVALIDATION_FAILED' | 'RESTORE_OR_COMMIT_AMBIGUITY';
  nativeOutcomeDigest: string; issuedAt: number; expiresAt: number;
};
export type TerminalBinding = Omit<FactoryPreparationTerminal,
  'schema' | 'planId' | 'planDigest' | 'receiverSequence' | 'receiverHeadDigest'
  | 'outcome' | 'reasonCode' | 'nativeOutcomeDigest' | 'issuedAt' | 'expiresAt'>;
const fields = ['schema','ownerId','organizationId','installationId','agentId','clientId','backendId',
  'incarnation','enrollmentVersion','requestId','workId','generation','missionId','factoryId',
  'factoryVersion','sourceDigest','configurationDigest','nativeRequestDigest','planId','planDigest',
  'receiverSequence','receiverHeadDigest','outcome','reasonCode','nativeOutcomeDigest','issuedAt','expiresAt'];
const numbers = new Set(['enrollmentVersion','generation','receiverSequence','issuedAt','expiresAt']);
const hashes = new Set(['factoryVersion','sourceDigest','configurationDigest','nativeRequestDigest',
  'planDigest','receiverHeadDigest','nativeOutcomeDigest']);
const fail = (): never => { throw Error('FACTORY_TERMINAL_INVALID'); };
export function parseFactoryPreparationTerminal(value: unknown): FactoryPreparationTerminal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))) return fail();
  for (const key of fields) {
    if (numbers.has(key)) {
      if (!Number.isSafeInteger(row[key]) || Number(row[key]) < 1) return fail();
    } else if (typeof row[key] !== 'string' || !row[key].length || row[key].length > 255
      || row[key] !== row[key].trim() || (hashes.has(key) && !/^[a-f0-9]{64}$/.test(row[key]))) return fail();
  }
  if (row.schema !== terminalSchema
    || !['DEFINITELY_NOT_ADMITTED','ADMISSION_UNCERTAIN'].includes(String(row.outcome))
    || !['POLICY_CHANGED','EXECUTION_AUTHORITY_DENIED','DEADLINE_EXPIRED','LOCK_TIMEOUT',
      'NATIVE_REVALIDATION_FAILED','RESTORE_OR_COMMIT_AMBIGUITY'].includes(String(row.reasonCode))
    || Number(row.expiresAt) <= Number(row.issuedAt) || Number(row.expiresAt) - Number(row.issuedAt) > 30_000
    || (row.outcome === 'ADMISSION_UNCERTAIN' && row.reasonCode !== 'RESTORE_OR_COMMIT_AMBIGUITY')) return fail();
  return Object.fromEntries(fields.map(key => [key,row[key]])) as FactoryPreparationTerminal;
}
const bytes = (value: string) => new TextEncoder().encode(value);
export async function signFactoryPreparationTerminal(value: FactoryPreparationTerminal, key: PolicyKey): Promise<SignedPolicyMessage> {
  // Schema/domain is signed inside the message, not supplied by an HTTP header.
  const message = JSON.stringify(parseFactoryPreparationTerminal(value));
  const privateKey = await crypto.subtle.importKey('jwk',key.jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,bytes(message));
  return {message,keyId:key.keyId,signature:btoa(String.fromCharCode(...new Uint8Array(signature)))};
}
export async function verifyFactoryPreparationTerminal(envelope: SignedPolicyMessage, key: PolicyKey,
  expected: TerminalBinding, now = Date.now()): Promise<FactoryPreparationTerminal> {
  if (!envelope || Object.keys(envelope).sort().join(',') !== 'keyId,message,signature'
    || envelope.keyId !== key.keyId || typeof envelope.message !== 'string' || envelope.message.length > 8192
    || typeof envelope.signature !== 'string' || envelope.signature.length > 128) return fail();
  const publicKey = await crypto.subtle.importKey('jwk',{kty:key.jwk.kty,crv:key.jwk.crv,x:key.jwk.x,y:key.jwk.y,ext:true},
    {name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  let signature: Uint8Array<ArrayBuffer>;
  try { signature = Uint8Array.from(atob(envelope.signature),char => char.charCodeAt(0)); } catch { return fail(); }
  if (!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,signature,bytes(envelope.message)))
    throw Error('FACTORY_TERMINAL_SIGNATURE');
  const bindingKeys = fields.filter(key => !['schema','planId','planDigest','receiverSequence','receiverHeadDigest',
    'outcome','reasonCode','nativeOutcomeDigest','issuedAt','expiresAt'].includes(key));
  if (!expected || Object.keys(expected).sort().join(',') !== [...bindingKeys].sort().join(','))
    throw Error('FACTORY_TERMINAL_BINDING');
  const receipt = parseFactoryPreparationTerminal(JSON.parse(envelope.message));
  if (Object.entries(expected).some(([key,value]) => receipt[key as keyof FactoryPreparationTerminal] !== value))
    throw Error('FACTORY_TERMINAL_BINDING');
  if (receipt.issuedAt > now || receipt.expiresAt <= now) throw Error('FACTORY_TERMINAL_STALE');
  return receipt;
}
