import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { preflightCodex } from '../../../packages/agents/src/index.ts';
import type { Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import type { FactoryStorage } from '../../../packages/storage/src/index.ts';
import { DEFAULT_VERIFICATION_IMAGE } from '../../../packages/verification/src/index.ts';
import type { CheckpointReceipt, JobManager } from './jobs.ts';
import type { ServiceProducer } from './service-producer.ts';
import type { ExecutionGateway, ExecutionObservation, ExecutionProvider } from './execution-provider.ts';
import { assertImplementationProgress } from './execution-context.ts';
import { contextPolicyFailure, requireStrictSourceOperations } from './local-v4-context-policy.ts';
import { digest } from '../../../packages/hosted-routing/src/result.ts';

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
  private readonly producer: ServiceProducer;
  private readonly probe: LocalResourceProbe;
  private readonly allRunContainers: boolean;

  constructor(storage: FactoryStorage, jobs: JobManager, producer: ServiceProducer, probe = defaultProbe, allRunContainers = false) {
    this.storage = storage;
    this.jobs = jobs;
    this.producer = producer;
    this.probe = probe;
    this.allRunContainers = allRunContainers;
  }

  private current(run: Run): Run {
    const current = this.storage.getRun(run.id);
    if (!current || current.workOrderId !== run.workOrderId || current.attemptNumber !== run.attemptNumber ||
        current.inputCommit !== run.inputCommit || current.workspacePath !== run.workspacePath) {
      throw new Error('Execution does not match the saved local attempt');
    }
    return current;
  }

  private resourceObservation(run: Run) {
    const current = this.current(run);
    const events = this.storage.listEvents(current.workOrderId).filter(event => event.runId === current.id);
    return { current, events, binding: digest({ run: current, events }) };
  }

  private resourceCurrent(run: Run, binding: string): boolean {
    return this.resourceObservation(run).binding === binding;
  }

  private staleObservation(observation: ExecutionObservation): ExecutionObservation {
    return { ...observation, quiescent: false, settled: false, recoveryEligible: false,
      evidence: { ...observation.evidence, observationCurrent: false } };
  }

  async prepare(work: WorkOrder, assertCurrentConnection?: () => void) { return this.jobs.prepareRun(work, assertCurrentConnection); }

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
    const { current, events, binding } = this.resourceObservation(run);
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
    let verifierGone = !verifierStarted && !this.allRunContainers;
    if (verifierStarted || this.allRunContainers) {
      try { verifierGone = await this.probe.verifierAbsent(current.id) === true; }
      catch { verifierGone = false; }
    }
    const recovery = events.filter(event => event.runId === current.id &&
      ['run.recovery_hold', 'run.interrupted'].includes(event.type)).at(-1);
    const active = this.jobs.activeRun(current.id);
    const observation = {
      active,
      quiescent: !active && ownerGone && processesGone && verifierGone,
      settled,
      recoveryEligible: !!recovery && processes.length > 0,
      // Preserve the existing signed terminal evidence shape.
      evidence: { processGroups: processes.map(event => event.payload.pid), verifierGone, settled, ownerGone },
    };
    return this.resourceCurrent(current, binding) ? observation : this.staleObservation(observation);
  }

  async reconcile(run: Run, assertCurrentConnection?: () => void) {
    assertCurrentConnection?.();
    const pre=this.resourceObservation(run);
    const {current,binding}=pre;
    const observation=await this.read(current);
    assertCurrentConnection?.();
    if(!this.resourceCurrent(current,binding))return this.staleObservation(observation);
    if(observation.quiescent&&observation.recoveryEligible){
      const receipt=await this.jobs.checkpointForRecovery(run.id) as CheckpointReceipt|void;
      assertCurrentConnection?.();
      // The checkpoint is this method's OWN durable mutation, so the pre-checkpoint cut is expected to change. Accept only
      // the rows the call itself reports (and its candidate pointer); anything else is a concurrent mutation and stays stale.
      const post=this.resourceObservation(run);
      if(!this.onlyOwnedDelta(pre,post,receipt))return this.staleObservation(observation);
      // Re-prove quiescence and eligibility from the post-checkpoint state instead of reusing the pre-checkpoint reading.
      const fresh=await this.read(post.current);
      assertCurrentConnection?.();
      return this.resourceCurrent(post.current,post.binding)?fresh:this.staleObservation(fresh);
    }
    assertCurrentConnection?.();
    return this.resourceCurrent(current,binding)?observation:this.staleObservation(observation);
  }

  private onlyOwnedDelta(pre:{current:Run;events:unknown[]},post:{current:Run;events:unknown[]},receipt:CheckpointReceipt|void):boolean{
    const owned=new Map<number,string>();
    if(receipt&&Array.isArray(receipt.events))for(const entry of receipt.events)owned.set(entry.id,entry.digest);
    const idOf=(event:unknown):number=>(event as {id:number}).id;
    if(!pre.events.every(event=>post.events.some(other=>digest(other)===digest(event))))return false;
    const added=post.events.filter(event=>!pre.events.some(other=>digest(other)===digest(event)));
    // Exact membership AND content: every added row is one the call wrote, byte for byte, and every row it wrote is present.
    if(added.length!==owned.size||added.some(event=>owned.get(idOf(event))!==digest(event)))return false;
    const candidate=receipt&&receipt.candidateCommit?receipt.candidateCommit:pre.current.candidateCommit;
    return digest({...post.current,candidateCommit:null})===digest({...pre.current,candidateCommit:null})&&post.current.candidateCommit===candidate;
  }

  async collect(run: Run): Promise<Awaited<ReturnType<ServiceProducer['read']>>> {
    const { current, binding } = this.resourceObservation(run);
    if (!(await this.read(current)).quiescent || !this.resourceCurrent(current, binding))
      throw new Error('Local execution resources are not quiescent');
    return this.producer.read(current);
  }

  async assertImplementationProgress(run: Run, inputCommit: string, allowedPaths: string[]): Promise<void> {
    const current = this.current(run);
    let snapshot: ReturnType<ServiceProducer['snapshot']>;
    try { snapshot = this.producer.snapshot(current); requireStrictSourceOperations(snapshot, this.producer); }
    catch (error) { throw contextPolicyFailure(error); }
    if (!this.producer.assertProgress) return assertImplementationProgress(current.workspacePath, inputCommit, allowedPaths);
    const paths = [...allowedPaths];
    if (!snapshot || snapshot.version !== 4 || inputCommit !== current.inputCommit ||
        JSON.stringify([...paths].sort()) !== JSON.stringify([...snapshot.configuration.allowedPaths].sort())) throw contextPolicyFailure(null);
    this.jobs.assertActive(current);
    await this.producer.assertProgress(current);
    this.current(current); this.jobs.assertActive(current);
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
