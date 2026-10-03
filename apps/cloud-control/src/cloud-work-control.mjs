import { randomBytes } from 'node:crypto';
import { digest } from '../../../packages/hosted-routing/src/result.ts';
import { cloudGrant,cloudConfiguration } from './cloud-work-plan.mjs';
import { cloudResult } from './cloud-work-result.mjs';
export const workTopic='factory-staging-work';
export const recoveryTopic='factory-staging-recovery';
export const binding=i=>({workId:i.workId,workGeneration:i.workGeneration,dispatchIdentity:i.dispatchIdentity,requestId:i.requestId,workOrderId:i.workOrderId,factoryVersion:i.factoryVersion,runId:i.remoteRunId});
export {cloudHarnessSpendPlan as spendPlan} from './cloud-harness-plan.mjs';
import {cloudHarnessSpendPlan as spendPlan} from './cloud-harness-plan.mjs';

export class CloudWorkControl {
 constructor({store,spend,provider,queue,signing,sourceDigest,deploymentId,ownerScope,grant=cloudGrant,configuration=cloudConfiguration,executionSpendPlan=spendPlan,executionWorkTopic=workTopic,verificationPolicy}) {Object.assign(this,{store,spend,provider,queue,signing,sourceDigest,deploymentId,ownerScope,grant,configuration,executionSpendPlan,executionWorkTopic,verificationPolicy});}
 snapshot(request,order,run){
  const configuration=structuredClone(this.configuration),configurationDigest=digest(configuration);
  return{version:2,inputTree:request.source.tree,factoryId:this.signing.factoryId,factoryVersion:digest({sourceDigest:this.sourceDigest,configurationDigest}),sourceDigest:this.sourceDigest,configurationDigest,configuration,requestId:request.requestId,requestDigest:digest(request),workOrderId:order.id,runId:run.id,attemptNumber:1,inputCommit:request.source.commit,capturedAt:run.startedAt};
 }
 async prepare(input){
  const row=await this.store.prepare({...this.grant,...(this.ownerScope?{ownerScope:this.ownerScope}:{})},input,(...args)=>this.snapshot(...args));
  await this.spend.createBudget({workId:row.work_id,workGeneration:row.work_generation,requestId:row.request_id,workOrderId:row.work_order_id},Math.floor(row.request.maxSpendUsd*1000000),row.request.deadline,this.executionSpendPlan);
  return this.read(row.request_id);
 }
 async dispatch(identity){
  const row=await this.store.read(this.grant.clientId,identity.requestId);this.store.assertIdentity(row,identity);
  if(row.events.some(e=>['factory.stop_requested','factory.terminal'].includes(e.type)))return this.read(identity.requestId);
  await this.spend.bindAuthority(binding(identity));
  const nonce=randomBytes(32).toString('hex');
  const reservation=await this.store.reserveDelivery(this.grant.clientId,identity,this.deploymentId,nonce);
  if(reservation.created){
   try{const sent=await this.queue.send(this.executionWorkTopic,{version:1,runId:row.run_id,nonce},{idempotencyKey:row.run_id,retentionSeconds:900});await this.store.recordDeliverySend(row.run_id,sent.messageId);}
   catch{await this.store.recordDeliverySend(row.run_id);}
  }
  return this.read(identity.requestId);
 }
 async read(requestId){
  const row=await this.store.read(this.grant.clientId,requestId),spend=await this.spend.read(row.work_id);
  const terminal=row.events.find(e=>e.type==='factory.terminal')?.payload,stopped=row.events.some(e=>e.type==='factory.stop_requested'),r=row.resource;
  const state=terminal?.status??(stopped?'STOPPING':r?(r.cleanup_confirmed?'UNKNOWN':r.allocation_unknown?'UNKNOWN':'RUNNING'):row.delivery?.state==='UNKNOWN'?'UNKNOWN':row.identity?'DISPATCHING':spend?'PREPARED':'PREPARING');
  return{requestId:row.request_id,workOrderId:row.work_order_id,runId:row.run_id,snapshot:row.snapshot,identity:row.identity,state,quiescent:!!terminal,evidenceRef:terminal?.evidenceRef??null,spend,blocker:terminal?.status==='FAILED'?(r?.evidence.failure??'EXECUTION_FAILED'):state==='UNKNOWN'?'EXECUTION_REQUIRES_RECONCILIATION':null};
 }
 async result(requestId){
  const row=await this.store.read(this.grant.clientId,requestId),terminal=row.events.find(e=>e.type==='factory.terminal')?.payload;
  if(!terminal)return{state:(await this.read(requestId)).state==='STOPPING'?'STOPPING':row.resource?.allocation_unknown?'UNKNOWN':'RUNNING',result:null};
  const saved=row.events.find(e=>e.type==='run.signed_result')?.payload;
  const result=saved??await this.store.saveResult(this.grant.clientId,requestId,cloudResult(row,row.custody?await this.provider.readCustody(row):null,this.signing,this.verificationPolicy));
  return{state:terminal.status,result};
 }
 async source(requestId){
  const row=await this.store.read(this.grant.clientId,requestId);
  if(!row.custody)throw Error('CUSTODY_NOT_AVAILABLE');
  const bundle=await this.provider.readCustody(row);
  return{base:bundle.base,sourceFiles:bundle.sourceFiles,candidateCommit:bundle.commit,candidateTree:bundle.tree,files:bundle.files};
 }
}
