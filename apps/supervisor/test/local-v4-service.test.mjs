import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {LocalProducerResultsV4,ProducerResults,LOCAL_V4_ADMISSION_EVENT,SNAPSHOT_EVENT,RESULT_EVENT,saveRunRecord,sourceIdentity} from '../src/producer-results.ts';
import {digest,signLocalResultV4,RESULT_PROTOCOL} from '../../../packages/hosted-routing/src/result.ts';

import {LocalV4ServiceProducer} from '../src/service-producer.ts';
import {LocalExecutionProvider} from '../src/local-execution-provider.ts';
import {createLocalV4Supervisor} from '../src/server.ts';

// Portable public storage/read fixtures. Seeded records and signed data here
// are NOT actual Git capture, execution, independent verification or authority.
function fixture(t,seed='both'){
 const dir=mkdtempSync(join(tmpdir(),'v4-admission-records-')),path=join(dir,'factory.sqlite'),storage=openStorage(path);
 const created=storage.createWorkOrder({title:'Synthetic retained original admission',description:'No repository or provider access',kind:'feature',repositoryPath:dir,baseRef:'1'.repeat(40),acceptanceCriteria:['Public wire identity only'],reproductionCommand:null,expectedFailureText:null,checkCommands:['synthetic-never-executed'],allowedPaths:['sample.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),run=storage.createRun({workOrderId:work.id,workerProfile:'mac',inputCommit:'1'.repeat(40),workspacePath:dir});
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
 return {dir,path,storage,work,run,options,configuration,snapshot,record,append,producer,events,capture,freeze,service:new LocalV4ServiceProducer(storage,dir,options)};
}

test('V4 service: exact retained original reaches local provider collection without recapture',async t=>{
 const f=fixture(t),before=f.events();let checkpoints=0;
 const jobs={activeRun:()=>false,checkpointForRecovery:async()=>{checkpoints++}};
 const provider=new LocalExecutionProvider(f.storage,jobs,f.service,{processAbsent:()=>true,verifierAbsent:async()=>true,readiness:async()=>({ready:false,reason:'No executor in portable fixture'})});
 assert.deepEqual(f.service.snapshot(f.run),f.snapshot);
 assert.deepEqual(f.service.capture(f.work,f.run,f.configuration.model,f.configuration.executorVersion),f.snapshot);
 assert.deepEqual(await provider.collect(f.run),{state:'RUNNING',result:null});
 assert.equal(checkpoints,0);assert.deepEqual(f.events(),before);
});
for(const seed of ['none','snapshot','admission'])test(`V4 service: ${seed} original pair refuses before local collection`,async t=>{
 const f=fixture(t,seed),before=f.events();
 assert.throws(()=>f.service.snapshot(f.run),/cannot backfill/);
 assert.throws(()=>f.service.read(f.run),/cannot backfill/);
 assert.throws(()=>f.service.finalize(f.run),/cannot backfill/);
 const provider=new LocalExecutionProvider(f.storage,{activeRun:()=>false},f.service);
 await assert.rejects(provider.collect(f.run),/cannot backfill/);assert.deepEqual(f.events(),before);
});
for(const field of ['workOrderId','attemptNumber','inputCommit','workspacePath','workerProfile','startedAt'])test(`V4 service: stale ${field} refuses through the common service surface`,t=>{
 const f=fixture(t),wrong={...f.run,[field]:field==='attemptNumber'?2:'changed'};
 assert.throws(()=>f.service.snapshot(wrong),/Exact immutable/);
 assert.throws(()=>f.service.read(wrong),/Exact immutable/);
 assert.throws(()=>f.service.finalize(wrong),/Exact immutable/);
});
for(const version of [1,3])test(`V4 service: legacy V${version} never selects an alternate codec`,t=>{
 const f=fixture(t,'admission'),{inputTree,workspace,...snapshot}=f.snapshot;
 saveRunRecord(f.storage,f.run,SNAPSHOT_EVENT,{...snapshot,version,...(version===3?{workspace}:{})});
 const before=f.events();assert.throws(()=>f.service.snapshot(f.run));assert.throws(()=>f.service.read(f.run));assert.deepEqual(f.events(),before);
});
test('V4 service: duplicate original admission cannot become a service snapshot',t=>{
 const f=fixture(t);f.append(LOCAL_V4_ADMISSION_EVENT,f.record);assert.throws(()=>f.service.snapshot(f.run),/Ambiguous/);
});
test('V4 service: changed persisted Work invalidates every retained read',t=>{
 const f=fixture(t);f.storage.saveWorkOrder({...f.work,allowedPaths:['foreign.txt']});
 for(const method of ['snapshot','read','finalize'])assert.throws(()=>f.service[method](f.run),/Work binding/);
});
test('V4 service: original snapshot is detached from caller mutation',t=>{
 const f=fixture(t),snapshot=f.service.snapshot(f.run);snapshot.configuration.commands.push('caller');snapshot.inputTree='a'.repeat(40);
 assert.deepEqual(f.service.snapshot(f.run),f.snapshot);
});
for(const state of ['planning','interrupted','stopping'])test(`V4 service: ${state} exposes no signed terminal result`,t=>{
 const f=fixture(t);if(state==='stopping')f.append('run.cancel_requested',{});else f.storage.saveRun({...f.run,state});
 assert.deepEqual(f.service.read(f.run),{state:state==='interrupted'?'UNKNOWN':state==='stopping'?'STOPPING':'RUNNING',result:null});
 assert.equal(f.events().filter(e=>e.type===RESULT_EVENT).length,0);
});
test('V4 service: uncertain verifier resources prevent Result collection',async t=>{
 const f=fixture(t);f.append('run.candidate_committed',{candidateCommit:'3'.repeat(40)});let reads=0;
 const service={...f.service,read(){reads++;return f.service.read(f.run)}};
 const provider=new LocalExecutionProvider(f.storage,{activeRun:()=>false},service,{processAbsent:()=>true,verifierAbsent:async()=>{throw Error('unknown')},readiness:async()=>({ready:false,reason:'fixture'})});
 await assert.rejects(provider.collect(f.run),/not quiescent/);assert.equal(reads,0);
});
test('V4 service: signed synthetic failed receipt survives fresh service and SQLite reopen',t=>{
 const f=fixture(t),{finished,result}=f.freeze(),before=f.events(),reopened=openStorage(f.path);
 try{const service=new LocalV4ServiceProducer(reopened,f.dir,f.options);assert.deepEqual(service.read(finished).result,result);assert.deepEqual(service.finalize(finished),result)}finally{reopened.close()}
 assert.throws(()=>new ProducerResults(f.storage,f.dir,f.options).read(finished),/explicit V4/);assert.deepEqual(f.events(),before);
});
test('V4 service: metadata selector in signing options is refused',t=>{
 const f=fixture(t);assert.throws(()=>new LocalV4ServiceProducer(f.storage,f.dir,{...f.options,sessionMetadata:true}),/signing options/);
});

// Actual authenticated HTTP over seeded synthetic records. No actual capture,
// repository, worker, native verifier, protected test or provider is executed.
async function httpFixture(t){
 let supervisor;t.after(async()=>{if(supervisor)await supervisor.close()});const f=fixture(t);
 const client=(id,token,ownerScope,actions,purpose,expiresAt)=>({id,name:'Portable synthetic connection',tokenSha256:createHash('sha256').update(token).digest('hex'),repositoryPaths:[f.dir],ownerScope,actions,...(purpose?{purpose}:{}),...(expiresAt?{expiresAt}:{})});
 const clients=[client('original','a'.repeat(64),'owner:fixture',['factory.prepare','factory.observe','factory.dispatch','factory.stop']),client('same-owner-other-client','b'.repeat(64),'owner:fixture',['factory.observe']),client('other-owner','c'.repeat(64),'owner:other',['factory.observe']),client('proof','d'.repeat(64),'owner:fixture',['evidence.read'],'myeve-proof','2099-01-01T00:00:00Z')];
 const save=()=>writeFileSync(join(f.dir,'connections.json'),JSON.stringify({clients}));save();
 f.append('factory.owner_scope_bound',{ownerScope:'owner:fixture',clientId:'original'});
 supervisor=createLocalV4Supervisor({dataDir:f.dir,resultSigning:f.options});
 await new Promise((resolve,reject)=>{supervisor.server.once('error',reject);supervisor.server.listen(0,'127.0.0.1',resolve)});
 const origin='http://127.0.0.1:'+supervisor.server.address().port;
 const request=async(path,token='a'.repeat(64),body)=>{const res=await fetch(origin+'/api/connect/v1/'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,body:await res.json()}};
 const paths=[`work-orders/${f.work.id}/runs/${f.run.id}/result`,'work-orders','work-orders/'+f.work.id];
 return {...f,request,paths,change(id,fn){fn(clients.find(c=>c.id===id));save()}};
}
test('portable V4 HTTP: exact original client reads seeded current attempt without execution',async t=>{
 const f=await httpFixture(t);for(const path of f.paths)assert.equal((await f.request(path)).status,200);assert.equal((await f.request(f.paths[0])).body.result,null);assert.equal(f.events().filter(e=>e.type===RESULT_EVENT).length,0);
});
for(const token of ['b'.repeat(64),'c'.repeat(64)])test(`portable V4 HTTP: same real repository distinct ${token[0]==='b'?'client':'owner'} denies Result/detail and filters list`,async t=>{
 const f=await httpFixture(t);assert.equal((await f.request(f.paths[0],token)).status,404);assert.equal((await f.request(f.paths[2],token)).status,404);assert.deepEqual((await f.request('work-orders',token)).body.workOrders,[]);
});
test('portable V4 HTTP: current original-owner rebind cannot expose old Work',async t=>{
 const f=await httpFixture(t);f.change('original',c=>c.ownerScope='owner:changed');assert.equal((await f.request(f.paths[0])).status,404);assert.equal((await f.request(f.paths[2])).status,404);assert.deepEqual((await f.request('work-orders')).body.workOrders,[]);
});
for(const variant of ['no-grant','no-grant-or-expiry','nonfinite-expiry','expired'])test(`portable V4 HTTP: Proof credential ${variant} never exposes retained Work`,async t=>{
 const f=await httpFixture(t);f.change('proof',c=>{if(variant!=='expired')c.actions=[];if(variant==='no-grant-or-expiry')delete c.expiresAt;if(variant==='nonfinite-expiry')c.expiresAt='not-a-date';if(variant==='expired')c.expiresAt='2020-01-01T00:00:00Z'});
 for(const path of f.paths)assert.equal((await f.request(path,'d'.repeat(64))).status,variant==='expired'?401:403);
});
test('portable V4 HTTP: current same-owner Proof read grant may read, then removal fences all reads',async t=>{
 const f=await httpFixture(t);for(const path of f.paths)assert.equal((await f.request(path,'d'.repeat(64))).status,200);f.change('proof',c=>c.actions=[]);for(const path of f.paths)assert.equal((await f.request(path,'d'.repeat(64))).status,403);
});
test('portable V4 HTTP: current ordinary observation grant is required before data access',async t=>{
 const f=await httpFixture(t);f.change('original',c=>c.actions=c.actions.filter(a=>a!=='factory.observe'));for(const path of f.paths)assert.equal((await f.request(path)).status,403);assert.equal(f.events().filter(e=>e.type===RESULT_EVENT).length,0);
});
test('portable V4 HTTP: Proof purpose cannot acquire controls from extra configured actions',async t=>{
 const f=await httpFixture(t);f.change('proof',c=>c.actions.push('factory.prepare','factory.observe','factory.dispatch','factory.stop'));
 for(const [path,body] of [['dispatches',{}],['dispatches/'+f.run.id,undefined],['dispatches/'+f.run.id+'/dispatch',{}],['dispatches/'+f.run.id+'/stop',{}]])assert.equal((await f.request(path,'d'.repeat(64),body)).status,403);
});
test('portable V4 HTTP: generic connected writes cannot introduce a parallel intake',async t=>{
 const f=await httpFixture(t);const before=f.events();assert.equal((await f.request('actions','a'.repeat(64),{action:'workorder.create',input:{}})).status,503);assert.deepEqual(f.events(),before);
});

for(const value of ['00000000-0000-4000-8000-000000000001',null,'',false])test(`portable V4 HTTP: repair field presence ${JSON.stringify(value)} refuses without state mutation`,async t=>{
 const f=await httpFixture(t),before=f.events(),orders=f.storage.listWorkOrders();const response=await f.request('dispatches','a'.repeat(64),{repairWorkOrderId:value});assert.equal(response.status,503);assert.deepEqual(f.events(),before);assert.deepEqual(f.storage.listWorkOrders(),orders);assert.equal(f.events().filter(e=>e.type===RESULT_EVENT).length,0);
});
