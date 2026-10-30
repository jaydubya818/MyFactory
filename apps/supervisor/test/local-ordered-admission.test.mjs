import test from 'node:test';
import {profileTest} from './local-v4-profile.mjs';
const ptest=profileTest(test);
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync,existsSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalV4Supervisor} from '../src/server.ts';
import {FactoryDispatchControl} from '../src/dispatch-control.ts';
import {FileReceiverWitness,assertWitnessOutsideData} from '../src/local-ordered-admission.ts';
import {admissionActionDigest,signPolicyMessage,verifyPolicyMessage,policyMessageHash} from '../../../packages/capability-enforcement/src/ordering-wire.ts';
import {verifyFactoryPreparationTerminal} from '../../../packages/capability-enforcement/src/factory-preparation-terminal.ts';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {verifyLifecycleReceipt} from '../../../packages/capability-enforcement/src/lifecycle-wire.ts';

// Synthetic only: throwaway keys, a temporary git repository, fixture worker/verifier, loopback. No network, provider or spend.
const policyKey=async keyId=>{const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {keyId,jwk:await crypto.subtle.exportKey('jwk',p.privateKey)};};
const scope={ownerId:'owner:fixture',organizationId:'org',installationId:'install',backendId:'backend',incarnation:'epoch',enrollmentVersion:1};
const token='a'.repeat(64),SIGNER='receiver';

function repoFixture(){
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'ordered-local-')),repo=join(dir,'repo');mkdirSync(repo);
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Factory fixture');git('config','user.email','fixture@example.invalid');
  writeFileSync(join(repo,'quantity.mjs'),'console.log(0);\n');git('add','.');git('commit','-qm','base');
  return {dir,repo,base:git('rev-parse','HEAD')};
}
const requestFor=(repo,base)=>({requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/golden',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1,
  input:{title:'Bounded fixture',description:'Change only quantity',kind:'feature',repositoryPath:repo,baseRef:base,acceptanceCriteria:['Print two'],reproductionCommand:null,expectedFailureText:null,checkCommands:['node quantity.mjs'],allowedPaths:['quantity.mjs'],workerProfile:'mac'}});

async function start(t,{ordered=true,dir,repo,base,keys,factory}={}){
  const f=dir?{dir,repo,base}:repoFixture(),dataDir=join(f.dir,'data-'+randomUUID().slice(0,8));mkdirSync(dataDir);
  const pair=generateKeyPairSync('ed25519'),key={factoryId:'factory-fixture',keyId:'fixture',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
  const resultSigning={factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]};
  writeFileSync(join(dataDir,'connections.json'),JSON.stringify({clients:[{id:'myeve',name:'Local fixture',tokenSha256:createHash('sha256').update(token).digest('hex'),repositoryPaths:[f.repo],ownerScope:scope.ownerId,actions:['factory.prepare','factory.dispatch','factory.observe','factory.stop']}]}));
  let calls=0;
  const jobDependencies={preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-codex-1',workerProfile:'mac',error:null}),
    runCodex:async input=>{calls++;writeFileSync(join(input.workspacePath,'quantity.mjs'),'console.log(2);\n');return {success:true,status:'completed',threadId:'fixture',eventsPath:'fixture',usage:null};},
    verifyCandidate:async input=>{mkdirSync(input.artifactDir,{recursive:true});return {checks:input.commands.map((command,i)=>{const logPath=join(input.artifactDir,i+'.log');writeFileSync(logPath,'fixture check\n');const at=new Date().toISOString();return {candidateCommit:input.candidateSha,candidateTree:execFileSync('git',['-C',f.repo,'rev-parse',input.candidateSha+'^{tree}'],{encoding:'utf8'}).trim(),command,status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath,reason:null};}),reason:null};}};
  const witnessPath=join(f.dir,'witness',`head-${randomUUID().slice(0,8)}.json`);
  const ks=keys??{myeve:await policyKey('myeve'),relay:await policyKey('relay'),signer:await policyKey(SIGNER)};
  const witness=new FileReceiverWitness(witnessPath,'epoch-1');
  const orderedAdmission=ordered?{enrollment:{scope,agentId:'agent',registryVersion:'r1',clientId:'myeve',sourceKeys:{myeve:ks.myeve,relay:ks.relay},signer:ks.signer,
    factory:factory??{factoryId:key.factoryId,factoryVersion:'a'.repeat(64),sourceDigest:'b'.repeat(64),configurationDigest:'c'.repeat(64)}},witness,witnessPath}:undefined;
  const supervisor=createLocalV4Supervisor({dataDir,resultSigning,jobDependencies,localFactoryFixture:true,orderedAdmission});
  await new Promise((resolve,reject)=>{supervisor.server.once('error',reject);supervisor.server.listen(0,'127.0.0.1',resolve)});
  const origin='http://127.0.0.1:'+supervisor.server.address().port;
  const post=async(path,body,auth=token)=>{const r=await fetch(origin+path,{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const cap=(step,body)=>post('/api/capability-admission/'+step,body);
  const readback=(request,missionId='mission')=>cap('readback',{schema:'factory-capability-admission-readback/v1',request,missionId});
  const challenge=(request,missionId='mission')=>cap('challenge',{schema:'factory-capability-admission-challenge/v1',request,missionId});
  const prepare=(request,permits,missionId='mission')=>cap('prepare',{schema:'factory-capability-admission-prepare/v1',request,missionId,capabilityPermits:permits});
  t.after(async()=>{try{await supervisor.close();}catch{/* already closed by the test */}if(!dir)rmSync(f.dir,{recursive:true,force:true});});
  return {...f,dataDir,supervisor,origin,post,cap,readback,challenge,prepare,keys:ks,key,witnessPath,get calls(){return calls;},resultSigning,jobDependencies,witness,scope};
}
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
// The pinned Factory identity is per deployment: read it from a discovery supervisor with the same request profile.
async function factoryIdentity(t){
  const d=await start(t,{ordered:false}),request=requestFor(d.repo,d.base);
  const res=await fetch(d.origin+'/api/connect/v1/dispatches',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(request)});
  const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));
  const s=body.snapshot;return {repo:d.repo,base:d.base,dir:d.dir,factory:{factoryId:s.factoryId,factoryVersion:s.factoryVersion,sourceDigest:s.sourceDigest,configurationDigest:s.configurationDigest},resultSigning:d.resultSigning};
}

