import { Sandbox } from '@vercel/sandbox';
import { put,get } from '@vercel/blob';
import { custodyStoreId,stagingProjectId } from './config.mjs';
import { noReplayFetch,boundedBytes,infrastructureProvider } from './infrastructure-provider.mjs';
import { qualifiedImage } from './infrastructure-plan.mjs';
import { cloudSource,materializationScript,deterministicWorkerScript,quiescenceScript } from './cloud-work-plan.mjs';
import { validateCandidateBundle } from './candidate-custody.mjs';
import { sha256 } from '../../../packages/hosted-routing/src/result.ts';

export function cloudWorkProvider() {
 const sdk={fetch:noReplayFetch()},signal=()=>AbortSignal.timeout(15000);
 return {
  async allocate(resource){
   const remaining=Math.min(120000,new Date(resource.deadline).getTime()-Date.now());
   if(!Number.isSafeInteger(remaining)||remaining<30000||resource.provider_name!==`factory-run-${resource.run_id}`)throw Error('RESOURCE_ENVELOPE');
   return Sandbox.create({name:resource.provider_name,image:qualifiedImage,persistent:false,region:'iad1',failoverRegions:[],resources:{vcpus:1},timeout:remaining,ports:[],env:{},networkPolicy:{allow:['github.com']},tags:{purpose:'factory-canonical-work',run:resource.run_id,project:stagingProjectId},...sdk,signal:AbortSignal.timeout(30000)});
  },
  async materialize(sandbox){
   if(sandbox.image!==qualifiedImage)throw Error('IMAGE_MISMATCH');
   const user=await sandbox.createUser('factoryproducer',{signal:signal()});
   const done=await user.runCommand({cmd:'node',args:['-e',materializationScript],timeoutMs:30000,signal:AbortSignal.timeout(35000)});
   if(done.exitCode!==0)throw Error('SOURCE_MATERIALIZATION_FAILED');
   const report=JSON.parse(await done.stdout({signal:signal()}));
   if(report.commit!==cloudSource.commit||report.tree!==cloudSource.tree)throw Error('SOURCE_MISMATCH');
   await sandbox.updateNetworkPolicy('deny-all',{signal:signal()});return report;
  },
  async execute(sandbox,recordCommand){
   const command=await sandbox.asUser('factoryproducer').runCommand({cmd:'node',args:['-e',deterministicWorkerScript],cwd:'/home/factoryproducer/workspace',timeoutMs:45000,detached:true,signal:signal()});
   await recordCommand(command.cmdId);
   const done=await command.wait({signal:AbortSignal.timeout(50000)});
   if(done.exitCode!==0)throw Error('WORKER_COMMAND_FAILED');
   const text=await done.stdout({signal:signal()});if(text.length>1000)throw Error('MANIFEST_BOUND');return JSON.parse(text);
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
   const pathname=`factory/staging/runs/${row.run_id}/${validated.sha256}.json`;
   await put(pathname,bytes,{access:'private',storeId:custodyStoreId,addRandomSuffix:false,allowOverwrite:false,contentType:'application/json',abortSignal:signal()});
   const saved=await get(pathname,{access:'private',storeId:custodyStoreId,useCache:false,abortSignal:signal()});
   if(saved?.statusCode!==200||saved.blob.size!==bytes.length||sha256(await boundedBytes(saved.stream))!==validated.sha256)throw Error('PRIVATE_CUSTODY_READBACK');
   return{receipt:{commit:validated.commit,tree:validated.tree,sha256:validated.sha256,bytes:bytes.length,pathname},bundle:validated.bundle};
  },
  async readCustody(row){
   const c=row.custody;
   if(!c||c.artifact_path!==`factory/staging/runs/${row.run_id}/${c.artifact_sha256}.json`)throw Error('CUSTODY_MISSING');
   const saved=await get(c.artifact_path,{access:'private',storeId:custodyStoreId,useCache:false,abortSignal:signal()});
   if(saved?.statusCode!==200)throw Error('CUSTODY_UNAVAILABLE');
   const bytes=await boundedBytes(saved.stream),v=validateCandidateBundle(bytes,row.request);
   if(v.sha256!==c.artifact_sha256||v.bytes!==c.artifact_bytes||v.commit!==c.candidate_commit||v.tree!==c.candidate_tree)throw Error('CUSTODY_CHANGED');return v.bundle;
  },
  destroy:(resource,sandbox)=>infrastructureProvider().destroy(resource.provider_name,sandbox),
 };
}
