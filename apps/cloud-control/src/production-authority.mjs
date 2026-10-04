import {digest} from '../../../packages/hosted-routing/src/result.ts';
export const productionRecoveryAllowanceMs=20*60*1000;
export function assertProductionCredentialHorizon(request,proofExpiresAt,signerNotAfter){
 const bound=Date.parse(request?.deadline)+productionRecoveryAllowanceMs;
 if(!Number.isFinite(bound)||![proofExpiresAt,signerNotAfter].every(value=>Number.isFinite(Date.parse(value))&&Date.parse(value)>bound))throw Error('PRODUCTION_CREDENTIAL_RECOVERY_HORIZON');
}

/** Runs inside the dispatch store's existing serialization transaction. The
 * operator installs the exact envelope; runtime never creates or widens it. */
export function productionAuthority({installation,sourceDigest,configuration,contractSha256,clientId,candidateSha256=null,authorizationSha256}){
 const configurationDigest=digest(configuration),factoryVersion=digest({sourceDigest,configurationDigest});
 return async(client,request,now,phase)=>{
  const row=(await client.query('SELECT * FROM factory.production_work_authority WHERE request_id=$1 FOR UPDATE',[request.requestId])).rows[0];
  const m=row?.manifest;
  const expectedKeys='candidateSha256,clientId,configurationDigest,contractSha256,environment,factoryVersion,ownerScope,publication,request,sourceDigest,version';
  if(!row||row.state!=='AUTHORIZED'||row.client_id!==clientId||row.work_id!==request.workId||!m||Object.keys(m).sort().join(',')!==expectedKeys||
   digest(m)!==row.manifest_sha256||(authorizationSha256!==undefined&&row.manifest_sha256!==authorizationSha256)||m.version!==1||m.clientId!==clientId||m.ownerScope!==installation.ownerScope||m.environment!=='CLOUD_PRODUCTION'||m.publication!==false||
   m.sourceDigest!==sourceDigest||m.configurationDigest!==configurationDigest||m.factoryVersion!==factoryVersion||m.contractSha256!==contractSha256||m.candidateSha256!==candidateSha256||
   digest(m.request)!==digest(request)||!Number.isFinite(Date.parse(request.deadline))||Date.parse(request.deadline)<=now)throw Error('PRODUCTION_WORK_NOT_AUTHORIZED');
  if(phase==='prepare')await client.query('UPDATE factory.production_work_authority SET consumed_at=COALESCE(consumed_at,clock_timestamp()) WHERE request_id=$1',[request.requestId]);
  else if(!row.consumed_at)throw Error('PRODUCTION_WORK_NOT_ADMITTED');
 };
}
