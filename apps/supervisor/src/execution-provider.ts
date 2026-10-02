import type { Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import type { EnvironmentType } from '../../../packages/contracts/src/environment.ts';
import type { JobManager } from './jobs.ts';
import type { ProducerResults } from './producer-results.ts';

/** Resource observations are evidence, never permission to dispatch or publish. */
export interface ExecutionObservation {
  active: boolean;
  quiescent: boolean;
  settled: boolean;
  recoveryEligible: boolean;
  evidence: Record<string, unknown>;
}

/** The existing host-owned spend gateway remains outside the executor/harness.
 * A remote adapter must bridge this boundary without transferring its authority.
 */
export type ExecutionGateway = Parameters<JobManager['executePrepared']>[3];

/** First migration seam around the canonical prepared Run. Work admission,
 * writer binding, spending and terminal decisions remain in dispatch control.
 * Local Run paths are legacy references; cloud admission is not enabled here.
 */
export interface ExecutionProvider {
  readonly id: string;
  readonly environment: EnvironmentType;
  prepare(work: WorkOrder): Promise<Run>;
  start(work: WorkOrder, run: Run, claim: () => boolean, gateway?: ExecutionGateway): Promise<boolean>;
  cancel(work: WorkOrder, run: Run): Promise<void>;
  read(run: Run): Promise<ExecutionObservation>;
  reconcile(run: Run): Promise<ExecutionObservation>;
  collect(run: Run): Promise<ReturnType<ProducerResults['read']>>;
  health(): Promise<{ ready: boolean; reason: string | null }>;
  teardown(run: Run): Promise<{ destroyed: boolean; reason: string | null }>;
}
