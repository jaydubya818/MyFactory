import test from 'node:test';
import {profileTest} from './local-v4-profile.mjs';
import {createServer} from 'node:http';
const ptest=profileTest(test);
import {SpendGateway} from '../src/spend-gateway.ts';
const reviewPrice={revision:'synthetic',model:'openai/gpt-5.5',validUntil:'2099-01-01T00:00:00Z',contextLimitTokens:1000,outputLimitTokens:100,inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:1000000};
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync,existsSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {verifyLifecycleReceipt} from '../../../packages/capability-enforcement/src/lifecycle-wire.ts';
import {tmpdir} from 'node:os';
import {createLocalV4Supervisor} from '../src/server.ts';
import {FactoryDispatchControl} from '../src/dispatch-control.ts';
import {LocalExecutionProvider} from '../src/local-execution-provider.ts';
import {FileReceiverWitness,assertWitnessOutsideData} from '../src/local-ordered-admission.ts';
import {admissionActionDigest,signPolicyMessage,verifyPolicyMessage,policyMessageHash} from '../../../packages/capability-enforcement/src/ordering-wire.ts';
import {verifyFactoryPreparationTerminal} from '../../../packages/capability-enforcement/src/factory-preparation-terminal.ts';
import {digest} from '../../../packages/hosted-routing/src/result.ts';

// Race regressions (P1 independent finding): synthetic only: throwaway keys, a temporary git repository, fixture worker/verifier, loopback. No network, provider or spend.
const policyKey=async keyId=>{const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {keyId,jwk:await crypto.subtle.exportKey('jwk',p.privateKey)};};
const scope={ownerId:'owner:fixture',organizationId:'org',installationId:'install',backendId:'backend',incarnation:'epoch',enrollmentVersion:1};
const token='a'.repeat(64),SIGNER='receiver';
// Synthetic resource proof: the fixture worker and verifier hold no process or container, and no Docker daemon is consulted.
const syntheticProbe={processAbsent:()=>true,verifierAbsent:async()=>true,readiness:async()=>({ready:true,reason:null})};

function repoFixture(){
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'ordered-local-')),repo=join(dir,'repo');mkdirSync(repo);
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Factory fixture');git('config','user.email','fixture@example.invalid');
  writeFileSync(join(repo,'quantity.mjs'),'console.log(0);\n');git('add','.');git('commit','-qm','base');
  return {dir,repo,base:git('rev-parse','HEAD')};
}
const requestFor=(repo,base)=>({requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/golden',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1,spendContract:{version:'WORK_LEDGER_V2',pricingRevision:'synthetic',maxPaidOperations:2,plannedProductiveOperations:1,plannedCompletionOperations:1,completionReserveMicrousd:1100},
  input:{title:'Bounded fixture',description:'Change only quantity',kind:'feature',repositoryPath:repo,baseRef:base,acceptanceCriteria:['Print two'],reproductionCommand:null,expectedFailureText:null,checkCommands:['node quantity.mjs'],allowedPaths:['quantity.mjs'],workerProfile:'mac'}});

async function fence(h,authority,version,{operation='enable',capabilityId='work',controls}={}){
  const message={kind:'FENCE',authority,...scope,version,policyId:`${authority}-policy-${version}`,capabilityId,operation,...(controls?{controls}:{})};
  const envelope=await signPolicyMessage(message,h.keys[authority]);
  return h.cap('fence',{schema:'factory-capability-fence/v1',envelope});
}
async function permits(h,challengeEnvelope,{budget,stale}={}){
  const c=await verifyPolicyMessage(challengeEnvelope,h.keys.signer),{kind,...rest}=c;
  const mine=await signPolicyMessage({...rest,kind:'PERMIT',requiredCapabilities:['myfactory','work'],agentRevision:1,sourcePermitHash:'SELF',...(budget?{budgetMicros:budget}:{})},h.keys.myeve);
  const m=await verifyPolicyMessage(mine,h.keys.myeve);
  const relay=await signPolicyMessage({...rest,authority:'relay',version:stale?9:1,policyId:`relay-policy-${stale?9:1}`,kind:'PERMIT',requiredCapabilities:['myfactory','work'],agentRevision:1,sourcePermitHash:await policyMessageHash(m),...(budget?{budgetMicros:budget}:{})},h.keys.relay);
  return {myeve:mine,relay};
}
async function admitted(t,h,request){
  assert.equal((await fence(h,'myeve',1)).status,200);assert.equal((await fence(h,'relay',1)).status,200);
  const ch=await h.challenge(request);assert.equal(ch.status,200);
  return {ch:ch.body,pair:await permits(h,ch.body)};
}
const dispatchIdentity=(request,s)=>({runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:request.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:request.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:request.deadline});
const pauseMyfactory=(h,version=2)=>fence(h,'myeve',version,{operation:'pause',capabilityId:'myfactory'});

