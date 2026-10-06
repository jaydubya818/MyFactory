import {alphaOwnerBinding,alphaOwnerCredentials,alphaRecordScope} from './alpha-owner-roster.mjs';
import {PostgresDispatchStore} from './postgres-dispatch.mjs';
import {PostgresSpendLedger} from './postgres-spend.mjs';
import {PostgresVerificationStore} from './postgres-verification.mjs';
import {CloudWorkControl} from './cloud-work-control.mjs';
import {cloudWorkProvider} from './cloud-work-provider.mjs';
import {verifyCloudCandidate,reconcileCloudVerification} from './cloud-verification.mjs';
import {productionInstallation} from './production-installation.mjs';
import {productionWorkloadIdentity} from './production-identity.mjs';
import {productionModelProvider} from './production-model-provider.mjs';
import {productionVerifierProvider} from './production-verifier-provider.mjs';
import {productionVerifierPolicy,productionVerifierPolicySha256} from './production-verifier-policy.mjs';
import {productionExecutionContractSha256,productionCheckpointPlan,productionConfiguration,productionSpendPlan,productionSourceGrant} from './production-execution-plan.mjs';

import {productionAuthority,assertProductionCredentialHorizon} from './production-authority.mjs';
import {validationCandidateSha256,validationConfiguration,validationContractSha256,validationSourceGrant} from './production-validation-plan.mjs';
import {operatorValidationProvider} from './production-validation-provider.mjs';

/** Explicit dependency composition of the single retained Cloud engine.
 * Not connected to HTTP/queue admission. A later, independently qualified
 * entrypoint must validate the production database marker, signer, exact Work
 * grant, FactoryVersion and Environment before supplying these dependencies.
 * This function alone never opens a database, dispatches or calls a model. */
export function productionRuntimeComponents({env,pool,queue,signing,sourceDigest,validation=false,cleanupOnly=false,alphaClientId}){
 const hostInstallation=productionInstallation(env);
 const ownerBinding=alphaClientId?alphaOwnerBinding(env,alphaClientId):null;
 if(ownerBinding&&validation)throw Error('PRODUCTION_WORK_NOT_AUTHORIZED');
 const installation=ownerBinding?{...hostInstallation,ownerScope:ownerBinding.ownerScope}:hostInstallation;
 const credentials=ownerBinding?alphaOwnerCredentials(env,ownerBinding,Date.now(),cleanupOnly):null;
 const approvalDigest=credentials?credentials.authorizationSha256:env.FACTORY_PRODUCTION_CANARY_AUTHORIZATION_SHA256;
 if(!validation&&!cleanupOnly&&!/^[a-f0-9]{64}$/.test(approvalDigest??''))throw Error('PRODUCTION_WORK_NOT_AUTHORIZED');
 if(!/^dpl_[A-Za-z0-9]+$/.test(env.VERCEL_DEPLOYMENT_ID??''))throw Error('PRODUCTION_RUNTIME_AUTHORITY_REQUIRED');
 if(signing?.factoryId!==installation.factoryId||signing?.key?.factoryId!==installation.factoryId||signing?.key?.keyId!=='production-cloud-v1')throw Error('PRODUCTION_SIGNER_REQUIRED');
 const configuration=validation?validationConfiguration:productionConfiguration,grant=validation?validationSourceGrant:ownerBinding?{...productionSourceGrant,clientId:ownerBinding.clientId}:productionSourceGrant;
 const checkAuthority=productionAuthority({installation,sourceDigest,configuration,clientId:grant.clientId,contractSha256:validation?validationContractSha256:productionExecutionContractSha256,candidateSha256:validation?validationCandidateSha256:null,...(validation?{}:{authorizationSha256:approvalDigest,...(ownerBinding?{ownerBinding}:{})})});
 const assertAuthority=async(...args)=>{
  if(cleanupOnly)throw Error('PRODUCTION_CLEANUP_ONLY');
  assertProductionCredentialHorizon(args[1],credentials?.proofExpiresAt??env.FACTORY_PROOF_EXPIRES_AT,signing.key.notAfter);
  return checkAuthority(...args);
 };
 const verificationPolicy={policy:productionVerifierPolicy,policySha256:productionVerifierPolicySha256};
 const store=new PostgresDispatchStore(pool,{maxWorks:1,workLimitError:'PRODUCTION_CANARY_WORK_LIMIT',custodyPrefix:'factory/production',verificationPolicySha256:productionVerifierPolicySha256,assertAuthority,...(ownerBinding?{assertRecordScope:alphaRecordScope(ownerBinding)}:{})});
 const assertWorkAuthorized=row=>store.transaction((client,now)=>assertAuthority(client,row.request,now,'model'));
 const spend=new PostgresSpendLedger(pool,{assertPaidAuthority:async(client,binding)=>{
  if(validation)throw Error('VALIDATION_MODEL_EXECUTION_FORBIDDEN');
  const row=(await client.query('SELECT request FROM factory.intake_receipts WHERE run_id=$1',[binding.runId])).rows[0];
  const now=Number((await client.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now')).rows[0].now);
  await assertAuthority(client,row?.request,now,'model');
 }});
 let provider=cloudWorkProvider({ledger:spend,plan:productionCheckpointPlan,projectId:installation.projectId,
  custodyStore:installation.custodyStoreId,custodyPrefix:'factory/production',
  providerOptions:async()=>({token:await productionWorkloadIdentity(installation),projectId:installation.projectId,teamId:installation.teamId}),
  blobOptions:async()=>({oidcToken:await productionWorkloadIdentity(installation)}),
  modelProviderForRow:validation?undefined:row=>productionModelProvider({env,assertWorkAuthorized:()=>assertWorkAuthorized(row)})});
 if(validation)provider=operatorValidationProvider(provider);
 const verification=new PostgresVerificationStore(store,verificationPolicy),verifier=productionVerifierProvider(env);
 const context=row=>({clientId:row.client_id,requestId:row.request_id,store:verification,provider:verifier,readCustody:()=>provider.readCustody(row)});
 provider.verifyCandidate=row=>verifyCloudCandidate(context(row));
 provider.reconcileVerification=row=>reconcileCloudVerification(context(row));
 const topics=validation?{work:'factory-production-validation-work-v1',recovery:'factory-production-validation-recovery-v1'}:ownerBinding?{work:'factory-alpha-work-v1',recovery:'factory-alpha-recovery-v1'}:{work:'factory-production-work-v1',recovery:'factory-production-recovery-v1'};
 const control=new CloudWorkControl({store,spend,provider,queue,signing,sourceDigest,deploymentId:env.VERCEL_DEPLOYMENT_ID,
  ownerScope:installation.ownerScope,grant,configuration,
  executionSpendPlan:productionSpendPlan,executionWorkTopic:topics.work,verificationPolicy});
 return{store,spend,provider,queue,control,verification,topics,clientId:grant.clientId};
}
