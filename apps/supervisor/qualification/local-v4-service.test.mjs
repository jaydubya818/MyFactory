// Actual pinned Mac Git + owned loopback service fixtures. All workers/checks
// below are synthetic; no model, provider, Docker or protected verifier runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createSupervisor,createLocalV4Supervisor} from '../src/server.ts';
import {LOCAL_V4_ADMISSION_EVENT,SNAPSHOT_EVENT,RESULT_EVENT,LocalProducerResultsV4} from '../src/producer-results.ts';
import {verifyLocalResultV4,verifyResult} from '../../../packages/hosted-routing/src/result.ts';
const GIT='/opt/homebrew/Cellar/git/2.48.1/bin/git';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,accept){const end=performance.now()+10000;while(performance.now()<end){const value=await read();if(accept(value))return value;await sleep(5)}throw Error('Owned synthetic service did not reach expected state')}
async function fixture(t,{mode='v4',worker,localFactoryFixture=true,localSpendFixture,keys,verifierObserved=true}={}){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'v4-service-'))),repo=join(dir,'repo'),dataDir=join(dir,'data');mkdirSync(repo);mkdirSync(dataDir);
 const git=(...args)=>execFileSync(GIT,['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-C',repo,...args],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}).trim();
 git('init','-q','--template=','--object-format=sha1');git('config','user.name','Ordinary service fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(repo,'sample.txt'),'before\n');git('add','sample.txt');git('commit','-qm','Base');
 const pair=generateKeyPairSync('ed25519'),token='a'.repeat(64),key={factoryId:'local-v4-service-fixture',keyId:'ephemeral',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const resultSigning={factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:keys?keys(key):[key]};
 const clients=[{id:'fixture-owner',name:'Synthetic owner',tokenSha256:createHash('sha256').update(token).digest('hex'),repositoryPaths:[repo],ownerScope:'owner:fixture',actions:['factory.prepare','factory.dispatch','factory.observe','factory.stop']},{id:'foreign-owner',name:'Other synthetic owner',purpose:'myeve-proof',expiresAt:'2099-01-01T00:00:00Z',tokenSha256:createHash('sha256').update('b'.repeat(64)).digest('hex'),repositoryPaths:[repo],ownerScope:'owner:other',actions:['evidence.read','factory.observe']},{id:'same-owner-proof',name:'Synthetic Proof reader',purpose:'myeve-proof',expiresAt:'2099-01-01T00:00:00Z',tokenSha256:createHash('sha256').update('d'.repeat(64)).digest('hex'),repositoryPaths:[repo],ownerScope:'owner:fixture',actions:['evidence.read']},{id:'other-client',name:'Same owner different client',tokenSha256:createHash('sha256').update('e'.repeat(64)).digest('hex'),repositoryPaths:[repo],ownerScope:'owner:fixture',actions:['factory.observe']},{id:'other-ordinary-owner',name:'Different ordinary owner',tokenSha256:createHash('sha256').update('f'.repeat(64)).digest('hex'),repositoryPaths:[repo],ownerScope:'owner:other',actions:['factory.observe']},{id:'unscoped-client',name:'No owner scope',tokenSha256:createHash('sha256').update('1'.repeat(64)).digest('hex'),repositoryPaths:[repo],actions:['factory.observe']}];
 writeFileSync(join(dataDir,'connections.json'),JSON.stringify({clients}));
 let calls=0,verifications=0,origin,supervisor;
 const activeVerifiers=new Set(),completedVerifiers=new Set();
 const jobDependencies={preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-service-fixture',workerProfile:'mac',error:null}),runCodex:async input=>{calls++;return worker?worker(input):{success:false,status:'failed',error:'Ordinary synthetic failure',eventsPath:'fixture',usage:null}},verifyCandidate:async input=>{verifications++;activeVerifiers.add(input.resourceKey);mkdirSync(input.artifactDir,{recursive:true});const result={checks:input.commands.map((command,i)=>{const logPath=join(input.artifactDir,i+'.log');writeFileSync(logPath,'Synthetic check, no command executed\n');const at=new Date().toISOString();return {candidateCommit:input.candidateSha,candidateTree:git('rev-parse',input.candidateSha+'^{tree}'),command,status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath,reason:null}}),reason:null};activeVerifiers.delete(input.resourceKey);completedVerifiers.add(input.resourceKey);return result}};
 const localV4ResourceProbe={processAbsent(pid,group){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(group?-pid:pid,0);return false}catch(error){return error.code==='ESRCH'}},async verifierAbsent(runId){return verifierObserved&&!activeVerifiers.has(runId)&&completedVerifiers.has(runId)},async readiness(){return {ready:false,reason:'Synthetic resource fixture only'}}};
 const options={dataDir,resultSigning,jobDependencies,localFactoryFixture,localSpendFixture,...(mode==='v4'&&(localFactoryFixture||localSpendFixture)?{localV4ResourceProbe}:{})};
 const open=async()=>{supervisor=mode==='v4'?createLocalV4Supervisor(options):createSupervisor(options);await new Promise((resolve,reject)=>{supervisor.server.once('error',reject);supervisor.server.listen(0,'127.0.0.1',resolve)});origin='http://127.0.0.1:'+supervisor.server.address().port};
 await open();
 t.after(async()=>{await supervisor.close();rmSync(dir,{recursive:true,force:true})});
 const request=async(path,body,auth=token)=>{const response=await fetch(origin+'/api/connect/v1/'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()}};
 const input={requestId:randomUUID(),workId:randomUUID(),workGeneration:2,repository:'fixture/dashboard',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1,input:{title:'Ordinary local service fixture',description:'No external or protected execution',kind:'feature',repositoryPath:repo,baseRef:git('rev-parse','HEAD'),acceptanceCriteria:['Synthetic wire and source identity'],reproductionCommand:null,expectedFailureText:null,checkCommands:['synthetic-never-executed'],allowedPaths:['sample.txt'],workerProfile:'mac'}};
 const identity=prepared=>{const s=prepared.snapshot;return {runId:randomUUID(),writerGeneration:2,dispatchIdentity:randomUUID(),workId:input.workId,workGeneration:input.workGeneration,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:input.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:input.deadline}};
 return {dir,repo,dataDir,key,resultSigning,input,request,identity,git,setVerifierObservation(value){verifierObserved=value},changeClient(id,change){change(clients.find(c=>c.id===id));writeFileSync(join(dataDir,'connections.json'),JSON.stringify({clients}))},changeClientOwner(ownerScope){clients[0].ownerScope=ownerScope;writeFileSync(join(dataDir,'connections.json'),JSON.stringify({clients}))},get supervisor(){return supervisor},get calls(){return calls},get verifications(){return verifications},async restart(nextMode){await supervisor.close();if(nextMode)mode=nextMode;await open()}};
}
const pairs=(f,id)=>f.supervisor.storage.listEvents(id.workOrderId).filter(e=>e.runId===id.remoteRunId&&[SNAPSHOT_EVENT,LOCAL_V4_ADMISSION_EVENT].includes(e.type));
const resultPath=id=>`work-orders/${id.workOrderId}/runs/${id.remoteRunId}/result`;
async function prepare(f){const p=await f.request('dispatches',f.input);assert.equal(p.status,200,JSON.stringify(p.body));return {prepared:p.body,id:f.identity(p.body)}}
async function settled(f,id){await until(()=>f.supervisor.storage.getRun(id.remoteRunId),r=>['ready_for_review','failed','cancelled','interrupted'].includes(r.state));await until(()=>f.supervisor.jobs.activeRun(id.remoteRunId),active=>!active)}

test('actual Mac V4 service: prepare retains original pair and restart replay preserves identity without execution',async t=>{
 const f=await fixture(t),{prepared,id}=await prepare(f);assert.equal(prepared.state,'PREPARED');assert.equal(prepared.snapshot.version,4);assert.equal(prepared.snapshot.inputTree,f.git('rev-parse',f.input.input.baseRef+'^{tree}'));assert.equal(pairs(f,id).length,2);assert.equal(f.calls,0);
 await f.restart();const replay=await f.request('dispatches',f.input);assert.equal(replay.status,200);assert.equal(replay.body.runId,id.remoteRunId);assert.deepEqual(replay.body.snapshot,prepared.snapshot);assert.equal(pairs(f,id).length,2);assert.equal(f.calls,0);
});
test('actual Mac V4 service: synthetic failed execution signs exact V4 once and never redispatches after restart',async t=>{
 const f=await fixture(t),{prepared,id}=await prepare(f);assert.equal((await f.request('dispatches/'+f.input.requestId+'/dispatch',id)).status,200);await settled(f,id);
 const done=await f.request('dispatches/'+f.input.requestId);assert.equal(done.body.state,'FAILED');assert.equal(done.body.quiescent,true);
 const receipt=await f.request(resultPath(id));assert.equal(receipt.status,200);const {version,workspace,capturedAt,...expected}=prepared.snapshot;
 assert.equal(verifyLocalResultV4(receipt.body.result,{keys:[f.key],expected}).manifest.status,'FAILED');assert.throws(()=>verifyResult(receipt.body.result,{keys:[f.key],...expected}));
 await f.restart();assert.equal((await f.request('dispatches/'+f.input.requestId+'/dispatch',id)).status,200);assert.equal(f.calls,1);assert.deepEqual((await f.request(resultPath(id))).body.result,receipt.body.result);assert.equal(f.supervisor.storage.listEvents(id.workOrderId).filter(e=>e.type===RESULT_EVENT).length,1);
});
test('actual Mac V4 service: default paid-disabled dispatch refuses before synthetic worker',async t=>{
 const f=await fixture(t,{localFactoryFixture:false}),{id}=await prepare(f);assert.equal((await f.request('dispatches/'+f.input.requestId+'/dispatch',id)).status,503);assert.equal(f.calls,0);assert.equal((await f.request('dispatches/'+f.input.requestId)).body.state,'PREPARED');
});
test('actual Mac V4 service: wrong token, owner, request and writer version never enter worker',async t=>{
 const f=await fixture(t);assert.equal((await f.request('dispatches',f.input,'c'.repeat(64))).status,401);const {id}=await prepare(f);
 assert.equal((await f.request(resultPath(id),undefined,'b'.repeat(64))).status,404);
 assert.equal((await f.request('dispatches/'+f.input.requestId,undefined,'b'.repeat(64))).status,403);
 assert.equal((await f.request('dispatches/'+f.input.requestId+'/dispatch',{...id,factoryVersion:'f'.repeat(64)})).status,409);
 assert.equal((await f.request('dispatches',{...f.input,workGeneration:3})).status,409);assert.equal(f.calls,0);
});
test('actual Mac V4 service: stop-before-start remains fenced through restart',async t=>{
 const f=await fixture(t),{id}=await prepare(f);const stopped=await f.request('dispatches/'+f.input.requestId+'/stop',id);assert.equal(stopped.status,200);assert.equal(stopped.body.state,'NOT_DISPATCHED');assert.equal(stopped.body.quiescent,true);
 await f.restart();await f.request('dispatches/'+f.input.requestId+'/dispatch',id);assert.equal(f.calls,0);
});
test('actual Mac V4 service: STOPPING waits for actual synthetic operation settlement',async t=>{
 let release;const held=new Promise(resolve=>release=resolve);t.after(()=>release());
 const f=await fixture(t,{worker:async()=>{await held;return {success:false,status:'cancelled',eventsPath:'fixture',usage:null}}}),{id}=await prepare(f);
 await f.request('dispatches/'+f.input.requestId+'/dispatch',id);await until(()=>f.calls,n=>n===1);
 const stopped=await f.request('dispatches/'+f.input.requestId+'/stop',id);assert.equal(stopped.body.state,'STOPPING');assert.equal(stopped.body.quiescent,false);assert.equal((await f.request(resultPath(id))).body.result,null);
 release();await settled(f,id);assert.equal((await f.request('dispatches/'+f.input.requestId)).body.state,'CANCELLED');assert.equal(f.calls,1);
});
test('actual Mac V4 service: interrupted claimed attempt stays UNKNOWN and is never retried',async t=>{
 const f=await fixture(t),{id}=await prepare(f),storage=f.supervisor.storage,run=storage.getRun(id.remoteRunId);
 storage.appendEvent({workOrderId:id.workOrderId,runId:run.id,type:'factory.writer_bound',payload:id});storage.appendEvent({workOrderId:id.workOrderId,runId:run.id,type:'factory.dispatch_claimed',payload:{identity:id,supervisorPid:process.pid}});storage.saveRun({...run,state:'interrupted'});storage.appendEvent({workOrderId:id.workOrderId,runId:run.id,type:'run.recovery_hold',payload:{previousState:'unknown'}});
 await f.restart();const state=await f.request('dispatches/'+f.input.requestId);assert.equal(state.body.state,'UNKNOWN');assert.equal(state.body.quiescent,false);assert.equal((await f.request(resultPath(id))).body.result,null);await f.request('dispatches/'+f.input.requestId+'/dispatch',id);assert.equal(f.calls,0);
});
test('actual Mac V4 service: duplicate original admission refuses observe/result after reopen',async t=>{
 const f=await fixture(t),{id}=await prepare(f),events=f.supervisor.storage.listEvents(id.workOrderId),admission=events.find(e=>e.type===LOCAL_V4_ADMISSION_EVENT);
 // Append a conflicting immutable event instead of mutating/deleting history.
 f.supervisor.storage.appendEvent({workOrderId:id.workOrderId,runId:id.remoteRunId,type:LOCAL_V4_ADMISSION_EVENT,payload:admission.payload});await f.restart();assert.equal((await f.request('dispatches/'+f.input.requestId)).status,500);assert.equal((await f.request(resultPath(id))).status,500);assert.equal(f.calls,0);
});
test('actual Mac V4 service: regular text candidate and signed Result retain exact bytes without independent Proof',async t=>{
 const f=await fixture(t,{worker:async input=>{writeFileSync(join(input.workspacePath,'sample.txt'),'after\n');return {success:true,status:'completed',eventsPath:'fixture',usage:null}}}),{prepared,id}=await prepare(f);
 await f.request('dispatches/'+f.input.requestId+'/dispatch',id);await settled(f,id);assert.equal(f.supervisor.storage.getRun(id.remoteRunId).state,'ready_for_review');assert.equal(f.verifications,1);
 // The explicit fixture probe observes only these tracked synthetic resources.
 // This is canonical fixture terminal evidence, never actual Docker/Proof qualification.
 const done=await f.request('dispatches/'+f.input.requestId);assert.equal(done.body.state,'COMPLETED');assert.equal(done.body.quiescent,true);
 const receipt=await f.request(resultPath(id));assert.equal(receipt.status,200);const {version,workspace,capturedAt,...expected}=prepared.snapshot,manifest=verifyLocalResultV4(receipt.body.result,{keys:[f.key],expected}).manifest;
 assert.equal(manifest.status,'COMPLETED');assert.equal(manifest.candidate.base,expected.inputCommit);assert.equal(f.git('show',manifest.candidate.commit+':sample.txt'),'after');assert.equal(f.calls,1);
 const patch=receipt.body.result.artifacts.find(a=>a.id===manifest.candidate.patchArtifactId);assert(Buffer.from(patch.base64,'base64').toString('utf8').includes('+after'));assert.equal(manifest.verification,undefined);
 const evidence=f.supervisor.storage.listEvents(id.workOrderId).find(e=>e.type==='run.evidence_collected').payload.refs[0];
 const proofRead={ownerScope:'owner:fixture',repository:f.input.repository,workId:f.input.workId,workGeneration:f.input.workGeneration,requestId:f.input.requestId,workOrderId:id.workOrderId,runId:id.remoteRunId,candidateCommit:manifest.candidate.commit,factoryVersion:expected.factoryVersion,evidenceReference:evidence.proofReference,expectedDigest:evidence.sha256,evidenceKind:evidence.kind};
 assert.equal((await f.request('evidence/read',proofRead,'d'.repeat(64))).status,404,'V4 signed Result must not enable the unchanged legacy-only evidence bridge');
});
test('actual Mac V4 service: revoked signing key rolls back prepared run and original records',async t=>{
 const f=await fixture(t,{keys:key=>[{...key,revokedAt:new Date().toISOString()}]});const prepared=await f.request('dispatches',f.input);assert.equal(prepared.status,503);const order=f.supervisor.storage.listWorkOrders()[0];assert.equal(f.supervisor.storage.listRuns(order.id).length,0);assert.equal(f.supervisor.storage.listEvents(order.id).filter(e=>[SNAPSHOT_EVENT,LOCAL_V4_ADMISSION_EVENT].includes(e.type)).length,0);assert.equal(f.calls,0);
});
test('actual Mac V4 service: legacy default keeps V1 without the explicit V4 constructor',async t=>{
 const f=await fixture(t,{mode:'legacy'}),{prepared,id}=await prepare(f);assert.equal(prepared.snapshot.version,1);assert.equal(pairs(f,id).length,1);assert.equal(f.calls,0);
});
test('V4 service constructor: requires explicit signing and refuses real provider before loading it',()=>{
 assert.throws(()=>createLocalV4Supervisor({}),/Explicit local V4 data directory and signing/);
 assert.throws(()=>createLocalV4Supervisor({dataDir:'/synthetic/not-accessed',resultSigning:{},realProvider:{}}),/not qualified for live/);
});

for(const outcome of ['known','unknown'])test(`actual Mac V4 service: synthetic spend ${outcome} is fenced and never retried`,async t=>{
 let providerCalls=0;
 const provider=createServer((req,res)=>{providerCalls++;assert.equal(req.headers.authorization,'Bearer synthetic-only');req.resume();if(outcome==='unknown'){req.socket.destroy();return}res.writeHead(200,{'content-type':'application/json','x-request-id':'synthetic-operation'});res.end(JSON.stringify({id:'synthetic',status:'completed',usage:{input_tokens:10,output_tokens:10}}))});
 await new Promise((resolve,reject)=>{provider.once('error',reject);provider.listen(0,'127.0.0.1',resolve)});t.after(()=>new Promise(resolve=>provider.close(resolve)));
 const price={revision:'synthetic-v4-service-v1',model:'gpt-5.5',validUntil:new Date(Date.now()+60000).toISOString(),contextLimitTokens:1000,outputLimitTokens:100,inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:2000000};
 const f=await fixture(t,{localFactoryFixture:false,localSpendFixture:{upstreamOrigin:'http://127.0.0.1:'+provider.address().port,upstreamApiKey:'synthetic-only',price},worker:async input=>{
  assert(input.gateway);writeFileSync(join(input.workspacePath,'sample.txt'),'Owned synthetic progress before bounded operation\n');const response=await fetch(input.gateway.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+input.gateway.childToken,'content-type':'application/json'},body:JSON.stringify({model:input.model,input:'Owned synthetic fixture'})});assert.equal(response.status===200,outcome==='known');
  return {success:false,status:'failed',error:'Synthetic end after one operation',eventsPath:'fixture',usage:null};
 }});
 f.input.spendContract={version:'WORK_LEDGER_V2',pricingRevision:price.revision,plannedProductiveOperations:1,plannedCompletionOperations:1,maxPaidOperations:2,completionReserveMicrousd:1200};
 const {id}=await prepare(f);await f.request('dispatches/'+f.input.requestId+'/dispatch',id);await settled(f,id);const done=await f.request('dispatches/'+f.input.requestId);
 assert.equal(done.body.state,'FAILED');assert.equal(done.body.spend.authorityState,'fenced');assert.equal(done.body.spend.status,outcome.toUpperCase());assert.equal(done.body.spend.operations.length,1);assert.equal(providerCalls,1);if(outcome==='known')assert.equal(done.body.spend.settledMicrousd,30);
 await f.restart();await f.request('dispatches/'+f.input.requestId+'/dispatch',id);assert.equal(f.calls,1);assert.equal(providerCalls,1);assert.equal((await f.request('dispatches/'+f.input.requestId)).body.spend.status,outcome.toUpperCase());
});

