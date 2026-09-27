export interface FactoryVersion { sourceCommit: string; sourceTree: string; configurationDigest: string }
export interface FactoryBinding { ownerId: string; agentId: string; workId: string; workVersion: number; workGeneration: number; criteriaVersion: number; submissionDigest: string; expectedFactoryId: string; expectedFactoryVersion: FactoryVersion }
export interface HostedInput { idempotencyKey: string; title: string; description: string; kind: "feature" | "defect" | "investigation"; acceptanceCriteria: string[]; allowedPaths: string[]; factoryBinding?: FactoryBinding }
export interface HostedSigningKey { id: string; version: "ed25519-v1"; status: "active" | "rotated" | "revoked"; publicKeyPem: string; privateKeyPem?: string; changedAt: string }
export interface HostedSigningKeyring { version: 1; activeKeyId: string; keys: HostedSigningKey[] }
export interface HostedKeyTrust { keyId: string | null; keyVersion: "ed25519-v1"; trustStatus: "active" | "rotated" | "revoked"; cryptographicallyValid: true; legacyEnvelope: boolean }
export interface HostedSignedEnvelope { encoded: string; signature: string; keyId?: string }
export interface HostedConfig { clientId: string; repository: string; teamId: string; token: string; labelId?: string; receiptPublicKey?: string; signingKeyring?: HostedSigningKeyring }
export interface HostedReceipt { version: number; issueId: string; workOrderId: string; state: string; updatedAt: string; workOrderUrl: string }
export interface HostedCandidateResult { version: 1; issueId: string; operationId: string; manifestDigest: string; factoryVersion: FactoryVersion; manifest: unknown }
export interface HostedResult { requestId: string; issueIdentifier: string; issueUrl: string; receipt: HostedReceipt | null; receiptTrust: HostedKeyTrust | null; result: HostedCandidateResult | null; resultEnvelope: HostedSignedEnvelope | null; resultEnvelopeDigest: string | null; resultTrust: HostedKeyTrust | null }
export type Graphql = (query: string, variables: Record<string, unknown>) => Promise<any>;
export function parseInput(input: unknown): HostedInput;
export function requestId(clientId: string, key: string): string;
export function requestDescription(config: HostedConfig, input: unknown, expiresAt?: string): string;
export function readRequest(issue: any, client: {id: string; tokenSha256: string}, route: {repository: string; teamId: string}, now?: number): {input: HostedInput};
export function peekClientId(issue: any): string;
export function receiptDescription(description: string, receipt: HostedReceipt, privateKey: any | HostedSigningKeyring): string;
export function inspectReceipt(description: string, publicKey: any | HostedSigningKeyring, issueId: string): {receipt: HostedReceipt; trust: HostedKeyTrust; envelope: HostedSignedEnvelope; envelopeDigest: string} | null;
export function readReceipt(description: string, publicKey: any | HostedSigningKeyring, issueId: string): HostedReceipt | null;
export function resultDescription(description: string, encoded: string, privateKey: any | HostedSigningKeyring): string;
export function inspectResult(description: string, publicKey: any | HostedSigningKeyring, issueId: string): {result: HostedCandidateResult; trust: HostedKeyTrust; envelope: HostedSignedEnvelope; envelopeDigest: string} | null;
export function readResult(description: string, publicKey: any | HostedSigningKeyring, issueId: string): HostedCandidateResult | null;
export function submitHostedRequest(config: HostedConfig, input: unknown, graphql: Graphql): Promise<HostedResult>;
export function getHostedRequest(config: HostedConfig, id: string, graphql: Graphql): Promise<HostedResult>;