const FAKE_CODEX=`#!/usr/bin/env node
// Disposable stand-in for the Codex CLI: reads only what the real adapter passes (argv and the child-token environment).
const fs=require('node:fs');
const a=process.argv.slice(2);
if(a[0]==='--version'){console.log('codex-cli 0.0.0-disposable');process.exit(0);}
if(a[0]==='login'){process.exit(0);}
const arg=n=>{const i=a.indexOf(n);return i<0?undefined:a[i+1];};
const base=JSON.parse(a.find(x=>x.startsWith('model_providers.factory_spend.base_url=')).split('=').slice(1).join('='));
const cwd=arg('-C'),model=arg('-m'),readOnly=arg('--sandbox')==='read-only',final=arg('-o');
(async()=>{
  console.log(JSON.stringify({type:'thread.started',thread_id:'disposable-thread'}));
  const res=await fetch(base+'/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.FACTORY_GATEWAY_TOKEN,'content-type':'application/json'},body:JSON.stringify({model,input:'disposable step'})});
  if(res.status!==200){console.error('gateway '+res.status);process.exit(2);}
  const body=await res.json();
  if(!readOnly)fs.writeFileSync(cwd+'/quantity.mjs','console.log(2);\\n');
  fs.writeFileSync(final,'done');
  console.log(JSON.stringify({type:'turn.completed',usage:body.usage}));
})().catch(e=>{console.error(String(e));process.exit(3);});
`;
function installFakeCodex(dir,hold){const p=join(dir,'codex-disposable'+(hold?'-held':''));
  writeFileSync(p,hold?FAKE_CODEX.replace("(async()=>{","(async()=>{\n  while(!fs.existsSync("+JSON.stringify(hold)+"))await new Promise(r=>setTimeout(r,25));"):FAKE_CODEX,{mode:0o755});return p;}