for(const token of ['e'.repeat(64),'f'.repeat(64)])test(`actual Mac V4 service: distinct ordinary ${token[0]==='e'?'client':'owner'} cannot read same-repository Work`,async t=>{
 const f=await fixture(t),{id}=await prepare(f);assert.equal((await f.request(resultPath(id),undefined,token)).status,404);assert.equal((await f.request('work-orders/'+id.workOrderId,undefined,token)).status,404);assert.deepEqual((await f.request('work-orders',undefined,token)).body.workOrders,[]);assert.equal(f.calls,0);
});
test('actual Mac V4 service: changed current connection owner denies prepare replay, observe and dispatch',async t=>{
 const f=await fixture(t),{id}=await prepare(f);f.changeClientOwner('owner:changed');
 for(const [path,body] of [['dispatches',f.input],['dispatches/'+f.input.requestId,undefined],['dispatches/'+f.input.requestId+'/dispatch',id],[resultPath(id),undefined],['work-orders/'+id.workOrderId,undefined]])assert.equal((await f.request(path,body)).status,404);
 assert.deepEqual((await f.request('work-orders')).body.workOrders,[]);assert.equal(f.calls,0);
});
test('actual Mac V4 service: same-owner Proof reader may inspect retained Result but evidence bridge stays disabled',async t=>{
 const f=await fixture(t),{id}=await prepare(f);const result=await f.request(resultPath(id),undefined,'d'.repeat(64));assert.equal(result.status,200);assert.equal(result.body.result,null);assert.equal((await f.request('work-orders/'+id.workOrderId,undefined,'d'.repeat(64))).status,200);assert.equal((await f.request('work-orders',undefined,'d'.repeat(64))).body.workOrders.length,1);assert.equal(f.calls,0);
});
test('actual Mac V4 service: unobserved synthetic verifier keeps candidate UNKNOWN until separately observed',async t=>{
 const f=await fixture(t,{verifierObserved:false,worker:async input=>{writeFileSync(join(input.workspacePath,'sample.txt'),'after\n');return {success:true,status:'completed',eventsPath:'fixture',usage:null}}}),{id}=await prepare(f);
 await f.request('dispatches/'+f.input.requestId+'/dispatch',id);await settled(f,id);const held=await f.request('dispatches/'+f.input.requestId);assert.equal(held.body.state,'UNKNOWN');assert.equal(held.body.quiescent,false);assert.equal(f.calls,1);f.setVerifierObservation(true);const observed=await f.request('dispatches/'+f.input.requestId);assert.equal(observed.body.state,'COMPLETED');assert.equal(observed.body.quiescent,true);assert.equal(f.calls,1);
});
test('V4 service constructor: explicit directory and fixture-only probe cannot fall back to installed state',()=>{
 for(const dataDir of [undefined,'','relative','/tmp/../tmp/example'])assert.throws(()=>createLocalV4Supervisor({dataDir,resultSigning:{}}),/Explicit local V4 data directory/);
 assert.throws(()=>createSupervisor({localV4ResourceProbe:{}}),/requires explicit synthetic/);
 assert.throws(()=>createLocalV4Supervisor({dataDir:'/synthetic/not-accessed',resultSigning:{},localV4ResourceProbe:{},localFactoryFixture:true}),/requires explicit synthetic/);
});
test('actual Mac V4 service: generic connected actions cannot bypass canonical dispatch writes',async t=>{
 const f=await fixture(t);assert.equal((await f.request('actions',{action:'workorder.create',input:f.input.input})).status,503);assert.equal(f.supervisor.storage.listWorkOrders().length,0);assert.equal(f.calls,0);
});

