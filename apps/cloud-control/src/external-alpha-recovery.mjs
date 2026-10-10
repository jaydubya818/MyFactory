import {createHash,timingSafeEqual} from 'node:crypto';
import {loadExternalAlphaInstallations} from './external-alpha-authority.mjs';
import {externalAlphaIdentity,reply} from './external-alpha-control.mjs';
import {withExternalAlphaRuntime} from './external-alpha-runtime.mjs';
import {reconcileCloudWork} from './cloud-work-lifecycle.mjs';

/** Bounded durable scan. It cannot mint authority, allocate resources or dispatch Work. */
export async function reconcileExternalAlpha(runtime){
 const {authority,store,provider,control,clientId,installation}=runtime;
 const rows=await authority.withClient(async client=>(await client.query(`SELECT i.request_id,i.run_id
  FROM factory.intake_receipts i JOIN factory.external_alpha_work_authority a ON a.request_id=i.request_id
  LEFT JOIN factory.execution_resources r ON r.run_id=i.run_id
  LEFT JOIN factory.verification_resources v ON v.run_id=i.run_id
  WHERE i.client_id=$1 AND a.cohort_id=$2 AND a.slot=$3 AND a.owner_id=$4 AND a.policy_sha256=$5
  AND (i.deadline<=clock_timestamp() OR a.state<>'CONSUMED'
   OR (NOT r.cleanup_confirmed AND (r.cancelled_at IS NOT NULL OR r.lease_expires_at<=clock_timestamp()))
   OR (r.cleanup_confirmed AND (v.cleanup_confirmed OR v.deadline+interval '30 seconds'<=clock_timestamp()))
   OR EXISTS(SELECT 1 FROM factory.events e WHERE e.run_id=i.run_id AND e.type IN ('factory.stop_requested','factory.terminal'))
   OR EXISTS(SELECT 1 FROM factory.external_alpha_revocation x WHERE (x.subject_kind='AUTHORITY' AND x.subject=a.authority_id::text) OR (x.subject_kind='COHORT' AND x.subject=a.cohort_id::text) OR (x.subject_kind='KEY' AND x.subject=a.key_id)))
  AND NOT EXISTS(SELECT 1 FROM factory.events e WHERE e.run_id=i.run_id AND e.type='run.signed_result')
  ORDER BY i.deadline,i.run_id LIMIT 10`,[clientId,installation.cohortId,installation.slot,installation.ownerId,installation.policySha256])).rows);
 const report={observed:rows.length,reconciled:0,pending:0};
 for(const item of rows){
  // A session lock spans provider cleanup; process death releases it. Concurrent scans only observe the sole Run.
  await authority.withClient(async client=>{
   const key='external-alpha-recovery:'+item.run_id;
   if(!(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',[key])).rows[0].acquired){report.pending++;return;}
   try{
    if(!await authority.ownedRow(client,item.request_id,{currentGeneration:false}))throw Error('RECOVERY_SCOPE_MISMATCH');
    const row=await store.read(clientId,item.request_id);
    const terminal=row.events.some(e=>e.type==='factory.terminal');
    if(!terminal){
     // Expiry/UNKNOWN/revocation fences the original writer. No replacement allocation or redispatch is possible.
     if(!row.resource||!row.resource.cleanup_confirmed)await store.stop(clientId,externalAlphaIdentity(row));
     await reconcileCloudWork(store,provider,clientId,item.request_id);
    }
    await control.result(item.request_id);
    report.reconciled++;
   }catch{report.pending++;} // fixed summary only; the next durable tick retries observation/cleanup.
   finally{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}
  });
 }
 return report;
}

export async function handleExternalAlphaRecovery(request,env,{withRuntime=withExternalAlphaRuntime}={}){
 if(new URL(request.url).pathname!=='/api/external-alpha-recovery'||new URL(request.url).search)return reply({error:'NOT_FOUND'},404);
 if(request.method!=='GET')return reply({error:'METHOD_NOT_ALLOWED'},405);
 const secret=env.CRON_SECRET,header=request.headers.get('authorization')??'';
 if(typeof secret!=='string'||secret.length<32||secret.length>512||!timingSafeEqual(createHash('sha256').update(header).digest(),createHash('sha256').update('Bearer '+secret).digest()))return reply({error:'UNAUTHORIZED'},401);
 let installations;try{installations=loadExternalAlphaInstallations(env);}catch{return reply({error:'NOT_FOUND'},404);}
 if(!installations.length)return reply({error:'NOT_FOUND'},404);
 const totals={observed:0,reconciled:0,pending:0};
 try{
  for(const installation of installations){
   const result=await withRuntime(env,installation,reconcileExternalAlpha);
   for(const key of Object.keys(totals))totals[key]+=result[key];
  }
  return reply(totals,totals.pending?503:200);
 }catch{return reply({error:'EXTERNAL_ALPHA_RECOVERY_UNAVAILABLE'},503);}
}
