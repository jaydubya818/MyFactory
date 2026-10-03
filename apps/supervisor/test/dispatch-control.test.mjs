import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {createSupervisor} from '../src/server.ts';
import {verifyResult} from '../../../packages/hosted-routing/src/result.ts';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t,worker,localFactoryFixture=true,localSpendFixture){
 const dir=mkdtempSync(join(tmpdir(),'factory-control-')),repo=join(dir,'repo'),dataDir=join(dir,'data');mkdirSync(repo);mkdirSync(dataDir);
 const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Factory fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(repo,'quantity.mjs'),'console.log(0);\n');git('add','.');git('commit','-qm','base');
 const pair=generateKeyPairSync('ed25519'),token='a'.repeat(64),key={factoryId:'factory-fixture',keyId:'fixture',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const resultSigning={factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]};
 writeFileSync(join(dataDir,'connections.json'),JSON.stringify({clients:[{id:'myeve',name:'Local fixture',tokenSha256:createHash('sha256').update(token).digest('hex'),repositoryPaths:[repo],ownerScope:'owner:fixture',actions:['factory.prepare','factory.dispatch','factory.observe','factory.stop']}]}));
 let calls=0;
 const jobDependencies={preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-codex-1',workerProfile:'mac',error:null}),runCodex:async input=>{calls++;if(worker)return worker(input);writeFileSync(join(input.workspacePath,'quantity.mjs'),'console.log(2);\n');return {success:true,status:'completed',threadId:'fixture',eventsPath:'fixture',usage:null};},verifyCandidate:async input=>{mkdirSync(input.artifactDir,{recursive:true});return {checks:input.commands.map((command,i)=>{const logPath=join(input.artifactDir,i+'.log');writeFileSync(logPath,'fixture check\n');const at=new Date().toISOString();return {candidateCommit:input.candidateSha,candidateTree:git('rev-parse',input.candidateSha+'^{tree}'),command,status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath,reason:null};}),reason:null};}};
 let supervisor=createSupervisor({dataDir,resultSigning,jobDependencies,localFactoryFixture,localSpendFixture});
 async function listen(){await new Promise(r=>supervisor.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+supervisor.server.address().port;}
 let origin=await listen();
 const request=async(path,body,auth=token)=>{const res=await fetch(origin+'/api/connect/v1/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()};};
 const input={requestId:randomUUID(),workId:randomUUID(),workGeneration:2,repository:'fixture/golden',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1,input:{title:'Bounded fixture',description:'Change only quantity',kind:'feature',repositoryPath:repo,baseRef:git('rev-parse','HEAD'),acceptanceCriteria:['Print two'],reproductionCommand:null,expectedFailureText:null,checkCommands:['node quantity.mjs'],allowedPaths:['quantity.mjs'],workerProfile:'mac'}};
 function identity(prepared){const s=prepared.snapshot;return {runId:randomUUID(),writerGeneration:2,dispatchIdentity:randomUUID(),workId:input.workId,workGeneration:input.workGeneration,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:input.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:input.deadline};}
 t.after(async()=>{await supervisor.close();rmSync(dir,{recursive:true,force:true});});
 return {request,input,identity,key,get calls(){return calls;},get supervisor(){return supervisor;},async restart(){await supervisor.close();supervisor=createSupervisor({dataDir,resultSigning,jobDependencies,localFactoryFixture,localSpendFixture});origin=await listen();}};
}
async function terminal(f){for(let i=0;i<300;i++){const r=await f.request('dispatches/'+f.input.requestId);assert.equal(r.status,200);if(r.body.quiescent)return r.body;await sleep(10);}throw Error('No terminal proof');}
test('prepare binds actual attempt before any execution; response-loss/restart replay never redispatches',async t=>{
 const f=await fixture(t);const p=await f.request('dispatches',f.input);assert.equal(p.status,200);assert.equal(p.body.state,'PREPARED');assert.equal(f.calls,0);assert(p.body.snapshot.requestDigest);const id=f.identity(p.body);
 assert.equal(f.supervisor.storage.listEvents(id.workOrderId).find(event=>event.type==='factory.owner_scope_bound').payload.ownerScope,'owner:fixture');
 assert.equal((await f.request('dispatches',f.input)).body.runId,p.body.runId);
 await f.restart();assert.equal((await f.request('dispatches/'+f.input.requestId)).body.state,'PREPARED');
 const returns=await Promise.all([f.request('dispatches/'+f.input.requestId+'/dispatch',id),f.request('dispatches/'+f.input.requestId+'/dispatch',id)]);assert(returns.every(r=>r.status===200));
 const done=await terminal(f);assert.equal(done.state,'COMPLETED');assert.equal(f.calls,1);assert.deepEqual(done.identity,id);
 const result=await f.request(`work-orders/${id.workOrderId}/runs/${id.remoteRunId}/result`);assert.equal(result.status,200);const expected={...p.body.snapshot,keys:[f.key]};assert.equal(verifyResult(result.body.result,expected).manifest.status,'COMPLETED');
 await f.restart();await f.request('dispatches/'+f.input.requestId+'/dispatch',id);assert.equal(f.calls,1);assert.deepEqual((await f.request(`work-orders/${id.workOrderId}/runs/${id.remoteRunId}/result`)).body.result,result.body.result);
});
test('wrong token, replay mutation, incomplete binding and changed FactoryVersion cannot start work',async t=>{
 const f=await fixture(t);assert.equal((await f.request('dispatches',f.input,'b'.repeat(64))).status,401);const p=await f.request('dispatches',f.input),id=f.identity(p.body);
 assert.equal((await f.request('dispatches',{...f.input,workGeneration:3})).status,409);
 assert.equal((await f.request('dispatches/'+f.input.requestId+'/dispatch',{...id,factoryVersion:'b'.repeat(64)})).status,409);
 const incomplete={...id};delete incomplete.runId;assert.equal((await f.request('dispatches/'+f.input.requestId+'/dispatch',incomplete)).status,400);
 assert.equal(f.calls,0);
 await assert.rejects(f.supervisor.jobs.startRun(f.supervisor.storage.getWorkOrder(id.workOrderId)),/exact bound dispatch/);
});
test('stop before dispatch creates a durable terminal fence rejecting delayed execution after restart',async t=>{
 const f=await fixture(t),p=await f.request('dispatches',f.input),id=f.identity(p.body);
 const stopped=await f.request('dispatches/'+f.input.requestId+'/stop',id);assert.equal(stopped.status,200);assert.equal(stopped.body.state,'NOT_DISPATCHED');assert.equal(stopped.body.quiescent,true);
 await f.restart();await f.request('dispatches/'+f.input.requestId+'/dispatch',id);assert.equal(f.calls,0);
});
test('running stop stays STOPPING until the actual adapter call settles',async t=>{
 let release;const held=new Promise(r=>release=r);const f=await fixture(t,async input=>{await held;return {success:false,status:'cancelled',eventsPath:'fixture',usage:null};});
 const p=await f.request('dispatches',f.input),id=f.identity(p.body);await f.request('dispatches/'+f.input.requestId+'/dispatch',id);
 for(let i=0;i<100&&f.calls===0;i++)await sleep(5);assert.equal(f.calls,1);
 const stop=await f.request('dispatches/'+f.input.requestId+'/stop',id);assert.equal(stop.body.state,'STOPPING');assert.equal(stop.body.quiescent,false);
 release();assert.equal((await terminal(f)).state,'CANCELLED');assert.equal(f.calls,1);
});

test('default paid dispatch denies even with valid binding and injected dependencies',async t=>{
 const f=await fixture(t,undefined,false),p=await f.request('dispatches',f.input),id=f.identity(p.body);
 const denied=await f.request('dispatches/'+f.input.requestId+'/dispatch',id);assert.equal(denied.status,503);assert.equal(f.calls,0);
 assert.equal((await f.request('dispatches/'+f.input.requestId)).body.state,'PREPARED');
});
test('producer deadline aborts execution without a MyEve polling loop',async t=>{
 const f=await fixture(t,async input=>{await new Promise(resolve=>{if(input.signal.aborted)resolve();else input.signal.addEventListener('abort',resolve,{once:true});});return {success:false,status:'cancelled',eventsPath:'fixture',usage:null};});
 f.input.deadline=new Date(Date.now()+600).toISOString();const p=await f.request('dispatches',f.input),id=f.identity(p.body);
 await f.request('dispatches/'+f.input.requestId+'/dispatch',id);const ended=await terminal(f);assert.equal(ended.state,'CANCELLED');assert.equal(f.calls,1);
});

test('connected START routes each synthetic model call through exact Work spend gateway',async t=>{
 let providerCalls=0;
 const gatewayTokens=[];
 const provider=createServer(async(req,res)=>{
  providerCalls++;
  assert.equal(req.headers.authorization,'Bearer fixture-provider-key');
  res.writeHead(200,{'content-type':'application/json','x-request-id':'provider-connected-'+providerCalls});
  res.end(JSON.stringify({id:'response-connected',status:'completed',usage:{input_tokens:10,output_tokens:10}}));
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>provider.close(resolve)));
 const price={revision:'fixture-v1',model:'gpt-5.5',validUntil:new Date(Date.now()+60000).toISOString(),
  contextLimitTokens:1000,outputLimitTokens:100,inputMicrousdPerMillion:1_000_000,outputMicrousdPerMillion:2_000_000};
 const f=await fixture(t,async input=>{
  assert(input.gateway);
  gatewayTokens.push(input.gateway.childToken);
  const response=await fetch(input.gateway.baseUrl+'/responses',{method:'POST',
   headers:{authorization:'Bearer '+input.gateway.childToken,'content-type':'application/json'},
   body:JSON.stringify({model:'gpt-5.5',input:'synthetic coding step'})});
  assert.equal(response.status,200);
  if(input.sandbox==='read-only')assert.equal(gatewayTokens.length,2);
  else writeFileSync(join(input.workspacePath,'quantity.mjs'),'console.log(2);\n');
  return {success:true,status:'completed',threadId:'fixture',eventsPath:'fixture',usage:null};
 },false,{upstreamOrigin:'http://127.0.0.1:'+provider.address().port,upstreamApiKey:'fixture-provider-key',price});
 f.input.spendContract={version:'WORK_LEDGER_V2',pricingRevision:price.revision,
  plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:1200};
 const prepared=await f.request('dispatches',f.input),id=f.identity(prepared.body);
 assert.equal(prepared.body.spend.ceilingMicrousd,1_000_000);
 await f.request('dispatches/'+f.input.requestId+'/dispatch',id);
 const done=await terminal(f);
 assert.equal(done.state,'COMPLETED');
 assert.equal(done.spend.status,'KNOWN');
 assert.equal(done.spend.settledMicrousd,60);
 assert.equal(done.spend.operations.length,2);
 assert.equal(done.spend.phase,'completion');
 assert.equal(providerCalls,2);
 assert.notEqual(gatewayTokens[0],gatewayTokens[1]);
});

for(const scenario of ['no changes','outside scope','failed checks','completion failure','completion mutation']){
 test('completion prerequisite/finalization fails closed: '+scenario,async t=>{
  let n=0,completions=0;
  const provider=createServer((req,res)=>{req.resume();res.writeHead(200,{'content-type':'application/json','x-request-id':'negative-'+(++n)});res.end(JSON.stringify({status:'completed',usage:{input_tokens:10,output_tokens:10}}));});
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>provider.close(r)));
  const price={revision:'negative-v1',model:'gpt-5.5',validUntil:new Date(Date.now()+60000).toISOString(),contextLimitTokens:1000,outputLimitTokens:100,inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:2000000};
  const f=await fixture(t,async input=>{
   const completion=input.sandbox==='read-only';if(completion)completions++;
   const r=await fetch(input.gateway.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+input.gateway.childToken,'content-type':'application/json'},body:JSON.stringify({model:input.model,input:'synthetic'})});assert.equal(r.status,200);
   if(!completion&&scenario!=='no changes')writeFileSync(join(input.workspacePath,scenario==='outside scope'?'outside.txt':'quantity.mjs'),scenario==='failed checks'?'throw Error("incomplete");\n':'console.log(2);\n');
   if(completion&&scenario==='completion mutation')writeFileSync(join(input.workspacePath,'quantity.mjs'),'console.log(3);\n');
   return {success:!(completion&&scenario==='completion failure'),status:completion&&scenario==='completion failure'?'failed':'completed',eventsPath:'fixture',usage:null};
  },false,{upstreamOrigin:'http://127.0.0.1:'+provider.address().port,upstreamApiKey:'synthetic-only',price});
  f.input.spendContract={version:'WORK_LEDGER_V2',pricingRevision:price.revision,plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:1200};
  const p=await f.request('dispatches',f.input);assert.equal(p.status,200);const id=f.identity(p.body);
  await f.request('dispatches/'+f.input.requestId+'/dispatch',id);const done=await terminal(f);
  assert.equal(done.state,'FAILED');assert.equal(f.supervisor.storage.getRun(id.remoteRunId).candidateCommit,null);
  assert.equal(completions,scenario.startsWith('completion')?1:0);
  assert.equal(done.spend.authorityState,'fenced');assert.equal(done.spend.status,'KNOWN');
  await f.request('dispatches/'+f.input.requestId+'/dispatch',id);assert.equal(n,scenario.startsWith('completion')||scenario==='failed checks'?2:1);
 });
}
