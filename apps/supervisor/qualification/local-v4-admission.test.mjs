// Actual pinned Mac Git capture in fresh synthetic repositories. No model,
// provider, protected verifier, historical custody or paid Work is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {LocalProducerResultsV4,ProducerResults,LOCAL_V4_ADMISSION_EVENT,SNAPSHOT_EVENT,RESULT_EVENT,readRunRecord} from '../src/producer-results.ts';
import {verifyLocalResultV4} from '../../../packages/hosted-routing/src/result.ts';
const GIT='/opt/homebrew/Cellar/git/2.48.1/bin/git';
const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:''};
function fixture(t,gitBinary=GIT){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'local-v4-admission-'))),repo=join(dir,'repo');mkdirSync(repo);
 const git=(...args)=>execFileSync(gitBinary,['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-C',repo,...args],{env,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}).trim();
 git('init','-q','--template=');git('config','user.name','Ordinary producer fixture');git('config','user.email','producer@example.invalid');
 writeFileSync(join(repo,'sample.txt'),'before\n');git('add','sample.txt');git('commit','-qm','Admitted input');
 const inputCommit=git('rev-parse','HEAD'),inputTree=git('rev-parse','HEAD^{tree}');
 const path=join(dir,'factory.sqlite'),storage=openStorage(path);
 const created=storage.createWorkOrder({title:'Direct local producer fixture',description:'Ordinary synthetic artifacts only',kind:'feature',repositoryPath:repo,baseRef:inputCommit,acceptanceCriteria:['Inspect exact signed bytes'],reproductionCommand:null,expectedFailureText:null,checkCommands:['check-one'],allowedPaths:['sample.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),run=storage.createRun({workOrderId:work.id,workerProfile:'mac',inputCommit,workspacePath:repo});
 const pair=generateKeyPairSync('ed25519'),options={factoryId:'local-v4-direct-fixture',currentKeyId:'ephemeral-test-key',privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[{factoryId:'local-v4-direct-fixture',keyId:'ephemeral-test-key',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'}]};
 const producer=new LocalProducerResultsV4(storage,dir,options);
 t.after(()=>{storage.close();rmSync(dir,{recursive:true,force:true});});
 const capture=()=>{const snapshot=producer.captureAdmitted(work,run,'openai/gpt-5.4-mini','direct-synthetic-fixture');return {snapshot,admission:producer.admission(storage.getRun(run.id))};};
 const finish=(state='failed')=>storage.saveRun({...storage.getRun(run.id),state,finishedAt:new Date().toISOString()});
 return {dir,repo,path,storage,work,run,options,producer,git,gitBinary,inputCommit,inputTree,capture,finish};
}
const pairEvents=f=>f.storage.listEvents(f.work.id).filter(e=>[SNAPSHOT_EVENT,LOCAL_V4_ADMISSION_EVENT].includes(e.type));
test('actual pinned Mac V4 admission: captures exact admitted tree and one detached original pair',t=>{
 const f=fixture(t);writeFileSync(join(f.repo,'sample.txt'),'other HEAD\n');f.git('add','sample.txt');f.git('commit','-qm','Other head');writeFileSync(join(f.repo,'sample.txt'),'dirty workspace\n');
 const {snapshot}=f.capture();assert.equal(snapshot.inputCommit,f.inputCommit);assert.equal(snapshot.inputTree,f.inputTree);assert.notEqual(snapshot.inputTree,f.git('rev-parse','HEAD^{tree}'));
 const admission=f.producer.admission(f.run);assert.deepEqual(admission.work,f.work);assert.equal(admission.expected.inputTree,f.inputTree);assert.equal(pairEvents(f).length,2);
 const before=f.storage.listEvents(f.work.id);assert.deepEqual(f.capture().snapshot,snapshot);assert.deepEqual(f.storage.listEvents(f.work.id),before);
});
for(const type of [SNAPSHOT_EVENT,LOCAL_V4_ADMISSION_EVENT])for(const when of ['before','after'])test(`actual pinned Mac V4 admission: ${when} ${type} append failure rolls back both records`,t=>{
 const f=fixture(t),append=f.storage.appendEvent.bind(f.storage);f.storage.appendEvent=event=>{
  if(event.type===type&&when==='before')throw Error('INJECTED_PAIR_APPEND');const result=append(event);if(event.type===type&&when==='after')throw Error('INJECTED_PAIR_APPEND');return result;
 };
 assert.throws(f.capture,/INJECTED_PAIR_APPEND/);assert.equal(pairEvents(f).length,0);assert.equal(f.storage.listRuns(f.work.id).length,1);
});
test('actual pinned Mac V4 admission: enclosing run creation rollback leaves no new run or pair',t=>{
 const f=fixture(t),before=f.storage.listRuns(f.work.id);let attempted;
 assert.throws(()=>f.storage.transaction(()=>{attempted=f.storage.createRun({workOrderId:f.work.id,workerProfile:'mac',inputCommit:f.inputCommit,workspacePath:f.repo});
  f.producer.captureAdmitted(f.work,attempted,'openai/gpt-5.4-mini','direct-synthetic-fixture');throw Error('INJECTED_OUTER_ROLLBACK');}),/INJECTED_OUTER_ROLLBACK/);
 assert.deepEqual(f.storage.listRuns(f.work.id),before);assert.equal(f.storage.getRun(attempted.id),null);assert.equal(pairEvents(f).length,0);
});
test('actual pinned Mac V4 admission: detaches inputs before storage hooks',t=>{
 const f=fixture(t),transaction=f.storage.transaction.bind(f.storage),title=f.work.title;let hooked=false;
 f.storage.transaction=action=>{if(!hooked){hooked=true;f.work.title='caller mutation';f.run.inputCommit='f'.repeat(40)}return transaction(action)};
 const {snapshot}=f.capture();assert.equal(snapshot.inputCommit,f.inputCommit);assert.equal(f.producer.admission(f.storage.getRun(f.run.id)).work.title,title);
});
test('actual pinned Mac V4 admission: stored Work mutation during append rolls back capture',t=>{
 const f=fixture(t),append=f.storage.appendEvent.bind(f.storage);f.storage.appendEvent=event=>{const result=append(event);if(event.type===LOCAL_V4_ADMISSION_EVENT)f.storage.saveWorkOrder({...f.work,title:'changed during append'});return result};
 assert.throws(f.capture,/Work binding/);assert.equal(pairEvents(f).length,0);assert.equal(f.storage.getWorkOrder(f.work.id).title,f.work.title);
});
test('actual pinned Mac V4 admission: existing explicit snapshot cannot be backfilled',t=>{
 const f=fixture(t);f.producer.capture(f.work,f.run,'openai/gpt-5.4-mini','direct-synthetic-fixture');const before=f.storage.listEvents(f.work.id);
 assert.throws(f.capture,/cannot backfill/);assert.deepEqual(f.storage.listEvents(f.work.id),before);assert.equal(pairEvents(f).length,1);
});
test('actual pinned Mac V4 admission: signed failed result and original admission survive reopen',t=>{
 const f=fixture(t),{snapshot}=f.capture(),run=f.finish(),result=f.producer.finalizeAdmitted(run);
 const {manifest}=verifyLocalResultV4(result,{keys:f.options.keys,expected:f.producer.admission(run).expected});assert.equal(manifest.status,'FAILED');assert.equal(manifest.candidate,null);assert.deepEqual(manifest.execution,snapshot);
 const reopened=openStorage(f.path);try{assert.deepEqual(new LocalProducerResultsV4(reopened,f.dir,f.options).readAdmitted(run).result,result)}finally{reopened.close()}
 assert.throws(f.capture,/Completed local V4 capture/);assert.equal(pairEvents(f).length,2);assert.equal(f.storage.listEvents(f.work.id).filter(e=>e.type===RESULT_EVENT).length,1);
});
test('actual pinned Mac V4 admission: current revoked key denies capture before Git',t=>{
 const f=fixture(t),options={...f.options,keys:f.options.keys.map(k=>({...k,revokedAt:new Date().toISOString()}))},producer=new LocalProducerResultsV4(f.storage,f.dir,options);let captures=0;
 producer.capture=()=>{captures++;throw Error('UNEXPECTED_CAPTURE')};assert.throws(()=>producer.captureAdmitted(f.work,f.run,'openai/gpt-5.4-mini','direct-synthetic-fixture'),/Current producer signing key/);assert.equal(captures,0);assert.equal(pairEvents(f).length,0);
});
test('actual pinned Mac V4 admission: key expiry during original append rolls back the pair',t=>{
 const f=fixture(t),append=f.storage.appendEvent.bind(f.storage),originalNow=Date.now;
 f.storage.appendEvent=event=>{const result=append(event);if(event.type===LOCAL_V4_ADMISSION_EVENT)Date.now=()=>Date.parse('2100-01-01T00:00:00Z');return result};
 try{assert.throws(f.capture,/Current producer signing key/);assert.equal(pairEvents(f).length,0)}finally{Date.now=originalNow}
});
test('actual pinned Mac V4 admission: no spend budget or charge operation is created',t=>{
 const f=fixture(t);f.capture();const db=new DatabaseSync(f.path,{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM work_spend_budgets').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM work_spend_operations').get().n,0)}finally{db.close()}
});
