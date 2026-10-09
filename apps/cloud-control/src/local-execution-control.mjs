import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {randomUUID} from 'node:crypto';
import {localExecutionProvider} from './local-execution-provider.mjs';
import {PostgresDispatchStore} from './postgres-dispatch.mjs';
import {PostgresSpendLedger} from './postgres-spend.mjs';
import {PostgresVerificationStore} from './postgres-verification.mjs';
import {CloudWorkControl} from './cloud-work-control.mjs';
import {executeCloudWork,reconcileCloudWork} from './cloud-work-lifecycle.mjs';
import {verifyCloudCandidate,reconcileCloudVerification} from './cloud-verification.mjs';
import {localSourceIdentity} from './local-source-identity.mjs';
import {validateLocalHostQualification} from '../../../packages/hosted-routing/src/local-provenance.ts';
export async function createLocalFactory(f,pool,assertAuthority,scheduleRecovery,queue) {
 if(typeof assertAuthority!=='function'||typeof scheduleRecovery!=='function'||typeof queue?.send!=='function')throw Error('LOCAL_CONTROL_AUTHORITY_REQUIRED');
 f={...f,...structuredClone({request:f.request,configuration:f.configuration,policy:f.policy,executionBinding:f.executionBinding,hostQualification:f.hostQualification})};
 if(f.sourceDigest!==localSourceIdentity(f.root))throw Error('LOCAL_SOURCE_IDENTITY_CHANGED');
 if(!f.hostQualification||digest(f.hostQualification)!==f.configuration.local.hostQualificationSha256)throw Error('LOCAL_HOST_NOT_QUALIFIED');
 validateLocalHostQualification(f.configuration.local,f.hostQualification);
 const p=await localExecutionProvider({...f,custodyRoot:f.temp,assertAuthority});
 const store=new PostgresDispatchStore(pool,{strictWriterFence:true,requireVerifierPass:true,verificationPolicySha256:digest(f.policy),
  assertAuthority:async(_client,input)=>{if(digest(input)!==digest(f.request))throw Error('EXACT_REQUEST_DENIED');await assertAuthority();},
  assertRecordScope:async(_client,row)=>{if(row.snapshot.version!==3||canonicalBinding(row.snapshot.localBinding)!==canonicalBinding(f.executionBinding))throw Error('CROSS_OWNER_DENIED');}});
 const spend=new PostgresSpendLedger(pool,{assertPaidAuthority:async()=>{throw Error('LOCAL_PAID_EXECUTION_UNSUPPORTED');}});
 const verification=new PostgresVerificationStore(store,{policy:f.policy,policySha256:digest(f.policy)});
 const verifyOptions=row=>({clientId:row.client_id,requestId:row.request_id,store:verification,provider:p.verifier,readCustody:()=>p.provider.readCustody(row)});
 p.provider.verifyCandidate=row=>verifyCloudCandidate(verifyOptions(row));
 p.provider.reconcileVerification=row=>reconcileCloudVerification(verifyOptions(row));
 const spendPlan={version:'WORK_LEDGER_V2',pricingRevision:'deterministic-no-paid-v1',model:'fixture/deterministic',validUntil:f.request.deadline,perOperationReserveMicrousd:1,plannedProductiveOperations:1,plannedCompletionOperations:1,maxPaidOperations:2,completionReserveMicrousd:1};
 const control=new CloudWorkControl({store,spend,provider:p.provider,queue,signing:f.signing,sourceDigest:f.sourceDigest,deploymentId:'dpl_localqualification',ownerScope:f.executionBinding.ownerScope,
  grant:{clientId:'missioncontrol-local',source:f.request.source,commands:f.request.input.checkCommands,allowedPaths:f.request.input.allowedPaths,maxDurationMs:180000,maxSpendUsd:0.00008},
  configuration:f.configuration,executionBinding:f.executionBinding,executionSpendPlan:spendPlan,verificationPolicy:{policy:f.policy,policySha256:digest(f.policy)}});
 return{...p,store,spend,verification,control,
  identity(prepared){return{workId:f.request.workId,workGeneration:1,dispatchIdentity:randomUUID(),requestId:f.request.requestId,workOrderId:prepared.workOrderId,remoteRunId:prepared.runId,runId:randomUUID(),writerGeneration:1,repository:f.request.repository,baseSha:f.request.source.commit,allowedPaths:f.request.input.allowedPaths,deadline:f.request.deadline,factoryId:f.signing.factoryId,factoryVersion:digest({sourceDigest:f.sourceDigest,configurationDigest:digest(f.configuration)})};},
  execute:identity=>executeCloudWork(store,p.provider,'missioncontrol-local',identity,scheduleRecovery),
  reconcile:()=>reconcileCloudWork(store,p.provider,'missioncontrol-local',f.request.requestId)};
}
const canonicalBinding=digest;
