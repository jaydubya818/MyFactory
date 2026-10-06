import {digest} from '../../../packages/hosted-routing/src/result.ts';

/** An optional, exact-envelope exception, never a numeric/global cap increase.
 * Eligibility is read inside the caller's canonical dispatch transaction. */
export function successorIntakePolicy(approval){
 const s=approval?.successorIntake;if(s===undefined)return null;
 const t=approval?.manifestTemplate,r=t?.request,p=s?.predecessor;
 const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
 const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 if(!s||Object.keys(s).sort().join(',')!=='clientId,maxIntakes,predecessor,version,workGeneration,workId'||
  s.version!==1||s.maxIntakes!==1||s.clientId!=='sofie-alpha-a'||t?.clientId!==s.clientId||
  s.workId!==r?.workId||!uuid(s.workId)||s.workGeneration!==r?.workGeneration||s.workGeneration!==2||approval.workVersion!==2||
  approval.ownerBinding?.clientId!==s.clientId||approval.ownerBinding?.ownerScope!==t.ownerScope||
  !p||Object.keys(p).sort().join(',')!=='inputDigest,manifestSha256,requestId,runId,workGeneration,workId'||
  ![p.workId,p.requestId,p.runId].every(uuid)||p.workId===s.workId||!Number.isSafeInteger(p.workGeneration)||p.workGeneration<1||
  !sha(p.inputDigest)||!sha(p.manifestSha256))throw Error('SUCCESSOR_INTAKE_BINDING');
 return s;
}
export async function assertSuccessorPredecessor(client,approval){
 const s=successorIntakePolicy(approval);if(!s)return null;const p=s.predecessor;
 const row=(await client.query(`SELECT i.*,a.state AS authority_state,a.consumed_at,a.manifest,a.manifest_sha256,
  b.authority_state AS budget_state,b.cancelled_at AS budget_cancelled_at
  FROM factory.intake_receipts i JOIN factory.production_work_authority a ON a.request_id=i.request_id
  JOIN factory.work_spend_budgets b ON b.work_id=i.work_id::text
  WHERE i.client_id=$1 AND i.request_id=$2`,[s.clientId,p.requestId])).rows[0];
 if(!row||row.work_id!==p.workId||row.work_generation!==p.workGeneration||row.run_id!==p.runId||
  row.input_digest!==p.inputDigest||digest(row.request)!==p.inputDigest||row.manifest_sha256!==p.manifestSha256||
  digest(row.manifest)!==p.manifestSha256||row.authority_state!=='REVOKED'||!row.consumed_at||
  row.budget_state!=='fenced'||!row.budget_cancelled_at||row.manifest.ownerScope!==approval.manifestTemplate.ownerScope||
  row.manifest.authorizationEnvelope?.approval?.successorIntake!==undefined||
  digest(row.manifest.authorizationEnvelope?.approval?.ownerBinding)!==digest(approval.ownerBinding))throw Error('SUCCESSOR_PREDECESSOR_INVALID');
 const state=(await client.query(`SELECT
  (SELECT count(*)::int FROM factory.execution_resources WHERE run_id=$1) resources,
  (SELECT count(*)::int FROM factory.execution_resources WHERE run_id=$1 AND NOT cleanup_confirmed) unresolved,
  (SELECT count(*)::int FROM factory.verification_resources WHERE run_id=$1) verifiers,
  (SELECT count(*)::int FROM factory.candidate_custody WHERE run_id=$1) candidates,
  (SELECT count(*)::int FROM factory.work_spend_operations WHERE work_id=$2) operations,
  EXISTS(SELECT 1 FROM factory.events WHERE run_id=$1 AND type='factory.stop_requested') stopped,
  EXISTS(SELECT 1 FROM factory.events WHERE run_id=$1 AND type='factory.terminal' AND payload->>'status'='CANCELLED') terminal`,[p.runId,p.workId])).rows[0];
 if(state?.resources!==1||state.unresolved!==0||state.verifiers!==0||state.candidates!==0||state.operations!==0||state.stopped!==true||state.terminal!==true)throw Error('SUCCESSOR_PREDECESSOR_UNRESOLVED');
 return s;
}
