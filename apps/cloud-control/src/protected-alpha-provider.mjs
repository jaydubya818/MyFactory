import {Sandbox} from '@vercel/sandbox';
import {noReplayFetch} from './infrastructure-provider.mjs';
import {protectedSandboxRunner} from './protected-alpha-runner.mjs';

export async function verifierCredentials(providerOptions){
 const options=await providerOptions();
 if(!options||Object.keys(options).some(k=>!['token','projectId','teamId'].includes(k))||Object.values(options).some(v=>typeof v!=='string'||!v))throw Error('VERIFIER_CREDENTIAL_SCOPE');
 return options;
}
/** External alpha has a dedicated allocator/destructor; canary and synthetic resource policies stay unchanged. */
export function protectedAlphaProvider({policy,policySha256,projectId,providerOptions=async()=>({}),sandboxApi=Sandbox}={}){
 const runners=new WeakMap(),fetch=noReplayFetch();
 const read=async name=>sandboxApi.get({name,resume:false,...await verifierCredentials(providerOptions),fetch,signal:AbortSignal.timeout(10000)});
 return {
  async allocate(resource){
   const remaining=Date.parse(resource.deadline)-Date.now();
   if(resource.provider_name!=='factory-verify-'+resource.run_id||resource.image!==policy.image||resource.policy_sha256!==policySha256||remaining<5000)throw Error('VERIFIER_RESOURCE_BINDING');
   const sandbox=await sandboxApi.create({name:resource.provider_name,image:policy.image,persistent:false,region:'iad1',failoverRegions:[],resources:{vcpus:1},timeout:Math.min(policy.timeoutMs,remaining),ports:[],env:{},networkPolicy:'deny-all',tags:{purpose:'factory-independent-verifier',run:resource.run_id,project:projectId},...await verifierCredentials(providerOptions),fetch,signal:AbortSignal.timeout(Math.min(20000,remaining))});
   if(sandbox.name!==resource.provider_name||sandbox.image!==policy.image)throw Error('VERIFIER_RESOURCE_BINDING');
   runners.set(sandbox,protectedSandboxRunner(sandbox,{readSandbox:()=>read(resource.provider_name),deadline:Math.min(Date.parse(resource.deadline),Date.now()+policy.timeoutMs),image:policy.image}));
   return sandbox;
  },
  runnerFor:sandbox=>runners.get(sandbox),
  attestationFor:async(sandbox,runner)=>{if(runners.get(sandbox)!==runner)throw Error('VERIFIER_ISOLATION_UNPROVEN');return runner.attestation();},
  async destroy(resource,known){
   if(resource.provider_name!=='factory-verify-'+resource.run_id||resource.image!==policy.image||resource.policy_sha256!==policySha256)throw Error('VERIFIER_RESOURCE_BINDING');
   let sandbox=known;
   if(!sandbox){try{sandbox=await read(resource.provider_name);}catch(error){if(error.response?.status!==404)throw error;}}
   if(sandbox){
    if(sandbox.name!==resource.provider_name||sandbox.image!==policy.image||(resource.provider_session_id&&sandbox.currentSession().sessionId!==resource.provider_session_id))throw Error('VERIFIER_RESOURCE_BINDING');
    await sandbox.stop({signal:AbortSignal.timeout(10000)});
    await sandbox.delete({deleteOrphanSnapshots:true,signal:AbortSignal.timeout(10000)});
   }
   try{await read(resource.provider_name);}catch(error){if(error.response?.status===404)return;throw error;}
   throw Error('VERIFIER_CLEANUP_UNPROVEN');
  },
 };
}