test('actual Mac V4 service: repository permission without owner scope cannot read connected APIs',async t=>{
 const f=await fixture(t),{id}=await prepare(f);
 for(const path of [resultPath(id),'work-orders','work-orders/'+id.workOrderId,'dispatches/'+f.input.requestId,'actions'])assert.equal((await f.request(path,undefined,'1'.repeat(64))).status,403);
 assert.equal(f.calls,0);
});
test('actual Mac V4 service: legacy prepared history stays refused without reset or backfill',async t=>{
 const f=await fixture(t,{mode:'legacy'}),{prepared,id}=await prepare(f),before=f.supervisor.storage.listEvents(id.workOrderId);assert.equal(prepared.snapshot.version,1);
 await f.restart('v4');assert.equal((await f.request('dispatches/'+f.input.requestId)).status,500);assert.equal((await f.request(resultPath(id))).status,500);assert.deepEqual(f.supervisor.storage.listEvents(id.workOrderId),before);assert.equal(pairs(f,id).length,1);assert.equal(f.calls,0);
});

for(const variant of ['missing-grant','missing-grant-and-expiry','nonfinite-expiry','expired'])test(`actual Mac V4 service: Proof purpose without current credential ${variant} cannot read Work`,async t=>{
 const f=await fixture(t),{id}=await prepare(f);
 f.changeClient('same-owner-proof',client=>{
  if(variant!=='expired')client.actions=[];
  if(variant==='missing-grant-and-expiry')delete client.expiresAt;
  if(variant==='nonfinite-expiry')client.expiresAt='not-a-date';
  if(variant==='expired')client.expiresAt='2020-01-01T00:00:00Z';
 });
 for(const path of [resultPath(id),'work-orders','work-orders/'+id.workOrderId])assert.equal((await f.request(path,undefined,'d'.repeat(64))).status,variant==='expired'?401:403);
 assert.equal(f.calls,0);
});
test('actual Mac V4 service: removal of prior Proof read grant fences all subsequent data reads',async t=>{
 const f=await fixture(t),{id}=await prepare(f);assert.equal((await f.request(resultPath(id),undefined,'d'.repeat(64))).status,200);f.changeClient('same-owner-proof',client=>client.actions=[]);
 for(const path of [resultPath(id),'work-orders','work-orders/'+id.workOrderId])assert.equal((await f.request(path,undefined,'d'.repeat(64))).status,403);assert.equal(f.calls,0);
});
test('actual Mac V4 service: removal of ordinary observation grant fences read APIs before Result generation',async t=>{
 const f=await fixture(t),{id}=await prepare(f);f.changeClient('fixture-owner',client=>client.actions=client.actions.filter(a=>a!=='factory.observe'));
 for(const path of [resultPath(id),'work-orders','work-orders/'+id.workOrderId,'dispatches/'+f.input.requestId])assert.equal((await f.request(path)).status,403);assert.equal(f.calls,0);assert.equal(f.supervisor.storage.listEvents(id.workOrderId).filter(e=>e.type===RESULT_EVENT).length,0);
});
test('actual Mac V4 service: Proof reader cannot gain dispatch controls from extra action strings',async t=>{
 const f=await fixture(t),{id}=await prepare(f);f.changeClient('same-owner-proof',client=>client.actions.push('factory.prepare','factory.observe','factory.dispatch','factory.stop'));
 for(const [path,body] of [['dispatches',f.input],['dispatches/'+f.input.requestId,undefined],['dispatches/'+f.input.requestId+'/dispatch',id],['dispatches/'+f.input.requestId+'/stop',id]])assert.equal((await f.request(path,body,'d'.repeat(64))).status,403);assert.equal(f.calls,0);
});
test('actual Mac V4 service: original client still needs each current control-operation grant',async t=>{
 const f=await fixture(t),{id}=await prepare(f);f.changeClient('fixture-owner',client=>client.actions=['factory.observe']);
 for(const [path,body] of [['dispatches',f.input],['dispatches/'+f.input.requestId+'/dispatch',id],['dispatches/'+f.input.requestId+'/stop',id]])assert.equal((await f.request(path,body)).status,403);assert.equal((await f.request('dispatches/'+f.input.requestId)).status,200);assert.equal(f.calls,0);
});

