import type { OwnerContainerProfile, MeteredContainerProfile } from './owner-container-profile.mjs';
export function assertContainerAvailable(raw: unknown): OwnerContainerProfile | MeteredContainerProfile;
export function dockerCommand(profile: OwnerContainerProfile | MeteredContainerProfile, args: string[], timeout?: number): string;
export function runContainer(invocation: Record<string, unknown>, argv: string[]): Promise<number>;
export function recoverOwnerContainers(raw: unknown, owner: string): { status: string; ledgerReconciled: boolean };
export function assertCredentialBindIsolation(authFile:string|null,stateDirectory:string,workspacePath:string):void;
export function sweepBrokerCredentials(stateDirectory: string): number;
export function resetWorkerHome(home: string, keepSessions: boolean): string;
export function rewriteMeteredArgv(argv: string[]): { argv: string[]; port: number };
