import {cloudHarnessIdentity,cloudCodexPackage} from './cloud-harness-plan.mjs';
import { qualifiedImage } from './infrastructure-plan.mjs';
import { digest } from '../../../packages/hosted-routing/src/result.ts';
import {cloudVerifierPolicySha256} from './cloud-verifier-policy.mjs';
export const cloudSource=Object.freeze({repository:'jaydubya818/MyFactory',commit:'5cd13fa1f307a0c0f42f6317d966bb3179ad77c9',tree:'1084844b1454165358e51248afe8676f96daf17c'});
export const allowedPaths=['fixtures/cloud-work/project-slug/slug.mjs'];
export const checkCommand='node --test fixtures/cloud-work/project-slug/slug.test.mjs';
export const cloudGrant=Object.freeze({clientId:'sofie-cloud-qualification',source:cloudSource,commands:[checkCommand],allowedPaths,maxDurationMs:180000,maxSpendUsd:1});
export const deterministicSolution=`export function projectSlug(value) {
  if (typeof value !== 'string' || !value.trim() || !/^[A-Za-z0-9\\s-]+$/.test(value)) {
    throw new Error('Invalid project name');
  }
  return value.trim().toLowerCase().replace(/\\s+/g, '-');
}
`;
export const cloudConfiguration=Object.freeze({model:cloudHarnessIdentity.model,executor:cloudHarnessIdentity.id,executorVersion:cloudHarnessIdentity.version,skillRevision:'none',workerProfile:'container',verificationImage:qualifiedImage,nodeVersion:'v24.19.0',platform:'linux',architecture:'x64',commands:[checkCommand],allowedPaths,timeoutMs:180000,
 cloud:{provider:'vercel-sandbox',providerVersion:'3.5.1',region:'iad1',workerImage:qualifiedImage,networkPolicy:'deny-all-after-pinned-harness-and-source-v1',toolPolicySha256:digest({allowedPaths,command:checkCommand,executor:cloudHarnessIdentity.id,packageIntegrity:cloudCodexPackage.integrity}),contextPolicySha256:digest({source:cloudSource,ownerData:false}),verificationPolicySha256:cloudVerifierPolicySha256,evidenceClass:'DETERMINISTIC',resources:{vcpus:1,memoryMb:2048,timeoutMs:180000,maxArtifactBytes:256000},skills:[]}});

export const materializationScript=`
const fs=require('node:fs'),cp=require('node:child_process');
const cwd='/home/factoryproducer/workspace';fs.mkdirSync(cwd,{mode:0o755});
const git=args=>cp.execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,encoding:'utf8',timeout:20000,maxBuffer:256000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
git(['init','-q']);git(['fetch','--depth=1',${JSON.stringify('https://github.com/'+cloudSource.repository+'.git')},${JSON.stringify(cloudSource.commit)}]);git(['checkout','--detach','FETCH_HEAD']);
if(git(['rev-parse','HEAD'])!==${JSON.stringify(cloudSource.commit)}||git(['rev-parse','HEAD^{tree}'])!==${JSON.stringify(cloudSource.tree)}||git(['status','--porcelain']))throw Error('SOURCE_MISMATCH');
process.stdout.write(JSON.stringify({commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}'])}));
`;

