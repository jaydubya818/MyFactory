export function localResultEvidence(row,bundle) {
 const l=row.snapshot.configuration.local,p=row.resource,v=row.verification;
 const observed=p?.evidence?.localExecution;
 if((p&&!p.cleanup_confirmed)||(v&&!v.cleanup_confirmed)
   ||(observed&&(observed.runtimeSha256!==l.runtimeSha256||observed.policySha256!==l.policySha256
   ||observed.hostQualificationSha256!==l.hostQualificationSha256)))throw Error('LOCAL_CLEANUP_OR_PROVENANCE_UNPROVEN');
 if(row.events.find(e=>e.type==='factory.terminal')?.payload.status==='COMPLETED'&&(!bundle||!observed||!v))throw Error('LOCAL_EXECUTION_UNPROVEN');
 return{provider:'local-docker',runtimeSha256:l.runtimeSha256,hostQualificationSha256:l.hostQualificationSha256,
  ownerScope:row.snapshot.localBinding.ownerScope,delegationDigest:row.snapshot.localBinding.delegationDigest,
  producerAllocation:p?.provider_session_id??null,verifierAllocation:v?.provider_session_id??null,
  candidateCommit:bundle?.commit??null,candidateTree:bundle?.tree??null,custodySha256:row.custody?.artifact_sha256??null,
  producerDestroyed:true,verifierDestroyed:true,policySha256:l.policySha256};
}
