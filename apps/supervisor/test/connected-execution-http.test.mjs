import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSupervisor} from '../src/server.ts';
import {FactoryClient} from '../../../packages/client/src/index.ts';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve;return {promise:new Promise(done=>resolve=done),resolve:()=>resolve()};}
async function fixture(t,{worker}={}){
 const dir=mkdtempSync(join(tmpdir(),'connected-http-')),repo=join(dir,'repo');mkdirSync(repo);
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 writeFileSync(join(repo,'sample.txt'),'before\n');git('add','sample.txt');git('commit','-qm','input');
 const pair=generateKeyPairSync('ed25519'),token='3'.repeat(64),otherToken='4'.repeat(64),limitedToken='5'.repeat(64);
 const signing={factoryId:'factory-local-test',currentKeyId:'k1',privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
  keys:[{factoryId:'factory-local-test',keyId:'k1',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'}]};
 const full=['workorder.create','factory.execution.prepare','factory.execution.start','factory.execution.read','factory.execution.stop'];
 const configPath=join(dir,'connections.json');
 const client=(id,secret,actions)=>({id,name:id,tokenSha256:createHash('sha256').update(secret).digest('hex'),repositoryPaths:[repo],actions});
 writeFileSync(configPath,JSON.stringify({clients:[client('myeve',token,full),client('other',otherToken,full),
  client('intake-only',limitedToken,['workorder.create'])]}));
 const dependencies={preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-codex-1',workerProfile:'mac',error:null}),
  runCodex:async input=>{if(worker)return worker(input);writeFileSync(join(input.workspacePath,'sample.txt'),'after\n');return {success:true,status:'completed',eventsPath:'unused'};},
  verifyCandidate:async input=>{mkdirSync(input.artifactDir,{recursive:true});const logPath=join(input.artifactDir,'check.log');writeFileSync(logPath,'pass\n');
   const at=new Date().toISOString();return {checks:[{candidateCommit:input.candidateSha,command:'fixture-check',status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath}],reason:null};}};
 let host,origin;
 async function startHost(){host=createSupervisor({dataDir:dir,resultSigning:signing,jobDependencies:dependencies,linear:{}});
  await new Promise(resolve=>host.server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${host.server.address().port}`;}
 await startHost();t.after(async()=>{await host.close();rmSync(dir,{recursive:true,force:true});});
 const order=host.storage.createWorkOrder({title:'Connected HTTP fixture',description:'bounded',kind:'feature',repositoryPath:repo,baseRef:git('rev-parse','HEAD'),
  acceptanceCriteria:['verified'],reproductionCommand:null,expectedFailureText:null,checkCommands:['fixture-check'],allowedPaths:['sample.txt'],workerProfile:'mac'});
 async function call(path,{method='GET',body,auth=token}={}){
  const response=await fetch(`${origin}/api/connect/v1/${path}`,{method,headers:{Authorization:`Bearer ${auth}`,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
 async function prepare(id=randomUUID()){
  const version=await call(`work-orders/${order.id}/execution-version`);assert.equal(version.status,200);
  const payload={dispatchOperationId:id,requestId:randomUUID(),workOrderId:order.id,
   factoryId:version.body.factoryId,factoryVersion:version.body.factoryVersion,deadline:new Date(Date.now()+120000).toISOString()};
  const response=await call('executions',{method:'POST',body:payload});assert.equal(response.status,200);
  return {id,payload,response:response.body};
 }
 return {dir,repo,order,token,otherToken,limitedToken,configPath,full,client,call,prepare,
  get origin(){return origin;},
  restart:async()=>{await host.close();await startHost();},get host(){return host;}};
}
async function terminal(f,id){for(let i=0;i<500;i++){const r=await f.call(`executions/${id}`);if(r.body.quiescent)return r.body;await sleep(10);}throw Error('No terminal readback');}

test('connected HTTP journey returns one exact signed attempt and survives lost response',async t=>{
 const f=await fixture(t),{id,payload}=await f.prepare();
 assert.equal((await f.call('executions',{method:'POST',body:payload})).status,200);
 const starts=await Promise.all([f.call(`executions/${id}/start`,{method:'POST'}),f.call(`executions/${id}/start`,{method:'POST'})]);
 assert.equal(starts[0].status,200);assert.equal(starts[1].status,200);
 const ended=await terminal(f,id);assert.equal(ended.state,'COMPLETED');assert.equal(f.host.storage.listRuns(f.order.id).length,1);
 const typed=new FactoryClient({origin:f.origin,token:f.token});
 assert.equal((await typed.readExecution(id)).runId,ended.runId);
 assert.ok(ended.resultManifestDigest);const result=await f.call(ended.resultUrl.replace('/api/connect/v1/',''));
 assert.equal(result.status,200);assert.equal(result.body.result.manifestDigest,ended.resultManifestDigest);
 await f.restart();assert.equal((await f.call(`executions/${id}`)).body.runId,ended.runId);
 assert.equal((await f.call(`executions/${id}/start`,{method:'POST'})).body.code,'terminal_fence');
});

test('connected stop fences before start and denies cross-client control',async t=>{
 const f=await fixture(t),{id}=await f.prepare();
  assert.equal((await f.call(`executions/${id}`,{auth:f.otherToken})).status,404);
  assert.equal((await f.call(`executions/${id}/stop`,{method:'POST',auth:f.otherToken})).status,404);
  assert.equal((await f.call(`work-orders/${f.order.id}/execution-version`,{auth:f.limitedToken})).status,403);
  assert.equal((await f.call(`executions/${id}/start`,{method:'POST',auth:f.limitedToken})).status,403);
  assert.equal((await f.call('actions',{method:'POST',body:{action:'factory.execution.start',input:{dispatchOperationId:id}}})).status,403);
 const stopped=await f.call(`executions/${id}/stop`,{method:'POST'});assert.equal(stopped.body.state,'FENCED');
 assert.equal(stopped.body.quiescent,true);
 await f.restart();assert.equal((await f.call(`executions/${id}/start`,{method:'POST'})).status,409);
 assert.equal(f.host.storage.listRuns(f.order.id).length,0);
 writeFileSync(f.configPath,JSON.stringify({clients:[f.client('other',f.otherToken,f.full)]}));
 assert.equal((await f.call(`executions/${id}`)).status,401);
});

test('connected stop is nonquiescent until active worker terminates',async t=>{
 const entered=deferred(),release=deferred();
 const f=await fixture(t,{worker:async()=>{entered.resolve();await release.promise;return {success:false,status:'cancelled',eventsPath:'unused'};}});
 const {id}=await f.prepare();await f.call(`executions/${id}/start`,{method:'POST'});await entered.promise;
 const stopping=await f.call(`executions/${id}/stop`,{method:'POST'});
 assert.equal(stopping.body.quiescent,false);assert.ok(['STOPPING','UNKNOWN'].includes(stopping.body.state));
 release.resolve();const ended=await terminal(f,id);assert.equal(ended.state,'CANCELLED');
 assert.equal((await f.call(`executions/${id}/start`,{method:'POST'})).status,409);
});
