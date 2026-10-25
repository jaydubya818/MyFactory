import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {JobManager} from '../src/jobs.ts';
import {LocalExecutionProvider} from '../src/local-execution-provider.ts';

const until=async fn=>{const deadline=Date.now()+15000;while(Date.now()<deadline){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Recovery fixture timed out');};
const absent=pid=>{try{process.kill(-pid,0);return false;}catch(e){return e.code==='ESRCH';}};

test('a killed supervisor retains partial code but cannot resume until its surviving child is absent',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'factory-crash-checkpoint-')),repo=join(dir,'repo'),statePath=join(dir,'started.json');mkdirSync(repo);
 const git=(path,...args)=>execFileSync('git',['-C',path,...args],{encoding:'utf8'}).trim();
 git(repo,'init','-q');git(repo,'config','user.name','Synthetic recovery');git(repo,'config','user.email','fixture@example.invalid');
 writeFileSync(join(repo,'sample.txt'),'base\n');git(repo,'add','.');git(repo,'commit','-qm','Disposable base');
 const hostPath=join(dir,'host.mjs');
 // Real disposable supervisor/worker processes; deterministic coding, no model.
 writeFileSync(hostPath,`
 import {spawn} from 'node:child_process';
 import {writeFileSync} from 'node:fs';
 import {join} from 'node:path';
 import {openStorage} from ${JSON.stringify(new URL('../../../packages/storage/src/index.ts',import.meta.url).href)};
 import {JobManager} from ${JSON.stringify(new URL('../src/jobs.ts',import.meta.url).href)};
 const storage=openStorage(${JSON.stringify(join(dir,'factory.sqlite'))});
 const work=storage.createWorkOrder({title:'Crash fixture',description:'Retain partial code',kind:'feature',repositoryPath:${JSON.stringify(repo)},baseRef:${JSON.stringify(git(repo,'rev-parse','HEAD'))},acceptanceCriteria:['Resume preserved code'],reproductionCommand:null,expectedFailureText:null,checkCommands:['fixture-check'],allowedPaths:['sample.txt'],workerProfile:'mac'});
 const jobs=new JobManager(storage,${JSON.stringify(dir)},()=>{},{
  preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic',error:null}),
  runCodex:async input=>{
   writeFileSync(join(input.workspacePath,'sample.txt'),'partial before host crash\\n');
   const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
   await input.onProcessStart({pid:child.pid});
   const run=storage.listRuns(work.id).at(-1);
   writeFileSync(${JSON.stringify(statePath)},JSON.stringify({workId:work.id,runId:run.id,pid:child.pid}));
   await new Promise(()=>{});
  },verifyCandidate:async()=>{throw Error('not reached');}
 },undefined,undefined,1,true);
 await jobs.startRun(work);
 `);
 const host=spawn(process.execPath,[hostPath],{stdio:['ignore','ignore','pipe']});let stderr='';host.stderr.on('data',b=>stderr+=b);
 let workerPid,storage,jobs;
 t.after(async()=>{if(host.exitCode===null&&host.signalCode===null)host.kill('SIGKILL');if(workerPid&&!absent(workerPid))process.kill(-workerPid,'SIGKILL');if(jobs)await jobs.close();storage?.close();rmSync(dir,{recursive:true,force:true});});
 await until(()=>{if(host.exitCode!==null)throw Error(stderr);return existsSync(statePath);});
 const state=JSON.parse(readFileSync(statePath,'utf8'));workerPid=state.pid;
 const exited=once(host,'exit');host.kill('SIGKILL');await exited;assert.equal(absent(workerPid),false);
 storage=openStorage(join(dir,'factory.sqlite'));let calls=0;
 const dependencies={preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic',error:null}),
  runCodex:async input=>{calls++;assert.equal(readFileSync(join(input.workspacePath,'sample.txt'),'utf8'),'partial before host crash\n');writeFileSync(join(input.workspacePath,'sample.txt'),'recovered\n');return {success:true,status:'completed',eventsPath:'synthetic'};},
  verifyCandidate:async input=>{mkdirSync(input.artifactDir,{recursive:true});const logPath=join(input.artifactDir,'check.log');writeFileSync(logPath,'Independent synthetic check\n');return {checks:[{candidateCommit:input.candidateSha,candidateTree:git(repo,'rev-parse',input.candidateSha+'^{tree}'),command:'fixture-check',status:'passed',exitCode:0,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),logPath,reason:null}],reason:null};}};
 jobs=new JobManager(storage,dir,()=>{},dependencies,undefined,undefined,1,true);
 const work=storage.getWorkOrder(state.workId),run=storage.getRun(state.runId);
 const provider=new LocalExecutionProvider(storage,jobs,{read:()=>{throw Error('No managed result in this local fixture');}});
 assert.equal((await provider.reconcile(run)).quiescent,false);
 assert.equal(storage.listEvents(work.id).some(e=>e.type==='run.recovery_checkpoint'),false);
 await assert.rejects(jobs.resumeRun(work,run.id),e=>e.code==='recovery_hold');
 process.kill(-workerPid,'SIGTERM');await until(()=>absent(workerPid));
 const observation=await provider.reconcile(run);assert.equal(observation.quiescent,true);assert.equal(observation.recoveryEligible,true);
 const checkpoint=storage.listEvents(work.id).find(e=>e.type==='run.recovery_checkpoint');assert.ok(checkpoint);assert.equal(checkpoint.payload.verified,false);
 const next=await jobs.resumeRun(work,run.id);await until(()=>storage.getRun(next.id).state==='ready_for_review');
 assert.equal(next.inputCommit,checkpoint.payload.commit);assert.equal(calls,1);
 assert.equal((await jobs.resumeRun(work,run.id)).id,next.id);assert.equal(calls,1);assert.equal(storage.listRuns(work.id).length,2);
 assert.equal(readFileSync(join(storage.getRun(next.id).workspacePath,'sample.txt'),'utf8'),'recovered\n');
});