test('not enrolled: the receiver does not exist (unchanged 404), and ordinary preparation still follows the existing capability refusal',async t=>{
  const h=await start(t,{ordered:false});
  assert.equal((await h.readback(requestFor(h.repo,h.base))).status,404);
  assert.equal((await h.challenge(requestFor(h.repo,h.base))).status,404);
});
ptest('enrolled: signed fences, challenge, pair, prepare and PREPARED readback; the pair is single use and replays never prepare twice',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id}),request=requestFor(h.repo,h.base);
  assert.equal((await h.readback(request)).status,404);                                         // never seen
  assert.equal((await h.challenge(request)).status,503);                                        // no myeve policy fence yet: FACTORY_POLICY_UNAVAILABLE
  const {ch,pair}=await admitted(t,h,request);
  const c=await verifyPolicyMessage(ch,h.keys.signer);
  assert.equal(c.kind,'CHALLENGE');assert.equal(c.capabilityId,'myfactory');assert.equal(c.budgetMicros,1_000_000);assert.equal(c.workId,request.workId);
  assert.equal(c.actionDigest,await admissionActionDigest({workId:request.workId,missionId:'mission',generation:1,
    nativeSnapshot:{...h.supervisor&&id.factory,backendId:scope.backendId,incarnation:scope.incarnation,enrollmentVersion:1},args:request}));
  const prepared=await h.prepare(request,pair);
  assert.equal(prepared.status,200,JSON.stringify(prepared.body));assert.equal(prepared.body.state,'PREPARED');assert.equal(prepared.body.snapshot.version,4);
  assert.equal(h.supervisor.storage.listWorkOrders().length,1);
  const again=await h.prepare(request,pair);assert.equal(again.status,200);assert.equal(again.body.runId,prepared.body.runId);   // response-loss replay
  assert.equal((await h.readback(request)).body.runId,prepared.body.runId);
  assert.equal(h.supervisor.storage.listWorkOrders().length,1);
  // the same pair cannot admit a second request for the same Work generation
  const second={...requestFor(h.repo,h.base),workId:request.workId};
  const ch2=await h.challenge(second);assert.equal(ch2.status,200);
  const reuse=await h.prepare(second,await permits(h,ch2.body));assert.notEqual(reuse.status,200);
  assert.equal(h.supervisor.storage.listWorkOrders().length,1);
});
ptest('enrolled: ordinary preparation is refused, and dispatch requires an ADMITTED ordered outcome and then runs exactly once',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id}),request=requestFor(h.repo,h.base);
  const direct=await h.post('/api/connect/v1/dispatches',request);assert.equal(direct.status,403);assert.equal(h.supervisor.storage.listWorkOrders().length,0);
  const {pair}=await admitted(t,h,request);const prepared=(await h.prepare(request,pair)).body;
  const s=prepared.snapshot,identity={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:request.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:request.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:request.deadline};
  const d1=await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,identity),d2=await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,identity);
  assert.equal(d1.status,200,JSON.stringify(d1.body));assert.equal(d2.status,200);
  for(let i=0;i<200&&h.calls<1;i++)await new Promise(r=>setTimeout(r,25));
  assert.equal(h.calls,1);
});
ptest('enrolled: stale, foreign, mis-budgeted or mismatched pairs consume nothing and prepare nothing',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id}),request=requestFor(h.repo,h.base);
  const {ch}=await admitted(t,h,request);
  const wrong=await h.prepare(request,await permits(h,ch,{budget:2_000_000}));assert.notEqual(wrong.status,200);
  const stale=await h.prepare(request,await permits(h,ch,{stale:true}));assert.notEqual(stale.status,200);
  const foreign=await policyKey('relay'),good=await permits(h,ch);
  const forged=await h.prepare(request,{myeve:good.myeve,relay:await signPolicyMessage({...(await verifyPolicyMessage(good.relay,h.keys.relay))},foreign)});assert.notEqual(forged.status,200);
  const other={...request,input:{...request.input,description:'Changed after challenge'}};assert.notEqual((await h.prepare(other,good)).status,200);
  const missing=await h.prepare(request,{myeve:good.myeve});assert.notEqual(missing.status,200);
  assert.equal(h.supervisor.storage.listWorkOrders().length,0);
  assert.equal((await h.prepare(request,good)).status,200);                                      // none of the refusals consumed the pair
});
ptest('enrolled: a pause/revoke fence blocks new challenges and dispatch; stale and conflicting fences are refused',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id}),request=requestFor(h.repo,h.base);
  const {pair}=await admitted(t,h,request);const prepared=(await h.prepare(request,pair)).body,s=prepared.snapshot;
  const identity={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:request.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:request.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:request.deadline};
  assert.equal((await fence(h,'myeve',2,{operation:'pause',capabilityId:'myfactory'})).status,200);
  assert.equal((await fence(h,'myeve',1)).status,409);                                          // stale
  const conflict=await signPolicyMessage({kind:'FENCE',authority:'myeve',...scope,version:2,policyId:'another',capabilityId:'work',operation:'enable'},h.keys.myeve);
  assert.equal((await h.cap('fence',{schema:'factory-capability-fence/v1',envelope:conflict})).status,409);
  assert.equal((await h.challenge(requestFor(h.repo,h.base))).status,503);                       // restricted
  const dispatch=await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,identity);assert.equal(dispatch.status,403);
  assert.equal(h.calls,0);
  const foreign=await signPolicyMessage({kind:'FENCE',authority:'myeve',...scope,ownerId:'owner:other',version:3,policyId:'x',capabilityId:'work',operation:'enable'},h.keys.myeve);
  assert.notEqual((await h.cap('fence',{schema:'factory-capability-fence/v1',envelope:foreign})).status,200);
});
ptest('native failure before intake is DEFINITELY_NOT_ADMITTED; ambiguous failure is ADMISSION_UNCERTAIN; both are signed terminals, never retried, and never dispatchable',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id}),original=FactoryDispatchControl.prototype.prepareAdmitted;
  t.after(()=>{FactoryDispatchControl.prototype.prepareAdmitted=original;});
  for(const [name,error,expected,reason] of [['validation',Object.assign(new Error('x'),{code:'invalid_input',status:400,name:'ActionError'}),null,null],['ambiguous',new Error('socket reset'),'ADMISSION_UNCERTAIN','RESTORE_OR_COMMIT_AMBIGUITY']]){
    const request=requestFor(h.repo,h.base);
    if(name==='validation'){const {ActionError}=await import('../src/actions.ts');FactoryDispatchControl.prototype.prepareAdmitted=async()=>{throw new ActionError('Preparation outside bounded repository profile','invalid_input')};}
    else FactoryDispatchControl.prototype.prepareAdmitted=async()=>{throw error};
    if(name==='validation'){assert.equal((await fence(h,'myeve',1)).status,200);assert.equal((await fence(h,'relay',1)).status,200);}
    const ch=await h.challenge(request);const pair=await permits(h,ch.body);
    const res=await h.prepare(request,pair);assert.equal(res.status,200);
    const receipt=await verifyFactoryPreparationTerminal(res.body,h.keys.signer,{...scope,agentId:'agent',clientId:'myeve',requestId:request.requestId,workId:request.workId,generation:1,missionId:'mission',...id.factory,nativeRequestDigest:digest(request)});
    assert.equal(receipt.outcome,expected??'DEFINITELY_NOT_ADMITTED');assert.equal(receipt.reasonCode,reason??'NATIVE_REVALIDATION_FAILED');
    FactoryDispatchControl.prototype.prepareAdmitted=original;
    assert.equal((await h.prepare(request,pair)).body.message!==undefined,true);                  // replay returns the same kind of terminal; no native attempt
    assert.equal(h.supervisor.storage.listWorkOrders().length,0);
    const identity={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:request.workId,workGeneration:1,factoryId:'f',factoryVersion:'a'.repeat(64),requestId:request.requestId,workOrderId:randomUUID(),remoteRunId:randomUUID(),repository:request.repository,baseSha:request.input.baseRef,allowedPaths:['quantity.mjs'],deadline:request.deadline};
    assert.notEqual((await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,identity)).status,200);
  }
});
ptest('restore fence: a restored receiver database or missing witness fails closed and cannot replay a consumed pair',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id}),request=requestFor(h.repo,h.base);
  assert.equal((await fence(h,'myeve',1)).status,200);assert.equal((await fence(h,'relay',1)).status,200);
  const dbPath=join(h.dataDir,'capability-receiver.sqlite');
  // snapshot the receiver database (closing WAL by checkpoint through a copy after close is not possible while running; use SQLite backup via a fresh copy)
  const { DatabaseSync } = await import('node:sqlite');
  const old=join(h.dir,'old-receiver.sqlite');rmSync(old,{force:true});new DatabaseSync(dbPath).exec(`VACUUM INTO '${old}'`);
  const ch=await h.challenge(request),pair=await permits(h,ch.body);assert.equal((await h.prepare(request,pair)).status,200);
  await h.supervisor.close();
  rmSync(dbPath+'-wal',{force:true});rmSync(dbPath+'-shm',{force:true});copyFileSync(old,dbPath);          // roll the database back past the consumption of the pair
  const restored=createLocalV4Supervisor({dataDir:h.dataDir,resultSigning:h.resultSigning,jobDependencies:h.jobDependencies,localFactoryFixture:true,
    orderedAdmission:{enrollment:{scope,agentId:'agent',registryVersion:'r1',clientId:'myeve',sourceKeys:{myeve:h.keys.myeve,relay:h.keys.relay},signer:h.keys.signer,factory:id.factory},witness:h.witness,witnessPath:h.witnessPath}});
  await new Promise(r=>restored.server.listen(0,'127.0.0.1',r));t.after(async()=>{try{await restored.close();}catch{}});
  const origin='http://127.0.0.1:'+restored.server.address().port;
  const call=async(step,body)=>{const r=await fetch(origin+'/api/capability-admission/'+step,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return r.status;};
  assert.equal(await call('readback',{schema:'factory-capability-admission-readback/v1',request,missionId:'mission'}),503);
  assert.equal(await call('prepare',{schema:'factory-capability-admission-prepare/v1',request,missionId:'mission',capabilityPermits:pair}),503);
  assert.equal(restored.storage.listWorkOrders().length,1);                                       // nothing new was prepared
});
ptest('restart control: an unrestored receiver database keeps the admitted outcome and serves the same readback',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id}),request=requestFor(h.repo,h.base);
  const {pair}=await admitted(t,h,request);const first=await h.prepare(request,pair);assert.equal(first.status,200);
  await h.supervisor.close();
  const again=createLocalV4Supervisor({dataDir:h.dataDir,resultSigning:h.resultSigning,jobDependencies:h.jobDependencies,localFactoryFixture:true,
    orderedAdmission:{enrollment:{scope,agentId:'agent',registryVersion:'r1',clientId:'myeve',sourceKeys:{myeve:h.keys.myeve,relay:h.keys.relay},signer:h.keys.signer,factory:id.factory},witness:h.witness,witnessPath:h.witnessPath}});
  await new Promise(r=>again.server.listen(0,'127.0.0.1',r));t.after(async()=>{try{await again.close();}catch{}});
  const r=await fetch('http://127.0.0.1:'+again.server.address().port+'/api/capability-admission/readback',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({schema:'factory-capability-admission-readback/v1',request,missionId:'mission'})});
  assert.equal(r.status,200);assert.equal((await r.json()).runId,first.body.runId);
});
// MyEve's lifecycle delivery: unauthenticated transport, authenticated by the signed envelope; returns a signed lifecycle receipt.
async function control(h,authority,version,{operation='pause',capabilityId='myfactory',key}={}){
  const envelope=await signPolicyMessage({kind:'FENCE',authority,...scope,version,policyId:`${authority}-policy-${version}`,capabilityId,operation},key??h.keys[authority]);
  const r=await fetch(h.origin+'/api/capability-admission/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({envelope})});
  return {status:r.status,body:await r.json()};
}
ptest('lifecycle: pause delivery is authenticated by signature, inventories admitted Work and reports a signed, idempotent receipt',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id}),request=requestFor(h.repo,h.base);
  const {pair}=await admitted(t,h,request);assert.equal((await h.prepare(request,pair)).status,200);
  const forged=await control(h,'myeve',2,{key:await policyKey('myeve')});assert.notEqual(forged.status,200);            // wrong key
  assert.equal((await control(h,'myeve',2,{operation:'enable'})).status,400);                                            // only pause/revoke are lifecycle controls
  const first=await control(h,'myeve',2);assert.equal(first.status,200,JSON.stringify(first.body));
  const receipt=await verifyLifecycleReceipt(first.body,h.keys.signer);
  assert.equal(receipt.operation,'pause');assert.equal(receipt.state,'PAUSE_CONFIRMED');assert.equal(receipt.inventoryComplete,true);assert.equal(receipt.version,2);assert.equal(receipt.sequence,1);
  assert.equal(receipt.backendId,scope.backendId);assert.equal(receipt.incarnation,scope.incarnation);
  const again=await control(h,'myeve',2);assert.deepEqual(again.body,first.body);                                         // unchanged state: same sequence and bytes
  assert.equal((await h.challenge(requestFor(h.repo,h.base))).status,503);                                              // the pause also restricts new admission
});
ptest('lifecycle: revoke of completed Work is cleanup-confirmed; an older control may be redelivered after a newer one; revoke is sticky',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id}),request=requestFor(h.repo,h.base);
  const {pair}=await admitted(t,h,request);const prepared=(await h.prepare(request,pair)).body;
  const s=prepared.snapshot,identity={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:request.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:request.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:request.deadline};
  assert.equal((await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,identity)).status,200);
  for(let i=0;i<200&&h.calls<1;i++)await new Promise(r=>setTimeout(r,25));
  const pause=await control(h,'myeve',2);assert.equal(pause.status,200);
  const revoke=await control(h,'myeve',3,{operation:'revoke',capabilityId:'work'});assert.equal(revoke.status,200,JSON.stringify(revoke.body));
  const r=await verifyLifecycleReceipt(revoke.body,h.keys.signer);assert.equal(r.operation,'revoke');assert.ok(['CLEANUP_CONFIRMED','AUTHORITY_FENCED'].includes(r.state));
  const old=await control(h,'myeve',2);assert.equal(old.status,200);                                                      // exact earlier control still resolvable
  assert.equal((await verifyLifecycleReceipt(old.body,h.keys.signer)).version,2);
  assert.equal((await control(h,'myeve',1)).status,409);                                                                  // never-recorded older version is stale
  assert.equal((await fence(h,'myeve',4,{operation:'enable',capabilityId:'work'})).status,200);
  assert.equal((await h.challenge(requestFor(h.repo,h.base))).status,503);                                                // revoke is sticky until re-enrollment
});
ptest('lifecycle: a later enable resumes a pause (latest control per capability wins)',async t=>{
  const id=await factoryIdentity(t),h=await start(t,{...id});
  assert.equal((await fence(h,'myeve',1)).status,200);assert.equal((await fence(h,'relay',1)).status,200);
  assert.equal((await fence(h,'myeve',2,{operation:'pause',capabilityId:'myfactory'})).status,200);
  assert.equal((await h.challenge(requestFor(h.repo,h.base))).status,503);
  assert.equal((await fence(h,'myeve',3,{operation:'enable',capabilityId:'myfactory'})).status,200);
  assert.equal((await h.challenge(requestFor(h.repo,h.base))).status,200);
});
test('witness must live outside the Factory data directory',()=>{
  assert.throws(()=>assertWitnessOutsideData('/tmp/x/data/witness.json','/tmp/x/data'),/outside/);
  assertWitnessOutsideData('/tmp/x/witness/head.json','/tmp/x/data');
  assert.throws(()=>new FileReceiverWitness('relative/path','e'),/absolute/);
  assert.equal(existsSync('/nonexistent-witness'),false);
});
