export interface HostedInput { idempotencyKey: string; title: string; description: string; kind: "feature" | "defect" | "investigation"; acceptanceCriteria: string[]; allowedPaths: string[] }
export interface HostedConfig { clientId: string; repository: string; teamId: string; token: string; labelId?: string; receiptPublicKey: string }
export interface HostedReceipt { version: number; issueId: string; workOrderId: string; state: string; updatedAt: string; workOrderUrl: string }
export interface HostedResult { requestId: string; issueIdentifier: string; issueUrl: string; receipt: HostedReceipt | null }
export type Graphql = (query: string, variables: Record<string, unknown>) => Promise<any>;
export function parseInput(input: unknown): HostedInput;
export function requestId(clientId: string, key: string): string;
export function requestDescription(config: HostedConfig, input: unknown, expiresAt?: string): string;
export function readRequest(issue: any, client: {id: string; tokenSha256: string}, route: {repository: string; teamId: string}, now?: number): {input: HostedInput};
export function peekClientId(issue: any): string;
export function receiptDescription(description: string, receipt: HostedReceipt, privateKey: any): string;
export function readReceipt(description: string, publicKey: any, issueId: string): HostedReceipt | null;
export function submitHostedRequest(config: HostedConfig, input: unknown, graphql: Graphql): Promise<HostedResult>;
export function getHostedRequest(config: HostedConfig, id: string, graphql: Graphql): Promise<HostedResult>;
