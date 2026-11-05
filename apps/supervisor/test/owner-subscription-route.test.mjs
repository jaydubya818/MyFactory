import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profileTest} from './local-v4-profile.mjs';
import {createLocalV4Supervisor} from '../src/server.ts';
import {FileReceiverWitness} from '../src/local-ordered-admission.ts';
import {OwnerSubscriptionOperations,parseOwnerSubscriptionRoute,subscriptionSpendContract,OwnerSubscriptionRefused,SUBSCRIPTION_BASE_URL} from '../src/owner-subscription-route.ts';
import {parseHostConfig,HostConfigRefused,HOST_CONFIG_SCHEMA,hostExecutionConfiguration} from '../src/local-v4-host.ts';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {SpendLedger} from '../../../packages/storage/src/spend.ts';
import {OWNER_SUBSCRIPTION_PRICING_REVISION,assertNotOwnerSubscriptionPlan} from '../../../packages/storage/src/spend-policy.ts';
import {OWNER_SUBSCRIPTION_PRICING_REVISION_MARKER,ownerSubscriptionExecutorVersion} from '../../../packages/contracts/src/owner-subscription-route.ts';
import {ownerLoginEnvironment} from '../../../packages/agents/src/index.ts';
import {parseInput} from '../../../packages/hosted-routing/src/index.mjs';
import {validateManifest,digest} from '../../../packages/hosted-routing/src/result.ts';
import {PostgresSpendLedger} from '../../cloud-control/src/postgres-spend.mjs';
import {signPolicyMessage,verifyPolicyMessage,policyMessageHash} from '../../../packages/capability-enforcement/src/ordering-wire.ts';
const ptest=profileTest(test);

// FIXTURE ONLY: synthetic keys, temporary git repositories and SQLite files, a disposable stand-in Codex executable. No real Codex
// process, provider, network or paid call. The real route runs the operator's authenticated Codex CLI from reviewed host config.
const scope={ownerId:'owner:fixture',organizationId:'org',installationId:'install',backendId:'backend',incarnation:'epoch',enrollmentVersion:1};
const token='a'.repeat(64);
const until=()=>new Date(Date.now()+7*86400_000).toISOString();
const routeFor=(over={})=>({mode:'OWNER_SUBSCRIPTION_LOCAL',ownerOnly:true,bindHost:'127.0.0.1',ownerScope:scope.ownerId,clientId:'myeve',model:'gpt-5.5',
  validUntil:until(),maxProductiveOperations:2,maxConcurrentRuns:1,maxWorkSeconds:600,...over});
const routeRefused=(raw,code)=>assert.throws(()=>parseOwnerSubscriptionRoute(raw),e=>e instanceof OwnerSubscriptionRefused&&e.code===code,code);
const tmp=(t,prefix)=>{const d=realpathSync(mkdtempSync(join(tmpdir(),prefix)));t.after(()=>{try{execFileSync('chmod',['-R','u+w',d]);}catch{}rmSync(d,{recursive:true,force:true});});return d;};

test('route selection is explicit, owner-only, loopback-only and strictly bounded',()=>{
  assert.equal(parseOwnerSubscriptionRoute(routeFor()).mode,'OWNER_SUBSCRIPTION_LOCAL');
  const {ownerOnly,...noAck}=routeFor();routeRefused(noAck,'SUBSCRIPTION_ROUTE_SHAPE');
  routeRefused(routeFor({ownerOnly:'true'}),'SUBSCRIPTION_ROUTE_OWNER_ACK');
  routeRefused(routeFor({ownerOnly:false}),'SUBSCRIPTION_ROUTE_OWNER_ACK');
  for(const bindHost of ['0.0.0.0','localhost','::1','192.168.1.2'])routeRefused(routeFor({bindHost}),'SUBSCRIPTION_ROUTE_LOOPBACK');
  for(const ownerScope of ['tester:alice','org:x','owner:','*'])routeRefused(routeFor({ownerScope}),'SUBSCRIPTION_ROUTE_OWNER_SCOPE');
  for(const maxProductiveOperations of [0,3,4,1.5])routeRefused(routeFor({maxProductiveOperations}),'SUBSCRIPTION_ROUTE_OPERATIONS');
  for(const maxConcurrentRuns of [0,2])routeRefused(routeFor({maxConcurrentRuns}),'SUBSCRIPTION_ROUTE_CONCURRENCY');
  routeRefused(routeFor({mode:'LIVE'}),'SUBSCRIPTION_ROUTE_MODE');
  routeRefused(routeFor({validUntil:'2001-01-01T00:00:00Z'}),'SUBSCRIPTION_ROUTE_EXPIRY');
  routeRefused(routeFor({validUntil:new Date(Date.now()+90*86400_000).toISOString()}),'SUBSCRIPTION_ROUTE_EXPIRY');
  routeRefused({...routeFor(),hosted:true},'SUBSCRIPTION_ROUTE_SHAPE');
  // The executor version carries the route, so the Factory identity cannot equal a metered one for the same profile.
  assert.equal(ownerSubscriptionExecutorVersion('codex-cli 0.163.0'),'codex-cli 0.163.0 route=OWNER_SUBSCRIPTION_LOCAL');
  assert.equal(OWNER_SUBSCRIPTION_PRICING_REVISION_MARKER,OWNER_SUBSCRIPTION_PRICING_REVISION);
  // The child environment never carries API keys or provider overrides.
  const env=ownerLoginEnvironment({PATH:'/bin',HOME:'/Users/x',OPENAI_API_KEY:'sk-x',OPENAI_BASE_URL:'http://x',NODE_ENV:'production',CODEX_API_KEY:'k',ANTHROPIC_API_KEY:'a'});
  assert.deepEqual(Object.keys(env).sort(),['CI','HOME','LANG','PATH','TMPDIR']);
});

test('host config: the subscription provider is opt-in by mode, bound to the single owner client and never a metered price card',t=>{
  const dir=tmp(t,'sub-host-'),keys=join(dir,'k.json');
  const raw={schema:HOST_CONFIG_SCHEMA,factoryId:'factory-sub',port:8792,dataDir:join(dir,'data'),materialDir:join(dir,'material'),
    witness:{path:join(dir,'witness','head.json'),epoch:'e1'},worker:{codexExecutable:'/opt/homebrew/bin/codex',workerProfile:'mac'},verificationImage:'sha256:'+'a'.repeat(64),
    profile:{checkCommands:['node q.mjs'],allowedPaths:['q.mjs']},client:{id:'myeve',name:'MyEve owner',ownerScope:scope.ownerId,repositoryPaths:[dir]},
    enrollment:{scope,agentId:'agent',registryVersion:'r1',sourceKeyFiles:{myeve:keys,relay:keys}},provider:routeFor()};
  const config=parseHostConfig(raw);
  assert.equal(config.provider.mode,'OWNER_SUBSCRIPTION_LOCAL');
  const refused=(over,code)=>assert.throws(()=>parseHostConfig({...raw,...over}),e=>e instanceof HostConfigRefused&&e.code===code,code);
  refused({provider:routeFor({clientId:'tester'})},'HOST_CONFIG_SUBSCRIPTION_OWNER_ONLY');
  refused({provider:routeFor({ownerScope:'owner:someone-else'})},'HOST_CONFIG_SUBSCRIPTION_OWNER_ONLY');
  refused({provider:routeFor({bindHost:'0.0.0.0'})},'HOST_CONFIG_SUBSCRIPTION_ROUTE_LOOPBACK');
  const {ownerOnly,...noAck}=routeFor();refused({provider:noAck},'HOST_CONFIG_SUBSCRIPTION_ROUTE_SHAPE');
  refused({provider:routeFor({credentialFile:'/x'})},'HOST_CONFIG_SUBSCRIPTION_ROUTE_SHAPE');
  const price={revision:OWNER_SUBSCRIPTION_PRICING_REVISION,model:'gpt-5.5',validUntil:'2099-01-01T00:00:00Z',contextLimitTokens:1000,outputLimitTokens:100,inputMicrousdPerMillion:1,outputMicrousdPerMillion:1};
  refused({provider:{upstreamOrigin:'https://api.openai.com',credentialFile:join(dir,'c'),price}},'HOST_CONFIG_PRICE');
  const metered=parseHostConfig({...raw,provider:{upstreamOrigin:'https://api.openai.com',credentialFile:join(dir,'c'),price:{...price,revision:'r1'}}});
  const a=hostExecutionConfiguration(config,'codex-cli 1.2.3'),b=hostExecutionConfiguration(metered,'codex-cli 1.2.3');
  assert.equal(a.executorVersion,'codex-cli 1.2.3 route=OWNER_SUBSCRIPTION_LOCAL');assert.equal(b.executorVersion,'codex-cli 1.2.3');
  assert.notEqual(digest(a),digest(b));
});

