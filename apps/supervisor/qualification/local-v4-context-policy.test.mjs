// Small ordinary owned text only. Synthetic workers/checkpoints and ephemeral
// fixture keys; no provider, protected test, paid Work or tester installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,lstatSync} from 'node:fs';
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
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'context-native-'))),repo=join(dir,'repo');mkdirSync(repo,{mode:0o700});
 const env={PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',GIT_EXEC_PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'};
 const git=(...args)=>execFileSync(GIT,['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-C',repo,...args],{env,timeout:10000,maxBuffer:1024*1024}).toString().trim();
 git('init','-q','--template=','--object-format=sha1');git('config','user.name','Public context fixture');git('config','user.email','fixture@example.invalid');
 writeFileSync(join(repo,'sample.txt'),'original\n');writeFileSync(join(repo,'README.md'),'public guide\n');writeFileSync(join(repo,'other.txt'),'inventory only\n');git('add','.');git('commit','-qm','Input');
 const inputCommit=git('rev-parse','HEAD'),inputTree=git('rev-parse','HEAD^{tree}'),storage=openStorage(join(dir,'factory.sqlite'));
 const created=storage.createWorkOrder({title:'Ordinary context qualification',description:'No protected acceptance or spend',kind:'feature',repositoryPath:repo,baseRef:inputCommit,acceptanceCriteria:['Preserve actual context identities'],reproductionCommand:null,expectedFailureText:null,checkCommands:['synthetic-check'],allowedPaths:['sample.txt','missing.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),pair=generateKeyPairSync('ed25519'),key={factoryId:'public-context-fixture',keyId:'ephemeral',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const service=new LocalV4ServiceProducer(storage,dir,{factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]});
 const preparation=createLocalV4Preparation(dir),bound=bindLocalV4PreparationCapture(preparation,service);
 const f={dir,repo,storage,work,inputCommit,inputTree,service,preparation,bound};
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
test('actual context: immutable input bodies and complete inventory ignore current ordinary edits',async t=>{
 const f=fixture(t),run=await direct(f);writeFileSync(join(run.workspacePath,'sample.txt'),'live edit\n');
 const value=JSON.parse(await f.bound.context(run,{kind:'INITIAL'}));
 assert.equal(value.base,f.inputCommit);assert.equal(value.tree,f.inputTree);assert.deepEqual(value.basis,{kind:'ADMITTED_INPUT',checkpointEventId:null,productiveStep:null});
 assert.equal(value.files['sample.txt'],'original\n');assert.equal(value.files['README.md'],'public guide\n');assert.equal(value.files['missing.txt'],null);assert.equal(Object.hasOwn(value.files,'other.txt'),false);
 assert.deepEqual(value.inventory,['README.md','other.txt','sample.txt']);assert(Buffer.byteLength(JSON.stringify(value))<=65536);
 await f.bound.assertProgress(run);assert.equal(readFileSync(join(run.workspacePath,'sample.txt'),'utf8'),'live edit\n');
});
for(const variant of ['no current changes','outside current scope'])test('actual live progress: '+variant+' refuses independently of an input context',async t=>{
 const f=fixture(t),run=await direct(f);await f.bound.context(run,{kind:'INITIAL'});
 if(variant==='outside current scope')writeFileSync(join(run.workspacePath,'other.txt'),'ordinary outside edit\n');
 await assert.rejects(f.bound.assertProgress(run),{code:'local_context_hold',status:503});assert.equal(f.storage.listEvents(f.work.id).filter(e=>e.type==='run.signed_result').length,0);
});
for(const operation of ['context','progress'])for(const change of ['work','phase','run'])test('actual pending native '+operation+': changed '+change+' cannot return stale data',async t=>{
 const f=fixture(t),run=await direct(f);writeFileSync(join(run.workspacePath,'sample.txt'),'ordinary live change\n');
 const pending=operation==='context'?f.bound.context(run,{kind:'INITIAL'}):f.bound.assertProgress(run);
 if(change==='work')f.storage.saveWorkOrder({...f.storage.getWorkOrder(f.work.id),title:'Changed original Work'});
 if(change==='phase')f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:'factory.stop_requested',payload:{actor:'public fixture'}});
 if(change==='run')f.storage.saveRun({...run,state:'interrupted'});
 await assert.rejects(pending,{code:'local_context_hold',status:503});
 assert.equal(f.storage.listEvents(f.work.id).some(e=>e.type==='run.candidate_committed'||e.type==='run.ready_for_review'),false);
});

function driver(f,{repair=false,heldPhase=null,change=null}={}){
 const contexts=[],observations=[],prompts=[],progress=[],entered=deferred(),release=deferred();let productive=0,checkpoints=0,commits=0;
 const producer={...f.bound,async context(run,phase){
   const admin=readFileSync(join(run.workspacePath,'.git'),'utf8').slice(8).trim(),index=join(admin,'index'),s=lstatSync(index);
   observations.push({phase:phase.kind,index:{ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs,sha256:createHash('sha256').update(readFileSync(index)).digest('hex')}});
   const result=await f.bound.context(run,phase);contexts.push({phase,value:JSON.parse(result)});
   if(phase.kind===heldPhase){entered.resolve();await release.promise;}
   return result;
 },commitCandidate:async()=>{commits++;throw Error('Public fixture stops after source context; candidate writes remain separately unqualified')}};
 const check=async(input,status)=>{mkdirSync(input.artifactDir,{recursive:true});const logPath=join(input.artifactDir,'public-check.log');writeFileSync(logPath,'Public synthetic implementation feedback\n');const at=new Date().toISOString();return {exportStatus:'ready',manifestPath:join(input.artifactDir,'synthetic-manifest.json'),checks:[{command:'synthetic-check',status,candidateCommit:input.candidateSha??f.inputCommit,candidateTree:input.tree,exitCode:status==='passed'?0:1,startedAt:at,finishedAt:at,logPath,reason:null}],reason:null}};
 const jobs=f.jobs=new JobManager(f.storage,f.dir,()=>{},{...f.preparation,
  preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-context',workerProfile:'mac',error:null}),
  runCodex:async input=>{prompts.push(input.prompt);if(input.sandbox!=='read-only'){
    productive++;writeFileSync(join(input.workspacePath,'sample.txt'),'productive '+productive+'\n');
    const run=f.storage.listRuns(f.work.id)[0];await provider.assertImplementationProgress(run,f.inputCommit,f.work.allowedPaths);progress.push(productive);
   }return {success:true,status:'completed',threadId:'public',eventsPath:'synthetic',usage:null}},
  verifyWorkspaceTree:async input=>{checkpoints++;return check(input,repair&&checkpoints===1?'failed':'passed')},
  verifyCandidate:async()=>{throw Error('Candidate verification outside context fixture')},
 },producer,model,1,false,true);
 const provider=new LocalExecutionProvider(f.storage,jobs,producer);
 const gateway={assertCurrentConnection:()=>{},baseUrl:'http://fixture.invalid',childToken:'no-network-token',close:async()=>{},
  nextProductive:async()=>({baseUrl:'http://fixture.invalid',childToken:'no-network-repair',productiveEndSignal:new AbortController().signal}),
  beginCompletion:async()=>({baseUrl:'http://fixture.invalid',childToken:'no-network-completion'}),assertCompleted:()=>{}};
 return {contexts,observations,prompts,progress,entered,release,get commits(){return commits},async start(){const run=await jobs.prepareRun(f.work);
  f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:'factory.writer_bound',payload:{deadline:new Date(Date.now()+600000).toISOString()}});
  assert.equal(await jobs.executePrepared(f.storage.getWorkOrder(f.work.id),run,()=>true,gateway),true);return run},change};
}
for(const repair of [false,true])test('actual JobManager context: '+(repair?'repair then completion':'first completion')+' selects the exact host checkpoints at all callers',async t=>{
 const f=fixture(t),d=driver(f,{repair}),run=await d.start(),current=await settled(f,run);
 assert.equal(current.state,'failed',JSON.stringify({current,events:f.storage.listEvents(f.work.id),contexts:d.contexts,observations:d.observations,progress:d.progress}));assert.match(current.failure,/Public fixture stops/);assert.equal(d.commits,1);
 assert.deepEqual(d.contexts.map(c=>c.phase.kind),repair?['INITIAL','REPAIR','COMPLETION']:['INITIAL','COMPLETION']);assert.deepEqual(d.progress,repair?[1,2]:[1]);
 const events=f.storage.listEvents(f.work.id),initial=d.contexts[0].value;assert.equal(initial.tree,f.inputTree);assert.equal(initial.files['sample.txt'],'original\n');
 for(const {phase,value} of d.contexts.slice(1)){
  const cp=events.find(e=>e.id===phase.checkpointEventId);assert(cp);assert.equal(value.tree,cp.payload.tree);assert.equal(value.base,f.inputCommit);assert.equal(value.basis.checkpointEventId,String(cp.id));assert.equal(value.basis.productiveStep,cp.payload.productiveStep);
  assert.equal(value.files['sample.txt'],'productive '+cp.payload.productiveStep+'\n');assert(Buffer.byteLength(JSON.stringify(value))<=65536);
 }
 const completion=d.contexts.at(-1),closed=events.find(e=>e.id===completion.phase.productiveClosedEventId),started=events.find(e=>e.id===completion.phase.completionStartedEventId);
 assert(closed.id<started.id);assert.equal(started.payload.checkpointEventId,completion.phase.checkpointEventId);assert.equal(events.some(e=>e.type==='run.candidate_committed'||e.type==='run.ready_for_review'),false);
});
for(const phase of ['INITIAL','REPAIR','COMPLETION'])for(const change of ['cancel','work'])test('actual pending '+phase+' context: '+change+' prevents the next worker call',async t=>{
 const f=fixture(t),d=driver(f,{repair:true,heldPhase:phase}),run=await d.start();t.after(()=>d.release.resolve());
 await Promise.race([d.entered.promise,sleep(20000).then(()=>{throw Error('Did not reach '+phase)})]);
 const before=d.prompts.length;if(change==='cancel')await f.jobs.cancelRun(f.storage.getWorkOrder(f.work.id));else f.storage.saveWorkOrder({...f.storage.getWorkOrder(f.work.id),title:'Changed original Work'});
 d.release.resolve();const current=await settled(f,run);
 assert.equal(d.prompts.length,before);assert.equal(d.commits,0);assert.notEqual(current.state,'ready_for_review');assert.equal(current.state,change==='cancel'?'cancelled':'interrupted');
 assert.equal(f.storage.listEvents(f.work.id).some(e=>e.type==='run.candidate_committed'||e.type==='run.ready_for_review'),false);
});