// No model or caller-authored program. This fixed executor qualifies canonical
// cloud mechanics first; it is not the Codex harness or protected verifier.
export const deterministicWorkerScript=`
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
if(process.getuid()===0||Object.keys(process.env).some(k=>/TOKEN|SECRET|PASSWORD|DATABASE_URL|PRIVATE_KEY/.test(k)))throw Error('WORKER_IDENTITY_BOUNDARY');
const env={PATH:process.env.PATH,HOME:process.env.HOME,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Factory staging',GIT_AUTHOR_EMAIL:'staging@invalid',GIT_COMMITTER_NAME:'Factory staging',GIT_COMMITTER_EMAIL:'staging@invalid'};
const git=args=>cp.execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{env,maxBuffer:256000,timeout:10000});
const ref=expression=>git(['rev-parse',expression]).toString().trim();
const base=ref('HEAD');if(base!==${JSON.stringify(cloudSource.commit)}||ref('HEAD^{tree}')!==${JSON.stringify(cloudSource.tree)})throw Error('SOURCE_MISMATCH');
const filesAt=commit=>Object.fromEntries(git(['ls-tree','-r','--name-only',commit]).toString().trim().split('\\n').map(path=>[path,git(['show',commit+':'+path]).toString('utf8')]));
const sourceFiles=filesAt(base);
fs.writeFileSync(${JSON.stringify(allowedPaths[0])},${JSON.stringify(deterministicSolution)});
git(['add','--',${JSON.stringify(allowedPaths[0])}]);git(['commit','-qm','Implement bounded project slug']);
const commit=ref('HEAD'),tree=ref('HEAD^{tree}');
const startedAt=new Date().toISOString();const result=cp.spawnSync('node',['--test','fixtures/cloud-work/project-slug/slug.test.mjs'],{env,encoding:'utf8',timeout:30000,maxBuffer:64000});
const finishedAt=new Date().toISOString();if(result.error||result.signal||!Number.isInteger(result.status))throw Error('CHECK_INDETERMINATE');
if(git(['status','--porcelain']).length||ref('HEAD')!==commit||ref('HEAD^{tree}')!==tree)throw Error('CHECK_MUTATED_CANDIDATE');
const bundle={version:1,base,commit,tree,sourceFiles,files:filesAt(commit),commitBase64:git(['cat-file','commit',commit]).toString('base64'),treeBase64:git(['cat-file','tree',tree]).toString('base64'),patchBase64:git(['show','--format=','--binary','--no-ext-diff','--no-textconv',commit]).toString('base64'),checks:[{command:${JSON.stringify(checkCommand)},exitCode:result.status,startedAt,finishedAt,log:result.stdout+result.stderr}]};
const bytes=Buffer.from(JSON.stringify(bundle));if(bytes.length>256000)throw Error('ARTIFACT_BOUND');fs.writeFileSync('/home/factoryproducer/candidate.json',bytes,{flag:'wx',mode:0o644});
process.stdout.write(JSON.stringify({sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}));
`;

export const quiescenceScript=`
const cp=require('node:child_process'),fs=require('node:fs');
if(process.getuid()!==0)throw Error('CONTROL_IDENTITY_REQUIRED');
const uid=Number(cp.execFileSync('id',['-u','factoryproducer'],{encoding:'utf8'}).trim());if(!Number.isInteger(uid)||uid<1000)throw Error('PRODUCER_UID_MISMATCH');
for(const entry of fs.readdirSync('/proc')){
 if(!/^[0-9]+$/.test(entry))continue;
 try{const status=fs.readFileSync('/proc/'+entry+'/status','utf8');if(Number(/^Uid:\\s+(\\d+)/m.exec(status)?.[1])===uid)process.kill(Number(entry),'SIGKILL');}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
}
for(let attempt=0;attempt<5;attempt++){
 let alive=0;
 for(const entry of fs.readdirSync('/proc')){
  if(!/^[0-9]+$/.test(entry))continue;
  try{const status=fs.readFileSync('/proc/'+entry+'/status','utf8');if(Number(/^Uid:\\s+(\\d+)/m.exec(status)?.[1])===uid&&!/^State:\\s+Z/m.test(status)){alive++;process.kill(Number(entry),'SIGKILL');}}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
 }
 if(!alive)break;if(attempt===4)throw Error('PRODUCER_NOT_QUIESCENT');cp.execFileSync('sleep',['0.05']);
}
const artifact=fs.lstatSync('/home/factoryproducer/candidate.json');if(!artifact.isFile()||artifact.isSymbolicLink()||artifact.size>256000)throw Error('ARTIFACT_TYPE');
process.stdout.write(JSON.stringify({uid,signal:'SIGKILL',artifactBytes:artifact.size}));
`;
