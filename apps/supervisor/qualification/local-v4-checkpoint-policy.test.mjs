// Small ordinary owned text only. Synthetic workers/checkpoints and ephemeral
// fixture keys; no provider, protected test, paid Work or tester installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {LocalV4ServiceProducer} from '../src/service-producer.ts';
import {createLocalV4Preparation,bindLocalV4PreparationCapture} from '../src/local-v4-preparation.ts';
import {JobManager} from '../src/jobs.ts';
import {LocalExecutionProvider} from '../src/local-execution-provider.ts';

const GIT='/opt/homebrew/Cellar/git/2.48.1/bin/git',model='openai/gpt-5.4-mini';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function settled(f,run){
 const until=performance.now()+20000;while(f.jobs.activeRun(run.id)&&performance.now()<until)await sleep(5);
 assert.equal(f.jobs.activeRun(run.id),false,JSON.stringify(f.storage.getRun(run.id)));return f.storage.getRun(run.id);
}
function fixture(t){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'checkpoint-native-'))),repo=join(dir,'repo');mkdirSync(repo,{mode:0o700});
 const env={PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',GIT_EXEC_PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'};
 const git=(...args)=>execFileSync(GIT,['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-C',repo,...args],{env,timeout:10000,maxBuffer:1024*1024}).toString().trim();
 git('init','-q','--template=','--object-format=sha1');git('config','user.name','Public context fixture');git('config','user.email','fixture@example.invalid');
 writeFileSync(join(repo,'sample.txt'),'original\n');writeFileSync(join(repo,'README.md'),'public guide\n');writeFileSync(join(repo,'other.txt'),'inventory only\n');git('add','.');git('commit','-qm','Input');
 const inputCommit=git('rev-parse','HEAD'),inputTree=git('rev-parse','HEAD^{tree}'),storage=openStorage(join(dir,'factory.sqlite'));
 const created=storage.createWorkOrder({title:'Ordinary context qualification',description:'No protected acceptance or spend',kind:'feature',repositoryPath:repo,baseRef:inputCommit,acceptanceCriteria:['Preserve actual context identities'],reproductionCommand:null,expectedFailureText:null,checkCommands:['synthetic-check'],allowedPaths:['sample.txt','missing.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),pair=generateKeyPairSync('ed25519'),key={factoryId:'public-context-fixture',keyId:'ephemeral',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const service=new LocalV4ServiceProducer(storage,dir,{factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]});
 const preparation=createLocalV4Preparation(dir),bound=bindLocalV4PreparationCapture(preparation,service);
 const f={dir,repo,git,storage,work,inputCommit,inputTree,service,preparation,bound};
 t.after(async()=>{if(f.jobs)await f.jobs.close();storage.close();rmSync(dir,{recursive:true,force:true})});return f;
}
async function direct(f){
 await f.preparation.resolveCommit(f.repo,f.inputCommit);
 const workspacePath=await f.preparation.createTaskWorktree(f.repo,f.inputCommit,join(f.dir,'workspaces'));
 const initial=f.storage.createRun({workOrderId:f.work.id,workerProfile:'mac',inputCommit:f.inputCommit,workspacePath});
 f.bound.capture(f.work,initial,model,'synthetic-context');
 const run=f.storage.saveRun({...initial,state:'implementing'});f.storage.saveWorkOrder({...f.work,state:'implementing'});
 f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:'run.implementing',payload:{agentVersion:'synthetic-context'}});return run;
}

import {checkpointIdentity} from '../src/local-v4-checkpoint-policy.ts';
function frame(f,run){
 const result=f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:'run.agent_result',payload:{checkpointVersion:1,productiveStep:1,implementationEligible:true,status:'completed'}});
 const settlement=f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:'run.implementation_settled',payload:{checkpointVersion:1,productiveStep:1,agentResultEventId:result.id,...checkpointIdentity(run,f.bound.snapshot(run)),provenance:'TRUSTED_IN_PROCESS_CALLBACK_RETURNED'}});
 return {kind:'CAPTURE',productiveStep:1,agentResultEventId:result.id,settlementEventId:settlement.id};
}
function indexIdentity(run){
 const pointer=readFileSync(join(run.workspacePath,'.git'),'utf8'),admin=pointer.slice(8).trim(),index=join(admin,'index'),s=lstatSync(index);
 return {pointer,head:readFileSync(join(admin,'HEAD'),'utf8'),ino:s.ino,mode:s.mode,size:s.size,mtime:s.mtimeMs,ctime:s.ctimeMs,hash:createHash('sha256').update(readFileSync(index)).digest('hex')};
}
for(const variant of ['modify','create','delete'])test('actual typed checkpoint: ordinary '+variant+' preserves original index and exact source root',async t=>{
 const f=fixture(t),run=await direct(f),before=indexIdentity(run),phase=frame(f,run);
 if(variant==='modify')writeFileSync(join(run.workspacePath,'sample.txt'),'ordinary checkpoint edit\n');
 if(variant==='create')writeFileSync(join(run.workspacePath,'missing.txt'),'ordinary new file\n');
 if(variant==='delete')unlinkSync(join(run.workspacePath,'sample.txt'));
 const result=await f.bound.checkpoint(run,phase);
 assert.match(result.tree,/^[a-f0-9]{40}$/);assert.notEqual(result.tree,f.inputTree);
 assert.deepEqual(result.changedPaths,[variant==='create'?'missing.txt':'sample.txt']);
 const names=f.git('ls-tree','-r','--name-only',result.tree).split('\n');
 assert.deepEqual(names.sort(),(variant==='create'?['README.md','missing.txt','other.txt','sample.txt']:variant==='delete'?['README.md','other.txt']:['README.md','other.txt','sample.txt']).sort());
 assert.deepEqual(indexIdentity(run),before);assert.equal(f.git('rev-parse','HEAD'),f.inputCommit);
 const checkpoint=f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:'run.implementation_checkpoint',payload:{contextVersion:1,checkpointVersion:1,productiveStep:1,agentResultEventId:phase.agentResultEventId,settlementEventId:phase.settlementEventId,tree:result.tree,exportStatus:'ready',passed:true,checks:[{command:'synthetic-check',status:'passed'}]}});
 const recheck=await f.bound.checkpoint(run,{...phase,kind:'RECHECK',checkpointEventId:checkpoint.id,expectedTree:result.tree});
 assert.deepEqual(recheck,result);assert.deepEqual(indexIdentity(run),before);
 assert.equal(f.storage.listEvents(f.work.id).some(e=>['run.candidate_committed','run.ready_for_review','run.signed_result'].includes(e.type)),false);
});
