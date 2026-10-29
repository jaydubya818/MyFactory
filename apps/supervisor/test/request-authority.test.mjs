// Disposable synthetic connection records and owned loopback only. No real
// credentials, worker/verifier/provider, paid operation or protected criteria.
import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSupervisor} from '../src/server.ts';
import * as connections from '../src/connections.ts';
import {FactoryDispatchControl} from '../src/dispatch-control.ts';
import {LocalExecutionProvider} from '../src/local-execution-provider.ts';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {SpendLedger} from '../../../packages/storage/src/spend.ts';
import {JobManager} from '../src/jobs.ts';
import {readBoundEvidence} from '../src/evidence-transport.ts';
import {storeEvidence,proofEvidenceReference} from '../../../packages/verification/src/evidence.ts';

const token='c'.repeat(64),hash=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const original=repo=>({id:'public',name:'Synthetic owner',tokenSha256:hash(token),ownerScope:'owner:public',repositoryPaths:[repo],actions:['workorder.create','factory.prepare','factory.dispatch','factory.observe','factory.stop']});
const mutations={
 revoke:()=>[],id:clients=>[{...clients[0],id:'different'}],token:clients=>[{...clients[0],tokenSha256:hash('d'.repeat(64))}],
 owner:clients=>[{...clients[0],ownerScope:'owner:different'}],purpose:clients=>[{...clients[0],purpose:'myeve-proof',expiresAt:new Date(Date.now()+60000).toISOString()}],
 expiry:clients=>[{...clients[0],expiresAt:new Date(Date.now()-1000).toISOString()}],
 malformedExpiry:clients=>[{...clients[0],expiresAt:'invalid'}],
 grant:clients=>[{...clients[0],actions:[]}],repository:(clients,other)=>[{...clients[0],repositoryPaths:[other]}],
};
const orderInput=repo=>({title:'Public authority regression',description:'No execution',kind:'feature',repositoryPath:repo,baseRef:'a'.repeat(40),acceptanceCriteria:['Keep original request authority'],reproductionCommand:null,expectedFailureText:null,checkCommands:['synthetic-check'],allowedPaths:['sample.txt'],workerProfile:'mac',syncToLinear:false,idempotencyKey:randomUUID()});
async function httpFixture(t){
 const dir=mkdtempSync(join(tmpdir(),'request-authority-')),repo=join(dir,'repo'),other=join(dir,'other');mkdirSync(repo);mkdirSync(other);
 const path=join(dir,'connections.json'),clients=[original(repo)],save=values=>writeFileSync(path,JSON.stringify({clients:values}));save(clients);
 const supervisor=createSupervisor({dataDir:dir});await new Promise(resolve=>supervisor.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+supervisor.server.address().port;
 t.after(async()=>{await supervisor.close();rmSync(dir,{recursive:true,force:true})});
 const post=async input=>{const response=await fetch(origin+'/api/connect/v1/actions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'workorder.create',input})});return {status:response.status,body:await response.json()}};
 async function pending(input,change){
  const seen=deferred(),body=JSON.stringify({action:'workorder.create',input});
  // Added after the real handler: authentication has completed and its body
  // reader is awaiting this request's remaining ordinary bytes.
  supervisor.server.once('request',()=>{change();seen.resolve()});
  const result=new Promise((resolve,reject)=>{
   const req=httpRequest(origin+'/api/connect/v1/actions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));res.on('error',reject);
   });req.on('error',reject);req.write(body.slice(0,1));seen.promise.then(()=>req.end(body.slice(1)));
  });return result;
 }
 return {dir,repo,other,clients,save,supervisor,post,pending};
}
test('connected ordinary create remains authorized with a current original identity',async t=>{
 const f=await httpFixture(t),response=await f.post(orderInput(f.repo));assert.equal(response.status,200);assert.equal(f.supervisor.storage.listWorkOrders().length,1);
});
for(const [name,mutate] of Object.entries(mutations))test('connected pending body: '+name+' denies before creating a second Work',async t=>{
 const f=await httpFixture(t);assert.equal((await f.post(orderInput(f.repo))).status,200);
 const before=f.supervisor.storage.listWorkOrders()[0],events=f.supervisor.storage.listEvents(before.id);
 const response=await f.pending(orderInput(f.repo),()=>f.save(mutate(f.clients,f.other)));
 assert([401,403,404].includes(response.status),'status='+response.status);assert.equal(f.supervisor.storage.listWorkOrders().length,1);
 assert.deepEqual(f.supervisor.storage.getWorkOrder(before.id),before);assert.deepEqual(f.supervisor.storage.listEvents(before.id),events);
 assert.equal(f.supervisor.storage.listRuns(before.id).length,0);
});
test('connection refresh preserves reduced current grants without rebinding identity or renewing expiry',()=>{
 const client=original('/public/synthetic'),fresh={...client,actions:['factory.observe'],expiresAt:new Date(Date.now()+60000).toISOString()};
 assert.equal(connections.refreshClient(client,[fresh]),fresh);assert.deepEqual(client.actions,original('/public/synthetic').actions);
 for(const mutation of [mutations.revoke,mutations.id,mutations.token,mutations.owner,mutations.purpose,mutations.expiry,mutations.malformedExpiry])assert.throws(()=>connections.refreshClient(client,mutation([client])),error=>[401,403].includes(error.status));
});

function controlFixture(t){
 const dir=mkdtempSync(join(tmpdir(),'claim-authority-')),other=join(dir,'other');mkdirSync(other);
 const storage=openStorage(join(dir,'factory.sqlite')),spend=new SpendLedger(join(dir,'factory.sqlite')),initial=original(dir);let clients=[initial],snapshot,run;
 let starts=0,reconciles=0,claimHold=null,readHold=null,prepareHold=null;
 const execution={
  async prepare(work){run=storage.createRun({workOrderId:work.id,workerProfile:'mac',inputCommit:work.baseRef,workspacePath:dir});
   snapshot={factoryId:'public-fixture',factoryVersion:'1'.repeat(64),requestId:input.requestId,workOrderId:work.id,runId:run.id,inputCommit:work.baseRef,configuration:{allowedPaths:work.allowedPaths}};
   storage.appendEvent({workOrderId:work.id,runId:run.id,type:'run.prepared',payload:{}});
   if(prepareHold){prepareHold.entered.resolve();await prepareHold.release.promise;}
  },
  async start(_work,_run,claim){if(claimHold){claimHold.entered.resolve();await claimHold.release.promise;}if(claim()){starts++;return true}return false},
  async reconcile(_run,assertCurrent){reconciles++;if(readHold){readHold.entered.resolve();await readHold.release.promise;}assertCurrent?.();return {active:false,quiescent:false,settled:false,recoveryEligible:false,evidence:{}}},
  async cancel(){},
 };
 const control=new FactoryDispatchControl(storage,execution,{snapshot:()=>snapshot},spend,true,undefined,false,client=>connections.refreshClient(client,clients));
 const input={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'public/repository',deadline:new Date(Date.now()+60000).toISOString(),maxSpendUsd:1,input:orderInput(dir)};
 // Canonical preparation input excludes only the generic create-only fields.
 delete input.input.syncToLinear;delete input.input.idempotencyKey;
 const hold=()=>({entered:deferred(),release:deferred()});
 t.after(()=>{claimHold?.release.resolve();readHold?.release.resolve();prepareHold?.release.resolve();spend.close();storage.close();rmSync(dir,{recursive:true,force:true})});
 return {dir,other,storage,spend,initial,control,input,get starts(){return starts},get reconciles(){return reconciles},setClients(value){clients=value},
  holdClaim(){return claimHold=hold()},holdRead(){return readHold=hold()},holdPrepare(){return prepareHold=hold()},
  async prepare(){const prepared=await control.prepare(initial,input),s=prepared.snapshot;return {runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:input.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:input.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:input.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:input.deadline}},
 };
}
test('control authority is required by default before any effect',async()=>{
 const control=new FactoryDispatchControl(null,null,null,null);await assert.rejects(control.prepare(original('/public'),{}),{code:'forbidden',status:403});
});
test('current ordinary dispatch claims exactly once and retains replay readback',async t=>{
 const f=controlFixture(t),identity=await f.prepare();await f.control.dispatch(f.initial,identity);await f.control.dispatch(f.initial,identity);
 assert.equal(f.starts,1);assert.equal(f.storage.listEvents(identity.workOrderId).filter(e=>e.type==='factory.dispatch_claimed').length,1);
});
for(const [name,mutate] of Object.entries(mutations).filter(([name])=>name!=='malformedExpiry'))test('pending dispatch claim: '+name+' cannot claim or start execution',async t=>{
 const f=controlFixture(t),identity=await f.prepare(),held=f.holdClaim(),before=f.spend.read(f.input.workId);
 const pending=f.control.dispatch(f.initial,identity);await held.entered.promise;f.setClients(mutate([f.initial],f.other));held.release.resolve();
 await assert.rejects(pending,error=>[401,403,404].includes(error.status));assert.equal(f.starts,0);
 assert.equal(f.storage.listEvents(identity.workOrderId).some(e=>e.type==='factory.dispatch_claimed'),false);assert.deepEqual(f.spend.read(f.input.workId),before);
 assert.equal(f.storage.listWorkOrders().length,1);assert.equal(f.storage.listRuns(identity.workOrderId).length,1);
});
for(const phase of ['prepare','read'])test('pending '+phase+' readback: revocation denies data and preserves existing records',async t=>{
 const f=controlFixture(t);let pending,held,workId;
 if(phase==='prepare'){held=f.holdPrepare();pending=f.control.prepare(f.initial,f.input)}else{const id=await f.prepare();workId=id.workOrderId;held=f.holdRead();pending=f.control.read(f.initial,f.input.requestId)}
 await held.entered.promise;workId??=f.storage.listWorkOrders()[0].id;const before=f.spend.read(f.input.workId),events=f.storage.listEvents(workId);
 f.setClients([]);held.release.resolve();await assert.rejects(pending,{code:'forbidden',status:403});
 assert.deepEqual(f.spend.read(f.input.workId),before);assert.deepEqual(f.storage.listEvents(workId),events);assert.equal(f.storage.listRuns(workId).length,1);assert.equal(f.starts,0);
});
test('local reconciliation checks current connection before a recovery checkpoint',async()=>{
 let checkpoint=0;const provider=new LocalExecutionProvider({}, {checkpointForRecovery:async()=>checkpoint++},{});
 provider.read=async()=>({quiescent:true,recoveryEligible:true});await assert.rejects(provider.reconcile({id:'public'},()=>{throw Error('Connection revoked')}),/Connection revoked/);assert.equal(checkpoint,0);
});
for(const boundary of ['preflight','resolve','workspace'])test('pending attempt preparation: revoked '+boundary+' cannot capture or create a Run',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'prepare-current-')),storage=openStorage(join(dir,'factory.sqlite')),entered=deferred(),release=deferred();let revoked=false,captures=0,creates=0;
 const work=storage.createWorkOrder({title:'Public preparation fence',description:'Synthetic dependencies only',kind:'feature',repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['No new capture after revocation'],reproductionCommand:null,expectedFailureText:null,checkCommands:[],allowedPaths:['sample.txt'],workerProfile:'mac'});
 const pause=async name=>{if(boundary===name){entered.resolve();await release.promise}};
 const jobs=new JobManager(storage,dir,()=>{},{preflightCodex:async()=>{await pause('preflight');return {binaryAvailable:true,authenticated:true,version:'public',workerProfile:'mac',error:null}},resolveCommit:async()=>{await pause('resolve');return 'a'.repeat(40)},createTaskWorktree:async()=>{creates++;await pause('workspace');return join(dir,'workspace')},removeTaskWorktree:async()=>{}},{capture(){captures++}},'openai/gpt-5.4-mini');
 t.after(async()=>{release.resolve();await jobs.close();storage.close();rmSync(dir,{recursive:true,force:true})});
 const pending=jobs.prepareRun(work,()=>{if(revoked)throw Error('Connection revoked')});await entered.promise;revoked=true;release.resolve();
 await assert.rejects(pending,/Connection revoked/);assert.equal(storage.listRuns(work.id).length,0);assert.equal(captures,0);assert.equal(creates,boundary==='workspace'?1:0);
});

