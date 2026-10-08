import {loadExternalAlphaInstallations} from './external-alpha-authority.mjs';
import {withExternalAlphaRuntime} from './external-alpha-runtime.mjs';
import {consumeCloudDelivery,retryCloudDelivery} from './cloud-queue-consumer.mjs';

export const externalAlphaWorkTopic='factory-external-alpha-work-v1';
export const externalAlphaRecoveryTopic='factory-external-alpha-recovery-v1';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Queue data is a wake-up, never an installation, owner or execution grant. */
export async function consumeExternalAlphaDelivery(env,payload,metadata,recovery=false,{withRuntime=withExternalAlphaRuntime}={}){
 if(!payload||Object.keys(payload).sort().join(',')!=='nonce,runId,version'||payload.version!==1||!uuid.test(payload.runId)||!/^[a-f0-9]{64}$/.test(payload.nonce))throw Error('INVALID_DELIVERY');
 if(metadata?.topicName!==(recovery?externalAlphaRecoveryTopic:externalAlphaWorkTopic)||metadata.region!=='iad1')throw Error('INVALID_DELIVERY');
 const installations=loadExternalAlphaInstallations(env);
 if(!installations.length)throw Error('DELIVERY_BINDING_MISMATCH');
 for(const installation of installations){
  const matched=await withRuntime(env,installation,async runtime=>{
   const row=await runtime.authority.withClient(async client=>(await client.query('SELECT request_id FROM factory.intake_receipts WHERE run_id=$1 AND client_id=$2',[payload.runId,runtime.clientId])).rows[0]);
   if(!row)return false;
   // Cleanup may observe an older generation, but claim/model hooks can never execute it.
   const owned=await runtime.authority.withClient(client=>runtime.authority.ownedRow(client,row.request_id,{currentGeneration:false}));
   if(!owned)throw Error('DELIVERY_BINDING_MISMATCH');
   await consumeCloudDelivery(runtime,payload,metadata,env.VERCEL_DEPLOYMENT_ID,recovery);
   return true;
  });
  if(matched)return;
 }
 throw Error('DELIVERY_BINDING_MISMATCH');
}
export {retryCloudDelivery as retryExternalAlphaDelivery};