test('hosted and cloud surfaces refuse the route',()=>{
  const input={idempotencyKey:'k',title:'t',description:'use OWNER_SUBSCRIPTION_LOCAL please',kind:'feature',acceptanceCriteria:['a'],allowedPaths:['src/a.ts']};
  assert.throws(()=>parseInput(input),/local only/);
  assert.throws(()=>parseInput({...input,description:'x',provider:{mode:'OWNER_SUBSCRIPTION_LOCAL'}}),/Unsupported factory request field/);
  assert.throws(()=>assertNotOwnerSubscriptionPlan({pricingRevision:OWNER_SUBSCRIPTION_PRICING_REVISION}),/local and owner-only/);
  const pg=new PostgresSpendLedger({});
  const binding={workId:'w',workGeneration:1,requestId:'r',workOrderId:'o'};
  const plan={version:'WORK_LEDGER_V2',pricingRevision:OWNER_SUBSCRIPTION_PRICING_REVISION,model:'gpt-5.5',validUntil:until(),perOperationReserveMicrousd:1,plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:1};
  return assert.rejects(pg.createBudgetWithContext({client:{query:()=>{throw Error('no query expected');}},now:Date.now(),timestamp:new Date().toISOString(),budget:async()=>undefined,operations:async()=>[]},binding,3,until(),plan),/local and owner-only/)
    .then(()=>{
      // A V1/V2 (hosted or legacy) Result can never carry the route in its executor version.
      const c={model:'openai/gpt-5.5',executor:'codex-cli',executorVersion:'codex-cli 1 route=OWNER_SUBSCRIPTION_LOCAL',skillRevision:'s',workerProfile:'mac',verificationImage:'i',nodeVersion:'v',platform:'p',architecture:'a',commands:['c'],allowedPaths:['p'],timeoutMs:1};
      const t0='2026-01-01T00:00:00.000Z',h='a'.repeat(64);
      const manifest={protocol:'MYFACTORY_RESULT_V1',keyId:'k',producer:'f',operationId:h,status:'COMPLETED',candidate:null,evidence:[],artifacts:[],evidenceDigest:h,artifactDigest:h,completedAt:t0,issuedAt:t0,
        execution:{version:1,factoryId:'f',factoryVersion:h,sourceDigest:h,configurationDigest:h,configuration:c,requestId:'r',requestDigest:h,workOrderId:'w',runId:'u',attemptNumber:1,inputCommit:'b'.repeat(40),capturedAt:t0}};
      assert.throws(()=>validateManifest(manifest),/Owner subscription route is local only/);
    });
});

// ---- ledger + worker unit contracts (real SQLite SpendLedger, fake adapter; no process)
function orderIn(path,dir){const storage=openStorage(path);const order=storage.createWorkOrder({title:'Ledger fixture',description:'Synthetic',kind:'feature',
  repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['Safe'],reproductionCommand:null,expectedFailureText:null,checkCommands:[],allowedPaths:['t.txt'],workerProfile:'mac'});
  const run=storage.createRun({workOrderId:order.id,workerProfile:'mac',inputCommit:'a'.repeat(40),workspacePath:dir});
  storage.close();return {workOrderId:order.id,runId:run.id};}
