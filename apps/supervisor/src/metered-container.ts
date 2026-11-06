import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { CodexAdapter, CodexPreflight, CodexRunOptions, CodexRunResult } from '../../../packages/agents/src/index.ts';
import { assertTrustedExecutablePath, assertTrustedFile } from './executable-trust.ts';
import { assertContainerAvailable, recoverOwnerContainers } from './owner-container-worker.mjs';
import { meteredContainerExecutorVersion, parseMeteredContainerProfile, type MeteredContainerProfile } from './owner-container-profile.mjs';

const monotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 40);
const WORKER_SCRIPT = fileURLToPath(new URL('./owner-container-worker.mjs', import.meta.url));
export const METERED_CONTAINER_MAX_MS = 600_000;

/**
 * Metered LOCAL_V4 execution inside the qualified worker container (Jay's approval, 2026-11-05: no native, uncontained tester execution).
 *
 * The spend gateway, WORK_LEDGER_V2, reserve-before-I/O and the pinned price are unchanged and stay on the host: the gateway holds the
 * host-side OpenAI credential (0600 file, read by the host only) and listens on 127.0.0.1. This adapter only changes WHERE the Codex
 * process runs: the agents adapter builds the same gateway argv, then hands it to the container wrapper, which runs Codex as a nonroot
 * uid in the container with an internal-only network. The broker container receives the gateway's per-operation child token on stdin
 * (memory only); the Codex container receives only a separate per-operation broker token. The API key never enters any container.
 */
export class MeteredContainerExecutor implements CodexAdapter {
  readonly profile: MeteredContainerProfile;
  readonly #base: CodexAdapter;
  readonly #owner: string;
  #disabled: string | null = null;
  constructor(base: CodexAdapter, profile: unknown, owner: string) {
    this.profile = parseMeteredContainerProfile(profile);
    if (typeof owner !== 'string' || !owner.startsWith('/')) throw Error('METERED_CONTAINER_OWNER_INVALID');
    assertTrustedExecutablePath(this.profile.dockerExecutable);
    for (const name of ['./owner-container-worker.mjs', './owner-container-profile.mjs', '../container/seccomp.json', '../container/worker-init.mjs', '../container/broker.mjs', '../container/Dockerfile'])
      assertTrustedFile(fileURLToPath(new URL(name, import.meta.url)));
    this.#base = base; this.#owner = owner;
  }
  get disabled() { return this.#disabled; }
  /** Startup, before listening: reap only this host's own labelled resources whose supervisor is gone; anything unproven disables the route. */
  recover() {
    const outcome = recoverOwnerContainers(this.profile, this.#owner);
    if (outcome.status === 'UNVERIFIED') this.#disabled = 'unverified container resources or live prior owner';
    return outcome;
  }
  preflightCodex = async (): Promise<CodexPreflight> => {
    const base = await this.#base.preflightCodex();
    if (!base.binaryAvailable || !base.version) return base;
    if (this.#disabled) return { ...base, authenticated: false, error: 'Metered container route disabled: ' + this.#disabled };
    assertContainerAvailable(this.profile);
    return { ...base, version: meteredContainerExecutorVersion(base.version, this.profile) };
  };
  runCodex = async (options: CodexRunOptions): Promise<CodexRunResult> => {
    if (this.#disabled) throw Error('Metered container route is disabled');
    if (!options?.gateway) throw Error('METERED_CONTAINER_GATEWAY_REQUIRED');
    if (options.ownerLogin !== undefined || options.ownerLoginContainer !== undefined || options.ownerLoginWatchdog !== undefined || options.meteredContainer !== undefined)
      throw Error('METERED_CONTAINER_OPTIONS_REFUSED');
    // Refuse before the process exists; the gateway has reserved nothing yet (reservation happens per provider request).
    assertContainerAvailable(this.profile);
    const invocation = {
      mode: 'metered', profile: this.profile, runId: hash(options.workspacePath),
      // The session home is attempt-owned; keying the container home by it keeps `exec resume` inside one attempt only.
      workId: hash(options.sessionHome ?? options.workspacePath), operationId: randomBytes(16).toString('hex'),
      owner: this.#owner, supervisorPid: process.pid, model: options.model,
      deadlineMonoMs: monotonicMs() + Math.min(options.timeoutMs, METERED_CONTAINER_MAX_MS),
    };
    return this.#base.runCodex({ ...options, meteredContainer: { script: WORKER_SCRIPT, invocation } });
  };
}
