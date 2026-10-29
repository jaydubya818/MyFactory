import type { Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import type { FactoryStorage } from '../../../packages/storage/src/index.ts';
import type { ExecutionSnapshot, LocalExecutionSnapshotV4, SignedResult } from '../../../packages/hosted-routing/src/result.ts';
import { LocalProducerResultsV4, type ProducerOptions, type producerState } from './producer-results.ts';
import type { ContextBasis, ContextPhase } from './local-v4-context-policy.ts';
import type { CheckpointBasis, CheckpointPhase, CheckpointResult } from './local-v4-checkpoint-policy.ts';
import type { FinalizationBasis, FinalizationPhase, FinalizationResult, FinalizationFence } from './local-v4-finalization-policy.ts';
import type { VerificationInputBasis, VerificationInputPhase, VerificationInputLease, VerificationInputFence } from './local-v4-verification-input-policy.ts';

export type ServiceExecutionSnapshot = ExecutionSnapshot | LocalExecutionSnapshotV4;
export type ServiceResult = { state: ReturnType<typeof producerState>; result: SignedResult | null };

/** Host-selected result plumbing. This interface grants no execution authority. */
export interface ServiceProducer {
  capture(work: WorkOrder, run: Run, model: string, executorVersion: string): ServiceExecutionSnapshot;
  snapshot(run: Run): ServiceExecutionSnapshot | null;
  read(run: Run): ServiceResult | Promise<ServiceResult>;
  finalize(run: Run): SignedResult | Promise<SignedResult>;
  beforeReady?(run: Run): Promise<() => void>;
  contextBasis?(run: Run, phase: ContextPhase): ContextBasis;
  context?(run: Run, phase: Exclude<ContextPhase, {kind: 'PROGRESS'}>): Promise<string>;
  assertProgress?(run: Run): Promise<void>;
  checkpointBasis?(run: Run, phase: CheckpointPhase): CheckpointBasis;
  checkpoint?(run: Run, phase: CheckpointPhase): Promise<CheckpointResult>;
  candidateBasis?(run: Run, phase: FinalizationPhase): FinalizationBasis;
  commitCandidate?(run: Run, phase: FinalizationPhase, assertCurrent: FinalizationFence): Promise<FinalizationResult>;
  verificationBasis?(run:Run,phase:VerificationInputPhase):VerificationInputBasis;
  assertVerificationInputReady?(run:Run):void;
  prepareVerificationInput?(run:Run,phase:VerificationInputPhase,assertCurrent:VerificationInputFence):Promise<VerificationInputLease>;
  closeVerificationInput?(run:Run,lease:VerificationInputLease,assertCurrent:VerificationInputFence):Promise<VerificationInputFence>;
}

/** Explicit local V4 only; retained original admission is required on every read. */
export class LocalV4ServiceProducer implements ServiceProducer {
  private readonly producer: LocalProducerResultsV4;

  constructor(storage: FactoryStorage, dataDir: string, options: Omit<ProducerOptions, 'sessionMetadata'>) {
    this.producer = new LocalProducerResultsV4(storage, dataDir, options);
  }

  capture(work: WorkOrder, run: Run, model: string, executorVersion: string): LocalExecutionSnapshotV4 {
    return this.producer.captureAdmitted(work, run, model, executorVersion);
  }

  snapshot(run: Run): LocalExecutionSnapshotV4 | null {
    return this.producer.snapshot(run, this.producer.admission(run));
  }

  read(run: Run) {
    return this.producer.readAdmitted(run);
  }

  finalize(run: Run) {
    return this.producer.finalizeAdmitted(run);
  }

  beforeReady(run: Run) { return this.producer.beforeReady(run); }
  contextBasis(run: Run, phase: ContextPhase) { return this.producer.contextBasis(run, phase); }
  checkpointBasis(run: Run, phase: CheckpointPhase) { return this.producer.checkpointBasis(run, phase); }
  candidateBasis(run: Run, phase: FinalizationPhase) { return this.producer.candidateBasis(run, phase); }
  verificationBasis(run:Run,phase:VerificationInputPhase){return this.producer.verificationBasis(run,phase);}
}
