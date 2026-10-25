import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {JobManager} from '../src/jobs.ts';
import {snapshotCandidateTree} from '../src/git.ts';
const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();
const until=async(fn)=>{const end=Date.now()+10000;while(Date.now()<end){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out');};
// Synthetic coding agents, real repository, detached worktrees, commits and host
// checks. This is deliberately not a paid/live provider qualification.
test('two productive sessions overlap, isolate writes, cancel one and independently verify combined code',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-concurrent-'));const repo=join(dir,'repository');await mkdir(repo);
 git(repo,'init','-q');git(repo,'config','user.name','Qualification');git(repo,'config','user.email','fixture@invalid');
 await writeFile(join(repo,'one.mjs'),'export const one = 0;\n');await writeFile(join(repo,'two.mjs'),'export const two = 0;\n');
 git(repo,'add','.');git(repo,'commit','-qm','Disposable base');const base=git(repo,'rev-parse','HEAD');
 let storage=openStorage(join(dir,'factory.sqlite'));const entered=new Map();let release;const barrier=new Promise(r=>release=r);
 const dependencies={preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic',error:null}),
  runCodex:async input=>{const role=input.prompt.includes('role-one')?'one':'two';const resumed=entered.has(role);entered.set(role,{workspace:input.workspacePath,at:Date.now()});
   await writeFile(join(input.workspacePath,role+'.mjs'),`export const ${role} = ${role==='one'?1:2};\n${resumed?'// Continued from retained checkpoint\n':''}`);
   await barrier;if(input.signal.aborted)throw Error('Synthetic process interrupted');
   return {success:true,status:'completed',threadId:'synthetic-'+role,usage:null,eventsPath:'synthetic'};},
  verifyWorkspaceTree:async input=>{const snap=await snapshotCandidateTree(input.workspacePath,input.inputCommit??base,input.allowedPaths??['one.mjs','two.mjs'],input.artifactDir);return {exportStatus:'ready',checks:input.commands.map(command=>({command,status:'passed'})),manifestPath:'synthetic-checkpoint',...snap};},
  verifyCandidate:async input=>{await mkdir(input.artifactDir,{recursive:true});const logPath=join(input.artifactDir,'checks.log');await writeFile(logPath,'Synthetic host checks; independent combined-tree check below');return {checks:input.commands.map(command=>({candidateCommit:input.candidateSha,candidateTree:git(repo,'rev-parse',input.candidateSha+'^{tree}'),command,status:'passed',exitCode:0,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),logPath,reason:null})),reason:null};}};
 let jobs=new JobManager(storage,dir,()=>{},dependencies,undefined,undefined,2,true);
 t.after(async()=>{release();await jobs.close();storage.close();await rm(dir,{recursive:true,force:true});});
 const order=role=>storage.createWorkOrder({title:'role-'+role,description:'Implement role-'+role,kind:'feature',reproductionCommand:null,expectedFailureText:null,repositoryPath:repo,baseRef:base,acceptanceCriteria:['Implement isolated role'],checkCommands:['node --test'],allowedPaths:[role+'.mjs'],workerProfile:'mac'});
 const a=order('one'),b=order('two');const [ra,rb]=await Promise.all([jobs.startRun(a),jobs.startRun(b)]);
 await until(()=>entered.size===2);assert.notEqual(ra.workspacePath,rb.workspacePath);assert.equal(git(ra.workspacePath,'rev-parse','--git-common-dir'),git(rb.workspacePath,'rev-parse','--git-common-dir'));
 assert.equal(git(ra.workspacePath,'rev-parse','HEAD'),base);assert.equal(git(rb.workspacePath,'rev-parse','HEAD'),base);
 assert.equal((await readFile(join(ra.workspacePath,'two.mjs'),'utf8')).trim(),'export const two = 0;');
 await assert.rejects(jobs.startRun(a),e=>e.code==='concurrency_limit');
 await jobs.cancelRun(a);release();await until(()=>storage.getRun(ra.id)?.state==='cancelled');await until(()=>storage.getRun(rb.id)?.state==='ready_for_review');
 assert.equal(storage.listRuns(a.id).length,1);assert.equal(storage.listRuns(b.id).length,1);
 // A resumed successor is a NEW Run, never replay the cancelled identity. Its
 // authority remains the existing local Work admission (managed Work refuses it).
 await until(()=>storage.listEvents(a.id).some(e=>e.runId===ra.id&&e.type==="run.recovery_checkpoint"));
 await jobs.close();storage.close();storage=openStorage(join(dir,"factory.sqlite"));
 jobs=new JobManager(storage,dir,()=>{},dependencies,undefined,undefined,2,true);
 const successor=await jobs.resumeRun(a,ra.id);assert.notEqual(successor.id,ra.id);await until(()=>storage.getRun(successor.id)?.state==='ready_for_review');
 const ca=storage.getRun(successor.id).candidateCommit,cb=storage.getRun(rb.id).candidateCommit;
 const combined=join(dir,'combined');git(repo,'worktree','add','--detach',combined,base);
 const checkpoint=storage.listEvents(a.id).find(e=>e.runId===ra.id&&e.type==='run.recovery_checkpoint').payload.commit;
 assert.equal(successor.inputCommit,checkpoint);
 git(combined,'cherry-pick',checkpoint);
 if(ca!==checkpoint)git(combined,'cherry-pick',ca);
 git(combined,'cherry-pick',cb);
 const independent=execFileSync(process.execPath,['--input-type=module','-e',"import {one} from './one.mjs'; import {two} from './two.mjs'; if(one!==1||two!==2||one+two!==3)process.exit(1)"],{cwd:combined});
 assert.equal(independent.toString(),'');assert.notEqual(git(combined,'rev-parse','HEAD'),base);
 assert.equal(git(repo,'rev-parse','HEAD'),base);assert.equal(storage.listRuns(a.id).length,2);
 const replay=await jobs.resumeRun(a,ra.id);assert.equal(replay.id,successor.id);assert.equal(storage.listRuns(a.id).length,2);
 await jobs.close();storage.close();storage=openStorage(join(dir,'factory.sqlite'));
 jobs=new JobManager(storage,dir,()=>{},dependencies,undefined,undefined,2,true);
 const afterRestart=await jobs.resumeRun(a,ra.id);assert.equal(afterRestart.id,successor.id);assert.equal(storage.listRuns(a.id).length,2);
});