function ledgerFixture(t,{planned=2,lockDir,route:routeOver}={}){
  const dir=tmp(t,'sub-ledger-'),path=join(dir,'factory.sqlite');const {workOrderId,runId}=orderIn(path,dir);
  const ledger=new SpendLedger(path);t.after(()=>{try{ledger.close();}catch{}});
  const route=parseOwnerSubscriptionRoute(routeFor(routeOver));
  const calls=[];let hold=null,outcome='completed',ending={};
  const adapter={preflightCodex:async()=>({workerProfile:'mac',binaryAvailable:true,version:'codex-cli 9.9.9',authenticated:true,error:null}),
    runCodex:async options=>{calls.push(options);let aborted=false;
      if(hold)await Promise.race([hold,new Promise(r=>options.signal?.addEventListener('abort',()=>{aborted=true;r();},{once:true}))]);
      if(aborted)return {workerProfile:'mac',status:'cancelled',success:false,exitCode:null,exitSignal:'SIGTERM',startedAt:'',finishedAt:'',eventsPath:'/dev/null',stderrPath:'',finalMessagePath:'',finalMessageAvailable:false,threadId:null,usage:null,completionEventSeen:false,error:'aborted'};
      if(outcome==='throw')throw Error('adapter crashed');
      return {workerProfile:'mac',status:outcome,success:outcome==='completed',exitCode:0,exitSignal:null,startedAt:'',finishedAt:'',eventsPath:'/dev/null',stderrPath:'',finalMessagePath:'',finalMessageAvailable:false,threadId:'11111111-2222-4333-8444-555555555555',usage:null,completionEventSeen:true,error:null,...ending};}};
  const lockDirectory=lockDir??join(dir,'locks');
  const exe=join(dir,'codex-trusted');writeFileSync(exe,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const ops=new OwnerSubscriptionOperations(route,ledger,adapter,exe,join(dir,'state'),{lockDirectory,preflight:adapter.preflightCodex});
  const workId=randomUUID(),binding={workId,workGeneration:1,dispatchIdentity:randomUUID(),requestId:randomUUID(),workOrderId,factoryVersion:'f'.repeat(64),runId};
  const {plan,ceiling}=ops.plan(subscriptionSpendContract(route,planned));
  ledger.createBudget(binding,ceiling,new Date(Date.now()+600_000).toISOString(),plan);ledger.bindAuthority(binding);
  const expired=[],terminal={now:false};ops.startWork(workId,{isTerminal:()=>terminal.now,onExpire:reason=>{expired.push(reason);try{ledger.cancelBound(binding);}catch{}}});
  const decisions=[];
  const run=(phase,opts={})=>{const lease=ops.issue(binding,phase,()=>{},e=>decisions.push(e));
    return ops.runCodex({workspacePath:'/tmp',prompt:'p',model:'gpt-5.5',timeoutMs:1000,artifactsDir:'/tmp',...(phase==='completion'?{sandbox:'read-only'}:{}),gateway:lease,...opts});};
  return {dir,path,ledger,ops,route,binding,calls,run,decisions,expired,terminal,exe,lockDirectory,set:{hold:p=>{hold=p;},outcome:o=>{outcome=o;},ending:e=>{ending=e;}}};
}

test('ledger admits each subscription process, records SUBSCRIPTION_UNMETERED (never $0) and enforces the operation ceiling',async t=>{
  const f=ledgerFixture(t,{planned:1});
  await f.run('productive');
  assert.equal(f.calls[0].ownerLogin,true);assert.equal(f.calls[0].gateway,undefined);   // operator login, no gateway credential
  let spend=f.ledger.read(f.binding.workId);
  assert.equal(spend.status,'SUBSCRIPTION_UNMETERED');assert.notEqual(spend.status,'KNOWN');
  assert.equal(spend.metering,'SUBSCRIPTION_UNMETERED');assert.equal(spend.costKnown,false);assert.equal(spend.currency,null);
  for(const k of ['settledMicrousd','retainedMicrousd','availableMicrousd','ceilingMicrousd','unknownExposureMicrousd'])assert.equal(spend[k],null,k);
  assert.equal(spend.operations.length,1);assert.equal(spend.operations[0].actualMicrousd,null);assert.equal(spend.operations[0].spendStatus,'SUBSCRIPTION_UNMETERED');
  assert.equal(spend.operations[0].state,'settled');assert.match(spend.operations[0].providerRequestId,/^subscription-unmetered:/);
  assert.ok(!JSON.stringify(spend).includes('"settledMicrousd":0'));
  // Ceiling: one planned productive operation; a second is refused before any process exists.
  await assert.rejects(f.run('productive'),/operation limit/);
  assert.equal(f.calls.length,1);
  // Completion only after the host transition; the metered settle can never price a subscription operation.
  await assert.rejects(f.run('completion'),/phase is not host authorized/);
  f.ledger.beginCompletion(f.binding);await f.run('completion');
  await assert.rejects(f.run('completion'),/limit/);
  assert.doesNotThrow(()=>f.ledger.assertCompleted(f.binding));
  spend=f.ledger.read(f.binding.workId);assert.equal(spend.status,'SUBSCRIPTION_UNMETERED');assert.equal(spend.operationsUsed,2);assert.equal(spend.maxOperations,2);
  const opId=spend.operations[0].operationId;
  assert.throws(()=>f.ledger.settle(opId,0,'x',{input_tokens:0,output_tokens:0}),/Only dispatched|never settle a cost/);
  assert.ok(f.decisions.some(d=>d.code==='SUBSCRIPTION_UNMETERED'));
});

test('single-use leases, concurrency 1, phase binding and revocation before the process',async t=>{
  const f=ledgerFixture(t);
  const lease=f.ops.issue(f.binding,'productive',()=>{},()=>{});
  let release;f.set.hold(new Promise(r=>{release=r;}));
  const first=f.ops.runCodex({workspacePath:'/tmp',prompt:'p',model:'gpt-5.5',timeoutMs:1000,artifactsDir:'/tmp',gateway:lease});
  await assert.rejects(f.ops.runCodex({workspacePath:'/tmp',prompt:'p',model:'gpt-5.5',timeoutMs:1000,artifactsDir:'/tmp',gateway:lease}),/single-use/);
  await assert.rejects(f.run('productive'),/concurrency/);
  release();await first;f.set.hold(null);
  await assert.rejects(f.ops.runCodex({workspacePath:'/tmp',prompt:'p',model:'gpt-5.5',timeoutMs:1000,artifactsDir:'/tmp',gateway:{baseUrl:SUBSCRIPTION_BASE_URL,childToken:'b'.repeat(64)}}),/lease required/);
  await assert.rejects(f.run('productive',{sandbox:'read-only'}),/phase mismatch/);
  // A revoked authority denies before reserve: nothing is recorded and no process starts.
  const before=f.calls.length;
  const denied=f.ops.issue(f.binding,'productive',()=>{throw Error('revoked');},()=>{});
  await assert.rejects(f.ops.runCodex({workspacePath:'/tmp',prompt:'p',model:'gpt-5.5',timeoutMs:1000,artifactsDir:'/tmp',gateway:denied}),/revoked/);
  assert.equal(f.calls.length,before);assert.equal(f.ledger.read(f.binding.workId).operations.filter(o=>o.state!=='released').length,1);
  f.ops.disable('test');assert.throws(()=>f.run('productive'),/disabled/);
  await assert.rejects(f.ops.runCodex({workspacePath:'/tmp',prompt:'p',model:'gpt-5.5',timeoutMs:1000,artifactsDir:'/tmp',gateway:lease}),/disabled/);
});

test('UNKNOWN after a crash or unresolved process is fenced and blocks every further operation',async t=>{
  const f=ledgerFixture(t);
  f.set.outcome('timed_out');await f.run('productive');
  let spend=f.ledger.read(f.binding.workId);
  assert.equal(spend.status,'UNKNOWN');assert.equal(spend.metering,'SUBSCRIPTION_UNMETERED');assert.equal(spend.unknownOperations,1);assert.equal(spend.authorityState,'fenced');
  await assert.rejects(f.run('productive'),/./);assert.equal(f.calls.length,1);
  assert.throws(()=>f.ledger.settleSubscriptionUnmetered(spend.operations[0].operationId,{outcome:'completed',threadId:null}),/dispatched/);
  // Host crash mid-process: the dispatched operation is left behind; restart recovery turns it UNKNOWN and fences the Work.
  const g=ledgerFixture(t);
  const op=randomUUID();
  g.ledger.reserve({...g.binding,operationId:op,model:'gpt-5.5',pricingRevision:OWNER_SUBSCRIPTION_PRICING_REVISION,reservedMicrousd:1,phase:'productive'});g.ledger.markDispatched(op);
  g.ledger.close();
  const restarted=new SpendLedger(g.path);t.after(()=>restarted.close());
  assert.equal(restarted.recoverUnknown(),1);
  spend=restarted.read(g.binding.workId);assert.equal(spend.status,'UNKNOWN');assert.equal(spend.authorityState,'fenced');
  assert.throws(()=>restarted.reserve({...g.binding,operationId:randomUUID(),model:'gpt-5.5',pricingRevision:OWNER_SUBSCRIPTION_PRICING_REVISION,reservedMicrousd:1,phase:'productive'}),/./);
  // An adapter exception is unresolved too.
  const h=ledgerFixture(t);h.set.outcome('throw');await assert.rejects(h.run('productive'),/adapter crashed/);
  assert.equal(h.ledger.read(h.binding.workId).status,'UNKNOWN');
});

test('metered ledger refuses the unmetered recorder',t=>{
  const dir=tmp(t,'sub-metered-'),path=join(dir,'factory.sqlite');const {workOrderId,runId}=orderIn(path,dir);
  const ledger=new SpendLedger(path);t.after(()=>ledger.close());
  const binding={workId:randomUUID(),workGeneration:1,dispatchIdentity:randomUUID(),requestId:randomUUID(),workOrderId,factoryVersion:'f'.repeat(64),runId};
  ledger.createBudget(binding,10_000,new Date(Date.now()+600_000).toISOString(),{version:'WORK_LEDGER_V2',pricingRevision:'r1',model:'gpt-5.5',validUntil:'2099-01-01T00:00:00Z',perOperationReserveMicrousd:100,plannedProductiveOperations:1,plannedCompletionOperations:1,maxPaidOperations:2,completionReserveMicrousd:100});
  ledger.bindAuthority(binding);const op=randomUUID();
  ledger.reserve({...binding,operationId:op,model:'gpt-5.5',pricingRevision:'r1',reservedMicrousd:100,phase:'productive'});ledger.markDispatched(op);
  assert.throws(()=>ledger.settleSubscriptionUnmetered(op,{outcome:'completed',threadId:null}),/authoritative provider usage/);
  ledger.settle(op,40,'req-1',{input_tokens:1,output_tokens:1});
  const spend=ledger.read(binding.workId);assert.equal(spend.status,'KNOWN');assert.equal(spend.settledMicrousd,40);assert.equal(spend.metering,undefined);
});

// ---- supervisor composition
const policyKey=async keyId=>{const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {keyId,jwk:await crypto.subtle.exportKey('jwk',p.privateKey)};};
const FAKE_CODEX=`#!/usr/bin/env node
// Disposable stand-in for the operator-login Codex CLI. Fails if any API key or gateway token reaches it.
const fs=require('node:fs');
const a=process.argv.slice(2);
if(a[0]==='--version'){console.log('codex-cli 0.0.0-subscription-fixture');process.exit(0);}
if(a.includes('login')){console.log('Logged in using ChatGPT');process.exit(0);}
if(process.env.OPENAI_API_KEY||process.env.FACTORY_GATEWAY_TOKEN||process.env.CODEX_API_KEY){console.error('credential leaked');process.exit(7);}
if(!a.includes('--ignore-user-config')||!a.includes('forced_login_method="chatgpt"')||a.some(x=>x.includes('model_providers'))){console.error('not owner-login argv');process.exit(8);}
const arg=n=>{const i=a.indexOf(n);return i<0?undefined:a[i+1];};
const cwd=arg('-C'),readOnly=arg('--sandbox')==='read-only',final=arg('-o');
fs.appendFileSync(require('node:path').dirname(process.argv[1])+'/calls.jsonl',JSON.stringify({readOnly,envKeys:Object.keys(process.env).sort()})+'\\n');
console.log(JSON.stringify({type:'thread.started',thread_id:'99999999-2222-4333-8444-555555555555'}));
if(!readOnly)fs.writeFileSync(cwd+'/quantity.mjs','console.log(2);\\n');
fs.writeFileSync(final,'done');
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));
`;
function keysFor(){const pair=generateKeyPairSync('ed25519'),key={factoryId:'factory-fixture',keyId:'fixture',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
  return {factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]};}
const ZERO='0'.repeat(64);
async function compose(t,{dir,repo,factory,keys,route=routeFor(),over={},enrollmentClient='myeve'}={}){
  const d=dir??tmp(t,'sub-sup-');
  if(!repo){repo=join(d,'repo');mkdirSync(repo);const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','F');git('config','user.email','f@example.invalid');
    writeFileSync(join(repo,'quantity.mjs'),'console.log(0);\n');git('add','.');git('commit','-qm','base');}
  const base=execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const dataDir=join(d,'data-'+randomUUID().slice(0,8));mkdirSync(dataDir);
  writeFileSync(join(dataDir,'connections.json'),JSON.stringify({clients:[{id:'myeve',name:'Owner',tokenSha256:createHash('sha256').update(token).digest('hex'),repositoryPaths:[repo],ownerScope:scope.ownerId,actions:['factory.prepare','factory.dispatch','factory.observe','factory.stop']}]}));
  const ks=keys??{myeve:await policyKey('myeve'),relay:await policyKey('relay'),signer:await policyKey('receiver')};
  const witnessPath=join(d,'witness',`head-${randomUUID().slice(0,8)}.json`);
  const codex=join(d,'codex-subscription-fixture');writeFileSync(codex,FAKE_CODEX,{mode:0o755});
  const image=over.verificationImage;
  const options={dataDir,resultSigning:keysFor(),orderedAdmission:{enrollment:{scope,agentId:'agent',registryVersion:'r1',clientId:enrollmentClient,sourceKeys:{myeve:ks.myeve,relay:ks.relay},signer:ks.signer,
    factory:factory??{factoryId:'factory-fixture',factoryVersion:ZERO,sourceDigest:ZERO,configurationDigest:ZERO}},witness:new FileReceiverWitness(witnessPath,'epoch-1'),witnessPath},
    ownerSubscriptionBinding:{route,codexExecutable:codex,...(image?{verificationImage:image}:{})},...(over.options??{})};
  return {dir:d,repo,base,dataDir,keys:ks,codex,options,make:()=>createLocalV4Supervisor(options)};
}

test('composition refuses every unqualified subscription shape and any non-loopback listener',async t=>{
  const c=await compose(t);
  const bad=over=>()=>createLocalV4Supervisor({...c.options,...over});
  assert.throws(bad({productiveBinding:{provider:{upstreamOrigin:'https://api.openai.com',upstreamApiKey:'k',price:{}},codexExecutable:c.codex}}),/excludes the metered/);
  assert.throws(bad({orderedAdmission:undefined}),/ordered receiver/);
  assert.throws(bad({localFactoryFixture:true}),/cannot use fixtures/);
  assert.throws(bad({jobDependencies:{runCodex:async()=>({})}}),/cannot use fixtures/);
  assert.throws(bad({maxParallelRuns:2}),/cannot use fixtures/);
  assert.throws(bad({ownerSubscriptionBinding:{...c.options.ownerSubscriptionBinding,codexExecutable:'codex'}}),/not qualified/);
  assert.throws(bad({ownerSubscriptionBinding:{...c.options.ownerSubscriptionBinding,route:routeFor({ownerOnly:false})}}),/OWNER_ACK/);
  assert.throws(bad({ownerSubscriptionBinding:{...c.options.ownerSubscriptionBinding,route:routeFor({clientId:'tester'})}}),/exactly one owner client/);
  assert.throws(bad({ownerSubscriptionBinding:{...c.options.ownerSubscriptionBinding,route:routeFor({ownerScope:'owner:other'})}}),/exactly one owner client/);
  const prior=process.env.FACTORY_HOSTED_INTAKE;process.env.FACTORY_HOSTED_INTAKE='true';
  try{assert.throws(bad({}),/hosted intake/);}finally{if(prior===undefined)delete process.env.FACTORY_HOSTED_INTAKE;else process.env.FACTORY_HOSTED_INTAKE=prior;}
  // Environment cannot select the route for a metered or unbound supervisor: there is no environment selector at all.
  const s=c.make();t.after(()=>s.close().catch(()=>{}));
  await new Promise((ok,fail)=>{s.server.once('error',fail);s.server.listen(0,'0.0.0.0',ok);});
  for(let i=0;i<50&&s.server.listening;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(s.ownerSubscription.disabled,'non-loopback listener');assert.equal(s.server.listening,false);
  assert.throws(()=>s.ownerSubscription.assertOwner({id:'myeve',ownerScope:scope.ownerId}),/disabled/);
});

test('owner-only: proof readers, testers and other scopes are refused by the route',async t=>{
  const c=await compose(t),s=c.make();t.after(()=>s.close().catch(()=>{}));
  const o=s.ownerSubscription;
  assert.doesNotThrow(()=>o.assertOwner({id:'myeve',ownerScope:scope.ownerId}));
  for(const client of [{id:'tester',ownerScope:scope.ownerId},{id:'myeve',ownerScope:'owner:other'},{id:'myeve',ownerScope:scope.ownerId,purpose:'myeve-proof'}])
    assert.throws(()=>o.assertOwner(client),/owner-only/);
  assert.throws(()=>o.plan({...subscriptionSpendContract(o.route),plannedProductiveOperations:3,maxPaidOperations:4}),/Exact owner-subscription/);
  assert.throws(()=>o.plan({...subscriptionSpendContract(o.route),pricingRevision:'r1'}),/Exact owner-subscription/);
  assert.throws(()=>o.plan({...subscriptionSpendContract(o.route),completionReserveMicrousd:1100}),/Exact owner-subscription/);
});

// ---- end to end through the ordered receiver on the pinned profile (disposable Codex stand-in; Docker verifier)
async function fence(h,authority,version){const envelope=await signPolicyMessage({kind:'FENCE',authority,...scope,version,policyId:`${authority}-policy-${version}`,capabilityId:'work',operation:'enable'},h.keys[authority]);return h.cap('fence',{schema:'factory-capability-fence/v1',envelope});}
async function permits(h,challengeEnvelope){
  const c=await verifyPolicyMessage(challengeEnvelope,h.keys.signer),{kind,...rest}=c;
  const mine=await signPolicyMessage({...rest,kind:'PERMIT',requiredCapabilities:['myfactory','work'],agentRevision:1,sourcePermitHash:'SELF'},h.keys.myeve);
  const m=await verifyPolicyMessage(mine,h.keys.myeve);
  return {myeve:mine,relay:await signPolicyMessage({...rest,authority:'relay',version:1,policyId:'relay-policy-1',kind:'PERMIT',requiredCapabilities:['myfactory','work'],agentRevision:1,sourcePermitHash:await policyMessageHash(m)},h.keys.relay)};
}
async function start(t,c){
  const supervisor=c.make();await new Promise((ok,fail)=>{supervisor.server.once('error',fail);supervisor.server.listen(0,'127.0.0.1',ok);});
  t.after(()=>supervisor.close().catch(()=>{}));
  const origin='http://127.0.0.1:'+supervisor.server.address().port;
  const post=async(path,body)=>{const r=await fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const get=async path=>{const r=await fetch(origin+path,{headers:{authorization:'Bearer '+token}});return {status:r.status,body:await r.json()};};
  const cap=(step,body)=>post('/api/capability-admission/'+step,body);
  return {...c,supervisor,origin,post,get,cap};
}
const requestFor=(repo,base,route)=>({requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/golden',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1,
  spendContract:subscriptionSpendContract(route),
  input:{title:'Bounded fixture',description:'Change only quantity',kind:'feature',repositoryPath:repo,baseRef:base,acceptanceCriteria:['Print two'],reproductionCommand:null,expectedFailureText:null,checkCommands:['node quantity.mjs'],allowedPaths:['quantity.mjs'],workerProfile:'mac'}});
async function prepared(h,request){
  assert.equal((await fence(h,'myeve',1)).status,200);assert.equal((await fence(h,'relay',1)).status,200);
  const ch=await h.cap('challenge',{schema:'factory-capability-admission-challenge/v1',request,missionId:'mission'});assert.equal(ch.status,200,JSON.stringify(ch.body));
  return h.cap('prepare',{schema:'factory-capability-admission-prepare/v1',request,missionId:'mission',capabilityPermits:await permits(h,ch.body)});
}
const identityFor=(request,s)=>({runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:request.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:request.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:request.deadline});

ptest('end to end: the ordered receiver dispatches the operator-login worker once, completes, and reports SUBSCRIPTION_UNMETERED',{timeout:180000},async t=>{
  const image=execFileSync('docker',['image','inspect','node:22-bookworm','--format','{{.Id}}'],{encoding:'utf8'}).trim();
  const priorKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='sk-must-not-reach-the-child';
  t.after(()=>{if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey;});
  // Discovery of the native identity (the enrolled placeholder never dispatches), then the real enrollment.
  const first=await start(t,await compose(t,{over:{verificationImage:image}})),log=join(first.dir,'calls.jsonl');
  const discover=requestFor(first.repo,first.base,routeFor());
  const dp=await prepared(first,discover);
  const orders=first.supervisor.storage.listWorkOrders();
  assert.ok(orders.length&&first.supervisor.storage.listEvents(orders[0].id).some(e=>e.type==='run.execution_snapshot'),JSON.stringify({status:dp.status,body:dp.body,events:orders[0]&&first.supervisor.storage.listEvents(orders[0].id).map(e=>e.type+':'+JSON.stringify(e.payload).slice(0,300))}));
  const snap=first.supervisor.storage.listEvents(first.supervisor.storage.listWorkOrders()[0].id).find(e=>e.type==='run.execution_snapshot').payload,sn=snap.snapshot??snap;
  assert.match(sn.configuration.executorVersion,/ route=OWNER_SUBSCRIPTION_LOCAL$/);
  const h=await start(t,await compose(t,{dir:first.dir,repo:first.repo,keys:first.keys,over:{verificationImage:image},
    factory:{factoryId:sn.factoryId,factoryVersion:sn.factoryVersion,sourceDigest:sn.sourceDigest,configurationDigest:sn.configurationDigest}}));
  const actions=await h.get('/api/connect/v1/actions');
  assert.equal(actions.body.execution.mode,'OWNER_SUBSCRIPTION_LOCAL');assert.equal(actions.body.execution.metering,'SUBSCRIPTION_UNMETERED');
  assert.deepEqual(actions.body.execution.limits,{maxProductiveOperations:2,plannedCompletionOperations:1,maxOperationsPerWork:3,maxConcurrentRuns:1,concurrencyScope:'MACHINE',maxWorkSeconds:600});
  const request=requestFor(h.repo,h.base,routeFor());
  const prep=await prepared(h,request);assert.equal(prep.status,200,JSON.stringify(prep.body));
  const s=prep.body.snapshot,identity=identityFor(request,s);
  // A dispatch that execution does not accept (dispatch paused) never starts the Work clock; the later accepted one does.
  h.supervisor.storage.setDispatchPaused(true,h.supervisor.storage.getPolicy().revision,'test');
  assert.notEqual((await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,identity)).status,200);
  assert.equal(h.supervisor.ownerSubscription.workDeadline(request.workId),null);
  h.supervisor.storage.setDispatchPaused(false,h.supervisor.storage.getPolicy().revision,'test');
  // A claim whose transaction rolls back (failed COMMIT) leaves neither a durable claim nor a clock.
  {
    const storage=h.supervisor.storage,orig=storage.transaction;let armed=true;
    storage.transaction=function(fn){return orig.call(this,()=>{const r=fn();
      if(r===true&&armed&&this.listEvents(s.workOrderId).some(e=>e.type==='factory.dispatch_claimed')){armed=false;throw Error('COMMIT failed');}return r;});};
    try{assert.notEqual((await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,identity)).status,200);}finally{storage.transaction=orig;}
    assert.equal(armed,false);
    assert.equal(storage.listEvents(s.workOrderId).filter(e=>e.type==='factory.dispatch_claimed').length,0);
    assert.equal(h.supervisor.ownerSubscription.workDeadline(request.workId),null);
  }
  const dispatch=await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,identity);assert.equal(dispatch.status,200,JSON.stringify(dispatch.body));
  let done;for(let i=0;i<1200;i++){done=(await h.get('/api/connect/v1/dispatches/'+request.requestId)).body;if(done.quiescent)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(done.state,'COMPLETED',JSON.stringify({state:done.state,blocker:done.blocker,events:h.supervisor.storage.listEvents(s.workOrderId).filter(e=>/hold|decision|failed|stderr|stopped/.test(e.type)).map(e=>e.type+':'+JSON.stringify(e.payload).slice(0,300))}));
  assert.ok(h.supervisor.ownerSubscription.workDeadline(request.workId)>0);
  assert.equal(h.supervisor.ownerSubscription.workRetired(request.workId),true);       // terminal readback retires the clock
  assert.equal(done.spend.cancelled,false);
  assert.equal(done.spend.status,'SUBSCRIPTION_UNMETERED');assert.equal(done.spend.metering,'SUBSCRIPTION_UNMETERED');assert.equal(done.spend.settledMicrousd,null);
  assert.deepEqual(done.spend.operations.map(o=>[o.phase,o.state,o.actualMicrousd]),[['productive','settled',null],['completion','settled',null]]);
  const calls=readFileSync(log,'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(calls.map(c=>c.readOnly),[false,true]);
  for(const c of calls)assert.ok(c.envKeys.filter(k=>k!=='__CF_USER_TEXT_ENCODING').every(k=>['CI','HOME','LANG','PATH','TMPDIR','USER','CODEX_HOME'].includes(k)),c.envKeys.join(','));
  // Single-use dispatch: a replay returns the recorded state and admits nothing.
  const again=await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,identity);assert.equal(again.status,200);
  await new Promise(r=>setTimeout(r,300));
  assert.equal(readFileSync(log,'utf8').trim().split('\n').length,2);
  assert.equal((await h.get('/api/connect/v1/dispatches/'+request.requestId)).body.spend.operations.length,2);
});

// ---- trusted host launcher with the subscription provider (disposable stand-in Codex; no dispatch)
import {provisionHostMaterial,startLocalV4Host,MATERIAL} from '../src/local-v4-host.ts';
const pubKey=k=>({keyId:k.keyId,jwk:{kty:'EC',crv:'P-256',x:k.jwk.x,y:k.jwk.y}});
async function hostFixture(t,{apiKeyLogin=false}={}){
  const dir=tmp(t,'sub-hostrun-'),repo=join(dir,'repo');mkdirSync(repo);
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','F');git('config','user.email','f@example.invalid');writeFileSync(join(repo,'quantity.mjs'),'console.log(0);\n');git('add','.');git('commit','-qm','base');
  const codex=join(dir,'codex-sub-host');writeFileSync(codex,apiKeyLogin?FAKE_CODEX.replace("console.log('Logged in using ChatGPT')","console.log('Logged in using an API key')"):FAKE_CODEX,{mode:0o755});
  const keys={myeve:await policyKey('myeve-k1'),relay:await policyKey('relay-k1')},keyDir=join(dir,'public-keys');mkdirSync(keyDir);
  for(const a of ['myeve','relay'])writeFileSync(join(keyDir,a+'.json'),JSON.stringify(pubKey(keys[a])));
  const raw={schema:HOST_CONFIG_SCHEMA,factoryId:'factory-sub-host',port:8792,dataDir:join(dir,'data'),materialDir:join(dir,'material'),
    witness:{path:join(dir,'witness','head.json'),epoch:'epoch-1'},worker:{codexExecutable:codex,workerProfile:'mac'},verificationImage:'sha256:'+'a'.repeat(64),
    profile:{checkCommands:['node quantity.mjs'],allowedPaths:['quantity.mjs']},client:{id:'myeve',name:'MyEve owner',ownerScope:scope.ownerId,repositoryPaths:[repo]},
    enrollment:{scope,agentId:'agent',registryVersion:'r1',sourceKeyFiles:{myeve:join(keyDir,'myeve.json'),relay:join(keyDir,'relay.json')}},provider:routeFor()};
  const config={...parseHostConfig(raw),port:0};await provisionHostMaterial(config);
  return {dir,repo,config};
}
test('host launcher: subscription route listens on loopback, advertises the route and limits, needs no provider credential',async t=>{
  const f=await hostFixture(t),host=await startLocalV4Host(f.config,{inspectImage:id=>id});t.after(()=>host.close().catch(()=>{}));
  const tokenValue=readFileSync(join(f.config.materialDir,MATERIAL.token),'utf8').trim();
  assert.equal((await fetch(host.origin+'/api/health')).status,200);
  const actions=await (await fetch(host.origin+'/api/connect/v1/actions',{headers:{authorization:'Bearer '+tokenValue}})).json();
  assert.equal(actions.execution.mode,'OWNER_SUBSCRIPTION_LOCAL');assert.equal(actions.execution.ownerOnly,true);assert.equal(actions.execution.enabled,true);
  assert.equal(actions.execution.limits.maxOperationsPerWork,3);
  const facts=JSON.parse(readFileSync(join(f.config.materialDir,MATERIAL.facts),'utf8'));
  assert.equal(facts.provider.mode,'OWNER_SUBSCRIPTION_LOCAL');assert.equal(facts.provider.metering,'SUBSCRIPTION_UNMETERED');
  assert.equal(facts.readiness.expectedExecution.mode,'OWNER_SUBSCRIPTION_LOCAL');
  assert.equal(facts.configuration.executorVersion,'codex-cli 0.0.0-subscription-fixture route=OWNER_SUBSCRIPTION_LOCAL');
  assert.deepEqual(facts.provider.spendContract,subscriptionSpendContract(f.config.provider));
});
test('host launcher refuses the subscription route without the operator ChatGPT login',async t=>{
  const f=await hostFixture(t,{apiKeyLogin:true});
  await assert.rejects(startLocalV4Host(f.config,{inspectImage:id=>id}),e=>e.code==='HOST_CODEX_OWNER_LOGIN_REQUIRED');
});

// ---- review-1 regressions and the 10-minute Work cap
import {OWNER_SUBSCRIPTION_LOCK_DIRECTORY} from '../src/owner-subscription-route.ts';
import {watchdogFor,lockFree,lockHolder,killOwnOrphan,WATCHDOG_SOURCE} from '../src/owner-subscription-watchdog.ts';
import {spawn,spawnSync} from 'node:child_process';
import {loadHostConfig,assertTrustedExecutable,isInsideForTest,hostPreflight} from '../src/local-v4-host.ts';
import {preflightOwnerLoginCodex} from '../../../packages/agents/src/index.ts';
import {symlinkSync,chmodSync,existsSync,statSync} from 'node:fs';

test('route accepts the exact MyEve owner principal UUID and enforces maxWorkSeconds 1..600',()=>{
  const uuid='bd78f31f-b369-443a-a1d4-6d7d2ecc0118';
  assert.equal(parseOwnerSubscriptionRoute(routeFor({ownerScope:uuid})).ownerScope,uuid);
  for(const ownerScope of ['BD78F31F-B369-443A-A1D4-6D7D2ECC0118','bd78f31f-b369-443a-a1d4-6d7d2ecc011*','tester:'+uuid,uuid+'x'])routeRefused(routeFor({ownerScope}),'SUBSCRIPTION_ROUTE_OWNER_SCOPE');
  for(const maxWorkSeconds of [0,601,3600,1.5,'600'])routeRefused(routeFor({maxWorkSeconds}),'SUBSCRIPTION_ROUTE_WORK_SECONDS');
  const {maxWorkSeconds,...missing}=routeFor();routeRefused(missing,'SUBSCRIPTION_ROUTE_SHAPE');
});

test('Work cap: expiry aborts the running process group, leaves its operation UNKNOWN, fences and refuses further operations',async t=>{
  const f=ledgerFixture(t,{route:{maxWorkSeconds:1}});
  f.set.hold(new Promise(()=>{}));                                   // the "process" only ends when aborted
  const started=Date.now();await f.run('productive');
  assert.ok(Date.now()-started>=900&&Date.now()-started<5000);
  assert.deepEqual(f.expired,['WORK_TIME_LIMIT']);
  const spend=f.ledger.read(f.binding.workId);
  assert.equal(spend.status,'UNKNOWN');assert.equal(spend.unknownOperations,1);assert.equal(spend.authorityState,'fenced');assert.equal(spend.cancelled,true);
  assert.ok(f.decisions.some(d=>d.code==='PROVIDER_OUTCOME_UNKNOWN'&&d.expired==='WORK_TIME_LIMIT'));
  assert.throws(()=>f.run('productive'),/clock is not running/);
  assert.throws(()=>f.ops.startWork(f.binding.workId,{onExpire:()=>{},isTerminal:()=>false}),/time limit/);   // a replay never resets the clock
});

test('a process needs an accepted (running) Work clock; startWork is idempotent; terminal Works only retire their clock',async t=>{
  const f=ledgerFixture(t);
  const other={...f.binding,workId:randomUUID()};
  const lease=f.ops.issue(other,'productive',()=>{},()=>{});                     // issuing before acceptance is allowed ...
  await assert.rejects(f.ops.runCodex({workspacePath:'/tmp',prompt:'p',model:'gpt-5.5',timeoutMs:1000,artifactsDir:'/tmp',gateway:lease}),/time limit/);   // ... running is not
  assert.equal(f.ops.workDeadline(other.workId),null);
  f.ops.startWork(f.binding.workId,{onExpire:()=>{throw Error('second hooks must not replace the first');},isTerminal:()=>false});
  f.terminal.now=true;f.ops.expireWork(f.binding.workId,'WORK_TIME_LIMIT');
  assert.deepEqual(f.expired,[]);assert.equal(f.ops.workRetired(f.binding.workId),true);assert.equal(f.ledger.read(f.binding.workId).cancelled,false);
  // A retired clock's timer never fires into a finished Work.
  const g=ledgerFixture(t,{route:{maxWorkSeconds:1}});g.ops.retireWork(g.binding.workId);
  await new Promise(r=>setTimeout(r,1300));
  assert.deepEqual(g.expired,[]);assert.equal(g.ledger.read(g.binding.workId).cancelled,false);
});

// Kernel-lock helpers: a real watchdog holding the lock around a long-running stand-in Codex.
function sleeper(dir,name='codex-sleeper'){const p=join(dir,name);writeFileSync(p,'#!/bin/sh\nsleep 60\n',{mode:0o755});return p;}
function launchDetached(dir,lockDirectory,{owner='/owner/state',remainingMs=60_000,orphan=false,codex}={}){
  const w=watchdogFor(lockDirectory),args=['-I',w.script,'run',w.lockFile,owner,String(remainingMs),randomUUID(),codex??sleeper(dir)];
  if(!orphan){const c=spawn(w.python,args,{detached:true,stdio:'ignore'});c.unref();return c.pid;}
  // Supervisor death: an intermediate process starts the watchdog and exits immediately.
  const r=spawnSync(process.execPath,['-e',`const c=require('node:child_process').spawn(${JSON.stringify(w.python)},${JSON.stringify(args)},{detached:true,stdio:'ignore'});c.unref();console.log(c.pid);`],{encoding:'utf8'});
  return Number(r.stdout.trim());
}
const waitFor=async(cond,ms=8000)=>{for(const end=Date.now()+ms;Date.now()<end;){if(cond())return true;await new Promise(r=>setTimeout(r,50));}return cond();};
const killGroup=pid=>{try{process.kill(-pid,'SIGKILL');}catch{}};

test('machine-wide concurrency is a kernel lock: a second host refuses before any ledger exposure; a crashed holder releases it',async t=>{
  const a=ledgerFixture(t),b=ledgerFixture(t,{lockDir:a.lockDirectory});
  const pid=launchDetached(a.dir,a.lockDirectory);t.after(()=>killGroup(pid));
  assert.ok(await waitFor(()=>!lockFree(a.lockDirectory)));
  await assert.rejects(b.run('productive'),/machine-wide concurrency/);
  assert.equal(b.calls.length,0);assert.equal(b.ledger.read(b.binding.workId).operations.length,0);
  const w=watchdogFor(a.lockDirectory);
  assert.equal(spawnSync(w.python,['-I',w.script,'run',w.lockFile,'/x','60000',randomUUID(),sleeper(a.dir,'other')],{detached:true,timeout:15_000,killSignal:'SIGKILL'}).status,75);   // another watchdog refuses
  assert.equal(statSync(a.lockDirectory).mode&0o777,0o700);
  killGroup(pid);                                                         // holder crash: the kernel releases the lock, no takeover logic
  assert.ok(await waitFor(()=>lockFree(a.lockDirectory)));
  await b.run('productive');assert.equal(b.calls.length,1);
  // A momentary probe (another host checking) never refuses a launch: the watchdog retries briefly.
  const holdFor=spawn(w.python,['-I','-c',`import fcntl,os,time\nfd=os.open(${JSON.stringify(w.lockFile)},os.O_RDWR)\nfcntl.flock(fd,fcntl.LOCK_EX)\ntime.sleep(0.3)`]);const holdClosed=new Promise(r=>holdFor.once('close',r));
  await new Promise(r=>setTimeout(r,100));
  const quick=join(a.dir,'codex-quick');writeFileSync(quick,'#!/bin/sh\nexit 0\n',{mode:0o755});
  assert.equal(spawnSync(w.python,['-I',w.script,'run',w.lockFile,'/x','60000',randomUUID(),quick],{detached:true,timeout:15_000,killSignal:'SIGKILL'}).status,0);
  await holdClosed;
  const c=await compose(t),s=c.make();t.after(()=>s.close().catch(()=>{}));
  assert.equal(s.ownerSubscription.lockDirectory,OWNER_SUBSCRIPTION_LOCK_DIRECTORY);
  assert.match(OWNER_SUBSCRIPTION_LOCK_DIRECTORY,/\/\.myfactory\/owner-subscription$/);
});

test('supervisor death keeps exclusivity and the wall clock: the watchdog holds the lock and kills its group at the deadline',async t=>{
  const dir=tmp(t,'sub-orphan-'),lockDirectory=join(dir,'locks');
  const pid=launchDetached(dir,lockDirectory,{orphan:true,remainingMs:2000});t.after(()=>killGroup(pid));
  assert.ok(pid>0);
  assert.ok(await waitFor(()=>!lockFree(lockDirectory)));               // the launcher is gone, Codex still holds the lock
  assert.equal(lockHolder(lockDirectory).pgid,pid);
  await new Promise(r=>setTimeout(r,1000));assert.equal(lockFree(lockDirectory),false);
  assert.ok(await waitFor(()=>lockFree(lockDirectory),9000),'deadline kill must release the lock');
  let alive=true;try{process.kill(-pid,0);}catch{alive=false;}
  assert.equal(alive,false);
  const w=watchdogFor(lockDirectory);                                    // at or after the deadline nothing starts
  assert.equal(spawnSync(w.python,['-I',w.script,'run',w.lockFile,'/x','0',randomUUID(),sleeper(dir,'late')],{detached:true,timeout:15_000,killSignal:'SIGKILL'}).status,124);
});

test('startup recovery kills only this host\'s orphaned group, before anything else',async t=>{
  const dir=tmp(t,'sub-recover-'),lockDirectory=join(dir,'locks');
  const pid=launchDetached(dir,lockDirectory,{orphan:true,owner:'/host/a/data'});t.after(()=>killGroup(pid));
  assert.ok(await waitFor(()=>!lockFree(lockDirectory)));
  assert.deepEqual(killOwnOrphan(lockDirectory,'/host/b/data'),{status:'OTHER_HOST'});assert.equal(lockFree(lockDirectory),false);   // another host's process is left alone
  const h=lockHolder(lockDirectory);assert.equal(h.pid,pid);assert.match(h.nonce,/^[0-9a-f-]{36}$/);assert.ok(h.start.length>0);
  // Identity doubt is never signalled: a forged start time or nonce (PID reuse) makes recovery refuse instead.
  const lockFile=join(lockDirectory,'execution.lock');
  for(const forged of [{...h,start:'Thu Jan  1 00:00:00 1970'},{...h,nonce:randomUUID()}]){
    writeFileSync(lockFile,JSON.stringify(forged));
    assert.deepEqual(killOwnOrphan(lockDirectory,'/host/a/data'),{status:'UNVERIFIED'});
    let alive=true;try{process.kill(-pid,0);}catch{alive=false;}assert.equal(alive,true);assert.equal(lockFree(lockDirectory),false);
  }
  // A different, live, unrelated process named by the metadata (PID reuse) is not signalled either.
  const bystander=spawn('/bin/sleep',['30'],{detached:true,stdio:'ignore'});bystander.unref();t.after(()=>killGroup(bystander.pid));
  const start=execFileSync('/bin/ps',['-o','lstart=','-p',String(bystander.pid)],{encoding:'utf8',env:{LC_ALL:'C',PATH:'/usr/bin:/bin'}}).trim();
  writeFileSync(lockFile,JSON.stringify({...h,pid:bystander.pid,pgid:bystander.pid,start}));
  assert.deepEqual(killOwnOrphan(lockDirectory,'/host/a/data'),{status:'UNVERIFIED'});
  let bystanderAlive=true;try{process.kill(bystander.pid,0);}catch{bystanderAlive=false;}assert.equal(bystanderAlive,true);
  writeFileSync(lockFile,JSON.stringify(h));
  assert.deepEqual(killOwnOrphan(lockDirectory,'/host/a/data'),{status:'KILLED',pgid:pid});assert.equal(lockFree(lockDirectory),true);
});

test('executable trust is re-checked at every execution entry and in direct composition',async t=>{
  const f=ledgerFixture(t);
  assert.ok((await f.ops.preflightCodex()).authenticated);
  chmodSync(f.exe,0o777);
  await assert.rejects(f.ops.preflightCodex(),e=>e.code==='HOST_CODEX_UNTRUSTED');
  await assert.rejects(f.run('productive'),e=>e.code==='HOST_CODEX_UNTRUSTED');
  assert.equal(f.calls.length,0);assert.equal(f.ledger.read(f.binding.workId).operations.length,0);
  assert.throws(()=>new OwnerSubscriptionOperations(f.route,f.ledger,{},f.exe,join(f.dir,'state')),e=>e.code==='HOST_CODEX_UNTRUSTED');
  const c=await compose(t);chmodSync(c.codex,0o777);
  assert.throws(()=>c.make(),e=>e.code==='HOST_CODEX_UNTRUSTED');
});

test('owner-login preflight children get the allowlisted environment (no API keys)',async t=>{
  const dir=tmp(t,'sub-preflight-'),codex=join(dir,'codex');
  writeFileSync(codex,`#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(join(dir,'env.jsonl'))},JSON.stringify(Object.keys(process.env))+'\\n');
const a=process.argv.slice(2);if(a[0]==='--version'){console.log('codex-cli 1.0.0');process.exit(0);}
console.log(a.includes('forced_login_method="chatgpt"')?'Logged in using ChatGPT':'Logged in using an API key');`,{mode:0o755});
  const prior=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='sk-must-not-reach-preflight';
  t.after(()=>{if(prior===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prior;});
  const pf=await preflightOwnerLoginCodex(codex);
  assert.equal(pf.authenticated,true);assert.equal(pf.version,'codex-cli 1.0.0');
  const envs=readFileSync(join(dir,'env.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.equal(envs.length,2);
  for(const keys of envs)assert.ok(!keys.includes('OPENAI_API_KEY')&&keys.filter(k=>k!=='__CF_USER_TEXT_ENCODING').every(k=>['CI','HOME','LANG','PATH','TMPDIR','USER','CODEX_HOME'].includes(k)),keys.join(','));
});

test('host config and Codex executable trust is checked before any execution; `..`-prefixed names are inside',async t=>{
  const dir=tmp(t,'sub-trust-');
  const keys=join(dir,'k.json');
  const raw={schema:HOST_CONFIG_SCHEMA,factoryId:'factory-sub',port:8792,dataDir:join(dir,'data'),materialDir:join(dir,'material'),
    witness:{path:join(dir,'witness','head.json'),epoch:'e1'},worker:{codexExecutable:'/opt/homebrew/bin/codex',workerProfile:'mac'},verificationImage:'sha256:'+'a'.repeat(64),
    profile:{checkCommands:['node q.mjs'],allowedPaths:['q.mjs']},client:{id:'myeve',name:'MyEve owner',ownerScope:scope.ownerId,repositoryPaths:[dir]},
    enrollment:{scope,agentId:'agent',registryVersion:'r1',sourceKeyFiles:{myeve:keys,relay:keys}},provider:routeFor()};
  const cfg=join(dir,'host-config.json');writeFileSync(cfg,JSON.stringify(raw),{mode:0o600});
  assert.equal(loadHostConfig(cfg).provider.mode,'OWNER_SUBSCRIPTION_LOCAL');
  const untrusted=(fn,code)=>assert.throws(fn,e=>e.code===code,code);
  chmodSync(cfg,0o666);untrusted(()=>loadHostConfig(cfg),'HOST_CONFIG_UNTRUSTED');chmodSync(cfg,0o620);untrusted(()=>loadHostConfig(cfg),'HOST_CONFIG_UNTRUSTED');chmodSync(cfg,0o600);
  const link=join(dir,'link.json');symlinkSync(cfg,link);untrusted(()=>loadHostConfig(link),'HOST_CONFIG_UNTRUSTED');
  const open=join(dir,'open');mkdirSync(open);chmodSync(open,0o777);const inOpen=join(open,'c.json');writeFileSync(inOpen,JSON.stringify(raw),{mode:0o600});
  untrusted(()=>loadHostConfig(inOpen),'HOST_CONFIG_UNTRUSTED');
  // Executable: a replaceable binary is refused BEFORE it ever runs (preflight included).
  const marker=join(dir,'executed'),codex=join(dir,'codex');
  writeFileSync(codex,`#!/bin/sh\ntouch ${marker}\necho codex-cli 1.0.0\n`,{mode:0o755});
  assert.doesNotThrow(()=>assertTrustedExecutable(codex));
  chmodSync(codex,0o777);
  await assert.rejects(hostPreflight({...parseHostConfig(raw),worker:{codexExecutable:codex,workerProfile:'mac'}}),e=>e.code==='HOST_CODEX_UNTRUSTED');
  chmodSync(codex,0o755);
  const inOpenCodex=join(open,'codex');writeFileSync(inOpenCodex,`#!/bin/sh\ntouch ${marker}\n`,{mode:0o755});
  untrusted(()=>assertTrustedExecutable(inOpenCodex),'HOST_CODEX_UNTRUSTED');
  const linkCodex=join(open,'codex-link');symlinkSync(codex,linkCodex);untrusted(()=>assertTrustedExecutable(linkCodex),'HOST_CODEX_UNTRUSTED');
  assert.equal(existsSync(marker),false);
  untrusted(()=>assertTrustedExecutable('codex'),'HOST_CODEX_UNTRUSTED');
  // Containment: `<repo>/..material` is inside the repository, `<repo>/../x` is not.
  assert.equal(isInsideForTest(join(dir,'..material'),dir),true);
  assert.equal(isInsideForTest(join(dir,'..','x'),dir),false);
});

test('the watchdog holds the lock and the deadline over the WHOLE group, reports signal deaths as signals, and uses a monotonic clock',async t=>{
  const dir=tmp(t,'sub-group-'),lockDirectory=join(dir,'locks'),w=watchdogFor(lockDirectory);
  // Codex exits at once but leaves a descendant: the watchdog (and so the lock) stays until the descendant is gone.
  const leaves=join(dir,'codex-leaves');writeFileSync(leaves,'#!/bin/sh\n(sleep 2) &\nexit 0\n',{mode:0o755});
  const run=spawn(w.python,['-I',w.script,'run',w.lockFile,'/o','60000',randomUUID(),leaves],{detached:true,stdio:'ignore'});t.after(()=>killGroup(run.pid));
  const exited=new Promise(r=>run.once('exit',(code,signal)=>r({code,signal,at:Date.now()})));const t0=Date.now();
  await new Promise(r=>setTimeout(r,800));assert.equal(lockFree(lockDirectory),false);
  const e=await exited;assert.equal(e.code,0);assert.ok(e.at-t0>=1800,'watchdog must outlive the descendant');
  assert.ok(await waitFor(()=>lockFree(lockDirectory)));
  // Deadline against the group: a descendant that outlives Codex is killed at the deadline.
  const lingers=join(dir,'codex-lingers');writeFileSync(lingers,'#!/bin/sh\n(sleep 60) &\nexit 0\n',{mode:0o755});
  const run2=spawn(w.python,['-I',w.script,'run',w.lockFile,'/o','1500',randomUUID(),lingers],{detached:true,stdio:'ignore'});t.after(()=>killGroup(run2.pid));
  const e2=await new Promise(r=>run2.once('exit',(code,signal)=>r({code,signal})));
  assert.equal(e2.signal,'SIGKILL');                                            // the group (watchdog included) was killed at the deadline
  let alive=true;try{process.kill(-run2.pid,0);}catch{alive=false;}assert.equal(alive,false);
  assert.ok(await waitFor(()=>lockFree(lockDirectory)));
  // A signal-killed Codex is reported as that signal, never as an ordinary exit code.
  const killed=join(dir,'codex-killed');writeFileSync(killed,'#!/bin/sh\nkill -KILL $$\n',{mode:0o755});
  const r3=spawnSync(w.python,['-I',w.script,'run',w.lockFile,'/o','60000',randomUUID(),killed],{detached:true,timeout:15_000,killSignal:'SIGKILL'});
  assert.equal(r3.status,null);assert.equal(r3.signal,'SIGKILL');
  // Deadline and grace use the shared monotonic clock; no adjustable wall clock is read.
  const src=readFileSync(w.script,'utf8');
  assert.equal((src.match(/time\.time\(\)/g)??[]).length,0);assert.match(src,/deadline = entry_ms \+ remaining_ms/);assert.match(src,/grace = monotonic_ms\(\) \+ 5000/);
});

test('signalled or >=128 exits are UNKNOWN, never settled as unmetered success',async t=>{
  for(const ending of [{exitCode:137,exitSignal:null},{exitCode:null,exitSignal:'SIGTERM'},{exitCode:143,exitSignal:null}]){
    const f=ledgerFixture(t);f.set.ending(ending);
    await f.run('productive');
    const spend=f.ledger.read(f.binding.workId);
    assert.equal(spend.status,'UNKNOWN',JSON.stringify(ending));assert.equal(spend.unknownOperations,1);assert.equal(spend.authorityState,'fenced');
  }
});

test('a watchdog started without its own process group becomes its group leader (never waits on or kills the caller group)',async t=>{
  const dir=tmp(t,'sub-leader-'),lockDirectory=join(dir,'locks'),w=watchdogFor(lockDirectory);
  const quick=join(dir,'codex-quick');writeFileSync(quick,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const r=spawnSync(w.python,['-I',w.script,'run',w.lockFile,'/o','60000',randomUUID(),quick],{timeout:20000});   // not detached
  assert.equal(r.status,0);assert.equal(r.error,undefined);
  const h=lockHolder(lockDirectory);assert.equal(h.pgid,h.pid);assert.notEqual(h.pgid,process.pid);
});

test('review-4: fail-closed scans, private lock fd, deadline recheck, monotonic min(request,cap) allowance, no post-reap group signal',async t=>{
  const dir=tmp(t,'sub-r4-'),lockDirectory=join(dir,'locks'),w=watchdogFor(lockDirectory),src=readFileSync(w.script,'utf8');
  // A failed or empty process scan counts as surviving members (never "none").
  assert.match(src,/if proc\.returncode != 0 or not out\.strip\(\):\n\s+raise RuntimeError/);
  assert.match(src,/except Exception:\n\s+return True/);assert.match(src,/does not even list the watchdog/);
  // Codex cannot unlock the watchdog's lock: the lock descriptor is not inherited.
  const unlocker=join(dir,'codex-unlocker');
  writeFileSync(unlocker,`#!/usr/bin/python3 -I\nimport fcntl,os,time\nfor fd in range(3,256):\n    try:\n        fcntl.flock(fd,fcntl.LOCK_UN)\n    except OSError:\n        pass\ntime.sleep(3)\n`,{mode:0o755});
  const run=spawn(w.python,['-I',w.script,'run',w.lockFile,'/o','60000',randomUUID(),unlocker],{detached:true,stdio:'ignore'});t.after(()=>killGroup(run.pid));
  await new Promise(r=>setTimeout(r,1500));
  assert.equal(lockFree(lockDirectory),false,'the watchdog must still hold the lock after Codex tried to unlock every descriptor');
  await new Promise(r=>run.once('exit',r));assert.ok(await waitFor(()=>lockFree(lockDirectory)));
  // The deadline is rechecked right before spawning: 1 ms left never starts Codex.
  const marker=join(dir,'started'),touch=join(dir,'codex-touch');writeFileSync(touch,`#!/bin/sh\ntouch ${marker}\n`,{mode:0o755});
  assert.equal(spawnSync(w.python,['-I',w.script,'run',w.lockFile,'/o','1',randomUUID(),touch],{detached:true,timeout:15_000,killSignal:'SIGKILL'}).status,124);assert.equal(existsSync(marker),false);
  // Allowance = min(maxWorkSeconds, request deadline), monotonic: a later wall-clock rollback does not extend it.
  const f=ledgerFixture(t),other=randomUUID();
  f.ops.startWork(other,{onExpire:()=>{},isTerminal:()=>false,requestDeadline:new Date(Date.now()+2000).toISOString()});
  assert.ok(f.ops.workRemainingMs(other)<=2000);
  const realNow=Date.now;Date.now=()=>realNow()-3_600_000;try{assert.ok(f.ops.workRemainingMs(other)<=2000);}finally{Date.now=realNow;}
  await f.run('productive');assert.ok(f.calls[0].ownerLoginWatchdog.remainingMs<=600_000&&f.calls[0].ownerLoginWatchdog.remainingMs>0);
  // The adapter never signals the watchdog's PGID after the watchdog was reaped.
  const {createCodexAdapter}=await import('../../../packages/agents/src/index.ts');
  const ws=join(dir,'ws'),art=join(dir,'art');mkdirSync(ws);mkdirSync(art);
  const quick=join(dir,'codex-q');writeFileSync(quick,'#!/bin/sh\nexit 0\n',{mode:0o755});
  const kills=[],realKill=process.kill;process.kill=function(pid,sig){if(pid<0)kills.push([pid,sig]);return realKill.call(process,pid,sig);};
  try{await createCodexAdapter(quick).runCodex({workspacePath:ws,prompt:'p',model:'gpt-5.5',timeoutMs:20000,artifactsDir:art,ownerLogin:true,
    ownerLoginWatchdog:{...w,owner:'/o',remainingMs:20000,deadlineMonoMs:Number(process.hrtime.bigint()/1_000_000n)+20000,nonce:randomUUID()}});}finally{process.kill=realKill;}
  assert.deepEqual(kills,[]);
});

test('failed or incomplete process inspection cannot release the execution lock as a successful completion',async t=>{
  for(const inspection of ['nonzero','empty','partial','timeout']){
    const dir=tmp(t,'sub-ps-'+inspection+'-'),w=watchdogFor(join(dir,'locks'));
    const probe=join(dir,'ps-fixture');
    const action=inspection==='nonzero'?'sys.exit(1)':inspection==='empty'?'sys.exit(0)':inspection==='partial'?'print("123 123 S");sys.exit(0)':'time.sleep(5)';
    writeFileSync(probe,`#!/usr/bin/python3\nimport os,sys,time\nif "-A" in sys.argv:\n    ${action}\nos.execv("/bin/ps",["/bin/ps"]+sys.argv[1:])\n`,{mode:0o755});
    const script=join(dir,'watchdog-inspection.py');
    writeFileSync(script,WATCHDOG_SOURCE.replace('["/bin/ps"]',`[${JSON.stringify(probe)}]`));
    const codex=join(dir,'codex-leaves');writeFileSync(codex,'#!/bin/sh\n(sleep 60) &\nexit 0\n',{mode:0o755});
    const child=spawn(w.python,['-I',script,'run',w.lockFile,'/fixture','1800',randomUUID(),codex],{detached:true,stdio:'ignore'});
    t.after(()=>killGroup(child.pid));
    const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    await new Promise(resolve=>setTimeout(resolve,600));
    assert.equal(lockFree(join(dir,'locks')),false,inspection);
    assert.deepEqual(await exited,{code:null,signal:'SIGKILL'},inspection);
    assert.ok(await waitFor(()=>lockFree(join(dir,'locks'))),inspection);
  }
});

test('a deadline spent collecting launch metadata never starts Codex',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sub-expired-launch-'));
  try{
    const w=watchdogFor(join(dir,'locks')),probe=join(dir,'slow-ps'),marker=join(dir,'executed');
    writeFileSync(probe,'#!/usr/bin/python3\nimport os,sys,time\ntime.sleep(0.9)\nos.execv("/bin/ps",["/bin/ps"]+sys.argv[1:])\n',{mode:0o755});
    const script=join(dir,'watchdog-delay.py');writeFileSync(script,WATCHDOG_SOURCE.replace('["/bin/ps"]',`[${JSON.stringify(probe)}]`));
    const codex=join(dir,'codex-marker');writeFileSync(codex,`#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`,{mode:0o755});
    const result=spawnSync(w.python,['-I',script,'run',w.lockFile,'/fixture','750',randomUUID(),codex],{detached:true,timeout:5000,killSignal:'SIGKILL'});
    assert.equal(result.status,124);assert.equal(existsSync(marker),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('absolute watchdog deadlines include interpreter startup and malformed deadlines never fall back to legacy mode',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sub-absolute-deadline-'));
  try{
    const w=watchdogFor(join(dir,'locks')),marker=join(dir,'executed'),codex=join(dir,'codex-marker');
    writeFileSync(codex,`#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`,{mode:0o755});
    const mono=()=>Number(process.hrtime.bigint()/1_000_000n);
    for(const [absolute,status]of[[String(mono()-1),124],['NaN',64],['0',64],['-1',64]]){
      const result=spawnSync(w.python,['-I',w.script,'run-deadline',w.lockFile,'/fixture','60000',randomUUID(),absolute,codex],{detached:true,timeout:5000,killSignal:'SIGKILL'});
      assert.equal(result.status,status,absolute);assert.equal(existsSync(marker),false);
    }
    const missing=spawnSync(w.python,['-I',w.script,'run-deadline',w.lockFile,'/fixture','60000',randomUUID(),codex],{detached:true,timeout:5000,killSignal:'SIGKILL'});
    assert.equal(missing.status,64);assert.equal(existsSync(marker),false);
    const unsupported=join(dir,'unsupported.py');
    writeFileSync(unsupported,WATCHDOG_SOURCE.replace('sys.platform == "darwin"','False').replace('sys.platform == "linux"','False'));
    assert.equal(spawnSync(w.python,['-I',unsupported,'run-deadline',w.lockFile,'/fixture','60000',randomUUID(),String(mono()+1000),codex],{detached:true,timeout:5000,killSignal:'SIGKILL'}).status,70);
    assert.equal(existsSync(marker),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('lock acquisition consumes both the legacy duration and the absolute Work allowance',async t=>{
  for(const absolute of [false,true]){
    const dir=tmp(t,'sub-lock-deadline-'),w=watchdogFor(join(dir,'locks')),ready=join(dir,'ready'),marker=join(dir,'executed');
    const holder=spawn(w.python,['-I','-c',`import fcntl,os,time\nfd=os.open(${JSON.stringify(w.lockFile)},os.O_RDWR|os.O_CREAT,0o600)\nfcntl.flock(fd,fcntl.LOCK_EX)\nopen(${JSON.stringify(ready)},'w').write('ready')\ntime.sleep(0.7)\n`],{detached:true,stdio:'ignore'});
    t.after(()=>killGroup(holder.pid));assert.ok(await waitFor(()=>existsSync(ready)));
    const codex=join(dir,'codex-marker');writeFileSync(codex,`#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`,{mode:0o755});
    const args=absolute?['run-deadline',w.lockFile,'/fixture','60000',randomUUID(),String(Number(process.hrtime.bigint()/1_000_000n)+150),codex]:['run',w.lockFile,'/fixture','150',randomUUID(),codex];
    const result=spawnSync(w.python,['-I',w.script,...args],{detached:true,timeout:5000,killSignal:'SIGKILL'});
    assert.equal(result.status,124);assert.equal(existsSync(marker),false);
  }
});

test('adapter filesystem preparation cannot renew the absolute Work deadline or start Codex after expiry',async t=>{
  const {default:fsPromises}=await import('node:fs/promises');
  const {syncBuiltinESMExports}=await import('node:module');
  const {createCodexAdapter}=await import('../../../packages/agents/src/index.ts');
  const dir=tmp(t,'sub-adapter-deadline-'),w=watchdogFor(join(dir,'locks')),ws=join(dir,'ws'),art=join(dir,'art'),marker=join(dir,'executed');mkdirSync(ws);mkdirSync(art);
  const codex=join(dir,'codex-marker');writeFileSync(codex,`#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`,{mode:0o755});
  const realOpen=fsPromises.open;let delayed=false,started=false;
  fsPromises.open=async function(path,...args){if(String(path).endsWith('/stderr.log')){delayed=true;await new Promise(r=>setTimeout(r,250));}return realOpen.call(this,path,...args);};syncBuiltinESMExports();
  try{
    await assert.rejects(createCodexAdapter(codex).runCodex({workspacePath:ws,prompt:'p',model:'gpt-5.5',timeoutMs:20000,artifactsDir:art,ownerLogin:true,
      ownerLoginWatchdog:{...w,owner:'/fixture',remainingMs:60000,deadlineMonoMs:Number(process.hrtime.bigint()/1_000_000n)+100,nonce:randomUUID()},onProcessStart:()=>{started=true;}}),/time limit reached before spawn/);
  }finally{fsPromises.open=realOpen;syncBuiltinESMExports();}
  assert.equal(delayed,true);assert.equal(started,false);assert.equal(existsSync(marker),false);
});
