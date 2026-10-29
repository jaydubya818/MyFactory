// Small ordinary owned text only. Synthetic workers/checkpoints and ephemeral
// fixture keys; no provider, protected test, paid Work or tester installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,lstatSync,unlinkSync,readdirSync,chmodSync} from 'node:fs';
import {join,dirname} from 'node:path';
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
function fixture(t,defect=false){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'verification-input-native-'))),repo=join(dir,'repo');mkdirSync(repo,{mode:0o700});
 const env={PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',GIT_EXEC_PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'};
 const raw=(...args)=>execFileSync(GIT,['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-C',repo,...args],{env,timeout:10000,maxBuffer:1024*1024});const git=(...args)=>raw(...args).toString().trim();
 git('init','-q','--template=','--object-format=sha1');git('config','user.name','Public context fixture');git('config','user.email','fixture@example.invalid');
 writeFileSync(join(repo,'sample.txt'),'original\n');writeFileSync(join(repo,'README.md'),'public guide\n');writeFileSync(join(repo,'other.txt'),'inventory only\n');mkdirSync(join(repo,'docs'));writeFileSync(join(repo,'docs/guide.txt'),'nested public guide\n');git('add','.');git('commit','-qm','Input');
 const inputCommit=git('rev-parse','HEAD'),inputTree=git('rev-parse','HEAD^{tree}'),storage=openStorage(join(dir,'factory.sqlite'));
 const created=storage.createWorkOrder({title:'Ordinary context qualification',description:'No protected acceptance or spend',kind:defect?'defect':'feature',repositoryPath:repo,baseRef:inputCommit,acceptanceCriteria:['Preserve actual context identities'],reproductionCommand:defect?'synthetic-reproduction':null,expectedFailureText:defect?'public baseline':null,checkCommands:['synthetic-check'],allowedPaths:['sample.txt','missing.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),pair=generateKeyPairSync('ed25519'),key={factoryId:'public-context-fixture',keyId:'ephemeral',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const service=new LocalV4ServiceProducer(storage,dir,{factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]});
 const preparation=createLocalV4Preparation(dir,{sourceArtifacts:true}),bound=bindLocalV4PreparationCapture(preparation,service);
 const f={dir,repo,git,raw,storage,work,inputCommit,inputTree,service,preparation,bound,artifactFixtures:[]};
 t.after(async()=>{if(f.jobs)await f.jobs.close();storage.close();for(const artifact of f.artifactFixtures){const directories=new Set([artifact.path]);for(const path of artifact.paths){let at=dirname(join(artifact.path,path));while(at.startsWith(artifact.path)){directories.add(at);if(at===artifact.path)break;at=dirname(at)}}for(const path of directories)chmodSync(path,0o700)}rmSync(dir,{recursive:true,force:true})});return f;
}

function indexObservation(run){
 const pointer=readFileSync(join(run.workspacePath,'.git'),'utf8'),admin=pointer.slice(8).trim(),path=join(admin,'index'),s=lstatSync(path);
 return {pointer,admin,identity:[s.dev,s.ino,s.mode,s.size,s.mtimeMs,s.ctimeMs].join(':'),hash:createHash('sha256').update(readFileSync(path)).digest('hex')};
}
// Only the three ordinary text cases selected by the finite contract. Callbacks
// consume immutable source data; they do not execute a command or native worker.
for(const variant of ['modify','create-delete','reproduction'])test('actual fixed verification input: ordinary '+variant+' binds full source at actual phase cuts',async t=>{
 const f=fixture(t,variant==='reproduction'),seen=[];let productive=0;
 const check=async input=>{
  const source=input.sourceInput;assert(source);assert.equal(source.schema,'local-v4-fixture-source/v1');
  const artifact=input.sourceArtifact;assert(artifact);assert(Object.isFrozen(artifact));assert.equal(artifact.schema,'local-v4-source-artifact/v1');assert.equal(artifact.tree,source.tree);
  assert(artifact.path.startsWith(join(f.dir,'verification-inputs')+'/'));assert.equal(lstatSync(artifact.path).mode&0o777,0o555);
  for(const [path,bytes] of Object.entries(source.files)){assert.equal(readFileSync(join(artifact.path,path),'utf8'),bytes);assert.equal(lstatSync(join(artifact.path,path)).mode&0o777,0o444)}
  assert.equal(readFileSync(join(artifact.path,'docs/guide.txt'),'utf8'),'nested public guide\n');
  assert.deepEqual(readdirSync(artifact.path).sort(),Object.keys(source.files).map(path=>path.split('/')[0]).filter((name,i,all)=>all.indexOf(name)===i).sort());
  const manifest=readFileSync(join(dirname(artifact.path),'manifest.json'));assert.equal(createHash('sha256').update(manifest).digest('hex'),artifact.manifestSha256);
  f.artifactFixtures.push({path:artifact.path,paths:Object.keys(source.files)});
  assert(Object.isFrozen(source));assert(Object.isFrozen(source.files));assert.equal(source.files['README.md'],'public guide\n');assert.equal(source.files['other.txt'],'inventory only\n');
  assert.equal(source.workOrderId,f.work.id);assert.equal(source.tree,input.tree??f.git('rev-parse',input.candidateSha+'^{tree}'));
  if(source.kind==='IMPLEMENTATION')assert.equal(source.commit,null);else assert.equal(source.commit,input.candidateSha);
  if(source.kind==='REPRODUCTION'){assert.equal(source.files['sample.txt'],'original\n');assert.equal(source.commit,f.inputCommit)}
  else if(variant==='create-delete'){assert.equal(source.files['sample.txt'],undefined);assert.equal(source.files['missing.txt'],'ordinary new file\n')}
  else assert.equal(source.files['sample.txt'],'verification input edit\n');
  seen.push(source);mkdirSync(input.artifactDir,{recursive:true,mode:0o700});const logPath=join(input.artifactDir,'public-check.log');
  writeFileSync(logPath,source.kind==='REPRODUCTION'?'public baseline\n':'Synthetic source-data check; independent verification NOT_RUN\n');
  const at=new Date().toISOString(),status=source.kind==='REPRODUCTION'?'failed':'passed';
  return{exportStatus:'ready',manifestPath:join(input.artifactDir,'fixture.json'),reason:null,checks:input.commands.map(command=>({command,status,
   candidateCommit:input.candidateSha??f.inputCommit,candidateTree:source.tree,exitCode:status==='failed'?1:0,startedAt:at,finishedAt:at,logPath,reason:null}))};
 };
 const jobs=f.jobs=new JobManager(f.storage,f.dir,()=>{},{...f.preparation,
  preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-input',workerProfile:'mac',error:null}),
  runCodex:async input=>{if(input.sandbox!=='read-only'){
   productive++;if(variant==='create-delete'){unlinkSync(join(input.workspacePath,'sample.txt'));writeFileSync(join(input.workspacePath,'missing.txt'),'ordinary new file\n')}
   else writeFileSync(join(input.workspacePath,'sample.txt'),'verification input edit\n');
   const run=f.storage.listRuns(f.work.id)[0];await provider.assertImplementationProgress(run,f.inputCommit,f.work.allowedPaths);
  }return{success:true,status:'completed',threadId:'public-synthetic',eventsPath:'synthetic',usage:null}},
  verifyWorkspaceTree:check,verifyCandidate:check,
 },f.bound,model,1,false,true);
 const provider=new LocalExecutionProvider(f.storage,jobs,f.bound),run=await jobs.prepareRun(f.work);
 f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:'factory.writer_bound',payload:{deadline:new Date(Date.now()+600000).toISOString()}});
 const gateway={assertCurrentConnection:()=>{},baseUrl:'http://fixture.invalid',childToken:'no-network',close:async()=>{},
  beginCompletion:async()=>({baseUrl:'http://fixture.invalid',childToken:'no-network-completion'}),assertCompleted:()=>{}};
 assert.equal(await jobs.executePrepared(f.storage.getWorkOrder(f.work.id),run,()=>true,gateway),true);
 const current=await settled(f,run);assert.equal(current.state,'ready_for_review',JSON.stringify({current,events:f.storage.listEvents(f.work.id)}));assert.equal(productive,1);
 assert.deepEqual(seen.map(source=>source.kind),variant==='reproduction'?['REPRODUCTION','IMPLEMENTATION','FINAL']:['IMPLEMENTATION','FINAL']);
 assert.equal(seen.at(-1).commit,current.candidateCommit);assert.equal(seen.at(-1).tree,seen.at(-2).tree);
 assert.equal(f.git('rev-parse','HEAD'),f.inputCommit);assert((await f.bound.read(current)).result);
 await assert.rejects(f.preparation.removeTaskWorktree(f.repo,run.workspacePath),/LOCAL_V4_PREPARATION_RETAINED_HOLD/);
});
