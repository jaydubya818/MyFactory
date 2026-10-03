import { createHash } from 'node:crypto';
import { proofEvidenceReference } from '../../../packages/verification/src/evidence.ts';
import { authorized } from './readiness.mjs';
import { cloudGrant } from './cloud-work-plan.mjs';
const denied=()=>Object.assign(Error('EVIDENCE_NOT_FOUND'),{status:404});
export function proofCredential(request,env){
 const token=env.FACTORY_PROOF_TOKEN;
 return /^[a-f0-9]{64}$/.test(token??'') && token!==env.FACTORY_SOFIE_STAGING_TOKEN &&
  typeof env.FACTORY_PROOF_OWNER_SCOPE==='string' && env.FACTORY_PROOF_OWNER_SCOPE.length>0 &&
  Number.isFinite(Date.parse(env.FACTORY_PROOF_EXPIRES_AT)) && Date.parse(env.FACTORY_PROOF_EXPIRES_AT)>Date.now() && authorized(request,token);
}
/** Deterministic projection of bytes already in private candidate custody. It
 * uses the accepted EvidenceProvider contract and grants no verifier verdict. */
export async function cloudEvidence(row,provider,ownerScope){
 const owners=row.events.filter(e=>e.type==='factory.owner_scope_bound');
 if(owners.length!==1||owners[0].payload.ownerScope!==ownerScope||owners[0].payload.workId!==row.work_id||
  owners[0].payload.workGeneration!==row.work_generation||owners[0].payload.requestId!==row.request_id||owners[0].payload.repository!==row.request.repository)throw denied();
 const signed=row.events.filter(e=>e.type==='run.signed_result');
 if(signed.length!==1)throw Object.assign(Error('WAITING_FOR_EVIDENCE'),{status:409,code:'waiting_for_evidence'});
 const bundle=await provider.readCustody(row),manifest=JSON.parse(Buffer.from(signed[0].payload.encoded,'base64url').toString('utf8'));
 if(!bundle||manifest?.status!=='COMPLETED'||manifest.candidate?.commit!==bundle.commit||manifest.execution.runId!==row.run_id||
  manifest.execution.workOrderId!==row.work_order_id||manifest.execution.factoryVersion!==row.snapshot.factoryVersion||manifest.execution.requestId!==row.request_id)throw denied();
 const binding={workOrderId:row.work_order_id,runId:row.run_id,candidateCommit:bundle.commit,factoryVersion:row.snapshot.factoryVersion};
 const at=row.events.find(e=>e.type==='factory.terminal')?.payload.finishedAt;
 const entries=[['TestEvidence','application/json','factory-candidate-checks',Buffer.from(JSON.stringify(bundle.checks.map(c=>({command:c.command,status:c.exitCode===0?'passed':'failed',exitCode:c.exitCode,candidateCommit:bundle.commit}))))],
  ['DiffEvidence','text/x-diff','factory-candidate-diff',Buffer.from(bundle.patchBase64,'base64')]];
 return entries.map(([kind,mediaType,source,bytes])=>{
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const ref={...binding,id:kind+'-'+sha256,kind,mediaType,sha256,size:bytes.length,collectedAt:at,source};
  return{scope:{ownerScope,repository:row.request.repository,workId:row.work_id,workGeneration:row.work_generation,requestId:row.request_id},
   ref,proofReference:proofEvidenceReference(ref),base64:bytes.toString('base64')};
 });
}
export async function cloudEvidenceRead(input,{store,provider},ownerScope){
 if(!input||Object.keys(input).sort().join(',')!=='candidateCommit,evidenceKind,evidenceReference,expectedDigest,factoryVersion,ownerScope,repository,requestId,runId,workGeneration,workId,workOrderId'||input.ownerScope!==ownerScope)throw denied();
 const found=await store.findRun(cloudGrant.clientId,input.workOrderId,input.runId);
 const row=await store.read(cloudGrant.clientId,found.request_id);
 const matches=(await cloudEvidence(row,provider,ownerScope)).filter(e=>e.proofReference===input.evidenceReference);
 if(matches.length!==1)throw denied();const e=matches[0];
 if(Object.entries(e.scope).some(([k,v])=>input[k]!==v)||['workOrderId','runId','candidateCommit','factoryVersion'].some(k=>input[k]!==e.ref[k])||input.evidenceKind!==e.ref.kind||input.expectedDigest!==e.ref.sha256)throw denied();
 return e;
}
