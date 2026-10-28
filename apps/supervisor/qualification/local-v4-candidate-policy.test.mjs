// Small ordinary owned text repositories only. Synthetic workers/verifiers,
// ephemeral fixture keys; no protected/private/provider/paid/native stress tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {LocalProducerResultsV4,RESULT_EVENT,readRunRecord} from '../src/producer-results.ts';
import {LocalV4CandidatePolicy,candidatePolicyKind} from '../src/local-v4-candidate-policy.ts';
import {verifyLocalResultV4,sha256} from '../../../packages/hosted-routing/src/result.ts';
import {JobManager} from '../src/jobs.ts';
import {createLocalV4Preparation,bindLocalV4PreparationCapture} from '../src/local-v4-preparation.ts';

const GIT='/opt/homebrew/Cellar/git/2.48.1/bin/git';
function fixture(t,rename=false){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'candidate-native-'))),repo=join(dir,'repo');mkdirSync(repo,{mode:0o700});
 const env={PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',GIT_EXEC_PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'};
 const raw=(...args)=>execFileSync(GIT,['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-C',repo,...args],{env,timeout:10000,maxBuffer:2*1024*1024});
 const git=(...args)=>raw(...args).toString('utf8').trim();git('init','-q','--template=','--object-format=sha1');git('config','user.name','Public ordinary candidate fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(repo,'sample.txt'),'before\n');git('add','.');git('commit','-qm','Input');
 const inputCommit=git('rev-parse','HEAD'),inputTree=git('rev-parse','HEAD^{tree}'),storage=openStorage(join(dir,'factory.sqlite'));
 const created=storage.createWorkOrder({title:'Ordinary candidate source qualification',description:'No independent acceptance or spend',kind:'feature',repositoryPath:repo,baseRef:inputCommit,acceptanceCriteria:['Preserve raw evidence'],reproductionCommand:null,expectedFailureText:null,checkCommands:['synthetic-check'],allowedPaths:['sample.txt','other.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),initial=storage.createRun({workOrderId:work.id,workerProfile:'mac',inputCommit,workspacePath:repo});
 const pair=generateKeyPairSync('ed25519'),key={factoryId:'public-candidate-fixture',keyId:'ephemeral',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const options={factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]},producer=new LocalProducerResultsV4(storage,dir,options);
 const snapshot=producer.captureAdmitted(work,initial,'openai/gpt-5.4-mini','ordinary-synthetic-candidate'),admission=producer.admission(initial);
 if(rename)renameSync(join(repo,'sample.txt'),join(repo,'other.txt'));else writeFileSync(join(repo,'sample.txt'),'after\n');git('add','.');git('commit','-qm','Candidate');
 const candidateCommit=git('rev-parse','HEAD'),candidateTree=git('rev-parse','HEAD^{tree}'),artifacts=join(dir,'artifacts',initial.id);mkdirSync(artifacts,{recursive:true});
 const patch=raw('show','--format=','--binary','--no-ext-diff','--no-textconv',candidateCommit),diffPath=join(artifacts,'candidate.patch');writeFileSync(diffPath,patch);
 storage.appendEvent({workOrderId:work.id,runId:initial.id,type:'run.candidate_committed',payload:{candidateCommit,candidateTree,diffPath,diffSha256:sha256(patch)}});
 const logPath=join(artifacts,'check.log');writeFileSync(logPath,'Synthetic check only; independent acceptance NOT_RUN\n');const at=new Date().toISOString();
 storage.insertCheck({runId:initial.id,candidateCommit,command:'synthetic-check',status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath,logSha256:sha256(readFileSync(logPath))});
 const run=storage.saveRun({...initial,candidateCommit,state:'verifying'}),input={repository:repo,inputCommit,inputTree,candidateCommit,candidateTree,runId:run.id,diffPath,diffSha256:sha256(patch)};
 t.after(()=>{storage.close();rmSync(dir,{recursive:true,force:true})});
 return {dir,repo,storage,work,run,options,key,snapshot,admission,producer,input,patch,raw,git,logPath,
  finish(){return storage.saveRun({...storage.getRun(run.id),state:'ready_for_review',finishedAt:new Date().toISOString()})}};
}
test('actual candidate policy: original raw bytes freeze once and saved read freshly validates after reopen',async t=>{
 const f=fixture(t),accept=await f.producer.beforeReady(f.run);f.storage.transaction(()=>{accept();f.finish()});
 const run=f.storage.getRun(f.run.id),result=await f.producer.finalizeAdmitted(run),{manifest}=verifyLocalResultV4(result,{keys:[f.key],expected:f.admission.expected});
 assert.equal(manifest.status,'COMPLETED');assert.equal(manifest.candidate.commit,f.input.candidateCommit);
 assert.equal(result.artifacts.find(a=>a.id==='candidate.patch').base64,f.patch.toString('base64'));assert.equal(f.storage.listEvents(f.work.id).filter(e=>e.type===RESULT_EVENT).length,1);
 const reopened=openStorage(join(f.dir,'factory.sqlite'));try{assert.deepEqual((await new LocalProducerResultsV4(reopened,f.dir,f.options).readAdmitted(run)).result,result)}finally{reopened.close()}
 writeFileSync(f.input.diffPath,'retained changed ordinary text\n');await assert.rejects(f.producer.readAdmitted(run),{code:'candidate_policy_hold',status:503});assert.deepEqual(readRunRecord(f.storage,run,RESULT_EVENT),result);
});
test('actual candidate policy: fixed byte adapter detaches native raw objects and is single use',async t=>{
 const f=fixture(t),policy=new LocalV4CandidatePolicy(f.dir),invocation={},guard=await policy.observe(f.input,'read','binding',invocation);
 const material=policy.consume(guard,'read','binding',invocation,f.run.id),request=['cat-file','commit',f.input.candidateCommit],raw=material.git(request);
 assert(raw.equals(f.raw('cat-file','commit',f.input.candidateCommit)));raw.fill(0);assert(material.git(request).equals(f.raw('cat-file','commit',f.input.candidateCommit)));
 assert.throws(()=>material.git(['rev-parse','HEAD']),{code:'candidate_policy_hold'});assert.throws(()=>policy.consume(guard,'read','binding',invocation,f.run.id),{code:'candidate_policy_hold'});
});
for(const variant of ['clone','purpose','binding','invocation','issuer'])test('actual candidate guard: '+variant+' cannot reuse a genuine observation',async t=>{
 const f=fixture(t),policy=new LocalV4CandidatePolicy(f.dir),invocation={},guard=await policy.observe(f.input,'read','binding',invocation);
 const issuer=variant==='issuer'?new LocalV4CandidatePolicy(f.dir):policy;
 assert.throws(()=>issuer.consume(variant==='clone'?structuredClone(guard):guard,variant==='purpose'?'freeze':'read',variant==='binding'?'changed':'binding',variant==='invocation'?{}:invocation,f.run.id),{code:'candidate_policy_hold'});
});
test('actual candidate guard: deterministic monotonic expiry cannot renew retained material',async t=>{
 const f=fixture(t),policy=new LocalV4CandidatePolicy(f.dir),invocation={},guard=await policy.observe(f.input,'read','binding',invocation),now=performance.now();
 t.mock.method(performance,'now',()=>now+60000);assert.throws(()=>policy.consume(guard,'read','binding',invocation,f.run.id),{code:'candidate_policy_hold'});
});
for(const variant of ['work','candidate','check','cancel'])test('actual pre-ready guard: '+variant+' changes while pending prevent the ready write',async t=>{
 const f=fixture(t),original=LocalV4CandidatePolicy.prototype.observe;let entered,release;const enteredPromise=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 t.mock.method(LocalV4CandidatePolicy.prototype,'observe',async function(...args){const guard=await original.apply(this,args);entered();await held;return guard});
 const pending=f.producer.beforeReady(f.run);await enteredPromise;
 if(variant==='work')f.storage.saveWorkOrder({...f.work,title:'Changed immutable Work'});
 if(variant==='candidate')f.storage.saveRun({...f.run,candidateCommit:'f'.repeat(40)});
 if(variant==='check')f.storage.insertCheck({...f.storage.listChecks(f.run.id)[0],command:'additional-check'});
 if(variant==='cancel')f.storage.appendEvent({workOrderId:f.work.id,runId:f.run.id,type:'run.cancel_requested',payload:{actor:'public-fixture'}});
 release();const accept=await pending;assert.throws(()=>f.storage.transaction(()=>{accept();f.finish()}),{code:'candidate_policy_hold'});assert.notEqual(f.storage.getRun(f.run.id).state,'ready_for_review');assert.equal(readRunRecord(f.storage,f.run,RESULT_EVENT),null);
});
test('actual candidate policy: one ordinary text rename preserves authentic raw refusal evidence',async t=>{
 const f=fixture(t,true);assert.match(f.patch.toString(),/rename from sample.txt/);
 await assert.rejects(f.producer.beforeReady(f.run),error=>error.code==='candidate_policy_hold'&&candidatePolicyKind(error)==='unsupported');
 const run=f.finish();await assert.rejects(f.producer.finalizeAdmitted(run),{code:'candidate_policy_hold'});assert.equal(readRunRecord(f.storage,run,RESULT_EVENT),null);assert(readFileSync(f.input.diffPath).equals(f.patch));assert.equal(f.git('rev-parse','HEAD'),f.input.candidateCommit);
});

for(const variant of ['unchanged','cancel','shutdown','work','check','candidate'])test('actual JobManager pending native guard: '+variant+' cannot bypass the atomic ready boundary',async t=>{
 const f=fixture(t);let entered,release;const enteredPromise=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 // The independent direct-data fixture has no running worker. Close its setup
 // Run before starting a separate managed fixture; do not weaken slot recovery.
 f.storage.saveRun({...f.run,state:'failed',failure:'Direct fixture setup only',finishedAt:new Date().toISOString()});
 f.storage.saveWorkOrder({...f.work,state:'failed'});
 const service={capture:(...args)=>f.producer.captureAdmitted(...args),snapshot:run=>f.producer.snapshot(run,f.producer.admission(run)),
  read:run=>f.producer.readAdmitted(run),finalize:run=>f.producer.finalizeAdmitted(run),
  async beforeReady(run){const accept=await f.producer.beforeReady(run);entered();await held;return accept}};
 const preparation=createLocalV4Preparation(f.dir),dependencies={...preparation,
  preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-job-guard',workerProfile:'mac',error:null}),
  runCodex:async input=>{writeFileSync(join(input.workspacePath,'sample.txt'),'job candidate\n');return {success:true,status:'completed',eventsPath:'fixture',usage:null}},
  verifyCandidate:async input=>{mkdirSync(input.artifactDir,{recursive:true});const logPath=join(input.artifactDir,'check.log');writeFileSync(logPath,'Synthetic check only\n');const at=new Date().toISOString();return {checks:[{candidateCommit:input.candidateSha,command:'synthetic-check',status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath,reason:null}],reason:null}}};
 const jobs=new JobManager(f.storage,f.dir,()=>{},dependencies,bindLocalV4PreparationCapture(preparation,service),'openai/gpt-5.4-mini');
 const {id,state,createdAt,updatedAt,...input}=f.work;const created=f.storage.createWorkOrder({...input,title:'Pending guard job '+variant}),work=f.storage.getWorkOrder(created.id);
 const run=await jobs.startRun(work);
 t.after(()=>release());
 await Promise.race([enteredPromise,new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(Error('Synthetic job did not reach native guard')),10000);timeout.unref()})]);
 let closing;
 if(variant==='cancel')await jobs.cancelRun(f.storage.getWorkOrder(work.id));
 if(variant==='shutdown')closing=jobs.close();
 if(variant==='work')f.storage.saveWorkOrder({...f.storage.getWorkOrder(work.id),title:'Changed pending Work'});
 if(variant==='check')f.storage.insertCheck({...f.storage.listChecks(run.id)[0],command:'changed-check'});
 if(variant==='candidate')f.storage.saveRun({...f.storage.getRun(run.id),candidateCommit:'f'.repeat(40)});
 release();const end=performance.now()+10000;while(jobs.activeRun(run.id)&&performance.now()<end)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(jobs.activeRun(run.id),false);await closing;await jobs.close();
 const current=f.storage.getRun(run.id),events=f.storage.listEvents(work.id);
 if(variant==='unchanged'){assert.equal(current.state,'ready_for_review');assert(events.some(e=>e.runId===run.id&&e.type==='run.signed_result'))}
 else{assert.notEqual(current.state,'ready_for_review');assert(!events.some(e=>e.runId===run.id&&e.type==='run.ready_for_review'));
  assert.equal(current.state,variant==='cancel'?'cancelled':'interrupted');
  if(['work','check','candidate'].includes(variant))assert(events.some(e=>e.runId===run.id&&e.type==='run.recovery_hold'));
 }
});
