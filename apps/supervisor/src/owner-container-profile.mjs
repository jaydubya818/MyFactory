import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const OWNER_CONTAINER_NAME = 'myfactory-owner-codex';
export const OWNER_CONTAINER_BROKER = 'myfactory-owner-codex-auth';
export const OWNER_CONTAINER_NETWORK = 'myfactory-owner-codex-internal';
/** This profile is the existing owner Mac's Docker Desktop socket; ambient Docker contexts cannot redirect it. */
export const ownerDockerEndpoint = () => 'unix://' + join(homedir(), '.docker', 'run', 'docker.sock');
export function currentOwnerContainerPolicy() { return createHash('sha256').update([
  'owner-container-v1', 'codex=0.163.0;node=24.22.1;undici=7.30.1', 'maxWorkMs=600000', 'guardian=root;child=operator-uid-nonroot',
  'internal-network;broker=chatgpt.com/backend-api/codex:responses,models',
  'tool-network=deny;bubblewrap;approval=never', 'root=readonly;workspace=phase-bound;auth=dummy',
  readFileSync(new URL('../container/worker-init.mjs', import.meta.url)),
  readFileSync(new URL('../container/broker.mjs', import.meta.url)),
  readFileSync(new URL('../container/seccomp.json', import.meta.url)),
  readFileSync(new URL('../container/Dockerfile', import.meta.url)),
].join('\n')).digest('hex'); }
export const OWNER_CONTAINER_POLICY = currentOwnerContainerPolicy();
export function assertOwnerContainerPolicy() { if (currentOwnerContainerPolicy() !== OWNER_CONTAINER_POLICY) throw Error('OWNER_CONTAINER_POLICY_CHANGED_RESTART_REQUIRED'); }
export function qualifyContainerClock(before, guestWall, after) {
  if (![before.wall, before.mono, guestWall, after.wall, after.mono].every(Number.isSafeInteger) ||
      after.mono < before.mono || after.wall < before.wall || guestWall < after.wall - 250 || guestWall > before.wall + 250 ||
      Math.abs(after.wall - before.wall - (after.mono - before.mono)) > 50) throw Error('OWNER_CONTAINER_CLOCK_UNQUALIFIED');
}

export function parseOwnerContainerProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== 'authFile,dockerExecutable,imageId,stateDirectory' ||
    !/^sha256:[a-f0-9]{64}$/.test(raw.imageId) ||
    !['authFile', 'dockerExecutable', 'stateDirectory'].every(k => typeof raw[k] === 'string' && raw[k].startsWith('/') && !raw[k].includes('\0') && !raw[k].split('/').includes('..')))
    throw Error('OWNER_CONTAINER_PROFILE_INVALID');
  return Object.freeze({ ...raw });
}
export function containerExecutorVersion(version, profile) {
  if (version !== 'codex-cli 0.163.0') throw Error('OWNER_CONTAINER_VERSION_INVALID');
  const p = parseOwnerContainerProfile(profile);
  return `${version} route=OWNER_SUBSCRIPTION_LOCAL isolation=owner-container-v1 image=${p.imageId} policy=${OWNER_CONTAINER_POLICY} endpoint=${createHash('sha256').update(ownerDockerEndpoint()).digest('hex')}`;
}
