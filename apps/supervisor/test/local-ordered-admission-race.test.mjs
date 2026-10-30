import test from 'node:test';
import {SpendGateway} from '../src/spend-gateway.ts';
const reviewPrice={revision:'synthetic',model:'openai/gpt-5.5',validUntil:'2099-01-01T00:00:00Z',contextLimitTokens:1000,outputLimitTokens:100,inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:1000000};
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync,existsSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
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

function repoFixture(){
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'ordered-local-')),repo=join(dir,'repo');mkdirSync(repo);
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Factory fixture');git('config','user.email','fixture@example.invalid');
  writeFileSync(join(repo,'quantity.mjs'),'console.log(0);\n');git('add','.');git('commit','-qm','base');
  return {dir,repo,base:git('rev-parse','HEAD')};
}
const requestFor=(repo,base)=>({requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/golden',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1,spendContract:{version:'WORK_LEDGER_V2',pricingRevision:'synthetic',maxPaidOperations:2,plannedProductiveOperations:1,plannedCompletionOperations:1,completionReserveMicrousd:1100},
  input:{title:'Bounded fixture',description:'Change only quantity',kind:'feature',repositoryPath:repo,baseRef:base,acceptanceCriteria:['Print two'],reproductionCommand:null,expectedFailureText:null,checkCommands:['node quantity.mjs'],allowedPaths:['quantity.mjs'],workerProfile:'mac'}});

async function start(t,{ordered=true,dir,repo,base,keys,factory,spend,runner}={}){
  const f=dir?{dir,repo,base}:repoFixture(),dataDir=join(f.dir,'data-'+randomUUID().slice(0,8));mkdirSync(dataDir);
  const pair=generateKeyPairSync('ed25519'),key={factoryId:'factory-fixture',keyId:'fixture',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
  const resultSigning={factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]};
  writeFileSync(join(dataDir,'connections.json'),JSON.stringify({clients:[{id:'myeve',name:'Local fixture',tokenSha256:createHash('sha256').update(token).digest('hex'),repositoryPaths:[f.repo],ownerScope:scope.ownerId,actions:['factory.prepare','factory.dispatch','factory.observe','factory.stop']}]}));
  let calls=0;
  const jobDependencies={preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-codex-1',workerProfile:'mac',error:null}),
    runCodex:async input=>{if(runner)return runner(input,()=>calls++);calls++;writeFileSync(join(input.workspacePath,'quantity.mjs'),'console.log(2);\n');return {success:true,status:'completed',threadId:'fixture',eventsPath:'fixture',usage:null};},
    verifyCandidate:async input=>{mkdirSync(input.artifactDir,{recursive:true});return {checks:input.commands.map((command,i)=>{const logPath=join(input.artifactDir,i+'.log');writeFileSync(logPath,'fixture check\n');const at=new Date().toISOString();return {candidateCommit:input.candidateSha,candidateTree:execFileSync('git',['-C',f.repo,'rev-parse',input.candidateSha+'^{tree}'],{encoding:'utf8'}).trim(),command,status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath,reason:null};}),reason:null};}};
  const witnessPath=join(f.dir,'witness',`head-${randomUUID().slice(0,8)}.json`);
  const ks=keys??{myeve:await policyKey('myeve'),relay:await policyKey('relay'),signer:await policyKey(SIGNER)};
  const witness=new FileReceiverWitness(witnessPath,'epoch-1');
  const orderedAdmission=ordered?{enrollment:{scope,agentId:'agent',registryVersion:'r1',clientId:'myeve',sourceKeys:{myeve:ks.myeve,relay:ks.relay},signer:ks.signer,
    factory:factory??{factoryId:key.factoryId,factoryVersion:'a'.repeat(64),sourceDigest:'b'.repeat(64),configurationDigest:'c'.repeat(64)}},witness,witnessPath}:undefined;
  const supervisor=createLocalV4Supervisor({dataDir,resultSigning,jobDependencies,localFactoryFixture:false,localSpendFixture:{upstreamOrigin:'http://127.0.0.1:1',price:reviewPrice,...(spend??{upstreamApiKey:'synthetic'})},orderedAdmission});
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


const dispatchIdentity=(request,s)=>({runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:request.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:request.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:request.deadline});
const pauseMyfactory=(h,version=2)=>fence(h,'myeve',version,{operation:'pause',capabilityId:'myfactory'});
async function prepared(t,opts){
  const id=await factoryIdentity(t),h=await start(t,{...id,...opts}),request=requestFor(h.repo,h.base);
  if(opts?.twoProductive)request.spendContract={...request.spendContract,maxPaidOperations:3,plannedProductiveOperations:2};   // first child request is not subject to the implementation-progress gate
  const {pair}=await admitted(t,h,request);const response=await h.prepare(request,pair);assert.equal(response.status,200,JSON.stringify(response.body));
  return {h,request,s:response.body.snapshot};
}

test('race: an acknowledged pause while gateway setup is held cannot commit the native dispatch claim',{timeout:30000},async t=>{
 const {h,request,s}=await prepared(t);
 let release,entered;const waiting=new Promise(r=>{entered=r}),gate=new Promise(r=>{release=r}),original=SpendGateway.prototype.listen;
 SpendGateway.prototype.listen=async function(){entered();await gate;return original.call(this)};t.after(()=>{SpendGateway.prototype.listen=original;release()});
 const pending=h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,dispatchIdentity(request,s));
 await waiting;const ack=await pauseMyfactory(h);assert.equal(ack.status,200);
 release();const dispatch=await pending;
 assert.equal(dispatch.status,403);
 assert.equal(h.supervisor.storage.listEvents(s.workOrderId).filter(e=>e.type==='factory.dispatch_claimed').length,0);
 await new Promise(r=>setTimeout(r,200));assert.equal(h.calls,0);
});
test('race: an already-issued child token cannot send a provider request after an acknowledged pause (held pre-send authorization)',{timeout:30000},async t=>{
 let upstream=0,enteredAuth,releaseAuth;const authEntered=new Promise(r=>{enteredAuth=r}),authGate=new Promise(r=>{releaseAuth=r});t.after(()=>releaseAuth());
 // The gateway binding is the one the real FactoryDispatchControl builds; only the worker process is replaced (it is not needed to exercise the child-token boundary).
 let binding;const original=LocalExecutionProvider.prototype.start;
 LocalExecutionProvider.prototype.start=async function(work,run,claim,gateway){binding=gateway;return claim();};t.after(()=>{LocalExecutionProvider.prototype.start=original;});
 const {h,request,s}=await prepared(t,{twoProductive:true,spend:{authorize:async()=>{enteredAuth();await authGate;return 'synthetic'},upstreamFetch:async()=>{upstream++;return Response.json({id:'x',status:'completed',usage:{input_tokens:1,output_tokens:1}},{headers:{'x-request-id':'x'}});}}});
 const dispatch=await h.post(`/api/connect/v1/dispatches/${request.requestId}/dispatch`,dispatchIdentity(request,s));assert.equal(dispatch.status,200,JSON.stringify(dispatch.body));
 assert.ok(binding?.childToken);binding.assertCurrentConnection();    // authority is current while enabled
 const child=fetch(binding.baseUrl+'/responses',{method:'POST',headers:{authorization:'Bearer '+binding.childToken,'content-type':'application/json'},body:JSON.stringify({model:reviewPrice.model,input:'hi'})});
 await authEntered;                                                    // the child request is inside gateway identity refresh with its token already issued
 assert.equal((await pauseMyfactory(h)).status,200);
 assert.throws(()=>binding.assertCurrentConnection(),e=>e.code==='capability_policy_restricted');   // the active connection check sees the pause too
 releaseAuth();const res=await child;
 assert.equal(res.status,409);assert.equal(upstream,0);                // denied before reserve: no provider request, no ledger exposure
 const spend=h.supervisor.spend?.read?.(request.workId);if(spend)assert.equal(spend.operations.length,0);
 await binding.close();
});

