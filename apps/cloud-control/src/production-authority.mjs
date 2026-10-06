import {alphaClientIds,assertAlphaApprovalBinding} from './alpha-owner-roster.mjs';
import {assertConcreteProductionGrant} from './production-approval.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {parseCloudPrepare} from '../../../packages/contracts/src/cloud-execution.ts';
import {validationSourceGrant} from './production-validation-plan.mjs';
export const productionRecoveryAllowanceMs=20*60*1000;
export function assertProductionCredentialHorizon(request,proofExpiresAt,signerNotAfter){
 const bound=Date.parse(request?.deadline)+productionRecoveryAllowanceMs;
 if(!Number.isFinite(bound)||![proofExpiresAt,signerNotAfter].every(value=>Number.isFinite(Date.parse(value))&&Date.parse(value)>bound))throw Error('PRODUCTION_CREDENTIAL_RECOVERY_HORIZON');
}

/** Runs inside the dispatch store's existing serialization transaction. The
 * operator installs the exact envelope; runtime never creates or widens it. */
export function productionAuthority({installation,sourceDigest,configuration,contractSha256,clientId,candidateSha256=null,authorizationSha256,ownerBinding}){
 const configurationDigest=digest(configuration),factoryVersion=digest({sourceDigest,configurationDigest});
 return async(client,request,now,phase)=>{
  const row=(await client.query('SELECT * FROM factory.production_work_authority WHERE request_id=$1 FOR UPDATE',[request.requestId])).rows[0];
  // Only a missing validation grant may wait. Revocation, expiry and mismatches
  // are terminal authority failures, never permission to retry preparation.
  if(!row&&clientId==='sofie-production-validation'&&phase==='prepare'&&Date.parse(request.deadline)>now){
   parseCloudPrepare(request,validationSourceGrant,now);
   throw Error('PRODUCTION_VALIDATION_GRANT_PENDING');
  }
  const m=row?.manifest;
  const alpha=alphaClientIds.includes(clientId),paid=clientId==='sofie-production'||alpha;
  if(alpha&&!ownerBinding||ownerBinding&&(!alpha||ownerBinding.clientId!==clientId||ownerBinding.ownerScope!==installation.ownerScope))throw Error('PRODUCTION_WORK_NOT_AUTHORIZED');
  if(!row)throw Error('PRODUCTION_WORK_NOT_AUTHORIZED');
  if(paid)assertConcreteProductionGrant(m,authorizationSha256,now);
  if(alpha)assertAlphaApprovalBinding(m?.authorizationEnvelope,ownerBinding);
  const expectedKeys=(paid?'authorizationEnvelope,authorizationEnvelopeSha256,':'')+'candidateSha256,clientId,configurationDigest,contractSha256,environment,factoryVersion,ownerScope,publication,request,sourceDigest,version';
  if(!row||row.state!=='AUTHORIZED'||row.client_id!==clientId||row.work_id!==request.workId||!m||Object.keys(m).sort().join(',')!==expectedKeys||
   digest(m)!==row.manifest_sha256||(!paid&&authorizationSha256!==undefined&&row.manifest_sha256!==authorizationSha256)||m.version!==(paid?2:1)||m.clientId!==clientId||m.ownerScope!==installation.ownerScope||m.environment!=='CLOUD_PRODUCTION'||m.publication!==false||
   m.sourceDigest!==sourceDigest||m.configurationDigest!==configurationDigest||m.factoryVersion!==factoryVersion||m.contractSha256!==contractSha256||m.candidateSha256!==candidateSha256||
   digest(m.request)!==digest(request)||!Number.isFinite(Date.parse(request.deadline))||Date.parse(request.deadline)<=now)throw Error('PRODUCTION_WORK_NOT_AUTHORIZED');
  if(phase==='prepare')await client.query('UPDATE factory.production_work_authority SET consumed_at=COALESCE(consumed_at,clock_timestamp()) WHERE request_id=$1',[request.requestId]);
  else if(!row.consumed_at)throw Error('PRODUCTION_WORK_NOT_ADMITTED');
 };
}
