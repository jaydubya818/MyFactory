import {boundedBytes} from './infrastructure-provider.mjs';
import {sourceMaterializationScript} from './cloud-work-plan.mjs';
import {checkpointScript} from './cloud-harness-checkpoint.mjs';
import {validateCandidateBundle} from './candidate-custody.mjs';
import {validationCandidate,validationCandidateSha256,validationCheckpointPlan as plan,validationConfiguration} from './production-validation-plan.mjs';
import {createHash} from 'node:crypto';

/** Reuse the production lifecycle, sandbox, custody and verifier. Replace only
 * the model phase with the exact reviewed operator input and real checks.
 * No harness, model transport, credentials or protected answers enter here. */
export function operatorValidationProvider(provider){
 return {...provider,
  async materialize(sandbox){
   if(sandbox.image!==validationConfiguration.cloud.workerImage)throw Error('IMAGE_MISMATCH');
   const user=await sandbox.createUser('factoryproducer',{signal:AbortSignal.timeout(15000)});
   const done=await user.runCommand({cmd:'node',args:['-e',sourceMaterializationScript(plan.source)],timeoutMs:30000,signal:AbortSignal.timeout(35000)});
   if(done.exitCode!==0)throw Error('SOURCE_MATERIALIZATION_FAILED');
   const report=JSON.parse(await done.stdout({signal:AbortSignal.timeout(15000)}));
   if(report.commit!==plan.source.commit||report.tree!==plan.source.tree)throw Error('SOURCE_MISMATCH');
   await sandbox.updateNetworkPolicy('deny-all',{signal:AbortSignal.timeout(15000)});return report;
  },
  async execute(sandbox,recordCommand,row,recordEvidence){
   const user=sandbox.asUser('factoryproducer');
   if(createHash('sha256').update(validationCandidate).digest('hex')!==validationCandidateSha256)throw Error('VALIDATION_CANDIDATE_CHANGED');
   await user.writeFiles([{path:'/home/factoryproducer/workspace/'+plan.allowedPaths[0],content:Buffer.from(validationCandidate),mode:0o600}],{signal:AbortSignal.timeout(15000)});
   const command=await user.runCommand({cmd:'node',args:['-e',checkpointScript(plan),'1'],cwd:'/home/factoryproducer/workspace',timeoutMs:25000,signal:AbortSignal.timeout(30000)});
   if(command.exitCode!==0)throw Error('VALIDATION_CHECKPOINT_FAILED');
   const bytes=await boundedBytes(await user.readFile({path:'/home/factoryproducer/checkpoint-1.json'},{signal:AbortSignal.timeout(15000)}));
   const candidate=validateCandidateBundle(bytes,row.request);
   if(candidate.bundle.files[plan.allowedPaths[0]]!==validationCandidate)throw Error('VALIDATION_CANDIDATE_CHANGED');
   await user.writeFiles([{path:'/home/factoryproducer/candidate.json',content:bytes,mode:0o600}],{signal:AbortSignal.timeout(15000)});
   await recordEvidence({validationMode:'OPERATOR_DETERMINISTIC_VALIDATION',candidateInputSha256:validationCandidateSha256,modelOperations:0,paidModelOperations:0,completion:'NOT_APPLICABLE'});
   return {sha256:candidate.sha256,bytes:candidate.bytes};
  },
 };
}
