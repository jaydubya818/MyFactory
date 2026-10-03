import {cloudSource,allowedPaths,checkCommand} from './cloud-work-plan.mjs';

export const harnessQuiescenceScript=`
const cp=require('node:child_process'),fs=require('node:fs');
if(process.getuid()!==0)throw Error('CONTROL_IDENTITY_REQUIRED');
const uid=Number(cp.execFileSync('id',['-u','factoryproducer'],{encoding:'utf8'}).trim());if(!Number.isInteger(uid)||uid<1000)throw Error('PRODUCER_UID_MISMATCH');
for(let attempt=0;attempt<8;attempt++){
 let alive=0;for(const pid of fs.readdirSync('/proc')){if(!/^[0-9]+$/.test(pid))continue;
 try{const status=fs.readFileSync('/proc/'+pid+'/status','utf8');if(Number(/^Uid:\\s+(\\d+)/m.exec(status)?.[1])===uid&&!/^State:\\s+Z/m.test(status)){alive++;process.kill(Number(pid),'SIGKILL');}}catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}}
 if(!alive){process.stdout.write(JSON.stringify({uid,quiescent:true}));process.exit(0);}
 cp.execFileSync('sleep',['0.05']);
}throw Error('PRODUCER_NOT_QUIESCENT');
`;

// Implementation-visible checks, never protected verification. Git and tests run
// without root, network or host credentials. Custody validation is performed
// independently by the host against the immutable admitted source and scope.
export function checkpointScript({source,allowedPaths,checkCommand,testPath,commitMessage,authorName,authorEmail}){
 return `
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
if(process.getuid()===0)throw Error('CHECKPOINT_IDENTITY');
const env={PATH:process.env.PATH,HOME:process.env.HOME,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:${JSON.stringify(authorName)},GIT_AUTHOR_EMAIL:${JSON.stringify(authorEmail)},GIT_COMMITTER_NAME:${JSON.stringify(authorName)},GIT_COMMITTER_EMAIL:${JSON.stringify(authorEmail)}};
const git=args=>cp.execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{env,maxBuffer:256000,timeout:10000});
const text=args=>git(args).toString().trim();
const base=${JSON.stringify(source.commit)};
if(text(['rev-parse','HEAD'])!==base||text(['rev-parse','HEAD^{tree}'])!==${JSON.stringify(source.tree)})throw Error('SOURCE_CHANGED');
git(['add','--all']);const tree=text(['write-tree']);
const changed=text(['diff','--no-ext-diff','--no-textconv','--name-only',base,tree]).split('\\n').filter(Boolean);
if(!changed.length||changed.some(path=>!${JSON.stringify(allowedPaths)}.includes(path)))throw Error('CANDIDATE_SCOPE');
const filesAt=ref=>Object.fromEntries(text(['ls-tree','-r','--name-only',ref]).split('\\n').map(path=>[path,git(['show',ref+':'+path]).toString('utf8')]));
const sourceFiles=filesAt(base),files=filesAt(tree);
const startedAt=new Date().toISOString(),check=cp.spawnSync('node',['--test',${JSON.stringify(testPath)}],{env,encoding:'utf8',timeout:15000,maxBuffer:64000}),finishedAt=new Date().toISOString();
if(check.error||check.signal||!Number.isInteger(check.status))throw Error('CHECK_INDETERMINATE');
git(['add','--all']);if(text(['write-tree'])!==tree||text(['rev-parse','HEAD'])!==base)throw Error('CHECK_MUTATED_TREE');
const commit=text(['commit-tree',tree,'-p',base,'-m',${JSON.stringify(commitMessage)}]);
const bundle={version:1,base,commit,tree,sourceFiles,files,commitBase64:git(['cat-file','commit',commit]).toString('base64'),treeBase64:git(['cat-file','tree',tree]).toString('base64'),patchBase64:git(['diff','--binary','--no-ext-diff','--no-textconv',base,commit]).toString('base64'),checks:[{command:${JSON.stringify(checkCommand)},exitCode:check.status,startedAt,finishedAt,log:check.stdout+check.stderr}]};
const bytes=Buffer.from(JSON.stringify(bundle));if(bytes.length>256000)throw Error('ARTIFACT_BOUND');
// A fresh phase path is provided by trusted argv; no model-selected destination.
const phase=process.argv[1];if(!/^[1-2]$/.test(phase))throw Error('CHECKPOINT_PHASE');
fs.writeFileSync('/home/factoryproducer/checkpoint-'+phase+'.json',bytes,{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify({sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,tree,passed:check.status===0}));
`;

}
export const qualificationCheckpointPlan={source:cloudSource,allowedPaths,checkCommand,testPath:'fixtures/cloud-work/project-slug/slug.test.mjs',commitMessage:'Implement bounded project slug',authorName:'Factory staging',authorEmail:'staging@invalid'};
export const harnessCheckpointScript=checkpointScript(qualificationCheckpointPlan);

export function unchangedCandidateScript(tree,source=cloudSource){
 if(!/^[a-f0-9]{40}$/.test(tree))throw Error('CANDIDATE_TREE');
 return `const cp=require('node:child_process');if(process.getuid()===0)throw Error('PRODUCER_IDENTITY');const git=args=>cp.execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{encoding:'utf8',timeout:10000,maxBuffer:256000}).trim();git(['add','--all']);if(git(['write-tree'])!==${JSON.stringify(tree)}||git(['rev-parse','HEAD'])!==${JSON.stringify(source.commit)})throw Error('COMPLETION_MUTATED_TREE');process.stdout.write('UNCHANGED');`;
}
