import { createPublicKey } from 'node:crypto';
import { digest,sha256,operationId,signResult,RESULT_PROTOCOL } from '../../../packages/hosted-routing/src/result.ts';
import {cloudVerifierPolicySha256,cloudVerifierPolicy} from './cloud-verifier-policy.mjs';

export function resultSigning(env) {
 if(!env.FACTORY_RESULT_SIGNING_JSON)throw Error('STAGING_RESULT_KEY_MISSING');
 const config=JSON.parse(env.FACTORY_RESULT_SIGNING_JSON);
 if(Object.keys(config).sort().join(',')!=='factoryId,key,privateKey'||config.factoryId!=='myfactory-cloud-staging'||config.key?.factoryId!==config.factoryId||config.key?.keyId!=='staging-cloud-v1')throw Error('STAGING_RESULT_KEY_BINDING');
 const key=createPublicKey(config.privateKey),expected=createPublicKey(config.key.publicKey);
 if(key.asymmetricKeyType!=='ed25519'||!key.export({type:'spki',format:'der'}).equals(expected.export({type:'spki',format:'der'}))||config.key.revokedAt||config.key.retiredAt||Date.now()<Date.parse(config.key.activeFrom)||Date.now()>Date.parse(config.key.notAfter))throw Error('STAGING_RESULT_KEY_INVALID');
 return config;
}
export function cloudResult(row,bundle,signing) {
 const terminal=row.events.find(e=>e.type==='factory.terminal')?.payload;
 if(!terminal)throw Error('TERMINAL_RESULT_NOT_READY');
 const execution=row.snapshot,artifacts=[];
 const manifest={protocol:RESULT_PROTOCOL,keyId:signing.key.keyId,producer:execution.factoryId,operationId:operationId(execution),execution,status:terminal.status,candidate:null,evidence:[],artifacts:[],evidenceDigest:'',artifactDigest:'',completedAt:terminal.finishedAt,issuedAt:terminal.finishedAt};
 if(bundle){
  if(bundle.commit!==terminal.candidateCommit||bundle.base!==execution.inputCommit)throw Error('RESULT_CUSTODY_MISMATCH');
  const add=(id,kind,bytes)=>{
   manifest.artifacts.push({id,kind,producer:execution.factoryId,runId:row.run_id,candidateCommit:bundle.commit,sha256:sha256(bytes),size:bytes.length,createdAt:terminal.finishedAt});
   artifacts.push({id,base64:bytes.toString('base64')});
  };
  add('candidate.commit','git-commit',Buffer.from(bundle.commitBase64,'base64'));add('candidate.tree','git-tree',Buffer.from(bundle.treeBase64,'base64'));add('candidate.patch','patch',Buffer.from(bundle.patchBase64,'base64'));
  manifest.candidate={commit:bundle.commit,tree:bundle.tree,base:bundle.base,patchDigest:sha256(Buffer.from(bundle.patchBase64,'base64')),commitArtifactId:'candidate.commit',treeArtifactId:'candidate.tree',patchArtifactId:'candidate.patch'};
  for(const [index,c] of bundle.checks.entries()){
   const logArtifactId=`check.${index}.log`;add(logArtifactId,'check-log',Buffer.from(c.log));
   manifest.evidence.push({id:`check.${index}`,producer:execution.factoryId,runId:row.run_id,candidateCommit:bundle.commit,command:c.command,status:c.exitCode===0?'passed':'failed',exitCode:c.exitCode,startedAt:c.startedAt,finishedAt:c.finishedAt,logArtifactId});
  }
  const v=row.verification;
  if(execution.configuration.cloud?.verificationPolicySha256===cloudVerifierPolicySha256&&terminal.status==='COMPLETED'&&!v)throw Error('VERIFIER_RESULT_REQUIRED');
  if(v){
   if(!v.cleanup_confirmed||v.run_id!==row.run_id||v.candidate_commit!==bundle.commit||v.candidate_tree!==bundle.tree||v.custody_sha256!==row.custody.artifact_sha256||v.policy_sha256!==execution.configuration.cloud?.verificationPolicySha256||v.policy_sha256!==cloudVerifierPolicySha256||v.image!==cloudVerifierPolicy.image)throw Error('VERIFIER_RESULT_BINDING');
   const at=value=>new Date(value).toISOString();
   const report={version:1,kind:'INDEPENDENT_CLOUD_VERIFICATION',runId:row.run_id,workId:row.work_id,workGeneration:row.work_generation,candidateCommit:v.candidate_commit,candidateTree:v.candidate_tree,custodySha256:v.custody_sha256,policySha256:v.policy_sha256,image:v.image,providerSessionId:v.provider_session_id,producerSessionId:row.resource.provider_session_id,cleanupConfirmed:true,outcome:v.outcome,checks:v.checks,startedAt:at(v.created_at),finishedAt:at(v.updated_at)};
   if(report.providerSessionId===report.producerSessionId)throw Error('VERIFIER_ISOLATION_BINDING');
   // Independent verification is signed in the canonical Result, separately
   // from producer-visible checks. No protected inputs or expected values.
   manifest.verification=report;
  }
 }else if(terminal.candidateCommit)throw Error('RESULT_CUSTODY_REQUIRED');
 manifest.evidenceDigest=digest(manifest.evidence);manifest.artifactDigest=digest(manifest.artifacts);
 return signResult(manifest,artifacts,signing.privateKey);
}
