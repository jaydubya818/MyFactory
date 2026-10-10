import { Sandbox } from '@vercel/sandbox';
import {exactSandboxSession} from './exact-sandbox-session.mjs';
import { put,get } from '@vercel/blob';
import { custodyStoreId,stagingProjectId } from './config.mjs';
import { noReplayFetch,boundedBytes,infrastructureProvider } from './infrastructure-provider.mjs';
import { qualifiedImage } from './infrastructure-plan.mjs';
import { sourceMaterializationScript,quiescenceScript } from './cloud-work-plan.mjs';
import { validateCandidateBundle,validateCustodyReadback } from './candidate-custody.mjs';

import {installCloudHarness} from './cloud-harness-phase.mjs';
import {executeCloudHarness} from './cloud-harness-executor.mjs';
import {qualificationCheckpointPlan} from './cloud-harness-checkpoint.mjs';
import {assertPrivateSnapshotReceipt} from './external-alpha-snapshots.mjs';
import {bindPrivateSource,materializePrivateSourceInSandbox,privateSourceNetworkPolicy,validateSnapshotBytes,bindVerifierSource} from './private-source.mjs';

/* privateSource (optional, separate mode): {binding,registry?,snapshot:{bytes,sha256}}. The producer
 * receives only the digest-verified snapshot bytes; GitHub is never reachable from it. When absent the
 * existing public-source behavior (used by canary/synthetic qualification) is byte-for-byte unchanged. */
export function cloudWorkProvider({ledger,plan=qualificationCheckpointPlan,projectId=stagingProjectId,custodyStore=custodyStoreId,custodyPrefix='factory/staging',providerOptions=async()=>({}),blobOptions=async()=>({}),modelProviderForRow,privateSource,sandboxApi=Sandbox,blobPut=put,blobGet=get}) {
 const privateEntry=privateSource?bindPrivateSource(privateSource.binding,privateSource.registry):undefined;
 let prepared;
 if(privateEntry&&(plan.source?.repository!==`${privateEntry.owner}/${privateEntry.repo}`||plan.source?.commit!==privateEntry.commit||plan.source?.tree!==privateEntry.tree))throw Error('PRIVATE_SOURCE_BINDING');
 if(privateSource?.receipt)assertPrivateSnapshotReceipt(privateEntry,privateSource.receipt);
 const sdk={fetch:noReplayFetch()},signal=()=>AbortSignal.timeout(15000);
 return {
  ...(privateEntry?{async prepareSource(row,note=async()=>{}){
   if(row?.request?.source?.repository!==plan.source.repository||row.request.source.commit!==privateEntry.commit||row.request.source.tree!==privateEntry.tree)throw Error('PRIVATE_SOURCE_BINDING');
   const read=privateSource.custody?await privateSource.custody.read(privateEntry,privateSource.receipt):privateSource.snapshot;
   if(!read)throw Error('PRIVATE_SOURCE_CUSTODY_UNAVAILABLE');
   const expected=privateSource.receipt?.sha256??read.sha256;
   if(!/^[a-f0-9]{64}$/.test(expected??'')||(privateSource.receipt&&read.bytes?.length!==privateSource.receipt.bytes))throw Error('PRIVATE_SOURCE_CUSTODY_BINDING');
   const v=validateSnapshotBytes(read.bytes,privateEntry,expected);
   prepared={bytes:read.bytes,sha256:v.sha256};
   await note({privateSourceReceipt:privateSource.receipt??{sha256:v.sha256,bytes:read.bytes.length},privateSourceCommit:privateEntry.commit,privateSourceTree:privateEntry.tree});
  }}:{}),
  async allocate(resource){
   if(privateEntry&&!prepared)throw Error('PRIVATE_SOURCE_CUSTODY_UNAVAILABLE');
   const remaining=Math.min(180000,new Date(resource.deadline).getTime()-Date.now());
   if(!Number.isSafeInteger(remaining)||remaining<30000||resource.provider_name!==`factory-run-${resource.run_id}`)throw Error('RESOURCE_ENVELOPE');
   const sandbox=await sandboxApi.create({name:resource.provider_name,image:qualifiedImage,persistent:false,region:'iad1',failoverRegions:[],resources:{vcpus:1},timeout:remaining,ports:[],env:{},networkPolicy:privateEntry?{allow:[...privateSourceNetworkPolicy.allow]}:{allow:['github.com','registry.npmjs.org']},tags:{purpose:'factory-canonical-work',run:resource.run_id,project:projectId},...(await providerOptions()),...sdk,signal:AbortSignal.timeout(30000)});
   return privateEntry?exactSandboxSession(sandbox):sandbox;
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
    const snapshot=prepared??privateSource.snapshot;
    if(!snapshot)throw Error('PRIVATE_SOURCE_CUSTODY_UNAVAILABLE');
    report=await materializePrivateSourceInSandbox(sandbox,{snapshotBytes:snapshot.bytes,sha256:snapshot.sha256,entry:privateEntry,user,...(privateSource.home?{home:privateSource.home}:{})});
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
   await blobPut(pathname,bytes,{access:'private',storeId:custodyStore,...(await blobOptions()),addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',abortSignal:signal()});
   const saved=await blobGet(pathname,{access:'private',storeId:custodyStore,...(await blobOptions()),useCache:false,abortSignal:signal()});
   await validateCustodyReadback(saved,{bytes:bytes.length,sha256:validated.sha256});
   return{receipt:{commit:validated.commit,tree:validated.tree,sha256:validated.sha256,bytes:bytes.length,pathname},bundle:validated.bundle};
  },
  async readCustody(row){
   const c=row.custody;
   if(!c||c.artifact_path!==`${custodyPrefix}/runs/${row.run_id}/${c.artifact_sha256}.json`)throw Error('CUSTODY_MISSING');
   const saved=await blobGet(c.artifact_path,{access:'private',storeId:custodyStore,...(await blobOptions()),useCache:false,abortSignal:signal()});
   if(saved?.statusCode!==200)throw Error('CUSTODY_UNAVAILABLE');
   const bytes=await boundedBytes(saved.stream),v=validateCandidateBundle(bytes,row.request);
   if(v.sha256!==c.artifact_sha256||v.bytes!==c.artifact_bytes||v.commit!==c.candidate_commit||v.tree!==c.candidate_tree)throw Error('CUSTODY_CHANGED');
   if(privateEntry){
    if(!privateSource.custody||!privateSource.receipt)throw Error('PRIVATE_SOURCE_CUSTODY_UNAVAILABLE');
    if(row.resource?.evidence?.privateSourceReceipt?.sha256!==privateSource.receipt.sha256)throw Error('PRIVATE_SOURCE_CUSTODY_BINDING');
    await bindVerifierSource({binding:privateSource.binding,registry:privateSource.registry,custody:privateSource.custody,receipt:privateSource.receipt,candidate:v.bundle});
   }
   return v.bundle;
  },
  destroy:(resource,sandbox)=>infrastructureProvider({providerOptions,sandboxApi}).destroy(resource.provider_name,sandbox),
 };
}
