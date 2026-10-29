import type { FactoryEvent, Run, WorkOrder } from '../../../packages/contracts/src/index.ts';
import type { LocalExecutionSnapshotV4 } from '../../../packages/hosted-routing/src/result.ts';
import { digest } from '../../../packages/hosted-routing/src/result.ts';
import { ActionError } from './actions.ts';
import { checkpointIdentity, selectCheckpointPhase } from './local-v4-checkpoint-policy.ts';
import { selectFinalizationPhase, type FinalizationPhase } from './local-v4-finalization-policy.ts';

export type VerificationInputPhase = Readonly<{kind:'ENTRY'} | {kind:'REPRODUCTION'; reproductionStartedEventId:number} |
  {kind:'IMPLEMENTATION'; productiveStep:1|2; agentResultEventId:number; settlementEventId:number} |
  {kind:'FINAL'; candidateEventId:number}>;
export type VerificationInputBasis = Readonly<{run:Run;work:WorkOrder;execution:LocalExecutionSnapshotV4;
  phase:VerificationInputPhase;selectedTree:string|null;selectedCommit:string|null;binding:string}>;
export type VerificationSourceData = Readonly<{schema:'local-v4-fixture-source/v1';runId:string;workOrderId:string;
  kind:Exclude<VerificationInputPhase['kind'],'ENTRY'>;commit:string|null;tree:string;files:Readonly<Record<string,string>>}>;
export type SourceArtifactDescriptor = Readonly<{schema:'local-v4-source-artifact/v1';path:string;tree:string;manifestSha256:string}>;
/** A structurally similar object is not a privately registered lease. */
export type VerificationInputLease = Readonly<{source:VerificationSourceData;artifact?:SourceArtifactDescriptor}>;
export type VerificationInputFence = ()=>void;
const denied = new WeakSet<Error>();
class VerificationInputError extends ActionError {
  readonly kind = 'uncertain';
  constructor(){super('Local verification input is unavailable; investigation is required','local_verification_input_hold',503);}
}
export function verificationInputKind(error:unknown){return error instanceof VerificationInputError || error instanceof Error&&denied.has(error)?'uncertain':null;}
export function verificationInputFailure(error:unknown):Error{return error instanceof Error&&(error instanceof VerificationInputError||denied.has(error))?error:new VerificationInputError();}
export function verificationInputHold():never{throw new VerificationInputError();}
/** Required synchronous denial only; no returned value is evidence or authority. */
export function verificationInputFence(fence:unknown):void{
  if(typeof fence!=='function')verificationInputHold();
  try{const value=fence();if(value!==undefined){if(value instanceof Promise)void value.catch(()=>{});verificationInputHold();}}
  catch(error){if(error instanceof Error){denied.add(error);throw error;}verificationInputHold();}
}
const id=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const fields=(value:object,names:string[])=>JSON.stringify(Object.keys(value).sort())===JSON.stringify(names.sort());
export function verificationCheckpointKey(run:Run,execution:LocalExecutionSnapshotV4,phase:{productiveStep:1|2;agentResultEventId:number;settlementEventId:number}){
  return digest({identity:checkpointIdentity(run,execution),runId:run.id,workOrderId:run.workOrderId,
    productiveStep:phase.productiveStep,agentResultEventId:phase.agentResultEventId,settlementEventId:phase.settlementEventId});
}
/** Validate the full real stream before using a phase-specific old parser. */
export function selectVerificationInputPhase(events:FactoryEvent[],phase:VerificationInputPhase,run:Run,work:WorkOrder,execution:LocalExecutionSnapshotV4){
  if(!phase||typeof phase!=='object'||Array.isArray(phase)||!events.length||events.some((event,index)=>
    !id(event.id)||index>0&&event.id<=events[index-1].id||event.runId!==run.id||event.workOrderId!==work.id))verificationInputHold();
  if(events.some(event=>['run.cancel_requested','factory.stop_requested','run.recovery_hold','run.recovery_cleared',
    'factory.terminal','run.ready_for_review','run.signed_result','run.failed','run.cancelled','run.interrupted'].includes(event.type)))verificationInputHold();
  const rows=(type:string)=>events.filter(event=>event.type===type);
  if(phase.kind==='ENTRY'){
    if(!fields(phase,['kind'])||!['planning','implementing','verifying'].includes(run.state))verificationInputHold();return {tree:null,commit:null};
  }
  if(phase.kind==='REPRODUCTION'){
    if(!fields(phase,['kind','reproductionStartedEventId'])||!id(phase.reproductionStartedEventId)||
      run.state!=='planning'||work.state!=='planning'||work.kind!=='defect'||!work.reproductionCommand||
      rows('run.reproduction_started').length!==1||rows('run.reproduction_started')[0].id!==phase.reproductionStartedEventId||
      events.some(event=>event.id>phase.reproductionStartedEventId||event.type.startsWith('agent.')||
        ['run.implementing','run.agent_result','run.implementation_settled','run.implementation_checkpoint',
         'run.reproduction_result','run.candidate_committed','run.completion_result','run.finalization_settled'].includes(event.type)))verificationInputHold();
    const started=rows('run.reproduction_started')[0];
    if(started.payload.command!==work.reproductionCommand||started.payload.inputCommit!==execution.inputCommit)verificationInputHold();return {tree:execution.inputTree,commit:execution.inputCommit};
  }
  if(phase.kind==='IMPLEMENTATION'){
    if(!fields(phase,['kind','productiveStep','agentResultEventId','settlementEventId'])||run.state!=='implementing'||work.state!=='implementing'||
      events.at(-1)!.id!==phase.settlementEventId)verificationInputHold();
    try{selectCheckpointPhase(events,{kind:'CAPTURE',productiveStep:phase.productiveStep,agentResultEventId:phase.agentResultEventId,
      settlementEventId:phase.settlementEventId},execution.configuration.commands,checkpointIdentity(run,execution));}
    catch(error){throw verificationInputFailure(error);}return {tree:null,commit:null};
  }
  if(phase.kind!=='FINAL'||!fields(phase,['kind','candidateEventId'])||!id(phase.candidateEventId)||run.state!=='verifying'||work.state!=='verifying')verificationInputHold();
  const candidates=rows('run.candidate_committed'),settled=rows('run.finalization_settled');
  if(candidates.length!==1||settled.length!==1||candidates[0].id!==phase.candidateEventId||
    candidates[0].id<=settled[0].id||events.some(event=>event.id>settled[0].id&&event!==candidates[0])||
    candidates[0].payload.candidateCommit!==run.candidateCommit)verificationInputHold();
  const p=settled[0].payload;
  const final:FinalizationPhase={kind:'FINALIZE',productiveStep:p.productiveStep as 1|2,checkpointEventId:p.checkpointEventId as number,
    productiveClosedEventId:p.productiveClosedEventId as number,completionStartedEventId:p.completionStartedEventId as number,
    completionResultEventId:p.completionResultEventId as number,settlementEventId:settled[0].id,expectedTree:p.expectedTree as string};
  if(candidates[0].payload.candidateTree!==final.expectedTree)verificationInputHold();
  try{selectFinalizationPhase(events.filter(event=>event!==candidates[0]),final,run,execution);}
  catch(error){throw verificationInputFailure(error);}
  return {tree:final.expectedTree,commit:run.candidateCommit!};
}