async function evidenceFixture(t){
 const dir=mkdtempSync(join(tmpdir(),'read-authority-')),storage=openStorage(join(dir,'factory.sqlite'));
 const work=storage.createWorkOrder({title:'Public synthetic evidence',description:'No independent acceptance',kind:'feature',repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['Read only while authorized'],reproductionCommand:null,expectedFailureText:null,checkCommands:[],allowedPaths:['sample.txt'],workerProfile:'mac'});
 const initial=storage.createRun({workOrderId:work.id,workerProfile:'mac',inputCommit:work.baseRef,workspacePath:dir}),run=storage.saveRun({...initial,state:'ready_for_review',candidateCommit:'b'.repeat(40)});
 const factoryVersion='1'.repeat(64),requestId=randomUUID(),workId=randomUUID(),scope={ownerScope:'owner:public',repository:'public/evidence',workId,workGeneration:1,requestId};
 const binding={workOrderId:work.id,runId:run.id,candidateCommit:run.candidateCommit,factoryVersion},bytes=Buffer.from('Ordinary public fixture bytes\n');
 const ref=await storeEvidence(dir,binding,'TestEvidence','text/plain','public-fixture',bytes),proofReference=proofEvidenceReference(ref);
 const event=(type,payload)=>storage.appendEvent({workOrderId:work.id,runId:run.id,type,payload});
 event('factory.prepare_requested',{...scope,input:{repositoryPath:dir}});event('factory.owner_scope_bound',{...scope,clientId:'public'});
 event('run.signed_result',{synthetic:true});event('run.evidence_collected',{refs:[{...ref,proofReference}]});
 const client={...original(dir),purpose:'myeve-proof',actions:['evidence.read'],expiresAt:new Date(Date.now()+60000).toISOString()};
 const producer={snapshot:()=>({requestId,factoryVersion,workOrderId:work.id,runId:run.id}),read:()=>({state:'COMPLETED',result:{synthetic:true}})};
 const input={...scope,...binding,evidenceReference:proofReference,expectedDigest:ref.sha256,evidenceKind:ref.kind};
 t.after(()=>{storage.close();rmSync(dir,{recursive:true,force:true})});return {dir,storage,work,run,bytes,producer,client,input};
}
test('current synthetic evidence transport returns only the exact authorized bytes',async t=>{
 const f=await evidenceFixture(t),value=await readBoundEvidence(f.client,f.input,f.storage,f.producer,f.dir,()=>f.client);
 assert(Buffer.from(value.base64,'base64').equals(f.bytes));assert.equal(Object.hasOwn(value.ref,'relativePath'),false);
});
for(const change of ['grant','owner','purpose','expiry','repository','run','history'])test('pending evidence read: '+change+' denies before emitting bytes',async t=>{
 const f=await evidenceFixture(t);let client=f.client;
 const pending=readBoundEvidence(f.client,f.input,f.storage,f.producer,f.dir,()=>client);
 if(change==='grant')client={...client,actions:[]};if(change==='owner')client={...client,ownerScope:'owner:other'};
 if(change==='purpose')client={...client,purpose:undefined};if(change==='expiry')client={...client,expiresAt:new Date(Date.now()-1000).toISOString()};
 if(change==='repository')client={...client,repositoryPaths:[join(f.dir,'not-allowed')]};
 if(change==='run')f.storage.saveRun({...f.run,candidateCommit:'c'.repeat(40)});
 if(change==='history')f.storage.appendEvent({workOrderId:f.work.id,runId:f.run.id,type:'public.changed',payload:{}});
 await assert.rejects(pending,error=>[401,403,404].includes(error.status));assert.equal(f.storage.listRuns(f.work.id).length,1);
});
