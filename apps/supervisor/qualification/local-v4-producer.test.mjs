import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {ProducerResults,LocalProducerResultsV4,producerOptions,SNAPSHOT_EVENT,RESULT_EVENT,readRunRecord,sourceIdentity} from '../src/producer-results.ts';
import {digest,sha256,verifyLocalResultV4,verifyResult} from '../../../packages/hosted-routing/src/result.ts';

const GIT='/opt/homebrew/Cellar/git/2.48.1/bin/git';
const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:''};
function fixture(t){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'local-v4-producer-'))),repo=join(dir,'repo');mkdirSync(repo);
 const git=(...args)=>execFileSync(GIT,['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-C',repo,...args],{env,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}).trim();
 git('init','-q','--template=');git('config','user.name','Ordinary producer fixture');git('config','user.email','producer@example.invalid');
 writeFileSync(join(repo,'sample.txt'),'before\n');git('add','sample.txt');git('commit','-qm','Admitted input');
 const inputCommit=git('rev-parse','HEAD'),inputTree=git('rev-parse','HEAD^{tree}');
 const path=join(dir,'factory.sqlite'),storage=openStorage(path);
 const created=storage.createWorkOrder({title:'Direct local producer fixture',description:'Ordinary synthetic artifacts only',kind:'feature',repositoryPath:repo,baseRef:inputCommit,acceptanceCriteria:['Inspect exact signed bytes'],reproductionCommand:null,expectedFailureText:null,checkCommands:['check-one'],allowedPaths:['sample.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),run=storage.createRun({workOrderId:work.id,workerProfile:'mac',inputCommit,workspacePath:repo});
 const pair=generateKeyPairSync('ed25519'),options={factoryId:'local-v4-direct-fixture',currentKeyId:'ephemeral-test-key',privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[{factoryId:'local-v4-direct-fixture',keyId:'ephemeral-test-key',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'}]};
 const producer=new LocalProducerResultsV4(storage,dir,options);
 t.after(()=>{storage.close();rmSync(dir,{recursive:true,force:true});});
 const capture=()=>{const snapshot=producer.capture(work,run,'openai/gpt-5.4-mini','direct-synthetic-fixture');const {version,workspace,capturedAt,...expected}=snapshot;return {snapshot,admission:{work,expected}};};
 const finish=(state='failed')=>storage.saveRun({...storage.getRun(run.id),state,finishedAt:new Date().toISOString()});
 return {dir,repo,path,storage,work,run,options,producer,git,inputCommit,inputTree,capture,finish};
}
function candidate(f){
 writeFileSync(join(f.repo,'sample.txt'),'after\n');f.git('add','sample.txt');f.git('commit','-qm','Synthetic candidate');
 const commit=f.git('rev-parse','HEAD'),tree=f.git('rev-parse','HEAD^{tree}'),artifacts=join(f.dir,'artifacts',f.run.id);mkdirSync(artifacts,{recursive:true});
 const diffPath=join(artifacts,'candidate.patch'),patch=execFileSync(GIT,['-C',f.repo,'show','--format=','--binary','--no-ext-diff','--no-textconv',commit],{env,timeout:10000});writeFileSync(diffPath,patch);
 f.storage.appendEvent({workOrderId:f.work.id,runId:f.run.id,type:'run.candidate_committed',payload:{candidateCommit:commit,candidateTree:tree,diffPath,diffSha256:sha256(patch)}});
 const logPath=join(artifacts,'check.log');writeFileSync(logPath,'Synthetic producer check only; independent verification NOT_RUN\n');const at=new Date().toISOString();
 f.storage.insertCheck({runId:f.run.id,candidateCommit:commit,command:'check-one',status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath,logSha256:sha256(readFileSync(logPath))});
 return f.storage.saveRun({...f.storage.getRun(f.run.id),candidateCommit:commit,state:'ready_for_review',finishedAt:new Date().toISOString()});
}

test('V4 direct producer: explicit API captures admitted tree instead of mutable HEAD/workspace',t=>{
 const f=fixture(t);writeFileSync(join(f.repo,'sample.txt'),'different HEAD\n');f.git('add','sample.txt');f.git('commit','-qm','Other HEAD');writeFileSync(join(f.repo,'sample.txt'),'dirty workspace\n');
 const {snapshot,admission}=f.capture();assert.equal(snapshot.version,4);assert.equal(snapshot.inputCommit,f.inputCommit);assert.equal(snapshot.inputTree,f.inputTree);assert.notEqual(snapshot.inputTree,f.git('rev-parse','HEAD^{tree}'));
 assert.deepEqual(f.producer.snapshot(f.run,admission),snapshot);assert.deepEqual(f.producer.capture(f.work,f.run,'openai/gpt-5.4-mini','direct-synthetic-fixture'),snapshot);
 assert.equal(f.storage.listEvents(f.work.id).filter(e=>e.type===SNAPSHOT_EVENT).length,1);assert.equal(f.storage.listRuns(f.work.id).length,1);
});
test('V4 direct producer: V1 and V3 defaults remain exact and cannot upgrade the same run',t=>{
 for(const version of [1,3]){const f=fixture(t),legacy=new ProducerResults(f.storage,f.dir,{...f.options,...(version===3?{sessionMetadata:true}:{})});
  const snapshot=legacy.capture(f.work,f.run,'openai/gpt-5.4-mini','direct-synthetic-fixture');assert.equal(snapshot.version,version);assert.equal(Object.hasOwn(snapshot,'inputTree'),false);assert.equal(Object.hasOwn(snapshot,'workspace'),version===3);
  assert.throws(f.capture,/Conflicting immutable/);assert.deepEqual(legacy.snapshot(f.run),snapshot);
 }
});
test('V4 direct producer: shared options and configuration never select V4',t=>{
 const f=fixture(t);assert.throws(()=>new LocalProducerResultsV4(f.storage,f.dir,{...f.options,sessionMetadata:true}),/signing options/);
 assert.throws(()=>new LocalProducerResultsV4(f.storage,f.dir,{...f.options,localDeliverySnapshotVersion:4}),/signing options/);
 writeFileSync(join(f.dir,'result-signing.json'),JSON.stringify({factoryId:f.options.factoryId,currentKeyId:f.options.currentKeyId,keys:f.options.keys,localDeliverySnapshotVersion:4}));
 assert.throws(()=>producerOptions(f.dir),/Invalid result signing configuration/);
});
test('V4 direct producer: legacy snapshot and read reject retained V4 even while nonterminal',t=>{
 const f=fixture(t);f.capture();const legacy=new ProducerResults(f.storage,f.dir,f.options);
 assert.throws(()=>legacy.snapshot(f.run),/explicit V4/);assert.throws(()=>legacy.read(f.run),/explicit V4/);
});
test('V4 direct producer: caller-mutated Work, run, repository and missing objects never persist a snapshot',t=>{
 for(const change of [f=>[{...f.work,title:'forged'},f.run],f=>[f.work,{...f.run,attemptNumber:2}],f=>[{...f.work,repositoryPath:f.dir},f.run],f=>[f.work,{...f.run,inputCommit:'f'.repeat(40)}]]){
  const f=fixture(t),[work,run]=change(f);assert.throws(()=>f.producer.capture(work,run,'openai/gpt-5.4-mini','direct-synthetic-fixture'),/Exact stored/);assert.equal(readRunRecord(f.storage,f.run,SNAPSHOT_EVENT),null);
 }
 const f=fixture(t);f.git('update-ref','refs/heads/another',f.inputCommit);rmSync(join(f.repo,'.git','objects',f.inputCommit.slice(0,2),f.inputCommit.slice(2)));
 assert.throws(f.capture);assert.equal(readRunRecord(f.storage,f.run,SNAPSHOT_EVENT),null);
});
test('V4 direct producer: unknown and running outcomes return no result; missing snapshot cannot backfill',t=>{
 for(const state of ['planning','interrupted']){const f=fixture(t),{admission}=f.capture();f.storage.saveRun({...f.run,state});const read=f.producer.read(f.run,admission);assert.equal(read.result,null);assert.equal(read.state,state==='interrupted'?'UNKNOWN':'RUNNING');assert.equal(readRunRecord(f.storage,f.run,RESULT_EVENT),null);}
 const f=fixture(t),run=f.finish();assert.throws(()=>f.producer.read(run,{work:f.work,expected:{}}),/no execution snapshot/);assert.equal(readRunRecord(f.storage,f.run,SNAPSHOT_EVENT),null);
});
test('V4 direct producer: exact trusted expectations and Work spec are required for retained reads',t=>{
 const f=fixture(t),{admission}=f.capture();
 for(const field of ['inputCommit','inputTree','requestId','requestDigest','factoryVersion','sourceDigest','configurationDigest','runId','workOrderId']) assert.throws(()=>f.producer.snapshot(f.run,{...admission,expected:{...admission.expected,[field]:'f'.repeat(64)}}),/binding/);
 assert.throws(()=>f.producer.snapshot(f.run,{...admission,work:{...f.work,title:'other'}}),/Work binding/);
 f.storage.saveWorkOrder({...f.work,allowedPaths:['different.txt']});assert.throws(()=>f.producer.snapshot(f.run,admission),/Work binding/);
});
test('V4 direct producer: known synthetic candidate freezes exact result and survives SQLite reopen',t=>{
 const f=fixture(t),{snapshot,admission}=f.capture(),run=candidate(f),result=f.producer.read(run,admission).result;
 assert.ok(result);const {manifest}=verifyLocalResultV4(result,{keys:f.options.keys,expected:admission.expected});assert.equal(manifest.status,'COMPLETED');assert.deepEqual(manifest.execution,snapshot);assert.equal(manifest.artifacts.length,4);assert.equal(manifest.evidence.length,1);assert.deepEqual(f.producer.finalize(run,admission),result);
 const reopened=openStorage(f.path);try{assert.deepEqual(new LocalProducerResultsV4(reopened,f.dir,f.options).read(run,admission).result,result);}finally{reopened.close();}
 assert.throws(()=>verifyResult(result,{keys:f.options.keys,factoryId:f.options.factoryId,requestId:snapshot.requestId,workOrderId:run.workOrderId,runId:run.id,factoryVersion:snapshot.factoryVersion}));
 assert.throws(()=>new ProducerResults(f.storage,f.dir,f.options).read(run),/explicit V4/);
 assert.equal(f.storage.listEvents(f.work.id).filter(e=>e.type===RESULT_EVENT).length,1);assert.equal(f.storage.listRuns(f.work.id).length,1);
 const changed=structuredClone(result);changed.artifacts[0].base64=Buffer.from('altered').toString('base64');assert.throws(()=>verifyLocalResultV4(changed,{keys:f.options.keys,expected:admission.expected}));
 assert.equal(snapshot.sourceDigest,sourceIdentity());assert.equal(snapshot.factoryVersion,digest({sourceDigest:snapshot.sourceDigest,configurationDigest:snapshot.configurationDigest}));
});
test('V4 direct producer: altered check artifacts and changed terminal Run do not freeze a Result',t=>{
 const f=fixture(t),{admission}=f.capture(),run=candidate(f);writeFileSync(join(f.dir,'artifacts',run.id,'check.log'),'changed');
 assert.throws(()=>f.producer.finalize(run,admission),/Check log changed/);assert.equal(readRunRecord(f.storage,run,RESULT_EVENT),null);
 assert.throws(()=>f.producer.finalize({...run,workspacePath:f.dir},admission),/Exact terminal Run/);
});
test('V4 direct producer: failed no-candidate result is immutable without implying software verification',t=>{
 const f=fixture(t),{admission}=f.capture(),run=f.finish(),result=f.producer.finalize(run,admission);const {manifest}=verifyLocalResultV4(result,{keys:f.options.keys,expected:admission.expected});
 assert.equal(manifest.status,'FAILED');assert.equal(manifest.candidate,null);assert.deepEqual(manifest.evidence,[]);assert.deepEqual(manifest.artifacts,[]);assert.deepEqual(f.producer.read(run,admission).result,result);
});

test('V4 direct producer: admission and terminal freeze races refuse before persistence',t=>{
 const f=fixture(t),transaction=f.storage.transaction.bind(f.storage);let changed=false;
 f.storage.transaction=operation=>{if(!changed){changed=true;f.storage.saveWorkOrder({...f.work,title:'racing replacement'});}return transaction(operation);};
 assert.throws(f.capture,/Admission changed/);assert.equal(readRunRecord(f.storage,f.run,SNAPSHOT_EVENT),null);
 const g=fixture(t),{admission}=g.capture(),run=candidate(g),freeze=g.storage.transaction.bind(g.storage);let frozen=false;
 g.storage.transaction=operation=>{if(!frozen){frozen=true;g.storage.saveRun({...run,state:'failed'});}return freeze(operation);};
 assert.throws(()=>g.producer.finalize(run,admission),/changed|differs/);assert.equal(readRunRecord(g.storage,run,RESULT_EVENT),null);
});
test('V4 direct producer: ordinary fixture creates no spend budgets or charge operations',t=>{
 const f=fixture(t),{admission}=f.capture();f.producer.finalize(f.finish(),admission);
 const db=new DatabaseSync(f.path,{readOnly:true});try{
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM work_spend_budgets').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM work_spend_operations').get().n,0);
 }finally{db.close();}
});
test('V4 direct producer: shared artifact extraction preserves legacy V1 and V3 terminal signing',t=>{
 for(const version of [1,3]){
  const f=fixture(t),legacy=new ProducerResults(f.storage,f.dir,{...f.options,...(version===3?{sessionMetadata:true}:{})});
  const snapshot=legacy.capture(f.work,f.run,'openai/gpt-5.4-mini','direct-synthetic-fixture'),run=candidate(f),result=legacy.read(run).result;
  const {manifest}=verifyResult(result,{keys:f.options.keys,factoryId:snapshot.factoryId,requestId:snapshot.requestId,workOrderId:run.workOrderId,runId:run.id,factoryVersion:snapshot.factoryVersion});
  assert.deepEqual(manifest.execution,snapshot);assert.equal(manifest.status,'COMPLETED');assert.equal(manifest.artifacts.length,4);assert.equal(manifest.evidence.length,1);assert.deepEqual(legacy.finalize(run),result);
  const reopened=openStorage(f.path);try{assert.deepEqual(new ProducerResults(reopened,f.dir,f.options).read(run).result,result);}finally{reopened.close();}
 }
});

test('V4 direct producer: duplicate candidate event arriving at freeze refuses the Result',t=>{
 const f=fixture(t),{admission}=f.capture(),run=candidate(f),transaction=f.storage.transaction.bind(f.storage);let changed=false;
 const original=f.storage.listEvents(f.work.id).find(e=>e.type==='run.candidate_committed');
 f.storage.transaction=operation=>{if(!changed){changed=true;f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:original.type,payload:original.payload});}return transaction(operation);};
 assert.throws(()=>f.producer.finalize(run,admission),/Attempt changed/);assert.equal(readRunRecord(f.storage,run,RESULT_EVENT),null);
});

test('V4 direct producer: key expiration during object reads cannot admit a snapshot',t=>{
 const f=fixture(t),transaction=f.storage.transaction.bind(f.storage),originalNow=Date.now;let changed=false;
 f.storage.transaction=operation=>{if(!changed){changed=true;Date.now=()=>Date.parse('2100-01-01T00:00:00Z');}return transaction(operation);};
 try{assert.throws(f.capture,/Signing key expired/);assert.equal(readRunRecord(f.storage,f.run,SNAPSHOT_EVENT),null);}finally{Date.now=originalNow;}
});

for(const version of [1,3])test(`Legacy direct producer: V${version} duplicate candidate event at freeze refuses the Result`,t=>{
 const f=fixture(t),legacy=new ProducerResults(f.storage,f.dir,{...f.options,...(version===3?{sessionMetadata:true}:{})});
 legacy.capture(f.work,f.run,'openai/gpt-5.4-mini','direct-synthetic-fixture');
 const run=candidate(f),transaction=f.storage.transaction.bind(f.storage);let changed=false,failure=null;
 const original=f.storage.listEvents(f.work.id).find(e=>e.type==='run.candidate_committed');
 f.storage.transaction=operation=>{if(!changed){changed=true;f.storage.appendEvent({workOrderId:f.work.id,runId:run.id,type:original.type,payload:original.payload});}return transaction(operation);};
 try{legacy.finalize(run);}catch(error){failure=error;}
 const result=readRunRecord(f.storage,run,RESULT_EVENT),candidateEvents=f.storage.listEvents(f.work.id).filter(e=>e.type==='run.candidate_committed').length;
 console.log('LEGACY_FREEZE_PROBE '+JSON.stringify({version,candidateEvents,resultPersisted:result!==null}));
 assert.ok(failure,'Ambiguous candidate history must refuse finalization');assert.match(failure.message,/Attempt changed/);assert.equal(result,null);
});
