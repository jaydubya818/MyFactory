import {randomUUID} from 'node:crypto';
import {cloudVerifierPolicy,cloudVerifierPolicySha256} from './cloud-verifier-policy.mjs';
export class PostgresVerificationStore{
 constructor(dispatch){this.dispatch=dispatch;}
 async read(clientId,requestId){return this.dispatch.transaction(async client=>{const row=await this.dispatch.record(client,clientId,requestId);return(await client.query('SELECT * FROM factory.verification_resources WHERE run_id=$1',[row.run_id])).rows[0]??null;});}
 async claim(clientId,requestId){
  return this.dispatch.transaction(async(client,now)=>{
   const row=await this.dispatch.record(client,clientId,requestId),existing=(await client.query('SELECT * FROM factory.verification_resources WHERE run_id=$1',[row.run_id])).rows[0];
   if(existing)return{created:false,record:existing};
   const custody=(await client.query('SELECT * FROM factory.candidate_custody WHERE run_id=$1',[row.run_id])).rows[0];
   const producer=(await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1',[row.run_id])).rows[0];
   if(!custody||!producer?.cleanup_confirmed||producer.evidence.visibleChecksPassed!==true||producer.cancelled_at||new Date(row.deadline).getTime()<=now||!row.identity||row.snapshot.configuration?.cloud?.verificationPolicySha256!==cloudVerifierPolicySha256)throw Error('VERIFIER_ADMISSION_DENIED');
   if((await client.query("SELECT 1 FROM factory.events WHERE run_id=$1 AND type IN ('factory.stop_requested','factory.terminal')",[row.run_id])).rowCount)throw Error('VERIFIER_AUTHORITY_FENCED');
   if((await client.query('SELECT 1 FROM factory.execution_resources WHERE NOT cleanup_confirmed LIMIT 1')).rowCount)throw Error('VERIFIER_ADMISSION_DENIED');
   const lease=randomUUID(),deadline=new Date(Math.min(now+cloudVerifierPolicy.timeoutMs,new Date(row.deadline).getTime())).toISOString();
   if(Date.parse(deadline)<now+10000)throw Error('VERIFIER_DEADLINE');
   const record=(await client.query(`INSERT INTO factory.verification_resources(run_id,lease_owner,lease_expires_at,deadline,provider_name,candidate_commit,candidate_tree,custody_sha256,policy_sha256,image,state) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,'ALLOCATING') RETURNING *`,[row.run_id,lease,deadline,'factory-verify-'+row.run_id,custody.candidate_commit,custody.candidate_tree,custody.artifact_sha256,cloudVerifierPolicySha256,cloudVerifierPolicy.image])).rows[0];
   await this.dispatch.event(client,row,'verifier.claimed',{candidateCommit:custody.candidate_commit,policySha256:cloudVerifierPolicySha256,providerName:record.provider_name});return{created:true,record};
  });
 }
 async allocated(runId,leaseOwner,sessionId){
  if(!/^sbx_[A-Za-z0-9_-]+$/.test(sessionId))throw Error('VERIFIER_PROVIDER_ID');
  return this.dispatch.transaction(async client=>{const result=await client.query(`UPDATE factory.verification_resources SET provider_session_id=$3,state=CASE WHEN state='ALLOCATING' THEN 'RUNNING' ELSE state END,updated_at=clock_timestamp() WHERE run_id=$1 AND lease_owner=$2 AND NOT cleanup_confirmed AND (provider_session_id IS NULL OR provider_session_id=$3) RETURNING *`,[runId,leaseOwner,sessionId]);if(result.rowCount!==1)throw Error('VERIFIER_RECEIPT_CONFLICT');return result.rows[0];});
 }
 async assertActive(runId,leaseOwner,state='RUNNING'){return this.dispatch.transaction(async client=>{
  if(!['ALLOCATING','RUNNING'].includes(state))throw Error('VERIFIER_LEASE_FENCED');
  const r=await client.query(`SELECT 1 FROM factory.verification_resources v WHERE run_id=$1 AND lease_owner=$2 AND lease_expires_at>clock_timestamp() AND deadline>clock_timestamp() AND state=$3 AND NOT cleanup_confirmed AND NOT EXISTS(SELECT 1 FROM factory.events e WHERE e.run_id=v.run_id AND e.type IN ('factory.stop_requested','factory.terminal'))`,[runId,leaseOwner,state]);if(r.rowCount!==1)throw Error('VERIFIER_LEASE_FENCED');
 });}
 async finish(runId,leaseOwner,checks){
  const expected=cloudVerifierPolicy.checks.map(check=>check.id);
  if(!Array.isArray(checks)||checks.length!==expected.length||checks.some((c,i)=>!c||Object.keys(c).sort().join(',')!=='id,result'||c.id!==expected[i]||!['PASS','FAIL'].includes(c.result)))throw Error('VERIFIER_CHECK_BINDING');
  return this.dispatch.transaction(async client=>{
   const outcome=checks.every(c=>c.result==='PASS')?'PASS':'FAIL';
   const result=await client.query(`UPDATE factory.verification_resources v SET state='FINISHED',outcome=$3,checks=$4,updated_at=clock_timestamp() WHERE run_id=$1 AND lease_owner=$2 AND state='RUNNING' AND lease_expires_at>clock_timestamp() AND deadline>clock_timestamp() AND NOT cleanup_confirmed AND NOT EXISTS(SELECT 1 FROM factory.events e WHERE e.run_id=v.run_id AND e.type IN ('factory.stop_requested','factory.terminal')) RETURNING *`,[runId,leaseOwner,outcome,JSON.stringify(checks)]);
   if(result.rowCount!==1)throw Error('VERIFIER_LEASE_FENCED');return result.rows[0];
  });
 }
 async failed(runId,leaseOwner,code){
  if(!/^VERIFIER_[A-Z_]{1,70}$/.test(code))throw Error('VERIFIER_ERROR_CODE');
  return this.dispatch.transaction(async client=>{
   // An indeterminate attempt cannot become PASS even if a delayed caller
   // supplies checks. Its resource remains fenced until confirmed cleanup.
   const r=await client.query("UPDATE factory.verification_resources SET state='FINISHED',outcome='UNKNOWN',checks='[]'::jsonb,failure=$3,updated_at=clock_timestamp() WHERE run_id=$1 AND lease_owner=$2 AND NOT cleanup_confirmed RETURNING run_id",[runId,leaseOwner,code]);
   if(r.rowCount!==1)throw Error('VERIFIER_LEASE_FENCED');
  });
 }
 async cleanup(runId,leaseOwner,sessionId){return this.dispatch.transaction(async(client,now)=>{
  const r=(await client.query('SELECT * FROM factory.verification_resources WHERE run_id=$1 AND lease_owner=$2',[runId,leaseOwner])).rows[0];
  if(!r||r.provider_session_id!==sessionId||(!sessionId&&now<new Date(r.deadline).getTime()+30000))throw Error('VERIFIER_CLEANUP_UNPROVEN');
  await client.query("UPDATE factory.verification_resources SET state='DESTROYED',cleanup_confirmed=true,updated_at=clock_timestamp() WHERE run_id=$1 AND lease_owner=$2",[runId,leaseOwner]);
 });}
}
