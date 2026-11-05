export interface OwnerContainerProfile { imageId: string; dockerExecutable: string; authFile: string; stateDirectory: string }
export const OWNER_CONTAINER_NAME: string;
export const OWNER_CONTAINER_BROKER: string;
export const OWNER_CONTAINER_NETWORK: string;
export const OWNER_CONTAINER_POLICY: string;
export function ownerDockerEndpoint():string;
export function currentOwnerContainerPolicy(): string;
export function assertOwnerContainerPolicy(): void;
export function qualifyContainerClock(before: {wall:number;mono:number}, guestWall:number, after:{wall:number;mono:number}):void;
export function parseOwnerContainerProfile(raw: unknown): OwnerContainerProfile;
export function containerExecutorVersion(version: string, profile: OwnerContainerProfile): string;
