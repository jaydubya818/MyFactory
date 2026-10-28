import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {LocalProducerResultsV4,ProducerResults,LOCAL_V4_ADMISSION_EVENT,SNAPSHOT_EVENT,RESULT_EVENT,saveRunRecord,sourceIdentity} from '../src/producer-results.ts';
import {digest,signLocalResultV4,RESULT_PROTOCOL} from '../../../packages/hosted-routing/src/result.ts';

// Portable public storage/read fixtures. Seeded records and signed data here
// are NOT actual Git capture, execution, independent verification or authority.
function fixture(t,seed='both'){
 const dir=mkdtempSync(join(tmpdir(),'v4-admission-records-')),path=join(dir,'factory.sqlite'),storage=openStorage(path);
 const created=storage.createWorkOrder({title:'Synthetic retained original admission',description:'No repository or provider access',kind:'feature',repositoryPath:'/synthetic/not-accessed',baseRef:'1'.repeat(40),acceptanceCriteria:['Public wire identity only'],reproductionCommand:null,expectedFailureText:null,checkCommands:['synthetic-never-executed'],allowedPaths:['sample.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),run=storage.createRun({workOrderId:work.id,workerProfile:'mac',inputCommit:'1'.repeat(40),workspacePath:'/synthetic/not-accessed'});
 const pair=generateKeyPairSync('ed25519'),options={factoryId:'synthetic-admission-fixture',currentKeyId:'ephemeral',privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[{factoryId:'synthetic-admission-fixture',keyId:'ephemeral',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'}]};
 const configuration={model:'openai/gpt-5.4-mini',executor:'codex-cli',executorVersion:'synthetic-portable-no-execution',skillRevision:'synthetic',workerProfile:'mac',verificationImage:'synthetic-never-used',nodeVersion:process.version,platform:'synthetic',architecture:'synthetic',commands:work.checkCommands,allowedPaths:work.allowedPaths,timeoutMs:1000};
 const sourceDigest=sourceIdentity(),configurationDigest=digest(configuration),requestId='local-workorder:'+work.id;
 const snapshot={version:4,inputCommit:run.inputCommit,inputTree:'2'.repeat(40),workspace:{kind:'GIT_WORKTREE',path:run.workspacePath,branch:null},factoryId:options.factoryId,factoryVersion:digest({sourceDigest,configurationDigest}),sourceDigest,configurationDigest,configuration,requestId,requestDigest:digest({requestId,work}),workOrderId:work.id,runId:run.id,attemptNumber:run.attemptNumber,capturedAt:run.startedAt};
 const {version,workspace,capturedAt,...expected}=structuredClone(snapshot),record={schema:'myfactory.local-producer-admission/v4',work:structuredClone(work),expected};
 const append=(type,payload)=>storage.appendEvent({workOrderId:work.id,runId:run.id,type,payload});
 if(['both','snapshot'].includes(seed))saveRunRecord(storage,run,SNAPSHOT_EVENT,snapshot);
 if(['both','admission'].includes(seed))append(LOCAL_V4_ADMISSION_EVENT,record);
 const producer=new LocalProducerResultsV4(storage,dir,options),events=()=>storage.listEvents(work.id);
 const capture=()=>producer.captureAdmitted(work,run,configuration.model,configuration.executorVersion);
 const freeze=()=>{
  const finished=storage.saveRun({...run,state:'failed',finishedAt:new Date().toISOString()});
  const manifest={protocol:RESULT_PROTOCOL,keyId:options.currentKeyId,producer:options.factoryId,operationId:digest([RESULT_PROTOCOL,options.factoryId,snapshot.requestId,work.id,run.id]),execution:snapshot,status:'FAILED',candidate:null,evidence:[],artifacts:[],evidenceDigest:digest([]),artifactDigest:digest([]),completedAt:finished.finishedAt,issuedAt:new Date().toISOString()};
  const result=signLocalResultV4(manifest,[],options.privateKey);saveRunRecord(storage,finished,RESULT_EVENT,result);return {finished,result};
 };
 t.after(()=>{storage.close();rmSync(dir,{recursive:true,force:true})});
 return {dir,path,storage,work,run,options,configuration,snapshot,record,append,producer,events,capture,freeze};
}

test('retained V4 admission: exact portable replay does not recapture or append',t=>{
 const f=fixture(t),before=f.events();f.producer.capture=()=>{throw Error('UNEXPECTED_GIT_CAPTURE')};
 assert.deepEqual(f.capture(),f.snapshot);assert.deepEqual(f.events(),before);assert.deepEqual(f.producer.readAdmitted(f.run),{state:'RUNNING',result:null});
 assert.deepEqual(f.producer.admission(f.run),{work:f.work,expected:f.record.expected});
});
test('retained V4 admission: returned values are detached',t=>{
 const f=fixture(t),value=f.producer.admission(f.run),snapshot=f.capture();value.work.title='changed';value.expected.configuration.commands.push('changed');snapshot.configuration.allowedPaths.length=0;
 assert.deepEqual(f.producer.admission(f.run),{work:f.work,expected:f.record.expected});assert.deepEqual(f.capture(),f.snapshot);
});
for(const seed of ['snapshot','admission'])test(`retained V4 admission: ${seed}-only record is never backfilled`,t=>{
 const f=fixture(t,seed),before=f.events();let captures=0;f.producer.capture=()=>{captures++;throw Error('UNEXPECTED_CAPTURE')};
 assert.throws(f.capture,/cannot backfill/);assert.throws(()=>f.producer.admission(f.run),/cannot backfill/);assert.throws(()=>f.producer.readAdmitted(f.run),/cannot backfill/);assert.throws(()=>f.producer.finalizeAdmitted(f.run),/cannot backfill/);
 assert.equal(captures,0);assert.deepEqual(f.events(),before);
});
for(const type of [SNAPSHOT_EVENT,LOCAL_V4_ADMISSION_EVENT,RESULT_EVENT])test(`retained V4 admission: duplicate ${type} denies even equal bytes`,t=>{
 const f=fixture(t);if(type===RESULT_EVENT)f.freeze();const row=f.events().find(e=>e.type===type);f.append(type,row.payload);
 assert.throws(()=>f.producer.admission(f.run),/Ambiguous/);assert.throws(f.capture,/Ambiguous/);
});
for(const value of [null,{},false])test(`retained V4 admission: invalid payload ${JSON.stringify(value)} is refused by storage or original reader`,t=>{
 const f=fixture(t,'none');
 if(value===null||typeof value!=='object'){
  const before=f.events();assert.throws(()=>f.append(SNAPSHOT_EVENT,value),/CHECK constraint/);assert.throws(()=>f.append(LOCAL_V4_ADMISSION_EVENT,value),/CHECK constraint/);assert.deepEqual(f.events(),before);return;
 }
 f.append(SNAPSHOT_EVENT,value);f.append(LOCAL_V4_ADMISSION_EVENT,value);let captures=0;f.producer.capture=()=>{captures++;throw Error('UNEXPECTED_CAPTURE')};const before=f.events();
 assert.throws(f.capture);assert.equal(captures,0);assert.deepEqual(f.events(),before);
});
for(const version of [1,3])test(`retained V4 admission: legacy V${version} pair cannot be upgraded`,t=>{
 const f=fixture(t,'admission'),{inputTree,workspace,...snapshot}=f.snapshot;
 saveRunRecord(f.storage,f.run,SNAPSHOT_EVENT,{...snapshot,version,...(version===3?{workspace}:{})});const before=f.events();
 assert.throws(f.capture);assert.throws(()=>f.producer.admission(f.run));assert.deepEqual(f.events(),before);
});
for(const field of ['workOrderId','attemptNumber','inputCommit','workspacePath','workerProfile','startedAt'])test(`retained V4 admission: stale immutable run ${field} denies`,t=>{
 const f=fixture(t),wrong={...f.run,[field]:field==='attemptNumber'?2:'different'};
 assert.throws(()=>f.producer.admission(wrong),/Exact immutable/);assert.throws(()=>f.producer.readAdmitted(wrong),/Exact immutable/);
});
for(const field of ['inputCommit','inputTree','requestId','requestDigest','factoryVersion','sourceDigest','configurationDigest','runId','workOrderId','attemptNumber','configuration'])test(`retained V4 admission: changed expected ${field} is refused`,t=>{
 const f=fixture(t,'snapshot'),record=structuredClone(f.record);record.expected[field]=field==='attemptNumber'?2:field==='configuration'?{...record.expected.configuration,commands:['other']}:'f'.repeat(40);f.append(LOCAL_V4_ADMISSION_EVENT,record);
 assert.throws(()=>f.producer.admission(f.run));assert.throws(f.capture);
});
test('retained V4 admission: source record cannot add authority or unknown schema',t=>{
 for(const change of [r=>r.spendingAuthority=true,r=>r.schema='unknown',r=>r.work.extra=true,r=>r.expected.extra=true,r=>r.work.syncToLinear='yes']){
  const f=fixture(t,'snapshot'),record=structuredClone(f.record);change(record);f.append(LOCAL_V4_ADMISSION_EVENT,record);assert.throws(()=>f.producer.admission(f.run));
 }
});
test('retained V4 admission: changed original or current Work is refused',t=>{
 const a=fixture(t,'snapshot'),record=structuredClone(a.record);record.work.title='other';a.append(LOCAL_V4_ADMISSION_EVENT,record);assert.throws(()=>a.producer.admission(a.run),/Work binding/);
 const b=fixture(t);b.storage.saveWorkOrder({...b.work,allowedPaths:['other.txt']});assert.throws(()=>b.producer.admission(b.run),/Work binding/);
});
test('retained V4 admission: getters and hidden input fields never execute or disappear',t=>{
 const f=fixture(t);let reads=0;const work={...f.work};Object.defineProperty(work,'title',{enumerable:true,get(){reads++;return f.work.title}});
 assert.throws(()=>f.producer.captureAdmitted(work,f.run,f.configuration.model,f.configuration.executorVersion));assert.equal(reads,0);
 const run={...f.run};Object.defineProperty(run,'hidden',{value:'not JSON'});assert.throws(()=>f.producer.admission(run));
 const symbol={...f.work,[Symbol('hidden')]:true};assert.throws(()=>f.producer.captureAdmitted(symbol,f.run,f.configuration.model,f.configuration.executorVersion));
});
for(const state of ['planning','interrupted','stopping'])test(`retained V4 admission: ${state} returns no Result or new execution`,t=>{
 const f=fixture(t);if(state==='stopping')f.append('run.cancel_requested',{});else f.storage.saveRun({...f.run,state});
 assert.deepEqual(f.producer.readAdmitted(f.run),{state:state==='interrupted'?'UNKNOWN':state==='stopping'?'STOPPING':'RUNNING',result:null});
 assert.equal(f.events().filter(e=>e.type===RESULT_EVENT).length,0);
});
test('retained V4 admission: frozen synthetic signing bytes survive SQLite reopen',t=>{
 const f=fixture(t),{finished,result}=f.freeze(),before=f.events();const reopened=openStorage(f.path);
 try{const producer=new LocalProducerResultsV4(reopened,f.dir,f.options);assert.deepEqual(producer.readAdmitted(finished).result,result);assert.deepEqual(producer.finalizeAdmitted(finished),result)}finally{reopened.close()}
 assert.throws(f.capture,/Completed local V4 capture/);assert.deepEqual(f.events(),before);assert.throws(()=>new ProducerResults(f.storage,f.dir,f.options).read(finished),/explicit V4/);
});
test('retained V4 admission: historical signed replay never grants current capture',t=>{
 const f=fixture(t),{finished,result}=f.freeze(),revoked={...f.options,keys:f.options.keys.map(k=>({...k,revokedAt:new Date().toISOString()}))};
 const producer=new LocalProducerResultsV4(f.storage,f.dir,revoked);assert.deepEqual(producer.readAdmitted(finished).result,result);
 assert.throws(()=>producer.captureAdmitted(f.work,f.run,f.configuration.model,f.configuration.executorVersion),/Current producer signing key/);
});
test('retained V4 admission: exact replay refuses changed model or executor version',t=>{
 const f=fixture(t),before=f.events();assert.throws(()=>f.producer.captureAdmitted(f.work,f.run,'other/model',f.configuration.executorVersion),/Conflicting/);
 assert.throws(()=>f.producer.captureAdmitted(f.work,f.run,f.configuration.model,'other'),/Conflicting/);assert.deepEqual(f.events(),before);
});
test('retained V4 admission: no synthetic Work budget or charge is created',t=>{
 const f=fixture(t);f.producer.readAdmitted(f.run);const db=new DatabaseSync(f.path,{readOnly:true});
 try{assert.equal(db.prepare('SELECT count(*) n FROM work_spend_budgets').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM work_spend_operations').get().n,0)}finally{db.close()}
});
