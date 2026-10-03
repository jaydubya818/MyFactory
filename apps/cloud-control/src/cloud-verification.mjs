/** Independent verification is a continuation of the canonical Run. A duplicate
 * delivery observes the original resource; it never creates a replacement. */
export async function verifyCloudCandidate({clientId,requestId,store,provider,readCustody,now=Date.now}){
 const claim=await store.claim(clientId,requestId),r=claim.record;
 if(!claim.created){
  if(r.cleanup_confirmed)return r;
  if(now()<new Date(r.deadline).getTime()+30000)throw Error('VERIFIER_RECONCILIATION_PENDING');
  await provider.destroy(r);await store.cleanup(r.run_id,r.lease_owner,r.provider_session_id);return store.read(clientId,requestId);
 }
 let sandbox;
 try{
  await store.assertActive(r.run_id,r.lease_owner,'ALLOCATING');
  sandbox=await provider.allocate(r);await store.allocated(r.run_id,r.lease_owner,sandbox.currentSession().sessionId);
  const bundle=await readCustody();
  if(bundle.commit!==r.candidate_commit||bundle.tree!==r.candidate_tree)throw Error('VERIFIER_CUSTODY_BINDING');
  const active=()=>store.assertActive(r.run_id,r.lease_owner);
  await active();const checks=await provider.verify(sandbox,bundle,active);await store.finish(r.run_id,r.lease_owner,checks);
 }catch(error){
  // Retain only controlled codes. Candidate/provider exceptions can contain
  // credentials, source or uncontrolled output and must never become evidence.
  const code=/^VERIFIER_[A-Z_]{1,70}$/.test(error?.message??'')?error.message:'VERIFIER_EXECUTION_UNKNOWN';
  await store.failed(r.run_id,r.lease_owner,code);
 }finally{
  if(sandbox){
   const sessionId=sandbox.currentSession().sessionId;
   // A database outage may have lost the first allocation receipt. Record the
   // same identity again after deletion; never invent an absent resource.
   await provider.destroy(r,sandbox);await store.allocated(r.run_id,r.lease_owner,sessionId);
   await store.cleanup(r.run_id,r.lease_owner,sessionId);
  }
 }
 const result=await store.read(clientId,requestId);if(!result?.cleanup_confirmed)throw Error('VERIFIER_CLEANUP_UNPROVEN');return result;
}

/** Recovery observes or destroys the original resource; it never claims a new
 * verification attempt. A lost allocation receipt waits for the bounded create
 * window before name-based absence can establish cleanup. */
export async function reconcileCloudVerification({clientId,requestId,store,provider,now=Date.now}){
 const r=await store.read(clientId,requestId);
 if(!r||r.cleanup_confirmed)return r;
 if(now()<new Date(r.deadline).getTime()+30000)throw Error('VERIFIER_RECONCILIATION_PENDING');
 await provider.destroy(r);
 await store.cleanup(r.run_id,r.lease_owner,r.provider_session_id);
 return store.read(clientId,requestId);
}
