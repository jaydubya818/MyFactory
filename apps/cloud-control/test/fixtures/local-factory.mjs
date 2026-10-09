import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {digest,sha256} from '../../../../packages/hosted-routing/src/result.ts';
import {localSourceIdentity} from '../../src/local-source-identity.mjs';
import {localExecutionProvider,localPolicySha256,localHarnessSha256,observeLocalRuntime,docker} from '../../src/local-execution-provider.mjs';
import {cloudSource,allowedPaths,checkCommand} from '../../src/cloud-work-plan.mjs';
import {cloudVerifierPolicy} from '../../src/cloud-verifier-policy.mjs';
export const defaultImage='public.ecr.aws/docker/library/node@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0';
export async function localFixture(root,{image=defaultImage,sourceGit=process.env.MYFACTORY_FIXTURE_GIT}={}) {
 const temp=await mkdtemp(join(tmpdir(),'local-factory-qualification-'));
 const runtime=await observeLocalRuntime(image),sourceDigest=localSourceIdentity(root);
 const request={protocol:'MYFACTORY_EXECUTION_V2',requestId:randomUUID(),workId:randomUUID(),workGeneration:1,
  repository:cloudSource.repository,deadline:new Date(Date.now()+175000).toISOString(),maxSpendUsd:0.00008,source:cloudSource,
  input:{title:'Deterministic local provider',description:'Qualification only',kind:'feature',acceptanceCriteria:['Protected project slug behavior'],checkCommands:[checkCommand],allowedPaths}};
 const policy={...cloudVerifierPolicy,image};
 const configuration={model:'fixture/deterministic',executor:'deterministic-qualification',executorVersion:'1',skillRevision:'none',workerProfile:'container',verificationImage:image,
  nodeVersion:'24',platform:'linux',architecture:runtime.runtime.architectureImage==='amd64'?'x64':'arm64',commands:[checkCommand],allowedPaths,timeoutMs:180000,
  local:{provider:'local-docker',providerVersion:'1',implementationSha256:sha256(await readFile(join(root,'apps/cloud-control/src/local-execution-provider.mjs'))),
   runtimeSha256:runtime.runtimeSha256,hostQualificationSha256:digest({runtime:runtime.runtimeSha256,policy:localPolicySha256,status:'PENDING'}),
   image,policySha256:localPolicySha256,verificationPolicySha256:digest(policy),evidenceClass:'DETERMINISTIC',modelProvider:'none',harnessSha256:localHarnessSha256,
   resources:{vcpus:1,memoryMb:256,pids:64,timeoutMs:180000,maxArtifactBytes:256000}}};
 const sourceBundle=join(temp,'source.bundle');
 const fixtureGit=join(temp,'source.git');
 execFileSync('git',['init','--bare',fixtureGit],{stdio:'pipe'});
 execFileSync('git',[`--git-dir=${fixtureGit}`,'fetch','--no-tags',resolve(sourceGit),cloudSource.commit+':refs/heads/fixture'],{stdio:'pipe'});
 execFileSync('git',[`--git-dir=${fixtureGit}`,'bundle','create',sourceBundle,'refs/heads/fixture'],{stdio:'pipe'});
 const pair=generateKeyPairSync('ed25519'),now=Date.now();
 const signing={factoryId:'myfactory-local-qualification',privateKey:pair.privateKey,key:{factoryId:'myfactory-local-qualification',keyId:'ephemeral-local',publicKey:pair.publicKey.export({type:'spki',format:'pem'}),activeFrom:new Date(now-60000).toISOString(),notAfter:new Date(now+3600000).toISOString()}};
 const fixture={root,temp,runtime,request,configuration,sourceDigest,policy,sourceBundle,signing,
  executionBinding:{ownerScope:'fixture-owner',delegationDigest:'a'.repeat(64),repository:request.repository,sourceSnapshotSha256:digest(request.source)},
  version:()=>digest({sourceDigest,configurationDigest:digest(configuration)}),stop:()=>rm(temp,{recursive:true,force:true})};
 return fixture;
}
export async function qualifyHost(f) {
 const p=await localExecutionProvider({...f,custodyRoot:f.temp,assertAuthority:async()=>{}});
 const run_id=randomUUID(),resource={run_id,provider_name:'factory-run-'+run_id,deadline:f.request.deadline};
 const s=await p.provider.allocate(resource);
 try{
  const probe=JSON.parse(await p.node(s,`const fs=require('node:fs'),net=require('node:net');let rootDenied=false;try{fs.writeFileSync('/etc/local-provider-probe','x')}catch{rootDenied=true};const st=fs.readFileSync('/proc/self/status','utf8');const absent=['/var/run/docker.sock','/run/docker.sock','/Users','/host','/root/.aws','/opt/candidate'].every(p=>!fs.existsSync(p));const keys=Object.keys(process.env);const sock=net.connect({host:'1.1.1.1',port:443});const done=blocked=>{sock.destroy();process.stdout.write(JSON.stringify({uid:process.getuid(),rootDenied,absent,noCredentials:!keys.some(k=>/TOKEN|SECRET|PASSWORD|KEY|DATABASE/.test(k)),caps:/CapEff:\\s+0+\\n/.test(st),seccomp:/Seccomp:\\s+2\\n/.test(st),noNewPrivileges:/NoNewPrivs:\\s+1\\n/.test(st),networkBlocked:blocked}));};sock.on('connect',()=>done(false));sock.on('error',()=>done(true));sock.setTimeout(1000,()=>done(true));`));
  if(probe.uid!==1000||Object.entries(probe).some(([k,v])=>k!=='uid'&&v!==true))throw Error('LOCAL_HOST_QUALIFICATION_FAILED');
  if(await p.node(s,"let denied=false;try{process.kill(1,'SIGSTOP')}catch(e){denied=e.code==='EPERM'}process.stdout.write(String(denied));")!=='true')throw Error('LOCAL_DEADLINE_INIT_UNPROTECTED');
  const limits=JSON.parse(await p.node(s,`const fs=require('node:fs');const read=n=>fs.readFileSync('/sys/fs/cgroup/'+n,'utf8').trim();fs.writeFileSync('/tmp/owner-marker','qualification');require('node:child_process').spawn('sleep',['120'],{stdio:'ignore',detached:true}).unref();process.stdout.write(JSON.stringify({memory:read('memory.max'),pids:read('pids.max'),cpu:read('cpu.max'),swap:read('memory.swap.max')}));`));
  if(limits.memory!=='268435456'||limits.pids!=='64'||limits.swap!=='0'||limits.cpu.split(' ')[0]!==limits.cpu.split(' ')[1])throw Error('LOCAL_LIMITS_UNENFORCED');
  const peerRun=randomUUID(),peerResource={run_id:peerRun,provider_name:'factory-run-'+peerRun,deadline:f.request.deadline};
  const peer=await p.provider.allocate(peerResource);
  try{if(await p.node(peer,"process.stdout.write(String(!require('node:fs').existsSync('/tmp/owner-marker')))" )!=='true')throw Error('LOCAL_CROSS_WORK_LEAK');}
  finally{await p.provider.destroy(peerResource,peer);}
  await p.provider.destroy(resource,s);
  if(await p.inspect(s.id)||await p.inspect(peer.id))throw Error('LOCAL_PROCESS_TREE_CLEANUP_FAILED');
  Object.assign(probe,{resourceLimits:true,crossWorkFilesystem:true,processTreeCleanup:true,separatePidNamespace:true,deadlineInitProtected:true});
  f.hostQualification={runtimeSha256:f.runtime.runtimeSha256,policySha256:localPolicySha256,checks:probe};
  f.configuration.local.hostQualificationSha256=digest(f.hostQualification);
  return f.hostQualification;
 }finally{await p.provider.destroy(resource,s);}
}
import {createLocalFactory as createControl} from '../../src/local-execution-control.mjs';
export async function createLocalFactory(f,pool,assertAuthority) {
 const factory=await createControl(f,pool,assertAuthority,async(row,resource)=>factory.store.transaction(async client=>{
  await factory.store.event(client,row,'factory.recovery_scheduled',{runId:row.run_id,providerName:resource.provider_name,mode:'QUALIFICATION_READBACK'});
 }),{send:async()=>({messageId:'local-qualification'})});
 return factory;
}
