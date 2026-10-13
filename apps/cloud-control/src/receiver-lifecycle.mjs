import {canonical,digest} from '../../../packages/hosted-routing/src/result.ts';
const same=(a,b)=>canonical(a)===canonical(b);
const order=(a,b)=>canonical(a.identity).localeCompare(canonical(b.identity));
/** Original authenticated inventory only. Missing producer/verifier history is
 * uncertainty; the absence of a resource row is never a cleanup receipt. */
export async function receiverInventory(ordered,client,state,select){
 const {enrollment}=ordered,runs=[],unqualified=[],seen=new Set();
 for(const binding of [...enrollment.clientBindings].sort((a,b)=>a.clientId.localeCompare(b.clientId))){
  const store=ordered.clientStores.get(binding.clientId);
  if(!store||typeof store.assertRecordScope!=='function'){unqualified.push({clientId:binding.clientId,reason:'ORIGINAL_CLIENT_AUTHENTICATION_UNAVAILABLE'});continue;}
  const rows=(await client.query('SELECT * FROM factory.intake_receipts WHERE client_id=$1 ORDER BY request_id LIMIT 129',[binding.clientId])).rows;
  if(rows.length>128||runs.length+rows.length>128){unqualified.push({clientId:binding.clientId,reason:'INVENTORY_OVERFLOW'});break;}
  for(const row of rows){
   seen.add(row.client_id+':'+row.request_id);
   try{await store.assertRecordScope(client,row);}catch{unqualified.push({clientId:binding.clientId,requestId:row.request_id,reason:'ORIGINAL_SCOPE_UNAVAILABLE'});continue;}
   const events=(await client.query('SELECT id,type,payload FROM factory.events WHERE run_id=$1 ORDER BY id',[row.run_id])).rows;
   const owners=events.filter(e=>e.type==='factory.owner_scope_bound'),admitted=events.filter(e=>e.type==='factory.capability_admitted');
   const o=owners[0]?.payload,a=admitted[0]?.payload;
   if(owners.length!==1||admitted.length!==1||o.ownerScope!==enrollment.scope.ownerId||o.organizationId!==enrollment.scope.organizationId
    ||o.installationId!==enrollment.scope.installationId||o.agentId!==binding.agentId||o.workId!==row.work_id||o.workGeneration!==row.work_generation
    ||o.requestId!==row.request_id||a.workId!==row.work_id||a.workGeneration!==row.work_generation||!Number.isSafeInteger(a.policyRevision)){
    unqualified.push({clientId:binding.clientId,requestId:row.request_id,runId:row.run_id,reason:'LEGACY_SCOPE_OR_ADMISSION_INCOMPLETE'});continue;
   }
   const refs=state.data.capability_admission_references.filter(r=>r.payload.workId===row.work_id&&r.payload.workGeneration===row.work_generation);
   const relay=refs.filter(r=>r.payload.authority==='relay'),myeve=refs.filter(r=>r.payload.authority==='myeve');
   if(relay.length!==1||myeve.length!==1||myeve[0].payload.referenceId!==a.referenceId||myeve[0].payload.policyId!==a.policyId
    ||myeve[0].payload.version!==a.policyRevision||relay[0].payload.nativeRequestDigest!==row.input_digest||relay[0].payload.agentId!==binding.agentId){
    unqualified.push({clientId:binding.clientId,requestId:row.request_id,runId:row.run_id,reason:'PAIRED_ADMISSION_INCOMPLETE'});continue;
   }
   const identity={clientId:row.client_id,requestId:row.request_id,workId:row.work_id,workGeneration:row.work_generation,
    runId:row.run_id,workOrderId:row.work_order_id,factoryVersion:row.snapshot.factoryVersion,policyId:a.policyId,policyRevision:a.policyRevision,
    agentId:relay[0].payload.agentId,agentRevision:relay[0].payload.agentRevision,relayReferenceId:relay[0].payload.referenceId};
   try{
    const outcome=await ordered.validateNativeOutcome(client,state,row.request,a.missionId,row.client_id);
    const seal=state.data.capability_control_observations.find(r=>r.payload.domain==='factory-native-outcome/v1'&&r.payload.planId===outcome.plan.record_key);
    if(outcome.outcome.payload.outcome!=='ADMITTED'||seal?.payload.nativeOutcomeDigest!==outcome.outcome.payload_digest)throw Error('INCOMPLETE_NATIVE_OUTCOME');
   }catch{unqualified.push({clientId:binding.clientId,requestId:row.request_id,runId:row.run_id,reason:'ORIGINAL_AUTHORITY_OR_NATIVE_OUTCOME_INCOMPLETE'});continue;}
   if(!select(identity))continue;
   const producer=(await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1',[row.run_id])).rows[0]??null;
   const verifier=(await client.query('SELECT * FROM factory.verification_resources WHERE run_id=$1',[row.run_id])).rows[0]??null;
   const claimed=events.some(e=>e.type==='factory.dispatch_claimed'),verified=events.some(e=>e.type==='verifier.claimed');
   // Admitted Work needs positive resource/journal evidence. Absence cannot
   // establish NOT_ALLOCATED after a restore, even for an unclaimed intake.
   const neverAllocated=false;
   if(!producer||!verifier)unqualified.push({clientId:binding.clientId,requestId:row.request_id,runId:row.run_id,reason:'RESOURCE_JOURNAL_INCOMPLETE'});
   const producerClean=!!producer&&producer.state==='DESTROYED'&&producer.cleanup_confirmed===true&&producer.allocation_unknown===false
    &&events.some(e=>e.type==='factory.resource_destroyed'&&e.payload.providerSessionId===producer.provider_session_id
      &&e.payload.providerName===producer.provider_name&&e.payload.leaseOwner===producer.lease_owner&&e.payload.leaseGeneration===producer.lease_generation
      &&e.payload.runId===row.run_id&&e.payload.workId===row.work_id&&e.payload.workGeneration===row.work_generation);
   const verifierClean=!!verifier&&verifier.state==='DESTROYED'&&verifier.cleanup_confirmed===true
    &&events.some(e=>e.type==='verifier.claimed'&&e.payload.leaseOwner===verifier.lease_owner&&e.payload.providerName===verifier.provider_name
      &&e.payload.runId===row.run_id&&e.payload.workId===row.work_id&&e.payload.workGeneration===row.work_generation)
    &&events.some(e=>e.type==='verifier.cleanup_confirmed'&&e.payload.leaseOwner===verifier.lease_owner
      &&e.payload.providerSessionId===verifier.provider_session_id&&e.payload.providerName===verifier.provider_name
      &&e.payload.runId===row.run_id&&e.payload.workId===row.work_id&&e.payload.workGeneration===row.work_generation
      &&e.payload.candidateCommit===verifier.candidate_commit&&e.payload.custodySha256===verifier.custody_sha256&&e.payload.policySha256===verifier.policy_sha256);
   const positiveCleanup=producerClean&&verifierClean;
   if(!producerClean&&producer?.cleanup_confirmed||!verifierClean&&verifier?.cleanup_confirmed)unqualified.push({clientId:binding.clientId,requestId:row.request_id,runId:row.run_id,reason:'POSITIVE_CLEANUP_JOURNAL_INCOMPLETE'});
   const missingHistory=!producer||!verifier;
   const unknown=missingHistory||!positiveCleanup&&(producer?.evidence?.cleanup==='UNKNOWN'||verifier?.failure==='VERIFIER_CLEANUP_UNKNOWN'
    ||events.some(e=>e.type==='factory.verifier_cleanup_unknown'&&e.payload.leaseOwner===verifier?.lease_owner));
   const failed=!positiveCleanup&&producer?.evidence?.cleanup==='FAILED';
   const budget=(await client.query('SELECT authority_state FROM factory.work_spend_budgets WHERE work_id=$1 AND work_generation=$2',[row.work_id,row.work_generation])).rows[0];
   const authorityFenced=typeof ordered.isRetainedAuthorityFenced==='function'&&await ordered.isRetainedAuthorityFenced(client,identity);
   const fenced=authorityFenced&&budget?.authority_state==='fenced'&&events.some(e=>e.type==='factory.stop_requested')&&(!producer||producer.cancelled_at!==null)
     &&(!verifier||new Date(verifier.lease_expires_at).getTime()<=Date.now());
   const paused=events.some(e=>e.type==='factory.capability_pause_requested')&&(neverAllocated||positiveCleanup);
   runs.push({identity,neverAllocated,positiveCleanup,unknown,failed,fenced,paused,
    producer:producer?{leaseOwner:producer.lease_owner,leaseGeneration:producer.lease_generation,providerSessionId:producer.provider_session_id,cleanupConfirmed:producer.cleanup_confirmed,cancelled:producer.cancelled_at!==null}:null,
    verifier:verifier?{leaseOwner:verifier.lease_owner,providerSessionId:verifier.provider_session_id,cleanupConfirmed:verifier.cleanup_confirmed,failure:verifier.failure}:null,
    events:events.filter(e=>['factory.stop_requested','factory.capability_pause_requested','factory.capability_revoked','factory.resource_destroyed','verifier.cleanup_confirmed','factory.verifier_cleanup_unknown'].includes(e.type)).map(e=>({id:String(e.id),type:e.type,payload:e.payload}))});
  }
 }
 for(const ref of state.data.capability_admission_references.filter(r=>r.payload.authority==='myeve')){
  if(seen.has(ref.payload.clientId+':'+ref.payload.requestId))continue;
  let definite=false;
  const plan=state.data.capability_receiver_plans.find(r=>r.record_kind==='PLAN'&&r.payload.identity.requestId===ref.payload.requestId&&r.payload.identity.clientId===ref.payload.clientId);
  if(plan){
   const outcome=state.data.capability_receiver_plans.find(r=>r.record_kind==='OUTCOME'&&r.record_key===plan.record_key),seal=state.data.capability_control_observations.find(r=>r.payload.domain==='factory-native-outcome/v1'&&r.payload.planId===plan.record_key);
   if(outcome?.payload.outcome==='DEFINITELY_NOT_ADMITTED'&&seal?.payload.nativeOutcomeDigest===outcome.payload_digest){
    try{const joined=await ordered.validateNativeOutcome(client,state,plan.payload.identity.nativeRequest,plan.payload.identity.missionId,ref.payload.clientId);
     const pairs=state.data.capability_admission_references.filter(r=>r.payload.requestId===ref.payload.requestId&&r.payload.clientId===ref.payload.clientId);
     definite=joined.outcome.payload.outcome==='DEFINITELY_NOT_ADMITTED'&&pairs.length===2
      &&pairs.every(r=>r.payload.workId===plan.payload.identity.workId&&r.payload.workGeneration===plan.payload.identity.workGeneration
        &&r.payload.nativeRequestDigest===plan.payload.identity.nativeRequestDigest&&r.payload.missionId===plan.payload.identity.missionId&&r.payload.nativeAdmission==='NOT_ASSERTED')
      &&new Set(pairs.map(r=>r.payload.authority)).size===2;
    }catch{}
   }
  }
  if(!definite)unqualified.push({clientId:ref.payload.clientId,requestId:ref.payload.requestId,reason:'CONSUMED_REFERENCE_WITHOUT_NATIVE_INTAKE'});
 }
 runs.sort(order);unqualified.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 return {runs,unqualified,inventoryComplete:unqualified.length===0};
}
export function aggregateLifecycle(inventory,operation){
 if(inventory.runs.some(r=>r.unknown))return 'STOP_UNKNOWN';
 if(inventory.runs.some(r=>r.failed))return 'STOP_FAILED';
 if(!inventory.inventoryComplete)return 'PENDING_BACKEND';
 if(operation==='pause')return inventory.runs.every(r=>r.paused)?'PAUSE_CONFIRMED':'PENDING_BACKEND';
 if(!inventory.runs.every(r=>r.fenced))return 'PENDING_BACKEND';
 return inventory.runs.every(r=>r.neverAllocated||r.positiveCleanup)?'CLEANUP_CONFIRMED':'AUTHORITY_FENCED';
}
/** Restriction only. Neither funds nor paid usage are released or settled. */
export async function fenceInventory(ordered,client,inventory,restriction){
 for(const run of inventory.runs){
  const store=ordered.clientStores.get(run.identity.clientId),row=await store.record(client,run.identity.clientId,run.identity.requestId);
  const eventType=restriction.operation==='pause'?'factory.capability_pause_requested':'factory.capability_revoked';
  if(!(await client.query('SELECT 1 FROM factory.events WHERE run_id=$1 AND type=$2 AND payload->>\'restrictionDigest\'=$3',[row.run_id,eventType,digest(restriction)])).rowCount)
   await store.event(client,row,eventType,{restrictionDigest:digest(restriction),...restriction});
  if(restriction.operation==='revoke'){
   if(!(await client.query("SELECT 1 FROM factory.events WHERE run_id=$1 AND type='factory.stop_requested'",[row.run_id])).rowCount)await store.event(client,row,'factory.stop_requested',{source:'receiver-control',restrictionDigest:digest(restriction)});
   await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced',cancelled_at=COALESCE(cancelled_at,clock_timestamp()::text) WHERE work_id=$1 AND work_generation=$2",[row.work_id,row.work_generation]);
   await client.query('UPDATE factory.execution_resources SET cancelled_at=COALESCE(cancelled_at,clock_timestamp()),lease_expires_at=least(lease_expires_at,clock_timestamp()),updated_at=clock_timestamp() WHERE run_id=$1',[row.run_id]);
   await client.query('UPDATE factory.verification_resources SET lease_expires_at=least(lease_expires_at,clock_timestamp()),updated_at=clock_timestamp() WHERE run_id=$1',[row.run_id]);
   // Native authority invalidation is monotonic; original exact row only.
   if(typeof ordered.invalidateRetainedAuthority!=='function')throw Error('FACTORY_AUTHORITY_INVALIDATION_UNAVAILABLE');
   await ordered.invalidateRetainedAuthority(client,run.identity);
  }
 }
}
export function inventoryMaterial(ordered,restriction,inventory){return {domain:'factory-capability-inventory/v1',scope:ordered.enrollment.scope,
 control:restriction,clientBindings:ordered.enrollment.clientBindings,inventoryComplete:inventory.inventoryComplete,runs:inventory.runs,unqualified:inventory.unqualified};}
