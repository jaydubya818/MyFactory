import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {verifyAlphaTask,loadHiddenSuite,attestationValid,policySha256 as acceptancePolicySha256,HIDDEN_SUITE_SHA256,productionRunnerIds} from '../../supervisor/src/alpha-task-verifier.ts';
import {protectedAlphaProvider} from './protected-alpha-provider.mjs';
import {productionVerifierPolicy} from './production-verifier-policy.mjs';

/*
 * Gate 3 in the cloud: the Alpha Tasks independent acceptance policy as the PROTECTED verifier of the Factory's own
 * verification slot (PostgresVerificationStore + verifyCloudCandidate). The producer sandbox is already destroyed when
 * this runs; only custody-validated exact candidate bytes reach it. The verdict is mapped fail-closed:
 *   PASS    -> [{id, result:'PASS'}]   (the only value that can ever reach COMPLETED)
 *   FAIL    -> [{id, result:'FAIL'}]
 *   PARTIAL -> throws VERIFIER_PARTIAL (the store records outcome UNKNOWN; the Run is FAILED, never accepted)
 * Everything unsupported, unattested or unproven is PARTIAL. In particular the production path REQUIRES a host-built
 * isolation attestation for an allow-listed runner (see docs/private-alpha/external-alpha-verifier-isolation.md).
 */
export const alphaTasksCheckId='alpha-tasks-acceptance';
export const alphaTasksVerificationPolicy=Object.freeze({version:1,id:'alpha-tasks-priority-acceptance-v1',image:productionVerifierPolicy.image,timeoutMs:90000,network:'deny-all',
 acceptancePolicySha256,hiddenSuiteSha256:HIDDEN_SUITE_SHA256,runnerId:productionRunnerIds[0],checks:Object.freeze([Object.freeze({id:alphaTasksCheckId,expected:Object.freeze({verdict:'PASS'})})])});
export const alphaTasksVerificationPolicySha256=digest(alphaTasksVerificationPolicy);
/** The only effects the host grants a private-source Work; no other effect path exists in the sandbox. */
export const hostGrantedEffects=Object.freeze(['PRIVATE_SOURCE_READ','PRIVATE_SNAPSHOT_CUSTODY_WRITE','CANDIDATE_CUSTODY_WRITE']);

const unavailable=()=>{throw Error('VERIFIER_PARTIAL');};

/**
 * Dependencies are injected by the production composition:
 *   runnerFor(sandbox)            -> VerifierRunner whose id is allow-listed (productionRunnerIds)
 *   attestationFor(sandbox,runner)-> IsolationAttestation built by the HOST from the allocated, read-back sandbox
 *   loadHidden()                  -> HiddenSuite from private custody (digest-pinned; never in the sandbox filesystem)
 * Any dependency that is absent makes verification PARTIAL. Nothing here has a default that could pass.
 */
export function alphaTasksVerifierProvider({installation,hostInstallation,providerOptions,sandboxApi,productionProfile,runnerFor,attestationFor,loadHidden=loadHiddenSuite,verify=verifyAlphaTask}={}){
 const base=hostInstallation?protectedAlphaProvider({policy:alphaTasksVerificationPolicy,policySha256:alphaTasksVerificationPolicySha256,projectId:hostInstallation.projectId,providerOptions,sandboxApi}):undefined;
 runnerFor??=base?.runnerFor;attestationFor??=base?.attestationFor;
 let runId,deadline;
 return {
  async allocate(resource){
   if(!base)unavailable();
   runId=resource.run_id;
   deadline=Date.parse(resource.deadline);
   return base.allocate(resource);
  },
  async verify(sandbox,bundle,assertActive){
   if(!installation||!runId||typeof runnerFor!=='function'||typeof attestationFor!=='function'||typeof loadHidden!=='function')unavailable();
   await assertActive();
   const hidden=await loadHidden().catch(()=>unavailable());
   const runner=runnerFor(sandbox);
   if(!runner)unavailable();
   const isolationAttestation=await attestationFor(sandbox,runner).catch(()=>undefined);
   if(!attestationValid(isolationAttestation,runner))unavailable();
   const report=await verify({mode:'production',productionProfile,isolationAttestation,runner,hidden,
    // Identities come from the Factory's pinned installation and the custody row, never from the producer.
    source:{commit:installation.source.baseSha,tree:installation.source.treeSha,files:bundle.sourceFiles},
    candidate:{commit:bundle.commit,tree:bundle.tree,parent:bundle.base,files:bundle.files},
    expected:{sourceCommit:installation.source.baseSha,sourceTree:installation.source.treeSha,candidateCommit:bundle.commit,candidateTree:bundle.tree},
    producer:{environmentId:'factory-run-'+runId},verifier:{environmentId:'factory-verify-'+runId},observedEffects:[...hostGrantedEffects],limits:{runMs:Math.min(80000,deadline-Date.now())}});
   await assertActive();
   if(report.verdict==='PARTIAL')unavailable();
   if(report.hiddenSuiteSha256!==alphaTasksVerificationPolicy.hiddenSuiteSha256||report.policySha256!==alphaTasksVerificationPolicy.acceptancePolicySha256)unavailable();
   return [{id:alphaTasksCheckId,result:report.verdict==='PASS'?'PASS':'FAIL'}];
  },
  destroy:(resource,sandbox)=>{if(!base)unavailable();return base.destroy(resource,sandbox);},
 };
}