test('parallel slots cannot activate the default real executor through a fixture flag',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-concurrency-deny-'));const storage=openStorage(join(dir,'factory.sqlite'));
 try{assert.throws(()=>new JobManager(storage,dir,()=>{},{},undefined,undefined,2),/synthetic/);}
 finally{storage.close();await rm(dir,{recursive:true,force:true});}
});

test('an uncertain durable continuation claim never retries initialization or coding',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-resume-unknown-'));const storage=openStorage(join(dir,'factory.sqlite'));let calls=0;
 const deps={runCodex:async()=>{calls++;throw Error('must not execute');},verifyCandidate:async()=>{throw Error('must not verify');}};
 const jobs=new JobManager(storage,dir,()=>{},deps,undefined,undefined,1,true);
 try{
  const work=storage.createWorkOrder({title:'Interrupted fixture',description:'Retain context',kind:'feature',repositoryPath:dir,baseRef:'a'.repeat(40),reproductionCommand:null,expectedFailureText:null,acceptanceCriteria:['Preserve bounded work'],checkCommands:['node --test'],allowedPaths:['one.mjs'],workerProfile:'mac'});
  const run=storage.createRun({workOrderId:work.id,workerProfile:'mac',inputCommit:'a'.repeat(40),workspacePath:dir});
  storage.saveRun({...run,state:'cancelled',finishedAt:new Date().toISOString()});
  storage.appendEvent({workOrderId:work.id,runId:run.id,type:'run.recovery_checkpoint',payload:{commit:'b'.repeat(40)}});
  await assert.rejects(jobs.resumeRun(work,run.id)); // fails source acquisition AFTER durable claim
  await assert.rejects(jobs.resumeRun(work,run.id),e=>e.code==='resume_unknown');
  assert.equal(storage.listRuns(work.id).length,1);assert.equal(calls,0);
  assert.equal(storage.listEvents(work.id).filter(e=>e.type==='run.continuation_claimed').length,1);
 }finally{await jobs.close();storage.close();await rm(dir,{recursive:true,force:true});}
});
