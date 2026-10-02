import {Sandbox} from '@vercel/sandbox';
import {noReplayFetch,infrastructureProvider} from './infrastructure-provider.mjs';
import {cloudVerifierPolicy,cloudVerifierPolicySha256,cloudVerifierProbe} from './cloud-verifier-policy.mjs';
import {stagingProjectId} from './config.mjs';
import {canonical} from '../../../packages/hosted-routing/src/result.ts';
const signal=()=>AbortSignal.timeout(10000);
// Root bounds the child process and its output, but never imports candidate code.
// Expected values remain exclusively in the Factory control plane.
const boundedProbe=`const cp=require('node:child_process');if(process.getuid()!==0)throw Error('VERIFIER_CONTROL_IDENTITY');const uid=Number(cp.execFileSync('id',['-u','factoryverifier'],{encoding:'utf8'}).trim()),gid=Number(cp.execFileSync('id',['-g','factoryverifier'],{encoding:'utf8'}).trim());if(uid<1000||!Number.isInteger(uid)||!Number.isInteger(gid))throw Error('VERIFIER_IDENTITY');const r=cp.spawnSync('node',['--input-type=module','-e',${JSON.stringify(cloudVerifierProbe)},process.argv[1]],{cwd:'/opt/candidate',uid,gid,timeout:1500,maxBuffer:4096,encoding:'utf8',env:{PATH:process.env.PATH,HOME:'/home/factoryverifier',TMPDIR:'/tmp',LANG:'C',CI:'1'}});process.stdout.write(JSON.stringify({exitCode:r.status,error:!!r.error||!!r.signal,stdout:r.stdout?.slice(0,4096)??''}));`;
export function cloudVerifierProvider(){return{
 async allocate(resource){
  const remaining=new Date(resource.deadline).getTime()-Date.now();
  if(resource.provider_name!=='factory-verify-'+resource.run_id||resource.image!==cloudVerifierPolicy.image||resource.policy_sha256!==cloudVerifierPolicySha256||remaining<5000)throw Error('VERIFIER_RESOURCE_BINDING');
  return Sandbox.create({name:resource.provider_name,image:resource.image,persistent:false,region:'iad1',failoverRegions:[],resources:{vcpus:1},timeout:Math.min(45000,remaining),ports:[],env:{},networkPolicy:'deny-all',tags:{purpose:'factory-independent-verifier',run:resource.run_id,project:stagingProjectId},fetch:noReplayFetch(),signal:AbortSignal.timeout(20000)});
 },
 async verify(sandbox,bundle,assertActive){
  if(sandbox.image!==cloudVerifierPolicy.image)throw Error('VERIFIER_IMAGE_MISMATCH');
  await sandbox.createUser('factoryverifier',{signal:signal()});
  // The producer sandbox is already gone. Only custody-validated exact candidate
  // bytes enter this new resource; no repository hooks, Git checkout or token.
  await sandbox.asUser('root').writeFiles(Object.entries(bundle.files).map(([path,text])=>({path:'/opt/candidate/'+path,content:text,mode:0o444})),{signal:signal()});
  const checks=[];
  for(const check of cloudVerifierPolicy.checks){
   await assertActive();
   const command=await sandbox.asUser('root').runCommand({cmd:'node',args:['-e',boundedProbe,JSON.stringify(check.input)],timeoutMs:3000,signal:signal()});
   if(command.exitCode!==0)throw Error('VERIFIER_CONTROL_FAILED');
   const text=await command.stdout({signal:signal()});if(text.length>10000)throw Error('VERIFIER_OUTPUT_BOUND');
   const report=JSON.parse(text);let actual;try{actual=JSON.parse(report.stdout);}catch{}
   checks.push({id:check.id,result:!report.error&&report.exitCode===0&&actual&&canonical(actual)===canonical(check.expected)?'PASS':'FAIL'});
  }
  return checks;
 },
 destroy:(resource,sandbox)=>infrastructureProvider().destroy(resource.provider_name,sandbox),
};}
