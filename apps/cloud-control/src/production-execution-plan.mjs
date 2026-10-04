import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {cloudHarnessIdentity,cloudCodexPackage} from './cloud-harness-plan.mjs';
import {productionModelPrice} from './production-model-provider.mjs';
import {productionCanarySource,productionCanaryPath,productionVerifierPolicy,productionVerifierPolicySha256} from './production-verifier-policy.mjs';

export const productionCheckpointPlan=Object.freeze({production:true,source:productionCanarySource,
 allowedPaths:[productionCanaryPath],testPath:'fixtures/production-canary/line-endings/normalize.test.mjs',
 checkCommand:'node --test fixtures/production-canary/line-endings/normalize.test.mjs',
 commitMessage:'Implement bounded line-ending normalization',authorName:'MyFactory production',authorEmail:'factory-production@invalid'});
const perOperationReserveMicrousd=Math.ceil(productionModelPrice.contextLimitTokens*productionModelPrice.inputMicrousdPerMillion/1000000)+Math.ceil(productionModelPrice.outputLimitTokens*productionModelPrice.outputMicrousdPerMillion/1000000);
export const productionSpendPlan=Object.freeze({version:'WORK_LEDGER_V2',pricingRevision:productionModelPrice.revision,
 model:productionModelPrice.model,validUntil:productionModelPrice.validUntil,perOperationReserveMicrousd,
 plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:perOperationReserveMicrousd});

// Explicit production pins reuse the accepted existing harness boundary only.
// Qualification grants, source, pricing and protected inputs are not inherited.
export const productionConfiguration=Object.freeze({model:productionModelPrice.model,executor:cloudHarnessIdentity.id,
 executorVersion:cloudHarnessIdentity.version,skillRevision:'none',workerProfile:'container',
 verificationImage:productionVerifierPolicy.image,nodeVersion:'v24.19.0',platform:'linux',architecture:'x64',
 commands:[productionCheckpointPlan.checkCommand],allowedPaths:productionCheckpointPlan.allowedPaths,timeoutMs:180000,
 cloud:{provider:'vercel-sandbox',providerVersion:'3.5.1',region:'iad1',workerImage:productionVerifierPolicy.image,
  networkPolicy:'deny-all-after-pinned-harness-and-source-v1',
  toolPolicySha256:digest({allowedPaths:productionCheckpointPlan.allowedPaths,command:productionCheckpointPlan.checkCommand,executor:cloudHarnessIdentity.id,packageIntegrity:cloudCodexPackage.integrity}),
  contextPolicySha256:digest({source:productionCanarySource,ownerData:false}),verificationPolicySha256:productionVerifierPolicySha256,
  evidenceClass:'LIVE',resources:{vcpus:1,memoryMb:2048,timeoutMs:180000,maxArtifactBytes:256000},skills:[]}});

export const productionExecutionContract=Object.freeze({version:1,status:'AWAITING_COMPOSED_QUALIFICATION',
 source:productionCanarySource,objective:'Implement normalizeLineEndings: primitive strings only; CRLF and lone CR become LF; preserve all other characters; reject non-strings.',
 configuration:productionConfiguration,spendPlan:productionSpendPlan,
 maxDurationMs:180000,maxSpendMicrousd:1000000,candidateAttempts:1,
 publication:false,merge:false,deployGeneratedCandidate:false,
 resultRequirements:['signed-exact-candidate','protected-verification','TestEvidence','DiffEvidence','durable-MyEve-Proof','producer-and-verifier-cleanup']});
export const productionExecutionContractSha256=digest(productionExecutionContract);
export const productionSourceGrant=Object.freeze({clientId:'sofie-production',source:productionCanarySource,
 commands:[productionCheckpointPlan.checkCommand],allowedPaths:productionCheckpointPlan.allowedPaths,
 maxDurationMs:productionExecutionContract.maxDurationMs,maxSpendUsd:productionExecutionContract.maxSpendMicrousd/1000000});
