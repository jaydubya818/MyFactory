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
import {productionCheckpointPlan,productionConfiguration,productionSpendPlan,productionSourceGrant} from './production-execution-plan.mjs';

/** Explicit dependency composition of the single retained Cloud engine.
 * Not connected to HTTP/queue admission. A later, independently qualified
 * entrypoint must validate the production database marker, signer, exact Work
 * grant, FactoryVersion and Environment before supplying these dependencies.
 * This function alone never opens a database, dispatches or calls a model. */
export function productionRuntimeComponents({env,pool,queue,signing,sourceDigest,assertWorkAuthorized}){
 const installation=productionInstallation(env);
 if(typeof assertWorkAuthorized!=='function'||!/^dpl_[A-Za-z0-9]+$/.test(env.VERCEL_DEPLOYMENT_ID??''))throw Error('PRODUCTION_RUNTIME_AUTHORITY_REQUIRED');
 if(signing?.factoryId!==installation.factoryId||signing?.key?.factoryId!==installation.factoryId||signing?.key?.keyId!=='production-cloud-v1')throw Error('PRODUCTION_SIGNER_REQUIRED');
 const verificationPolicy={policy:productionVerifierPolicy,policySha256:productionVerifierPolicySha256};
 const store=new PostgresDispatchStore(pool,{maxWorks:1,workLimitError:'PRODUCTION_CANARY_WORK_LIMIT',custodyPrefix:'factory/production',verificationPolicySha256:productionVerifierPolicySha256});
 const spend=new PostgresSpendLedger(pool);
 const provider=cloudWorkProvider({ledger:spend,plan:productionCheckpointPlan,projectId:installation.projectId,
  custodyStore:installation.custodyStoreId,custodyPrefix:'factory/production',
  providerOptions:async()=>({token:await productionWorkloadIdentity(installation),projectId:installation.projectId,teamId:installation.teamId}),
  blobOptions:async()=>({oidcToken:await productionWorkloadIdentity(installation)}),
  modelProviderForRow:row=>productionModelProvider({env,assertWorkAuthorized:()=>assertWorkAuthorized(row)})});
 const verification=new PostgresVerificationStore(store,verificationPolicy),verifier=productionVerifierProvider(env);
 const context=row=>({clientId:row.client_id,requestId:row.request_id,store:verification,provider:verifier,readCustody:()=>provider.readCustody(row)});
 provider.verifyCandidate=row=>verifyCloudCandidate(context(row));
 provider.reconcileVerification=row=>reconcileCloudVerification(context(row));
 const topics={work:'factory-production-work-v1',recovery:'factory-production-recovery-v1'};
 const control=new CloudWorkControl({store,spend,provider,queue,signing,sourceDigest,deploymentId:env.VERCEL_DEPLOYMENT_ID,
  ownerScope:installation.ownerScope,grant:productionSourceGrant,configuration:productionConfiguration,
  executionSpendPlan:productionSpendPlan,executionWorkTopic:topics.work,verificationPolicy});
 return{store,spend,provider,queue,control,verification,topics,clientId:productionSourceGrant.clientId};
}
