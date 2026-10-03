import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { preflightCodex } from '../../../packages/agents/src/index.ts';
import type { Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import type { FactoryStorage } from '../../../packages/storage/src/index.ts';
import { DEFAULT_VERIFICATION_IMAGE } from '../../../packages/verification/src/index.ts';
import type { JobManager } from './jobs.ts';
import type { ProducerResults } from './producer-results.ts';
import type { ExecutionGateway, ExecutionObservation, ExecutionProvider } from './execution-provider.ts';

const exec = promisify(execFile);

function absent(pid: unknown, group: boolean): boolean {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(group ? -pid : pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}

export interface LocalResourceProbe {
  processAbsent(pid: unknown, group: boolean): boolean;
  verifierAbsent(runId: string): Promise<boolean>;
  readiness(): Promise<{ ready: boolean; reason: string | null }>;
}

const defaultProbe: LocalResourceProbe = {
  processAbsent: absent,
  async verifierAbsent(runId) {
    try {
      const { stdout } = await exec('docker', ['ps', '-aq', '--filter', 'label=factory.run=' + runId],
        { timeout: 10_000, maxBuffer: 4096 });
      return stdout.trim() === '';
    } catch { return false; } // An unavailable Docker daemon does not prove absence.
  },
  async readiness() {
    const preflight = await preflightCodex();
    if (!preflight.binaryAvailable || !preflight.authenticated) {
      return { ready: false, reason: 'Local executor unavailable or unauthenticated' };
    }
    // --pull=never verification needs the existing image and a reachable daemon.
    await exec('docker', ['image', 'inspect', DEFAULT_VERIFICATION_IMAGE], { timeout: 5000, maxBuffer: 64 * 1024 });
    return { ready: true, reason: null };
  },
};

/** Adapts the existing qualified local loop without moving its authority.
 * Only this provider interprets host PIDs and local Docker resource labels.
 */
export class LocalExecutionProvider implements ExecutionProvider {
  readonly id = 'local-execution-v1';
  readonly environment = 'LOCAL_FACTORY' as const;
  private readonly storage: FactoryStorage;
  private readonly jobs: JobManager;
  private readonly producer: ProducerResults;
  private readonly probe: LocalResourceProbe;

  constructor(storage: FactoryStorage, jobs: JobManager, producer: ProducerResults, probe = defaultProbe) {
    this.storage = storage;
    this.jobs = jobs;
    this.producer = producer;
    this.probe = probe;
  }

  private current(run: Run): Run {
    const current = this.storage.getRun(run.id);
    if (!current || current.workOrderId !== run.workOrderId || current.attemptNumber !== run.attemptNumber ||
        current.inputCommit !== run.inputCommit || current.workspacePath !== run.workspacePath) {
      throw new Error('Execution does not match the saved local attempt');
    }
    return current;
  }

  async prepare(work: WorkOrder) { return this.jobs.prepareRun(work); }

  async start(work: WorkOrder, run: Run, claim: () => boolean, gateway?: ExecutionGateway) {
    const current = this.current(run);
    if (work.id !== current.workOrderId) throw new Error('Execution WorkOrder mismatch');
    return this.jobs.executePrepared(work, current, claim, gateway);
  }

  async cancel(work: WorkOrder, run: Run) {
    const current = this.current(run);
    if (work.id !== current.workOrderId) throw new Error('Execution WorkOrder mismatch');
    if (this.jobs.activeRun(current.id)) await this.jobs.cancelRun(work);
  }

  async read(run: Run): Promise<ExecutionObservation> {
    const current = this.current(run);
    const events = this.storage.listEvents(current.workOrderId);
    const claim = events.find(event => event.runId === current.id && event.type === 'factory.dispatch_claimed');
    const settled = events.some(event => event.runId === current.id && event.type === 'factory.execution_settled');
    const ownerGone = !claim || claim.payload.supervisorPid === process.pid ||
      this.probe.processAbsent(claim.payload.supervisorPid, false);
    const processes = events.filter(event => event.runId === current.id &&
      ['agent.process_started', 'agent.completion_process_started'].includes(event.type));
    const processesGone = processes.every(event => this.probe.processAbsent(event.payload.pid, true));
    const verifierStarted = events.some(event => event.runId === current.id &&
      ['run.candidate_committed', 'run.reproduction_started'].includes(event.type));
    // Unknown probe outcomes are fail-closed even for an injected implementation.
    let verifierGone = !verifierStarted;
    if (verifierStarted) {
      try { verifierGone = await this.probe.verifierAbsent(current.id) === true; }
      catch { verifierGone = false; }
    }
    const recovery = events.filter(event => event.runId === current.id &&
      ['run.recovery_hold', 'run.interrupted'].includes(event.type)).at(-1);
    const active = this.jobs.activeRun(current.id);
    return {
      active,
      quiescent: !active && ownerGone && processesGone && verifierGone,
      settled,
      recoveryEligible: !!recovery && processes.length > 0,
      // Preserve the existing signed terminal evidence shape.
      evidence: { processGroups: processes.map(event => event.payload.pid), verifierGone, settled, ownerGone },
    };
  }

  async reconcile(run: Run) { return this.read(run); }

  async collect(run: Run) {
    const current = this.current(run);
    if (!(await this.read(current)).quiescent) throw new Error('Local execution resources are not quiescent');
    return this.producer.read(current);
  }

  async health() {
    try { return await this.probe.readiness(); }
    catch { return { ready: false, reason: 'Local execution or verification prerequisites unavailable' }; }
  }

  async teardown(run: Run) {
    if (!(await this.read(run)).quiescent) return { destroyed: false, reason: 'Local resources are not quiescent' };
    // Legacy publication consumes this exact workspace. Deleting it here would
    // regress durable candidate access. Cloud custody must remove this dependency.
    return { destroyed: false, reason: 'Local candidate workspace retained by the existing custody/publication policy' };
  }
}
