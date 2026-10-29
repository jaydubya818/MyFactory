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
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'finalization-native-'))),repo=join(dir,'repo');mkdirSync(repo,{mode:0o700});
 const env={PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',GIT_EXEC_PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'};
 const raw=(...args)=>execFileSync(GIT,['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-C',repo,...args],{env,timeout:10000,maxBuffer:1024*1024});const git=(...args)=>raw(...args).toString().trim();
 git('init','-q','--template=','--object-format=sha1');git('config','user.name','Public context fixture');git('config','user.email','fixture@example.invalid');
 writeFileSync(join(repo,'sample.txt'),'original\n');writeFileSync(join(repo,'README.md'),'public guide\n');writeFileSync(join(repo,'other.txt'),'inventory only\n');git('add','.');git('commit','-qm','Input');
 const inputCommit=git('rev-parse','HEAD'),inputTree=git('rev-parse','HEAD^{tree}'),storage=openStorage(join(dir,'factory.sqlite'));
 const created=storage.createWorkOrder({title:'Ordinary context qualification',description:'No protected acceptance or spend',kind:'feature',repositoryPath:repo,baseRef:inputCommit,acceptanceCriteria:['Preserve actual context identities'],reproductionCommand:null,expectedFailureText:null,checkCommands:['synthetic-check'],allowedPaths:['sample.txt','missing.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),pair=generateKeyPairSync('ed25519'),key={factoryId:'public-context-fixture',keyId:'ephemeral',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const service=new LocalV4ServiceProducer(storage,dir,{factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]});
 const preparation=createLocalV4Preparation(dir),bound=bindLocalV4PreparationCapture(preparation,service);
 const f={dir,repo,git,raw,storage,work,inputCommit,inputTree,service,preparation,bound};
 t.after(async()=>{if(f.jobs)await f.jobs.close();storage.close();rmSync(dir,{recursive:true,force:true})});return f;
}

function indexObservation(run){
 const pointer=readFileSync(join(run.workspacePath,'.git'),'utf8'),admin=pointer.slice(8).trim(),path=join(admin,'index'),s=lstatSync(path);
 return {pointer,admin,identity:[s.dev,s.ino,s.mode,s.size,s.mtimeMs,s.ctimeMs].join(':'),hash:createHash('sha256').update(readFileSync(path)).digest('hex')};
}
for(const variant of ['modify','create','delete'])test('actual fixed finalizer: ordinary '+variant+' seals exact candidate HEAD/index/artifact and genuine C source result',async t=>{
 const f=fixture(t),mainHead=readFileSync(join(f.repo,'.git/HEAD'),'utf8'),refs=f.raw('for-each-ref','--format=%(refname)%00%(objectname)');let productive=0,assertions=0;
 const check=async input=>{mkdirSync(input.artifactDir,{recursive:true,mode:0o700});const logPath=join(input.artifactDir,'public-check.log');writeFileSync(logPath,'Synthetic implementation-visible check; independent protected verification NOT_RUN\n');const at=new Date().toISOString();return {exportStatus:'ready',manifestPath:join(input.artifactDir,'synthetic.json'),reason:null,checks:[{command:'synthetic-check',status:'passed',candidateCommit:input.candidateSha??f.inputCommit,candidateTree:input.tree??f.git('rev-parse',input.candidateSha+'^{tree}'),exitCode:0,startedAt:at,finishedAt:at,logPath,reason:null}]}};
 const jobs=f.jobs=new JobManager(f.storage,f.dir,()=>{},{...f.preparation,
  preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-finalization',workerProfile:'mac',error:null}),
  runCodex:async input=>{if(input.sandbox!=='read-only'){
   productive++;if(variant==='modify')writeFileSync(join(input.workspacePath,'sample.txt'),'ordinary final edit\n');
   if(variant==='create')writeFileSync(join(input.workspacePath,'missing.txt'),'ordinary new file\n');
   if(variant==='delete')unlinkSync(join(input.workspacePath,'sample.txt'));
   const run=f.storage.listRuns(f.work.id)[0];await provider.assertImplementationProgress(run,f.inputCommit,f.work.allowedPaths);
  }return {success:true,status:'completed',threadId:'public-synthetic',eventsPath:'synthetic',usage:null}},
  verifyWorkspaceTree:check,verifyCandidate:check,
 },f.bound,model,1,false,true);
 const provider=new LocalExecutionProvider(f.storage,jobs,f.bound),run=await jobs.prepareRun(f.work),original=indexObservation(run);
 f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:'factory.writer_bound',payload:{deadline:new Date(Date.now()+600000).toISOString()}});
 const gateway={assertCurrentConnection:()=>{},baseUrl:'http://fixture.invalid',childToken:'no-network',close:async()=>{},beginCompletion:async()=>({baseUrl:'http://fixture.invalid',childToken:'no-network-completion'}),assertCompleted:()=>{assertions++}};
 assert.equal(await jobs.executePrepared(f.storage.getWorkOrder(f.work.id),run,()=>true,gateway),true);
 const current=await settled(f,run),events=f.storage.listEvents(f.work.id);
 assert.equal(current.state,'ready_for_review',JSON.stringify({current,events}));assert.equal(productive,1);assert.equal(assertions,1);
 assert.notEqual(current.candidateCommit,f.inputCommit);assert.equal(f.git('rev-parse','HEAD'),f.inputCommit);assert.equal(readFileSync(join(f.repo,'.git/HEAD'),'utf8'),mainHead);assert(f.raw('for-each-ref','--format=%(refname)%00%(objectname)').equals(refs));
 const candidate=events.find(e=>e.type==='run.candidate_committed');assert(candidate);const cp=events.find(e=>e.type==='run.implementation_checkpoint');assert.equal(candidate.payload.candidateTree,cp.payload.tree);
 assert.equal(readFileSync(join(original.admin,'HEAD'),'utf8'),current.candidateCommit+'\n');assert.notEqual(indexObservation(run).identity,original.identity);
 assert.equal(f.git('rev-list','--parents','-n','1',current.candidateCommit),current.candidateCommit+' '+f.inputCommit);
 const patch=readFileSync(candidate.payload.diffPath);assert.equal(createHash('sha256').update(patch).digest('hex'),candidate.payload.diffSha256);
 assert(patch.equals(f.raw('show','--format=','--binary','--no-ext-diff','--no-textconv',current.candidateCommit)));assert.equal(lstatSync(candidate.payload.diffPath).mode&0o777,0o600);
 assert.equal(events.filter(e=>e.type==='run.finalization_settled').length,1);assert.equal(events.filter(e=>e.type==='run.signed_result').length,1);
 assert((await f.bound.read(current)).result);await assert.rejects(f.bound.context(current,{kind:'INITIAL'}),{code:'local_context_hold'});
 await assert.rejects(f.preparation.removeTaskWorktree(f.repo,run.workspacePath),/LOCAL_V4_PREPARATION_RETAINED_HOLD/);
});
