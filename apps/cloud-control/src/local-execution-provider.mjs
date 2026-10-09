import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir,writeFile,open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {digest,sha256,canonical} from '../../../packages/hosted-routing/src/result.ts';
import {validateCandidateBundle} from './candidate-custody.mjs';
import {deterministicWorkerScript,cloudSource} from './cloud-work-plan.mjs';
import {cloudVerifierProbe} from './cloud-verifier-policy.mjs';
import {validateLocalConfiguration,validateLocalBinding} from '../../../packages/hosted-routing/src/local-provenance.ts';

const exec=promisify(execFile);
export const localPolicy=Object.freeze({version:1,network:'none',user:'1000:1000',rootFilesystem:'read-only',capabilities:[],noNewPrivileges:true,seccomp:'docker-default',pidNamespace:'private',ipc:'private',hostMounts:false,ports:false,memoryMb:256,pids:64,vcpus:1,swapMb:256,timeoutMs:180000,tmpfsMb:96});
export const localPolicySha256=digest(localPolicy);
export const localHarnessSha256=sha256(deterministicWorkerScript);
export async function docker(args,options={}) {
 const result=await exec('docker',args,{env:{PATH:process.env.PATH,HOME:process.env.HOME},timeout:30000,maxBuffer:512000,...options});
 return result.stdout.trim();
}
export async function observeLocalRuntime(image) {
 if(!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(image))throw Error('LOCAL_IMAGE_NOT_PINNED');
 const info=JSON.parse(await docker(['info','--format','{{json .}}']));
 const img=JSON.parse(await docker(['image','inspect',image]))[0];
 if(info.OSType!=='linux'||img.Os!=='linux'||!img.RepoDigests.includes(image)||Object.keys(img.Config.Volumes??{}).length)throw Error('LOCAL_RUNTIME_UNSUPPORTED');
 const runtime={engine:info.ServerVersion,kernel:info.KernelVersion,architecture:info.Architecture,os:info.OperatingSystem,
  securityOptions:info.SecurityOptions,imageId:img.Id,image,architectureImage:img.Architecture};
 if(!runtime.securityOptions.some(v=>v.startsWith('name=seccomp')))throw Error('LOCAL_SECCOMP_REQUIRED');
 return{runtime,runtimeSha256:digest(runtime)};
}
export async function localExecutionProvider({configuration,executionBinding,request,sourceBundle,custodyRoot,policy,assertAuthority}) {
 configuration=structuredClone(configuration);executionBinding=structuredClone(executionBinding);request=structuredClone(request);policy=structuredClone(policy);
 validateLocalConfiguration(configuration);validateLocalBinding(executionBinding);
 const l=configuration.local;
 if(!l||l.provider!=='local-docker'||l.policySha256!==localPolicySha256||l.harnessSha256!==localHarnessSha256
  ||canonical(request.source)!==canonical(cloudSource)||l.verificationPolicySha256!==digest(policy)||configuration.executor!=='deterministic-qualification'
  ||executionBinding.repository!==request.repository||executionBinding.sourceSnapshotSha256!==digest(request.source)
  ||l.implementationSha256!==sha256(await readFile(new URL(import.meta.url))))throw Error('LOCAL_PROVIDER_NEGOTIATION_DENIED');
 const observed=await observeLocalRuntime(l.image);
 if(observed.runtimeSha256!==l.runtimeSha256||configuration.architecture!==(observed.runtime.architectureImage==='amd64'?'x64':'arm64'))throw Error('LOCAL_RUNTIME_CHANGED');
 const ownerDigest=digest(executionBinding.ownerScope),bindingDigest=executionBinding.delegationDigest;
 const evidence={producerAllocations:0,verifierAllocations:0,productiveExecutions:0,containers:[],runtime:observed.runtime,policy:localPolicy};
 const label='factory.local.binding';
 async function inspect(id) {
  try{return JSON.parse(await docker(['inspect',id]))[0];}
  catch(e){if(/No such (object|container)/i.test(e.stderr??''))return null;throw e;}
 }
 function validate(info,resource) {
  const h=info?.HostConfig;
  if(!h||info.Config.Labels?.[label]!==bindingDigest||info.Config.Labels?.['factory.local.owner']!==ownerDigest
   ||info.Config.Labels?.['factory.local.run']!==resource.run_id||info.Image!==observed.runtime.imageId||info.Config.User!=='1000:1000'
   ||h.NetworkMode!=='none'||!h.ReadonlyRootfs||h.Privileged||h.CapAdd?.length||!h.CapDrop?.includes('ALL')
   ||!h.SecurityOpt?.includes('no-new-privileges')||h.SecurityOpt?.some(x=>x.includes('unconfined'))
   ||h.PidsLimit!==64||h.Memory!==268435456||h.MemorySwap!==268435456||h.NanoCpus!==1000000000
   ||h.PidMode||h.IpcMode!=='private'||info.Mounts.some(m=>m.Type!=='tmpfs')||Object.keys(h.PortBindings??{}).length)throw Error('LOCAL_ALLOCATION_PROVENANCE_DENIED');
 }
 async function current(s) {const i=await inspect(s.id);validate(i,s.resource);return i;}
 async function allocate(resource,kind) {
  await assertAuthority();
  if((await observeLocalRuntime(l.image)).runtimeSha256!==l.runtimeSha256)throw Error('LOCAL_RUNTIME_CHANGED');
  if(!/^[a-f0-9-]{36}$/.test(resource.run_id)||resource.provider_name!==(kind==='producer'?'factory-run-':'factory-verify-')+resource.run_id)throw Error('LOCAL_ALLOCATION_IDENTITY');
  const remaining=Math.min(l.resources.timeoutMs,new Date(resource.deadline).getTime()-Date.now());
  if(remaining<5000)throw Error('LOCAL_EXECUTION_EXPIRED');
  const id=await docker(['run','-d','--pull=never','--name',resource.provider_name,'--label',`${label}=${bindingDigest}`,'--label',`factory.local.owner=${ownerDigest}`,'--label',`factory.local.run=${resource.run_id}`,
   '--network=none','--read-only','--user=1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=256m','--memory-swap=256m','--cpus=1','--ipc=private','--log-driver=none',
   '--tmpfs','/home:rw,nosuid,nodev,size=64m,mode=1777','--tmpfs','/opt:rw,nosuid,nodev,size=16m,mode=1777','--tmpfs','/tmp:rw,nosuid,nodev,size=16m,mode=1777',
   '--entrypoint','sleep',l.image,String(Math.ceil(remaining/1000))]);
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('LOCAL_ALLOCATION_UNKNOWN');
  const s={id,resource,currentSession:()=>({sessionId:'sbx_'+id})};
  await current(s);evidence[kind+'Allocations']++;evidence.containers.push({id,runId:resource.run_id,kind});return s;
 }
 async function node(s,code,args=[],cwd='/tmp') {
  await current(s);
  return docker(['exec','--workdir',cwd,s.id,'env','-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/home/factoryproducer','node','--input-type=commonjs','-e',"if(process.versions.node.split('.')[0]!=='24')throw Error('LOCAL_NODE_RUNTIME');"+code,...args]);
 }
 async function destroy(resource,sandbox) {
  const id=sandbox?.id??resource.provider_session_id?.replace(/^sbx_/,'')??resource.provider_name;
  const info=await inspect(id);
  if(info){validate(info,resource);await docker(['rm','-f',info.Id]);}
  if(await inspect(id))throw Error('LOCAL_CLEANUP_UNKNOWN');
  captured.delete(id);
 }
 const dirFor=async row=>{if(!/^[a-f0-9-]{36}$/.test(row.run_id))throw Error('LOCAL_RUN_IDENTITY');const path=join(custodyRoot,ownerDigest,row.run_id);await mkdir(path,{recursive:true,mode:0o700});return path;};
 async function boundedRead(path){const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await file.stat();if(!stat.isFile()||stat.size>256000)throw Error('LOCAL_CUSTODY_BOUND');return await file.readFile();}finally{await file.close();}}
 const captured=new Map();
 const provider={
  allocate:r=>allocate(r,'producer'),
  async materialize(s,note){
   await node(s,"require('node:fs').mkdirSync('/home/factoryproducer',{recursive:true})");
   if(!(await lstat(sourceBundle)).isFile())throw Error('LOCAL_SOURCE_BUNDLE');
   const bundle=await readFile(sourceBundle);if(bundle.length>256000)throw Error('LOCAL_SOURCE_BOUND');
   await node(s,"require('node:fs').writeFileSync('/home/source.bundle',Buffer.from(process.argv[1],'base64'),{flag:'wx',mode:0o400})",[bundle.toString('base64')]);
   await node(s,`const cp=require('node:child_process');cp.execFileSync('git',['clone','-q','/home/source.bundle','/home/factoryproducer/workspace']);cp.execFileSync('git',['checkout','--detach',${JSON.stringify(request.source.commit)}],{cwd:'/home/factoryproducer/workspace'});`);
   await note({localExecution:{runtimeSha256:l.runtimeSha256,policySha256:l.policySha256,hostQualificationSha256:l.hostQualificationSha256}});
   return request.source;
  },
  async execute(s){await assertAuthority();evidence.productiveExecutions++;return JSON.parse(await node(s,deterministicWorkerScript,[],'/home/factoryproducer/workspace'));},
  async quiesce(s){
   const encoded=await node(s,"const fs=require('node:fs');const fd=fs.openSync('/home/factoryproducer/candidate.json',fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>256000)throw Error('ARTIFACT_BOUND');process.stdout.write(fs.readFileSync(fd).toString('base64'));fs.closeSync(fd);");
   captured.set(s.id,Buffer.from(encoded,'base64'));
   await docker(['pause',s.id]);if(!(await current(s)).State.Paused)throw Error('LOCAL_QUIESCENCE_UNKNOWN');return{paused:true};
  },
  async collect(s,row,manifest){
   const info=await current(s);if(!info.State.Paused)throw Error('LOCAL_COLLECTION_BEFORE_QUIESCENCE');
   const dir=await dirFor(row),bytes=captured.get(s.id);
   if(!bytes)throw Error('LOCAL_CAPTURE_UNAVAILABLE');
   const v=validateCandidateBundle(bytes,row.request);
   if(manifest.sha256!==v.sha256||manifest.bytes!==v.bytes)throw Error('LOCAL_CUSTODY_DIGEST');
   await writeFile(join(dir,v.sha256+'.json'),bytes,{flag:'wx',mode:0o400});
   return{bundle:v.bundle,receipt:{commit:v.commit,tree:v.tree,sha256:v.sha256,bytes:v.bytes,pathname:`factory/staging/runs/${row.run_id}/${v.sha256}.json`}};
  },
  async readCustody(row){
   if(row.snapshot.localBinding?.ownerScope!==executionBinding.ownerScope||row.snapshot.localBinding?.delegationDigest!==bindingDigest)throw Error('LOCAL_CROSS_OWNER_DENIED');
   const c=row.custody;if(!c||!/^[a-f0-9]{64}$/.test(c.artifact_sha256))throw Error('LOCAL_CUSTODY_MISSING');
   const v=validateCandidateBundle(await boundedRead(join(await dirFor(row),c.artifact_sha256+'.json')),row.request);
   if(v.sha256!==c.artifact_sha256||v.bytes!==c.artifact_bytes||v.commit!==c.candidate_commit||v.tree!==c.candidate_tree)throw Error('LOCAL_CUSTODY_SUBSTITUTION');return v.bundle;
  },destroy,
 };
 const verifier={allocate:r=>allocate(r,'verifier'),destroy,
  async verify(s,bundle,active){
   await current(s);
   await docker(['exec','--user','0:0',s.id,'env','-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp','node','--input-type=commonjs','-e',
    `const fs=require('node:fs'),p=require('node:path');for(const [path,text] of Object.entries(${JSON.stringify(bundle.files)})){const name='/opt/candidate/'+path;fs.mkdirSync(p.dirname(name),{recursive:true,mode:0o755});fs.writeFileSync(name,text,{flag:'wx',mode:0o444});}`]);
   const checks=[];
   for(const [index,c] of policy.checks.entries()){await active();let actual;try{await current(s);actual=JSON.parse(await docker(['exec','--user',`${1100+index}:${1100+index}`,s.id,'env','-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp','node','--input-type=module','-e',cloudVerifierProbe,JSON.stringify(c.input)],{timeout:3000,maxBuffer:4096}));}catch{throw Error('VERIFIER_EXECUTION_UNKNOWN');}
    checks.push({id:c.id,result:actual&&canonical(actual)===canonical(c.expected)?'PASS':'FAIL'});
   }return checks;
  },
 };
 return{provider,verifier,evidence,node,inspect,validate};
}
