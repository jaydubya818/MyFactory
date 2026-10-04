import {createHash} from 'node:crypto';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {productionConfiguration,productionCheckpointPlan,productionSourceGrant} from './production-execution-plan.mjs';
// Reviewed operator input. No model, generated candidate or completion claim.
export const validationCandidate="export function normalizeLineEndings(value) {\n  if (typeof value !== 'string') throw new TypeError('Expected a string');\n  return value.replace(/\\r\\n?/g, '\\n');\n}\n";
export const validationCandidateSha256=createHash('sha256').update(validationCandidate).digest('hex');
export const validationCheckpointPlan={...productionCheckpointPlan,commitMessage:'Operator-authored production evidence validation',authorName:'MyFactory release operator',authorEmail:'release-validation@invalid'};
export const validationConfiguration={...productionConfiguration,model:'none',executor:'operator-authored-candidate-validation',executorVersion:'1',
 cloud:{...productionConfiguration.cloud,evidenceClass:'DETERMINISTIC',networkPolicy:'deny-all-after-pinned-source-v1',
 toolPolicySha256:digest({candidateSha256:validationCandidateSha256,command:validationCheckpointPlan.checkCommand,model:false})}};
export const validationContract={version:1,mode:'OPERATOR_DETERMINISTIC_VALIDATION',candidateSha256:validationCandidateSha256,
 configuration:validationConfiguration,source:validationCheckpointPlan.source,modelOperations:0,candidateAttempts:1,publication:false};
export const validationContractSha256=digest(validationContract);
export const validationSourceGrant={...productionSourceGrant,clientId:'sofie-production-validation'};
