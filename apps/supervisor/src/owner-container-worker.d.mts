import type { OwnerContainerProfile } from './owner-container-profile.mjs';
export function assertContainerAvailable(raw: unknown): OwnerContainerProfile;
export function dockerCommand(profile: OwnerContainerProfile, args: string[], timeout?: number): string;
export function runContainer(invocation: Record<string, unknown>, argv: string[]): Promise<number>;
export function recoverOwnerContainers(raw: unknown, owner: string): { status: string; ledgerReconciled: boolean };
export function assertCredentialBindIsolation(authFile:string,stateDirectory:string,workspacePath:string):void;
