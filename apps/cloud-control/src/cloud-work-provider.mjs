import { Sandbox } from '@vercel/sandbox';
import { put,get } from '@vercel/blob';
import { custodyStoreId,stagingProjectId } from './config.mjs';
import { noReplayFetch,boundedBytes,infrastructureProvider } from './infrastructure-provider.mjs';
import { qualifiedImage } from './infrastructure-plan.mjs';
import { sourceMaterializationScript,quiescenceScript } from './cloud-work-plan.mjs';
import { validateCandidateBundle,validateCustodyReadback } from './candidate-custody.mjs';

import {installCloudHarness} from './cloud-harness-phase.mjs';
import {executeCloudHarness} from './cloud-harness-executor.mjs';
import {qualificationCheckpointPlan} from './cloud-harness-checkpoint.mjs';
import {bindPrivateSource,materializePrivateSourceInSandbox,privateSourceNetworkPolicy} from './private-source.mjs';

/* privateSource (optional, separate mode): {binding,registry?,snapshot:{bytes,sha256}}. The producer
 * receives only the digest-verified snapshot bytes; GitHub is never reachable from it. When absent the
 * existing public-source behavior (used by canary/synthetic qualification) is byte-for-byte unchanged. */
export function cloudWorkProvider({ledger,plan=qualificationCheckpointPlan,projectId=stagingProjectId,custodyStore=custodyStoreId,custodyPrefix='factory/staging',providerOptions=async()=>({}),blobOptions=async()=>({}),modelProviderForRow,privateSource}) {
 const privateEntry=privateSource?bindPrivateSource(privateSource.binding,privateSource.registry):undefined;
 const sdk={fetch:noReplayFetch()},signal=()=>AbortSignal.timeout(15000);
 return {
  async allocate(resource){
   const remaining=Math.min(180000,new Date(resource.deadline).getTime()-Date.now());
   if(!Number.isSafeInteger(remaining)||remaining<30000||resource.provider_name!==`factory-run-${resource.run_id}`)throw Error('RESOURCE_ENVELOPE');
   return Sandbox.create({name:resource.provider_name,image:qualifiedImage,persistent:false,region:'iad1',failoverRegions:[],resources:{vcpus:1},timeout:remaining,ports:[],env:{},networkPolicy:privateEntry?{allow:[...privateSourceNetworkPolicy.allow]}:{allow:['github.com','registry.npmjs.org']},tags:{purpose:'factory-canonical-work',run:resource.run_id,project:projectId},...(await providerOptions()),...sdk,signal:AbortSignal.timeout(30000)});
  },
  async materialize(sandbox,record=async()=>{}){
   await record({startupStage:'SANDBOX_READINESS'});
   if(sandbox.image!==qualifiedImage)throw Error('IMAGE_MISMATCH');
   await record({startupStage:'HARNESS_INSTALLATION'});
   const harness=await installCloudHarness(sandbox);
   await record({startupStage:'SOURCE_MATERIALIZATION'});
   const user=await sandbox.createUser('factoryproducer',{signal:signal()});
   let report;
   if(privateEntry){
    // Bounded snapshot only; the plan source must be this exact binding, never the public canary source.
    if(plan.source?.commit!==privateEntry.commit||plan.source?.tree!==privateEntry.tree)throw Error('SOURCE_MISMATCH');
    report=await materializePrivateSourceInSandbox(sandbox,{snapshotBytes:privateSource.snapshot.bytes,sha256:privateSource.snapshot.sha256,entry:privateEntry,user,...(privateSource.home?{home:privateSource.home}:{})});
   }else{
   const done=await user.runCommand({cmd:'node',args:['-e',sourceMaterializationScript(plan.source)],timeoutMs:30000,signal:AbortSignal.timeout(35000)});
   if(done.exitCode!==0)throw Error('SOURCE_MATERIALIZATION_FAILED');
   report=JSON.parse(await done.stdout({signal:signal()}));
   }
   if(report.commit!==plan.source.commit||report.tree!==plan.source.tree)throw Error('SOURCE_MISMATCH');
   await sandbox.updateNetworkPolicy('deny-all',{signal:signal()});
   await record({startupStage:'SOURCE_READY'});return {...report,harness};
  },
  async execute(sandbox,recordCommand,row,recordEvidence){
   await recordEvidence({startupStage:'MODEL_TRANSPORT_INITIALIZATION'});
   const modelProvider=modelProviderForRow?.(row);
   return executeCloudHarness({sandbox,row,ledger,recordCommand,recordEvidence,plan,modelProvider});
  },
  async quiesce(sandbox){
   const done=await sandbox.asUser('root').runCommand({cmd:'node',args:['-e',quiescenceScript],timeoutMs:5000,signal:signal()});
   if(done.exitCode!==0)throw Error('PRODUCER_NOT_QUIESCENT');
   return JSON.parse(await done.stdout({signal:signal()}));
  },
  async collect(sandbox,row,manifest){
   const bytes=await boundedBytes(await sandbox.readFile({path:'/home/factoryproducer/candidate.json'},{signal:signal()}));
   const validated=validateCandidateBundle(bytes,row.request);
   if(manifest.sha256!==validated.sha256||manifest.bytes!==bytes.length)throw Error('WORKER_MANIFEST_MISMATCH');
   const pathname=`${custodyPrefix}/runs/${row.run_id}/${validated.sha256}.json`;
   await put(pathname,bytes,{access:'private',storeId:custodyStore,...(await blobOptions()),addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',abortSignal:signal()});
   const saved=await get(pathname,{access:'private',storeId:custodyStore,...(await blobOptions()),useCache:false,abortSignal:signal()});
   await validateCustodyReadback(saved,{bytes:bytes.length,sha256:validated.sha256});
   return{receipt:{commit:validated.commit,tree:validated.tree,sha256:validated.sha256,bytes:bytes.length,pathname},bundle:validated.bundle};
  },
  async readCustody(row){
   const c=row.custody;
   if(!c||c.artifact_path!==`${custodyPrefix}/runs/${row.run_id}/${c.artifact_sha256}.json`)throw Error('CUSTODY_MISSING');
   const saved=await get(c.artifact_path,{access:'private',storeId:custodyStore,...(await blobOptions()),useCache:false,abortSignal:signal()});
   if(saved?.statusCode!==200)throw Error('CUSTODY_UNAVAILABLE');
   const bytes=await boundedBytes(saved.stream),v=validateCandidateBundle(bytes,row.request);
   if(v.sha256!==c.artifact_sha256||v.bytes!==c.artifact_bytes||v.commit!==c.candidate_commit||v.tree!==c.candidate_tree)throw Error('CUSTODY_CHANGED');return v.bundle;
  },
  destroy:(resource,sandbox)=>infrastructureProvider({providerOptions}).destroy(resource.provider_name,sandbox),
 };
}