test('actual Mac V4 service: revoked observe cannot prevent separately authorized stop effects',async t=>{
 let release;const held=new Promise(resolve=>release=resolve);t.after(()=>release());
 const f=await fixture(t,{worker:async()=>{await held;return {success:false,status:'cancelled',eventsPath:'fixture',usage:null}}}),{id}=await prepare(f);
 await f.request('dispatches/'+f.input.requestId+'/dispatch',id);await until(()=>f.calls,n=>n===1);f.changeClient('fixture-owner',c=>c.actions=c.actions.filter(a=>a!=='factory.observe'));
 const stopped=await f.request('dispatches/'+f.input.requestId+'/stop',id);assert.equal(stopped.status,403,'Denied observation must remain opaque after authorized stop');
 const events=f.supervisor.storage.listEvents(id.workOrderId);assert(events.some(e=>e.runId===id.remoteRunId&&e.type==='factory.stop_requested'));assert(events.some(e=>e.runId===id.remoteRunId&&e.type==='run.cancel_requested'));
 release();await settled(f,id);assert.equal(f.supervisor.storage.getRun(id.remoteRunId).state,'cancelled');assert.equal(f.calls,1);
 f.changeClient('fixture-owner',c=>c.actions.push('factory.observe'));const observed=await f.request('dispatches/'+f.input.requestId);assert.equal(observed.body.state,'CANCELLED');assert.equal(observed.body.quiescent,true);assert.equal(f.calls,1);
});

for(const value of ['00000000-0000-4000-8000-000000000001',null,'',false])test(`actual Mac V4 service: repair field presence ${JSON.stringify(value)} refuses before preparation effects`,async t=>{
 const f=await fixture(t);f.input.repairWorkOrderId=value;assert.equal((await f.request('dispatches',f.input)).status,503);assert.deepEqual(f.supervisor.storage.listWorkOrders(),[]);assert.equal(f.calls,0);assert.equal(f.verifications,0);
});