async function disposableUpstream(t){
 const seen={calls:0,keys:[]};
 const server=createServer((req,res)=>{seen.calls++;seen.keys.push(req.headers.authorization);req.resume();
  res.writeHead(200,{'content-type':'application/json','x-request-id':'disposable-'+seen.calls});res.end(JSON.stringify({id:'r'+seen.calls,status:'completed',usage:{input_tokens:10,output_tokens:10}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 return {seen,origin:'http://127.0.0.1:'+server.address().port};
}
const ZERO='0'.repeat(64);
async function startProductive(t,{factory,dir,repo,base,keys,up,provider,codex,extra}={}){
  const f=dir?{dir,repo,base}:repoFixture(),dataDir=join(f.dir,'data-'+randomUUID().slice(0,8));mkdirSync(dataDir);
  const pair=generateKeyPairSync('ed25519'),key={factoryId:'factory-fixture',keyId:'fixture',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
  const resultSigning={factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]};
  writeFileSync(join(dataDir,'connections.json'),JSON.stringify({clients:[{id:'myeve',name:'Local fixture',tokenSha256:createHash('sha256').update(token).digest('hex'),repositoryPaths:[f.repo],ownerScope:scope.ownerId,actions:['factory.prepare','factory.dispatch','factory.observe','factory.stop']}]}));
  const witnessPath=join(f.dir,'witness',`head-${randomUUID().slice(0,8)}.json`);
  const ks=keys??{myeve:await policyKey('myeve'),relay:await policyKey('relay'),signer:await policyKey(SIGNER)};
  const witness=new FileReceiverWitness(witnessPath,'epoch-1');
  const orderedAdmission={enrollment:{scope,agentId:'agent',registryVersion:'r1',clientId:'myeve',sourceKeys:{myeve:ks.myeve,relay:ks.relay},signer:ks.signer,
    factory:factory??{factoryId:key.factoryId,factoryVersion:ZERO,sourceDigest:ZERO,configurationDigest:ZERO}},witness,witnessPath};
  const productiveBinding={provider:provider??{upstreamOrigin:up.origin,upstreamApiKey:'disposable-key',price:reviewPrice},codexExecutable:codex??installFakeCodex(f.dir),...(extra??{})};
  const supervisor=createLocalV4Supervisor({dataDir,resultSigning,orderedAdmission,productiveBinding});
  await new Promise((resolve,reject)=>{supervisor.server.once('error',reject);supervisor.server.listen(0,'127.0.0.1',resolve)});
  const origin='http://127.0.0.1:'+supervisor.server.address().port;
  const post=async(path,body,auth=token)=>{const r=await fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const cap=(step,body)=>post('/api/capability-admission/'+step,body);
  const challenge=(request,missionId='mission')=>cap('challenge',{schema:'factory-capability-admission-challenge/v1',request,missionId});
  const prepare=(request,pm,missionId='mission')=>cap('prepare',{schema:'factory-capability-admission-prepare/v1',request,missionId,capabilityPermits:pm});
  t.after(async()=>{try{await supervisor.close();}catch{}if(!dir){try{execFileSync('chmod',['-R','u+w',f.dir]);}catch{}rmSync(f.dir,{recursive:true,force:true});}});   // leased source artifacts are deliberately read-only
  return {...f,dataDir,supervisor,origin,post,cap,challenge,prepare,keys:ks,key,witnessPath,resultSigning,witness,scope};
}
// Discovery: an enrolled placeholder identity makes the native snapshot an ambiguous (never dispatchable) outcome, but the snapshot itself
// is the real productive configuration identity the production enrollment must pin.
async function productiveIdentity(t,up){
  const h=await startProductive(t,{up}),request=requestFor(h.repo,h.base);
  request.spendContract={...request.spendContract,maxPaidOperations:3,plannedProductiveOperations:2};
  const {pair}=await admitted(t,h,request);await h.prepare(request,pair);
  const snap=h.supervisor.storage.listEvents(h.supervisor.storage.listWorkOrders()[0].id).find(e=>e.type==='run.execution_snapshot').payload;
  const s=snap.snapshot??snap;
  return {repo:h.repo,base:h.base,dir:h.dir,factory:{factoryId:s.factoryId,factoryVersion:s.factoryVersion,sourceDigest:s.sourceDigest,configurationDigest:s.configurationDigest}};
}
async function quiescent(h,request,ms=60000){
 const until=Date.now()+ms;let last;
 while(Date.now()<until){const r=await fetch(h.origin+'/api/connect/v1/dispatches/'+request.requestId,{headers:{authorization:'Bearer '+token}});last=await r.json();if(last.quiescent)return last;await new Promise(x=>setTimeout(x,50));}
 throw Error('not quiescent; last='+JSON.stringify({state:last?.state,blocker:last?.blocker}));
}

test('productive binding is host-only, ordered-only and refuses every unqualified shape',async t=>{
  const up=await disposableUpstream(t),dir=realpathSync(mkdtempSync(join(tmpdir(),'prod-guards-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const codex=installFakeCodex(dir),provider={upstreamOrigin:up.origin,upstreamApiKey:'k',price:reviewPrice};
  const make=(over)=>{const d=join(dir,'d-'+randomUUID().slice(0,6));mkdirSync(d);
    const pair=generateKeyPairSync('ed25519'),key={factoryId:'f',keyId:'k',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
    return createLocalV4Supervisor({dataDir:d,resultSigning:{factoryId:'f',currentKeyId:'k',privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]},...over});};
  const ordered={enrollment:{scope,agentId:'agent',registryVersion:'r1',clientId:'myeve',sourceKeys:{myeve:{keyId:'a',jwk:{}},relay:{keyId:'b',jwk:{}}},signer:{keyId:'c',jwk:{}},factory:{factoryId:'f',factoryVersion:ZERO,sourceDigest:ZERO,configurationDigest:ZERO}},witness:new FileReceiverWitness(join(dir,'w','h.json'),'e'),witnessPath:join(dir,'w','h.json')};
  const base={provider,codexExecutable:codex};
  assert.throws(()=>make({productiveBinding:base}),/ordered receiver/);                                                           // no receiver
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:{...base,codexExecutable:'codex'}}),/not qualified/);          // PATH lookup
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:{...base,provider:{...provider,upstreamOrigin:'https://example.com'}}}),/not qualified/);
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:{...base,extra:1}}),/not qualified/);
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:base,localFactoryFixture:true}),/cannot use fixtures/);
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:base,localSpendFixture:{upstreamOrigin:up.origin,upstreamApiKey:'k',price:reviewPrice}}),/cannot use fixtures/);
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:base,jobDependencies:{runCodex:async()=>({})}}),/cannot use fixtures/);
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:base,localV4ResourceProbe:{processAbsent:()=>true,verifierAbsent:async()=>true,readiness:async()=>({ready:true,reason:null})}}),/cannot use fixtures/);
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:base,maxParallelRuns:2}),/cannot use fixtures/);
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:base,realProvider:{mode:'OPENAI_RESPONSES_PRIVATE_ALPHA'}}),/./);                  // realProvider stays refused in LOCAL_V4
  assert.throws(()=>make({orderedAdmission:ordered,productiveBinding:{...base,provider:{...provider,price:{...reviewPrice,validUntil:'2001-01-01T00:00:00Z'}}}}),/./);
});
ptest('productive: admitted dispatch runs the host-pinned worker through the metered gateway, verifies the leased source in Docker and completes with exact accounting',{timeout:180000},async t=>{
  const up=await disposableUpstream(t),id=await productiveIdentity(t,up),h=await startProductive(t,{...id,up}),request=requestFor(h.repo,h.base);
  request.spendContract={...request.spendContract,maxPaidOperations:3,plannedProductiveOperations:2};   // the first request is outside the implementation-progress capacity gate
  const {pair}=await admitted(t,h,request),prep=await h.prepare(request,pair);assert.equal(prep.status,200,JSON.stringify(prep.body));
  const s=prep.body.snapshot,dispatch=await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,dispatchIdentity(request,s));assert.equal(dispatch.status,200,JSON.stringify(dispatch.body));
  const done=await quiescent(h,request);
  assert.equal(done.state,'COMPLETED',JSON.stringify({state:done.state,blocker:done.blocker,events:h.supervisor.storage.listEvents(s.workOrderId).filter(e=>/hold|decision|failed|stderr/.test(e.type)).map(e=>e.type+':'+JSON.stringify(e.payload).slice(0,400))}));
  assert.equal(done.spend.status,'KNOWN');assert.equal(done.spend.operations.length,2);assert.equal(done.spend.settledMicrousd,40);
  assert.equal(up.seen.calls,2);assert.ok(up.seen.keys.every(k=>k==='Bearer disposable-key'));
  assert.equal(h.supervisor.storage.listChecks(s.runId).filter(c=>c.status==='passed').length>=1,true);
});

