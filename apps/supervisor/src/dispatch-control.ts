import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {promisify} from 'node:util';
import {realpathSync} from 'node:fs';
import {ActionError,parseCreateInput,admissionState} from './actions.ts';
import {canAccessRepository,type FactoryClient} from './connections.ts';
import {JobManager} from './jobs.ts';
import {ProducerResults,producerState} from './producer-results.ts';
import {canonical,digest,type ExecutionSnapshot} from '../../../packages/hosted-routing/src/result.ts';
import type {FactoryStorage} from '../../../packages/storage/src/index.ts';
import {SpendLedger,type SpendPlan} from '../../../packages/storage/src/spend.ts';
import {SpendGateway,type SpendPrice,validatePrice} from './spend-gateway.ts';
import type {WorkOrder,Run} from '../../../packages/contracts/src/index.ts';

export interface ExecutionIdentity {
 runId:string;writerGeneration:number;dispatchIdentity:string;workId:string;workGeneration:number;
 factoryId:string;factoryVersion:string;requestId:string;workOrderId:string;remoteRunId:string;
 repository:string;baseSha:string;allowedPaths:string[];deadline:string;
}
export interface PrepareRequest {
 requestId:string;workId:string;workGeneration:number;repository:string;deadline:string;maxSpendUsd:number;
 input:unknown;
 spendContract?:{version:'WORK_LEDGER_V2';pricingRevision:string;plannedProductiveOperations:number;
  plannedCompletionOperations:number;maxPaidOperations:number;completionReserveMicrousd:number};
}
const spendBinding=(identity:ExecutionIdentity)=>({workId:identity.workId,workGeneration:identity.workGeneration,dispatchIdentity:identity.dispatchIdentity,requestId:identity.requestId,workOrderId:identity.workOrderId,factoryVersion:identity.factoryVersion,runId:identity.remoteRunId});
const exec=promisify(execFile),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function absent(pid:unknown):boolean {
 if(typeof pid!=='number'||!Number.isSafeInteger(pid)||pid<=0)return false;
 try{process.kill(-pid,0);return false;}catch(e){return (e as NodeJS.ErrnoException).code==='ESRCH';}
}
function processAbsent(pid:unknown):boolean {
 if(typeof pid!=='number'||!Number.isSafeInteger(pid)||pid<=0)return false;
 try{process.kill(pid,0);return false;}catch(e){return (e as NodeJS.ErrnoException).code==='ESRCH';}
}
/** Exact request state is appended to the existing WorkOrder event history.
 * BEGIN IMMEDIATE guards every claim across processes. No new execution store. */
