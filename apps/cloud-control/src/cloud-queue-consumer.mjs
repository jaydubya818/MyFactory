import {workTopic,recoveryTopic} from './cloud-work-control.mjs';
import {cloudGrant} from './cloud-work-plan.mjs';
import {executeCloudWork,reconcileCloudWork} from './cloud-work-lifecycle.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export async function consumeCloudDelivery(runtime,payload,metadata,deploymentId,recovery=false){
 if(!payload||Object.keys(payload).sort().join(',')!=='nonce,runId,version'||payload.version!==1||!uuid.test(payload.runId)||!/^[a-f0-9]{64}$/.test(payload.nonce))throw Error('INVALID_DELIVERY');
 if(metadata.topicName!==(recovery?recoveryTopic:workTopic)||metadata.region!=='iad1')throw Error('INVALID_DELIVERY');
 const {store,provider,queue,control}=runtime;
 const admitted=recovery?await store.recoveryBinding(payload.runId,deploymentId,payload.nonce):await store.acceptDelivery(payload.runId,deploymentId,payload.nonce,metadata.messageId);
 if(admitted.client_id!==cloudGrant.clientId||!admitted.identity)throw Error('DELIVERY_BINDING_MISMATCH');
 let row;
 if(recovery)row=await reconcileCloudWork(store,provider,admitted.client_id,admitted.request_id);
 else{
  const prior=await store.read(admitted.client_id,admitted.request_id);
  if(prior.resource){
   row=prior.events.some(e=>e.type==='factory.terminal')?prior:await reconcileCloudWork(store,provider,admitted.client_id,admitted.request_id);
  }else row=await executeCloudWork(store,provider,admitted.client_id,admitted.identity,async(_row,resource)=>{
   const delaySeconds=Math.max(1,Math.ceil((new Date(resource.deadline).getTime()+30000-Date.now())/1000));
   await queue.send(recoveryTopic,payload,{idempotencyKey:'recovery:'+payload.runId,delaySeconds,retentionSeconds:900});
  });
 }
 if(!row.events.some(e=>e.type==='factory.terminal'))throw Error('WORK_UNRESOLVED');
 await control.result(admitted.request_id); // Durable signed Result without browser polling.
}
export function retryCloudDelivery(error){
 if(['INVALID_DELIVERY','DELIVERY_BINDING_MISMATCH'].includes(error.message))return{acknowledge:true};
 return{afterSeconds:15}; // Retry observation/reconciliation only, never a fresh execution.
}