// Unit-level boundary ordering with a fake ledger: authority is rechecked after reserve and after markDispatched.
function fakeLedger(trace,{onReserve,onDispatched}={}){
 return {read:async()=>({operations:[],plannedProductiveOperations:1}),assertCompletionEligible:async()=>{},
  reserve:async o=>{trace.push('reserve');onReserve?.();},markDispatched:async()=>{trace.push('markDispatched');onDispatched?.();},
  settle:async()=>{trace.push('settle');},releaseUndispatched:async()=>{trace.push('release');if(trace.includes('markDispatched'))throw Error('dispatched');},markUnknown:async()=>{trace.push('unknown');}};
}
async function gatewayCall(ledger,authorizeDispatch,upstream){
 const gateway=new SpendGateway({ledger,binding:{workId:'w',workGeneration:1,dispatchIdentity:'d',requestId:'r',workOrderId:'o',factoryVersion:'v',runId:'run'},phase:'productive',price:reviewPrice,
  upstreamOrigin:'http://127.0.0.1:1',upstreamApiKey:'synthetic',childToken:'t'.repeat(64),authorizeDispatch,upstreamFetch:async()=>{upstream.n++;return Response.json({id:'x',status:'completed',usage:{input_tokens:1,output_tokens:1}},{headers:{'x-request-id':'x'}});}});
 return gateway.fetch(new Request('https://gateway.example/v1/responses',{method:'POST',headers:{authorization:'Bearer '+'t'.repeat(64)},body:JSON.stringify({model:reviewPrice.model,input:'hi'})}));
}
test('race: revocation after reserve releases the undispatched reservation and sends nothing',async()=>{
 const trace=[],upstream={n:0};let revoked=false;
 const res=await gatewayCall(fakeLedger(trace,{onReserve:()=>{revoked=true;}}),()=>{if(revoked)throw Error('revoked');},upstream);
 assert.equal(res.status,409);assert.equal(upstream.n,0);assert.deepEqual(trace,['reserve','release']);
});
test('race: revocation after markDispatched sends nothing and retains unknown exposure (no release, no resend)',async()=>{
 const trace=[],upstream={n:0};let revoked=false;
 const res=await gatewayCall(fakeLedger(trace,{onDispatched:()=>{revoked=true;}}),()=>{if(revoked)throw Error('revoked');},upstream);
 assert.equal(res.status,503);assert.equal(upstream.n,0);assert.deepEqual(trace,['reserve','markDispatched','release','unknown']);
});