export class FactoryDispatchControl {
 private readonly storage:FactoryStorage;
 private readonly jobs:JobManager;
 private readonly producer:ProducerResults;
 private readonly spend:SpendLedger;
 private readonly localFixture:boolean;
 private readonly live:boolean;
 private readonly spendFixture?:{upstreamOrigin:string;upstreamApiKey:string;price:SpendPrice};
 constructor(storage:FactoryStorage,jobs:JobManager,producer:ProducerResults,spend:SpendLedger,localFixture=false,
  spendFixture?:{upstreamOrigin:string;upstreamApiKey:string;price:SpendPrice},live=false){
  this.localFixture=localFixture;this.storage=storage;this.jobs=jobs;this.producer=producer;this.spend=spend;this.spendFixture=spendFixture;
  this.live=live;
 }
 executionAvailability(){return {mode:this.live?'LIVE':this.localFixture?'LOCAL_FIXTURE':this.spendFixture?'LOCAL_SPEND_FIXTURE':'DISABLED',
  spendEnforced:this.localFixture||!!this.spendFixture,reason:this.localFixture?'Backend-injected zero-cost fixture':
   this.live?'Explicit private-alpha provider; every call requires bounded Work admission':this.spendFixture?'Loopback synthetic provider fixture; live paid execution remains disabled':'Paid Codex gateway routing is not live-qualified'};}
 private authorize(client:FactoryClient,action:string){if(!client.actions.includes(action))throw new ActionError('Factory control action is not granted','forbidden',403);}
 private record(client:FactoryClient,requestId:string){
  const intake=this.storage.getIntake('gateb:'+client.id,requestId);
  if(!intake)throw new ActionError('Factory request not found','not_found',404);
  const order=this.storage.getWorkOrder(intake.work_order_id)!;
  if(!canAccessRepository(client,order.repositoryPath))throw new ActionError('Repository outside connection scope','forbidden',403);
  const events=this.storage.listEvents(order.id),request=events.find(e=>e.type==='factory.prepare_requested');
  if(!request)throw new ActionError('Incomplete preparation record','binding_missing',409);
  const prepared=events.find(e=>e.type==='run.prepared'),run=prepared?.runId?this.storage.getRun(prepared.runId):null;
  return {order,events,request:request.payload as unknown as PrepareRequest,run,snapshot:run?this.producer.snapshot(run):null};
 }
 async prepare(client:FactoryClient,input:PrepareRequest){
  this.authorize(client,'factory.prepare');
  if(!input||!['deadline,input,maxSpendUsd,repository,requestId,workGeneration,workId',
    'deadline,input,maxSpendUsd,repository,requestId,spendContract,workGeneration,workId'].includes(Object.keys(input).sort().join(','))||
   !uuid.test(input.requestId)||!uuid.test(input.workId)||!Number.isSafeInteger(input.workGeneration)||input.workGeneration<1||
   typeof input.repository!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(input.repository)||
   !Number.isFinite(input.maxSpendUsd)||input.maxSpendUsd<0.000001||input.maxSpendUsd>20||
   !(Date.parse(input.deadline)>Date.now()&&Date.parse(input.deadline)<=Date.now()+3600000))
   throw new ActionError('Bounded exact preparation required','invalid_input');
  let plan:SpendPlan|undefined;
  if(this.live&&(!input.spendContract||input.maxSpendUsd>1.35||Date.parse(input.deadline)>Date.now()+600000||
    input.spendContract.maxPaidOperations>4||input.spendContract.plannedProductiveOperations>3||
    input.spendContract.plannedCompletionOperations!==1))
   throw new ActionError('Private-alpha Work requires at most $1.35, 600 seconds, three productive operations and one protected completion','alpha_limits',409);
  if(input.spendContract){
   const c=input.spendContract;
   if(!this.spendFixture||Object.keys(c).sort().join(',')!=='completionReserveMicrousd,maxPaidOperations,plannedCompletionOperations,plannedProductiveOperations,pricingRevision,version'||
      c.version!=='WORK_LEDGER_V2'||c.pricingRevision!==this.spendFixture.price.revision)
    throw new ActionError('Qualified V2 pricing and exact plan required','spend_unqualified',409);
   validatePrice(this.spendFixture.price);
   const p=this.spendFixture.price;
   const perOperationReserveMicrousd=Math.ceil(p.contextLimitTokens*p.inputMicrousdPerMillion/1_000_000)+
    Math.ceil(p.outputLimitTokens*p.outputMicrousdPerMillion/1_000_000);
   plan={...c,model:p.model,validUntil:p.validUntil,perOperationReserveMicrousd};
  }
  const work=parseCreateInput(input.input);
  if(!canAccessRepository(client,work.repositoryPath)||admissionState(work)!=='queued'||work.workerProfile!=='mac'||
    !/^[a-f0-9]{40}$/.test(work.baseRef)||work.allowedPaths.length>100||work.checkCommands.length>20||
    Buffer.byteLength(canonical(input))>32000)throw new ActionError('Preparation outside bounded repository profile','invalid_input');
  work.repositoryPath=realpathSync(work.repositoryPath);
  const request={...input,input:work},hash=digest(request);
  const created=this.storage.transaction(()=>{
   const existing=this.storage.getIntake('gateb:'+client.id,input.requestId);
   if(existing){if(existing.input_digest!==hash)throw new ActionError('Preparation replay conflict','conflict',409);return null;}
   const order=this.storage.createWorkOrder(work);
   this.storage.recordIntake('gateb:'+client.id,input.requestId,hash,order.id);
   this.storage.appendEvent({workOrderId:order.id,runId:null,type:'workorder.created',payload:{requestId:input.requestId,actor:'connection:'+client.id}});
   this.storage.appendEvent({workOrderId:order.id,runId:null,type:'factory.prepare_requested',payload:request});
   return order;
  });
  // A replay cannot increase or reset the Work ceiling. A partially prepared
  // order without this budget remains unable to cross any paid boundary.
  this.spend.createBudget({workId:input.workId,workGeneration:input.workGeneration,requestId:input.requestId,
    workOrderId:created?.id??this.record(client,input.requestId).order.id},
    Math.floor(input.maxSpendUsd*1_000_000),input.deadline,plan);
  if(created){try{await this.jobs.prepareRun(created);}catch(e){this.storage.appendEvent({workOrderId:created.id,runId:null,type:'factory.prepare_failed',payload:{reason:e instanceof Error?e.message:String(e)}});throw e;}}
  return this.read(client,input.requestId);
 }
 private bind(client:FactoryClient,identity:ExecutionIdentity){
  if(!identity||Object.keys(identity).sort().join(',')!=='allowedPaths,baseSha,deadline,dispatchIdentity,factoryId,factoryVersion,remoteRunId,repository,requestId,runId,workGeneration,workId,workOrderId,writerGeneration'||
    !uuid.test(identity.runId)||!uuid.test(identity.dispatchIdentity)||!Number.isSafeInteger(identity.writerGeneration)||identity.writerGeneration<1)
   throw new ActionError('Complete MyEve writer identity required','invalid_input');
  const data=this.record(client,identity.requestId),s=data.snapshot,q=data.request;
  if(!s||!data.run||identity.workId!==q.workId||identity.workGeneration!==q.workGeneration||identity.repository!==q.repository||identity.deadline!==q.deadline||
   identity.factoryId!==s.factoryId||identity.factoryVersion!==s.factoryVersion||identity.workOrderId!==s.workOrderId||identity.remoteRunId!==s.runId||identity.baseSha!==s.inputCommit||
   canonical(identity.allowedPaths)!==canonical(s.configuration.allowedPaths))throw new ActionError('Dispatch differs from prepared execution','binding_mismatch',409);
  const prior=data.events.find(e=>e.type==='factory.writer_bound');
  if(prior&&canonical(prior.payload)!==canonical(identity))throw new ActionError('Writer binding conflict','conflict',409);
  return data as typeof data & {run:Run;snapshot:ExecutionSnapshot};
 }
 async dispatch(client:FactoryClient,identity:ExecutionIdentity){
  this.authorize(client,'factory.dispatch');
  const data=this.bind(client,identity);
  // A terminal tombstone/claim is checked before touching JobManager, so replay
  // readback remains available even when another unrelated Run is active.
  if(data.events.some(e=>['factory.dispatch_claimed','factory.stop_requested','factory.terminal'].includes(e.type)))return this.read(client,identity.requestId);
  if(!this.localFixture&&!this.spendFixture)throw new ActionError('Paid execution disabled: actual paid boundary is not qualified','spend_unqualified',503);
  const admittedWork={...data.order,...data.request.input as object} as WorkOrder;
  let gateway:SpendGateway|undefined, gatewayBinding:{baseUrl:string;childToken:string;close:()=>Promise<void>;
   beginCompletion:()=>Promise<{baseUrl:string;childToken:string}>;assertCompleted:()=>void;fenceAuthority:()=>void}|undefined;
  if(this.spendFixture){
   if(!data.request.spendContract)throw new ActionError('V2 paid plan required before dispatch','spend_unqualified',409);
   const binding={workId:identity.workId,workGeneration:identity.workGeneration,
    dispatchIdentity:identity.dispatchIdentity,requestId:identity.requestId,workOrderId:identity.workOrderId,
    factoryVersion:identity.factoryVersion,runId:identity.remoteRunId};
   this.spend.bindAuthority(binding);
   const childToken=randomBytes(32).toString('hex');
   gateway=new SpendGateway({ledger:this.spend,binding,phase:'productive',
    price:this.spendFixture.price,upstreamOrigin:this.spendFixture.upstreamOrigin,
    upstreamApiKey:this.spendFixture.upstreamApiKey,childToken});
   let current=gateway;
   gatewayBinding={baseUrl:await gateway.listen(),childToken,close:()=>current.close(),
    beginCompletion:async()=>{
     await current.close();
     this.spend.beginCompletion(binding);
     const completionToken=randomBytes(32).toString('hex');
     current=new SpendGateway({ledger:this.spend,binding,phase:'completion',price:this.spendFixture!.price,
      upstreamOrigin:this.spendFixture!.upstreamOrigin,upstreamApiKey:this.spendFixture!.upstreamApiKey,childToken:completionToken});
     return {baseUrl:await current.listen(),childToken:completionToken};
    },assertCompleted:()=>this.spend.assertCompleted(binding),fenceAuthority:()=>this.spend.fenceAuthority(binding)};
  }
  try{
  const started=this.jobs.executePrepared(admittedWork,data.run,()=>this.storage.transaction(()=>{
   const current=this.bind(client,identity);
   if(current.events.some(e=>['factory.dispatch_claimed','factory.stop_requested','factory.terminal'].includes(e.type)))return false;
   if(Date.parse(identity.deadline)<=Date.now()||this.storage.getPolicy().dispatchPaused)throw new ActionError('Dispatch expired or paused','dispatch_denied',409);
   if(!current.events.some(e=>e.type==='factory.writer_bound'))this.storage.appendEvent({workOrderId:data.order.id,runId:data.run.id,type:'factory.writer_bound',payload:{...identity}});
   this.storage.appendEvent({workOrderId:data.order.id,runId:data.run.id,type:'factory.dispatch_claimed',payload:{identity,supervisorPid:process.pid}});
   return true;
  }),gatewayBinding);
  if(!started)await gatewayBinding?.close();
  }catch(error){await gatewayBinding?.close();throw error;}
  return this.read(client,identity.requestId);
 }
 async stop(client:FactoryClient,identity:ExecutionIdentity){
  this.authorize(client,'factory.stop');
  const data=this.storage.transaction(()=>{
   const data=this.bind(client,identity);
   if(!data.events.some(e=>e.type==='factory.writer_bound'))this.storage.appendEvent({workOrderId:data.order.id,runId:data.run.id,type:'factory.writer_bound',payload:{...identity}});
   if(!data.events.some(e=>e.type==='factory.stop_requested'))this.storage.appendEvent({workOrderId:data.order.id,runId:data.run.id,type:'factory.stop_requested',payload:{...identity}});
   return data;
  });
  this.spend.cancelBound(spendBinding(identity));
  if(this.jobs.activeRun(data.run.id))await this.jobs.cancelRun(data.order);
  return this.read(client,identity.requestId);
 }
 async read(client:FactoryClient,requestId:string){
  this.authorize(client,'factory.observe');
  const data=this.record(client,requestId),{run,snapshot,events}=data;
  const binding=events.find(e=>e.type==='factory.writer_bound')?.payload as unknown as ExecutionIdentity|undefined;
  const claim=events.find(e=>e.type==='factory.dispatch_claimed');
  const stopped=events.some(e=>e.type==='factory.stop_requested');
  const terminal=events.find(e=>e.type==='factory.terminal');
  let state='PREPARING',quiescent=false;
  if(terminal){state=String(terminal.payload.state);quiescent=true;if(binding)this.spend.fenceAuthority(spendBinding(binding));}
  else if(run&&snapshot){
   state=claim?this.jobs.activeRun(run.id)?stopped?'STOPPING':'RUNNING':'UNKNOWN':stopped?'STOPPING':'PREPARED';
   const settled=events.some(e=>e.runId===run.id&&e.type==='factory.execution_settled');
   const ownerGone=!claim||claim.payload.supervisorPid===process.pid||processAbsent(claim.payload.supervisorPid);
   const processEvents=events.filter(e=>e.runId===run.id&&['agent.process_started','agent.completion_process_started'].includes(e.type));
   const processesGone=processEvents.every(e=>absent(e.payload.pid));
   const verifierStarted=events.some(e=>e.runId===run.id&&['run.candidate_committed','run.reproduction_started'].includes(e.type));
   let verifierGone=!verifierStarted;
   if(verifierStarted){try{const {stdout}=await exec('docker',['ps','-aq','--filter','label=factory.run='+run.id],{timeout:10000,maxBuffer:4096});verifierGone=stdout.trim()==='';}catch{/* Unavailable Docker cannot prove absence. */}}
   const terminalRun=['ready_for_review','failed','cancelled'].includes(run.state);
   const recovery=events.filter(e=>e.runId===run.id&&['run.recovery_hold','run.interrupted'].includes(e.type)).at(-1);
   const recoverable=!!recovery && (processEvents.length>0 || recovery.payload.previousState==='verifying');
   if(binding&&!this.jobs.activeRun(run.id)&&ownerGone&&processesGone&&verifierGone&&
     ((!claim&&stopped)||(settled&&terminalRun)||(recoverable&&processEvents.length>0))){
    const proposed=!claim?'NOT_DISPATCHED':terminalRun?producerState(this.storage,run):'CANCELLED';
    // A terminal claim cannot precede the durable paid-authority fence.
    this.spend.fenceAuthority(spendBinding(binding));
    this.storage.transaction(()=>{
     const current=this.record(client,requestId);
     if(current.events.some(e=>e.type==='factory.terminal'))return;
     if(!claim&&current.events.some(e=>e.type==='factory.dispatch_claimed'))return;
     // The tombstone is durable before reporting absence. No delayed dispatch
     // can re-enter JobManager after this event.
     if(!terminalRun){this.storage.saveRun({...run,state:'cancelled',finishedAt:new Date().toISOString(),failure:'Bound attempt fenced after resource reconciliation'});this.storage.saveWorkOrder({...data.order,state:'cancelled'});}
     this.storage.appendEvent({workOrderId:data.order.id,runId:run.id,type:'factory.terminal',payload:{state:proposed,identity:binding,resourceProof:{processGroups:processEvents.map(e=>e.payload.pid),verifierGone,settled,ownerGone},at:new Date().toISOString()}});
    });
    const saved=this.record(client,requestId).events.find(e=>e.type==='factory.terminal');
    if(saved){state=String(saved.payload.state);quiescent=true;if(binding)this.spend.fenceAuthority(spendBinding(binding));}
   }
  }
  return {requestId,workOrderId:data.order.id,runId:run?.id??null,snapshot,identity:binding??null,state,quiescent,
   evidenceRef:quiescent?'factory-event:'+data.order.id+':terminal':null,
   spend:this.localFixture?{status:'KNOWN',ceilingUsd:0,reason:'Backend-injected local fixture; no paid provider'}:
    {...this.spend.read(data.request.workId),reason:this.spendFixture?
     this.live?'Real provider through the bounded Work ledger':'Loopback synthetic provider only; live paid execution disabled':'Live paid execution disabled'},
   blocker:quiescent?null:state==='UNKNOWN'?'Exact process/verifier reconciliation required':null};
 }
}