ptest('productive: a MyEve revoke while the worker holds denies its first metered call before the endpoint, stops cleanly and only then confirms cleanup',{timeout:180000},async t=>{
  const up=await disposableUpstream(t),id=await productiveIdentity(t,up),holdFile=join(id.dir,'hold-'+randomUUID()),codex=installFakeCodex(id.dir,holdFile);
  const h=await startProductive(t,{...id,up,codex}),request=requestFor(h.repo,h.base);
  request.spendContract={...request.spendContract,maxPaidOperations:3,plannedProductiveOperations:2};
  const {pair}=await admitted(t,h,request),prep=await h.prepare(request,pair);assert.equal(prep.status,200,JSON.stringify(prep.body));
  const s=prep.body.snapshot;assert.equal((await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,dispatchIdentity(request,s))).status,200);
  for(let i=0;i<200&&!h.supervisor.storage.listEvents(s.workOrderId).some(e=>e.type==='agent.process_started');i++)await new Promise(r=>setTimeout(r,50));
  assert.ok(h.supervisor.storage.listEvents(s.workOrderId).some(e=>e.type==='agent.process_started'));    // the real worker process is running (held before its first call)
  const envelope=await signPolicyMessage({kind:'FENCE',authority:'myeve',...scope,version:2,policyId:'myeve-policy-2',capabilityId:'myfactory',operation:'revoke'},h.keys.myeve);
  const first=await verifyLifecycleReceipt((await h.post('/api/capability-admission/control',{envelope})).body,h.keys.signer);
  assert.notEqual(first.state,'CLEANUP_CONFIRMED');                                                       // never clean while a worker may still be live
  writeFileSync(holdFile,'go');                                                                           // release the worker: its first metered call must now be denied
  const done=await quiescent(h,request);
  assert.equal(up.seen.calls,0);assert.equal(done.spend.operations.filter(o=>o.status==='SETTLED').length,0);
  const last=await verifyLifecycleReceipt((await h.post('/api/capability-admission/control',{envelope})).body,h.keys.signer);
  assert.equal(last.state,'CLEANUP_CONFIRMED');assert.equal(last.inventoryComplete,true);assert.ok(last.sequence>first.sequence);
});
