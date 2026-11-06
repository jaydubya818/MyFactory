import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { CodexAdapter, CodexPreflight, CodexRunOptions, CodexRunResult } from '../../../packages/agents/src/index.ts';
import { assertTrustedExecutablePath, assertTrustedFile } from './executable-trust.ts';
import { assertContainerAvailable, recoverOwnerContainers } from './owner-container-worker.mjs';
import { meteredContainerExecutorVersion, parseMeteredContainerProfile, type MeteredContainerProfile } from './owner-container-profile.mjs';

const monotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const WORKER_SCRIPT = fileURLToPath(new URL('./owner-container-worker.mjs', import.meta.url));
export const METERED_CONTAINER_MAX_MS = 600_000;
export const PINNED_CODEX = 'codex-cli 0.163.0';

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
  readonly #bindings = new Map<string, { runId: string; workId: string; deadlineMonoMs: number }>();
  /** Host dispatch only: binds a gateway child token to the saved Run id and the ONE absolute admitted Work deadline. Never rebinds. */
  bindOperation(childToken: string, binding: { runId: string; workId: string; deadlineMonoMs: number }) {
    if (!/^[a-f0-9]{64}$/.test(childToken) || this.#bindings.has(childToken) || ![binding?.runId, binding?.workId].every(v => typeof v === 'string' && SAFE_ID.test(v)) ||
        !Number.isSafeInteger(binding.deadlineMonoMs)) throw Error('METERED_CONTAINER_BINDING_INVALID');
    this.#bindings.set(childToken, { runId: binding.runId, workId: binding.workId, deadlineMonoMs: binding.deadlineMonoMs });
  }
  releaseOperation(childToken: string) { this.#bindings.delete(childToken); }
  /** Startup, before listening: reap only this host's own labelled resources whose supervisor is gone; anything unproven disables the route. */
  recover() {
    const outcome = recoverOwnerContainers(this.profile, this.#owner);
    if (outcome.status === 'UNVERIFIED') this.#disabled = 'unverified container resources or live prior owner';
    return outcome;
  }
  /** No host executable is run: the Codex version is the qualified image's pinned label (factory.owner.codex=0.163.0), proven by
   *  assertContainerAvailable together with the image id and policy. Authentication is the host gateway's, not a Codex login. */
  preflightCodex = async (): Promise<CodexPreflight> => {
    const base = { workerProfile: 'mac' as const, binaryAvailable: true, version: PINNED_CODEX, authenticated: true, error: null };
    if (this.#disabled) return { ...base, authenticated: false, error: 'Metered container route disabled: ' + this.#disabled };
    assertContainerAvailable(this.profile);
    return { ...base, version: meteredContainerExecutorVersion(PINNED_CODEX, this.profile) };
  };
  runCodex = async (options: CodexRunOptions): Promise<CodexRunResult> => {
    if (this.#disabled) throw Error('Metered container route is disabled');
    if (!options?.gateway) throw Error('METERED_CONTAINER_GATEWAY_REQUIRED');
    if (options.ownerLogin !== undefined || options.ownerLoginContainer !== undefined || options.ownerLoginWatchdog !== undefined || options.meteredContainer !== undefined)
      throw Error('METERED_CONTAINER_OPTIONS_REFUSED');
    // Only a token the dispatch bound to its saved Run and admitted Work deadline may start a container (fail closed otherwise).
    const binding = this.#bindings.get(options.gateway.childToken);
    if (!binding) throw Error('METERED_CONTAINER_OPERATION_UNBOUND');
    const deadlineMonoMs = Math.min(binding.deadlineMonoMs, monotonicMs() + Math.min(options.timeoutMs, METERED_CONTAINER_MAX_MS));
    if (deadlineMonoMs <= monotonicMs()) throw Error('METERED_CONTAINER_WORK_DEADLINE_REACHED');
    // Refuse before the process exists; the gateway has reserved nothing yet (reservation happens per provider request).
    assertContainerAvailable(this.profile);
    // The only process the host starts is the pinned container wrapper under the trusted Node runtime (never the configured executable).
    assertTrustedExecutablePath(process.execPath); assertTrustedFile(WORKER_SCRIPT);
    const invocation = {
      // runId is the SAVED Run id: the container label factory.run=<Run id> is exactly what readback/reconcile probes.
      mode: 'metered', profile: this.profile, runId: binding.runId, workId: binding.workId, operationId: randomBytes(16).toString('hex'),
      owner: this.#owner, supervisorPid: process.pid, model: options.model, deadlineMonoMs,
    };
    return this.#base.runCodex({ ...options, meteredContainer: { script: WORKER_SCRIPT, invocation } });
  };
}
