import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {JobManager} from '../src/jobs.ts';
import {ProducerResults} from '../src/producer-results.ts';
import {ConnectedExecutionControl} from '../src/connected-execution.ts';
import {verifyResult} from '../../../packages/hosted-routing/src/result.ts';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve;return {promise:new Promise(done=>resolve=done),resolve:()=>resolve()};}
async function fixture(t,{worker,preflight}={}){
 const dir=mkdtempSync(join(tmpdir(),'connected-execution-')),repo=join(dir,'repo');mkdirSync(repo);
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 writeFileSync(join(repo,'sample.txt'),'before\n');git('add','sample.txt');git('commit','-qm','input');
 const storage=openStorage(join(dir,'factory.sqlite'));
 const pair=generateKeyPairSync('ed25519');
 const signing={factoryId:'factory-local-test',currentKeyId:'k1',privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
  keys:[{factoryId:'factory-local-test',keyId:'k1',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'}]};
 const producer=new ProducerResults(storage,dir,signing);
 const jobs=new JobManager(storage,dir,()=>{},{
  preflightCodex:preflight??(async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-codex-1',workerProfile:'mac',error:null})),
  runCodex:async input=>{if(worker)return worker(input);writeFileSync(join(input.workspacePath,'sample.txt'),'after\n');return {success:true,status:'completed',eventsPath:'unused'};},
  verifyCandidate:async input=>{mkdirSync(input.artifactDir,{recursive:true});const logPath=join(input.artifactDir,'check.log');writeFileSync(logPath,'pass\n');
   const at=new Date().toISOString();return {checks:[{candidateCommit:input.candidateSha,command:'fixture-check',status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath}],reason:null};},
 },producer);
 const order=storage.createWorkOrder({title:'Connected fixture',description:'bounded test',kind:'feature',repositoryPath:repo,baseRef:git('rev-parse','HEAD'),
  acceptanceCriteria:['candidate is verified'],reproductionCommand:null,expectedFailureText:null,checkCommands:['fixture-check'],allowedPaths:['sample.txt'],workerProfile:'mac'});
 const client={id:'myeve',name:'MyEve',repositoryPaths:[repo],actions:['factory.execution.prepare','factory.execution.start','factory.execution.read','factory.execution.stop']};
 const control=new ConnectedExecutionControl(storage,jobs,producer);
 t.after(async()=>{await jobs.close();storage.close();rmSync(dir,{recursive:true,force:true});});
 const pin=await jobs.prepareConnectedVersion(order);
 const prepare=async(id=randomUUID(),version=pin.factoryVersion)=>control.prepare(client,{dispatchOperationId:id,workOrderId:order.id,
  requestId:randomUUID(),factoryId:pin.factoryId,factoryVersion:version,deadline:new Date(Date.now()+120000).toISOString()});
 return {dir,repo,storage,producer,jobs,order,client,control,prepare,pin,signing};
}
async function terminal(f,id){for(let n=0;n<500;n++){const r=f.control.read(f.client,id);if(r.quiescent)return r;await sleep(10);}throw Error('No terminal observation');}

test('prepare, concurrent exact start, signed completion and immutable identity',async t=>{
 const f=await fixture(t),record=await f.prepare();
 assert.equal(record.state,'PREPARED');assert.equal(f.storage.listRuns(f.order.id).length,0);
 const starts=await Promise.all([f.control.start(f.client,record.dispatchOperationId),f.control.start(f.client,record.dispatchOperationId)]);
 const ended=await terminal(f,record.dispatchOperationId);
 assert.equal(starts.length,2);assert.equal(f.storage.listRuns(f.order.id).length,1);
 assert.equal(ended.state,'COMPLETED');assert.equal(ended.quiescent,true);assert.equal(ended.attemptNumber,1);
 const result=f.producer.read(f.storage.getRun(ended.runId)).result;
 const manifest=verifyResult(result,{keys:f.signing.keys,factoryId:ended.factoryId,factoryVersion:ended.factoryVersion,
  requestId:ended.requestId,workOrderId:ended.workOrderId,runId:ended.runId}).manifest;
 assert.equal(manifest.execution.attemptNumber,ended.attemptNumber);
 assert.equal(ended.resultManifestDigest,result.manifestDigest);
 assert.throws(()=>f.storage.transitionConnectedExecution(record.dispatchOperationId,['COMPLETED'],'COMPLETED',
  {resultManifestDigest:'f'.repeat(64)}),/immutable/);
 await assert.rejects(f.control.start(f.client,record.dispatchOperationId),/DENIED_TERMINAL_FENCE/);
});

test('stop before start durably fences delayed start across restart',async t=>{
 const f=await fixture(t),record=await f.prepare(),id=record.dispatchOperationId;
 const stopped=await f.control.stop(f.client,id);assert.equal(stopped.state,'FENCED');assert.equal(stopped.quiescent,true);
 await assert.rejects(f.control.start(f.client,id),/DENIED_TERMINAL_FENCE/);
 const reopened=openStorage(join(f.dir,'factory.sqlite'));assert.equal(reopened.getConnectedExecution(id).state,'FENCED');
 reopened.close();assert.equal(f.storage.listRuns(f.order.id).length,0);
});

test('stop during active execution stays nonquiescent until worker exits',async t=>{
 const entered=deferred(),release=deferred();
 const f=await fixture(t,{worker:async input=>{entered.resolve();await release.promise;return {success:false,status:'cancelled',eventsPath:'unused'};}});
 const record=await f.prepare(),id=record.dispatchOperationId;
 await f.control.start(f.client,id);await entered.promise;
 const stopping=await f.control.stop(f.client,id);assert.equal(stopping.quiescent,false);
 assert.ok(['STOPPING','UNKNOWN'].includes(stopping.state));
 await assert.rejects(f.control.start(f.client,id),/DENIED_TERMINAL_FENCE/);
 release.resolve();const ended=await terminal(f,id);assert.equal(ended.state,'CANCELLED');
 assert.equal(f.storage.listRuns(f.order.id).length,1);
});

test('lost start response readback, cross-client denial and FactoryVersion mismatch',async t=>{
 const f=await fixture(t),record=await f.prepare(),id=record.dispatchOperationId;
 await assert.rejects(f.prepare(randomUUID(),'f'.repeat(64)),/FactoryVersion/);
 await f.control.start(f.client,id);const ended=await terminal(f,id);
 const other={...f.client,id:'other'};
 assert.throws(()=>f.control.read(other,id),/not found/i);
 await assert.rejects(f.control.stop(other,id),/not found/i);
 assert.equal(f.control.read(f.client,id).runId,ended.runId);
 assert.equal(f.storage.listRuns(f.order.id).length,1);
});

test('expired preparation and competing dispatch identity cannot start work',async t=>{
 const f=await fixture(t),record=await f.prepare(),id=record.dispatchOperationId;
 await assert.rejects(f.prepare(randomUUID()),/Dispatch operation binding conflict|UNIQUE constraint/);
 const original=f.storage.getConnectedExecution(id);
 assert.equal((await f.control.prepare(f.client,{dispatchOperationId:id,requestId:original.requestId,
  workOrderId:original.workOrderId,factoryId:original.factoryId,factoryVersion:original.factoryVersion,
  deadline:original.deadline})).dispatchOperationId,original.dispatchOperationId);
 f.storage.transitionConnectedExecution(id,['PREPARED'],'FENCED',{terminalAt:new Date().toISOString()});
 await assert.rejects(f.control.start(f.client,id),/DENIED_TERMINAL_FENCE/);
 assert.equal(f.storage.listRuns(f.order.id).length,0);
});

test('crash window after durable start claim remains UNKNOWN until explicit stop fence',async t=>{
 const f=await fixture(t),record=await f.prepare(),id=record.dispatchOperationId;
 f.storage.transitionConnectedExecution(id,['PREPARED'],'STARTING');
 const unknown=f.control.read(f.client,id);assert.equal(unknown.state,'UNKNOWN');assert.equal(unknown.quiescent,false);
 assert.equal(f.storage.listRuns(f.order.id).length,0);
 const stopped=await f.control.stop(f.client,id);assert.equal(stopped.state,'FENCED');
 assert.equal(stopped.quiescent,true);
 await assert.rejects(f.control.start(f.client,id),/DENIED_TERMINAL_FENCE/);
});

test('start after deadline is durably fenced without allocating a Run',async t=>{
 const f=await fixture(t),id=randomUUID();
 await f.control.prepare(f.client,{dispatchOperationId:id,requestId:randomUUID(),workOrderId:f.order.id,
  factoryId:f.pin.factoryId,factoryVersion:f.pin.factoryVersion,
  deadline:new Date(Date.now()+25).toISOString()});
 await sleep(35);
 await assert.rejects(f.control.start(f.client,id),/expired/);
 assert.equal(f.control.read(f.client,id).state,'FENCED');
 assert.equal(f.storage.listRuns(f.order.id).length,0);
});

test('stop during STARTING fences a delayed worker pickup',async t=>{
 const entered=deferred(),release=deferred();let calls=0;
 const preflight=async()=>{calls++;if(calls===3){entered.resolve();await release.promise;}
  return {binaryAvailable:true,authenticated:true,version:'synthetic-codex-1',workerProfile:'mac',error:null};};
 const f=await fixture(t,{preflight}),record=await f.prepare(),id=record.dispatchOperationId;
 const starting=f.control.start(f.client,id);await entered.promise;
 const stopping=await f.control.stop(f.client,id);assert.equal(stopping.quiescent,false);
 release.resolve();await assert.rejects(starting,/cancelled/i);
 const ended=await terminal(f,id);assert.equal(ended.state,'FENCED');
 assert.equal(f.storage.listRuns(f.order.id).length,0);
});

test('process shutdown with an unresolved worker remains UNKNOWN and blocks reuse',async t=>{
 const entered=deferred(),release=deferred();
 const f=await fixture(t,{worker:async()=>{entered.resolve();await release.promise;return {success:false,status:'cancelled',eventsPath:'unused'};}});
 const record=await f.prepare(),id=record.dispatchOperationId;
 await f.control.start(f.client,id);await entered.promise;
 const closing=f.jobs.close();release.resolve();await closing;
 const observed=f.control.read(f.client,id);assert.equal(observed.state,'UNKNOWN');assert.equal(observed.quiescent,false);
 const stop=await f.control.stop(f.client,id);assert.equal(stop.quiescent,false);
 await assert.rejects(f.control.start(f.client,id),/DENIED_TERMINAL_FENCE/);
 assert.equal(f.storage.listRuns(f.order.id).length,1);
});

test('changed FactoryVersion after PREPARE cannot create an attempt',async t=>{
 let calls=0;const preflight=async()=>({binaryAvailable:true,authenticated:true,
  version:++calls>=3?'synthetic-codex-2':'synthetic-codex-1',workerProfile:'mac',error:null});
 const f=await fixture(t,{preflight}),record=await f.prepare(),id=record.dispatchOperationId;
 await assert.rejects(f.control.start(f.client,id),/FactoryVersion changed/);
 assert.equal(f.storage.listRuns(f.order.id).length,0);
 assert.equal(f.control.read(f.client,id).quiescent,false);
 assert.equal((await f.control.stop(f.client,id)).state,'FENCED');
});
