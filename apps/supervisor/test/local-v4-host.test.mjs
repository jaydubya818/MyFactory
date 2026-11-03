import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync,realpathSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {profileTest} from './local-v4-profile.mjs';
import {parseHostConfig,provisionHostMaterial,startLocalV4Host,HostConfigRefused,HOST_CONFIG_SCHEMA,MATERIAL} from '../src/local-v4-host.ts';
import {signPolicyMessage,verifyPolicyMessage,policyMessageHash} from '../../../packages/capability-enforcement/src/ordering-wire.ts';
const ptest=profileTest(test);

// FIXTURE ONLY: synthetic throwaway keys, a temporary git repository, a disposable stand-in Codex executable and a loopback upstream
// that is never called (no dispatch happens here). No provider, network, Docker, spend or tester authority. The real host uses the
// real Codex executable and the immutable Docker verifier image from its reviewed config.
const FAKE_CODEX=`#!/usr/bin/env node
const a=process.argv.slice(2);
if(a[0]==='--version'){console.log('codex-cli 0.0.0-host-fixture');process.exit(0);}
if(a[0]==='login'){process.exit(0);}
console.error('host fixture codex never executes work');process.exit(7);
`;
const price={revision:'synthetic',model:'openai/gpt-5.5',validUntil:'2099-01-01T00:00:00Z',contextLimitTokens:1000,outputLimitTokens:100,inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:1000000};
const IMAGE='sha256:'+'a'.repeat(64);
const policyKey=async keyId=>{const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {keyId,jwk:await crypto.subtle.exportKey('jwk',p.privateKey)};};
const pub=k=>({keyId:k.keyId,jwk:{kty:'EC',crv:'P-256',x:k.jwk.x,y:k.jwk.y}});

async function fixture(t,over={}){
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'v4-host-'))),repo=join(dir,'repo');mkdirSync(repo);
  t.after(()=>{try{execFileSync('chmod',['-R','u+w',dir]);}catch{}rmSync(dir,{recursive:true,force:true});});
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Host fixture');git('config','user.email','fixture@example.invalid');
  writeFileSync(join(repo,'quantity.mjs'),'console.log(0);\n');git('add','.');git('commit','-qm','base');
  const codex=join(dir,'codex-host-fixture');writeFileSync(codex,FAKE_CODEX,{mode:0o755});
  const keys={myeve:await policyKey('myeve-k1'),relay:await policyKey('relay-k1')},keyDir=join(dir,'public-keys');mkdirSync(keyDir);
  for(const a of ['myeve','relay'])writeFileSync(join(keyDir,a+'.json'),JSON.stringify(pub(keys[a])));
  const credentialFile=join(dir,'provider-credential');writeFileSync(credentialFile,'disposable-never-sent\n',{mode:0o600});
  const scope={ownerId:'owner:fixture',organizationId:'org',installationId:'install',backendId:'backend',incarnation:'epoch',enrollmentVersion:1};
  const raw={schema:HOST_CONFIG_SCHEMA,factoryId:'factory-host-fixture',port:0,dataDir:join(dir,'data'),materialDir:join(dir,'material'),
    witness:{path:join(dir,'witness','head.json'),epoch:'epoch-1'},worker:{codexExecutable:codex,workerProfile:'mac'},verificationImage:IMAGE,
    profile:{checkCommands:['node quantity.mjs'],allowedPaths:['quantity.mjs']},
    client:{id:'myeve',name:'MyEve private beta',ownerScope:scope.ownerId,repositoryPaths:[repo]},
    enrollment:{scope,agentId:'agent',registryVersion:'r1',sourceKeyFiles:{myeve:join(keyDir,'myeve.json'),relay:join(keyDir,'relay.json')}},
    provider:{upstreamOrigin:'http://127.0.0.1:9',credentialFile,price},...over};
  return {dir,repo,keys,scope,raw,base:git('rev-parse','HEAD')};
}
const refused=(fn,code)=>assert.throws(fn,e=>e instanceof HostConfigRefused&&e.code===code,code);

test('host config is strict and fails closed',async t=>{
  const f=await fixture(t),ok={...f.raw,port:8791};
  assert.equal(parseHostConfig(ok).port,8791);
  refused(()=>parseHostConfig(null),'HOST_CONFIG_SHAPE');
  refused(()=>parseHostConfig({...ok,extra:1}),'HOST_CONFIG_SHAPE');
  const {provider,...missing}=ok;refused(()=>parseHostConfig(missing),'HOST_CONFIG_SHAPE');
  refused(()=>parseHostConfig({...ok,schema:'v0'}),'HOST_CONFIG_SCHEMA');
  refused(()=>parseHostConfig({...ok,port:80}),'HOST_CONFIG_PORT');
  refused(()=>parseHostConfig({...ok,dataDir:'relative/data'}),'HOST_CONFIG_DATA_DIR');
  refused(()=>parseHostConfig({...ok,dataDir:join(process.cwd(),'host-data')}),'HOST_CONFIG_PATH_INSIDE_REPOSITORY');
  refused(()=>parseHostConfig({...ok,witness:{path:join(ok.dataDir,'w.json'),epoch:'e'}}),'HOST_CONFIG_PATH_OVERLAP');
  refused(()=>parseHostConfig({...ok,worker:{codexExecutable:'codex',workerProfile:'mac'}}),'HOST_CONFIG_WORKER');
  refused(()=>parseHostConfig({...ok,worker:{codexExecutable:'/opt/codex',workerProfile:'container'}}),'HOST_CONFIG_WORKER');
  refused(()=>parseHostConfig({...ok,verificationImage:'qdev-dashboard-profile:20261030'}),'HOST_CONFIG_IMAGE');
  refused(()=>parseHostConfig({...ok,provider:{...ok.provider,upstreamOrigin:'https://example.com'}}),'HOST_CONFIG_PROVIDER');
  refused(()=>parseHostConfig({...ok,provider:{...ok.provider,price:{...price,validUntil:'2001-01-01T00:00:00Z'}}}),'HOST_CONFIG_PRICE');
  refused(()=>parseHostConfig({...ok,profile:{checkCommands:['x'],allowedPaths:['../escape']}}),'HOST_CONFIG_PROFILE');
  refused(()=>parseHostConfig({...ok,client:{...ok.client,ownerScope:'owner:other'}}),'HOST_CONFIG_OWNER_SCOPE');
});

async function started(t,f,deps={inspectImage:id=>id}){
  const config={...parseHostConfig({...f.raw,port:8791}),port:0};          // ephemeral port for tests only; the file format requires >=1024
  await provisionHostMaterial(config);
  const host=await startLocalV4Host(config,deps);t.after(()=>host.close().catch(()=>{}));
  const token=readFileSync(join(config.materialDir,MATERIAL.token),'utf8').trim();
  return {config,host,token};
}

test('host material is provisioned owner-only and refused when missing, loose or private-keyed',async t=>{
  const f=await fixture(t),config=parseHostConfig({...f.raw,port:8791});
  await assert.rejects(startLocalV4Host(config,{inspectImage:id=>id}),e=>e.code==='HOST_MATERIAL_MISSING');
  const first=await provisionHostMaterial(config);assert.deepEqual(first.created.sort(),[MATERIAL.token,MATERIAL.signer,MATERIAL.result].sort());
  assert.deepEqual((await provisionHostMaterial(config)).created,[]);                                   // never overwrites
  for(const n of [MATERIAL.signer,MATERIAL.result,MATERIAL.token])assert.equal(statSync(join(config.materialDir,n)).mode&0o777,0o600);
  assert.equal(statSync(config.materialDir).mode&0o777,0o700);
  chmodSync(join(config.materialDir,MATERIAL.token),0o644);
  await assert.rejects(startLocalV4Host(config,{inspectImage:id=>id}),e=>e.code==='HOST_MATERIAL_TOKEN_PERMISSIONS');
  chmodSync(join(config.materialDir,MATERIAL.token),0o600);
  writeFileSync(config.enrollment.sourceKeyFiles.relay,JSON.stringify(f.keys.relay));                  // a private Relay key must never be held here
  await assert.rejects(startLocalV4Host(config,{inspectImage:id=>id}),e=>e.code==='HOST_SOURCE_KEY_RELAY');
  writeFileSync(config.enrollment.sourceKeyFiles.relay,JSON.stringify(pub(f.keys.relay)));
  await assert.rejects(startLocalV4Host(config,{inspectImage:()=>null}),e=>e.code==='HOST_VERIFICATION_IMAGE_UNAVAILABLE');
});

test('host composes the ordered productive supervisor on loopback: health answers, unauthenticated control is refused',async t=>{
  const f=await fixture(t),{config,host,token}=await started(t,f);
  assert.match(host.origin,/^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await fetch(host.origin+'/api/health')).status,200);
  const id=randomUUID();
  for(const auth of [undefined,'Bearer '+'0'.repeat(64)]){
    const headers=auth?{authorization:auth,'content-type':'application/json'}:{'content-type':'application/json'};
    const d=await fetch(host.origin+'/api/connect/v1/dispatches/'+id+'/dispatch',{method:'POST',headers,body:JSON.stringify({requestId:id})});
    assert.equal(d.status,401);
    const c=await fetch(host.origin+'/api/capability-admission/challenge',{method:'POST',headers,body:'{}'});
    assert.equal(c.status,401);
  }
  const ordinary=await fetch(host.origin+'/api/connect/v1/dispatches',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'});
  assert.notEqual(ordinary.status,200);                                                                  // ordinary preparation is refused once enrolled
  const actions=await (await fetch(host.origin+'/api/connect/v1/actions',{headers:{authorization:'Bearer '+token}})).json();
  assert.deepEqual(actions.execution.mode,'LIVE');assert.equal(actions.execution.spendEnforced,true);
  assert.deepEqual(actions.controls.sort(),['factory.dispatch','factory.observe','factory.prepare','factory.stop']);
  const facts=JSON.parse(readFileSync(join(config.materialDir,MATERIAL.facts),'utf8'));
  assert.equal(facts.origin,host.origin);assert.equal(facts.receiverSigner.jwk.d,undefined);assert.equal(facts.feedback.strictLocalV4MaxRounds,1);
  assert.equal(JSON.stringify(facts).includes(token),false);assert.equal(JSON.stringify(facts).includes('disposable-never-sent'),false);
  assert.equal(facts.configuration.executorVersion,'codex-cli 0.0.0-host-fixture');
});

ptest('host-computed Factory identity is exactly the one the real preparation captures (ordered admission reaches PREPARED)',{timeout:120000},async t=>{
  const f=await fixture(t),{config,host,token}=await started(t,f),facts=JSON.parse(readFileSync(join(config.materialDir,MATERIAL.facts),'utf8'));
  const signer=JSON.parse(readFileSync(join(config.materialDir,MATERIAL.signer),'utf8'));
  const post=async(path,body)=>{const r=await fetch(host.origin+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const fence=async authority=>post('/api/capability-admission/fence',{schema:'factory-capability-fence/v1',envelope:await signPolicyMessage(
    {kind:'FENCE',authority,...f.scope,version:1,policyId:`${authority}-policy-1`,capabilityId:'work',operation:'enable'},f.keys[authority])});
  assert.equal((await fence('myeve')).status,200);assert.equal((await fence('relay')).status,200);
  const request={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/golden',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1,
    spendContract:{version:'WORK_LEDGER_V2',pricingRevision:'synthetic',maxPaidOperations:3,plannedProductiveOperations:2,plannedCompletionOperations:1,completionReserveMicrousd:1100},
    input:{title:'Bounded fixture',description:'Change only quantity',kind:'feature',repositoryPath:f.repo,baseRef:f.base,acceptanceCriteria:['Print two'],reproductionCommand:null,expectedFailureText:null,
      checkCommands:config.profile.checkCommands,allowedPaths:config.profile.allowedPaths,workerProfile:'mac'}};
  const ch=await post('/api/capability-admission/challenge',{schema:'factory-capability-admission-challenge/v1',request,missionId:'mission'});assert.equal(ch.status,200,JSON.stringify(ch.body));
  const {kind,...rest}=await verifyPolicyMessage(ch.body,signer);
  const myeve=await signPolicyMessage({...rest,kind:'PERMIT',requiredCapabilities:['myfactory','work'],agentRevision:1,sourcePermitHash:'SELF'},f.keys.myeve);
  const relay=await signPolicyMessage({...rest,authority:'relay',version:1,policyId:'relay-policy-1',kind:'PERMIT',requiredCapabilities:['myfactory','work'],agentRevision:1,
    sourcePermitHash:await policyMessageHash(await verifyPolicyMessage(myeve,f.keys.myeve))},f.keys.relay);
  const prep=await post('/api/capability-admission/prepare',{schema:'factory-capability-admission-prepare/v1',request,missionId:'mission',capabilityPermits:{myeve,relay}});
  assert.equal(prep.status,200,JSON.stringify(prep.body));
  const s=prep.body.snapshot;assert.ok(s,JSON.stringify(prep.body).slice(0,400));
  assert.deepEqual({factoryId:s.factoryId,factoryVersion:s.factoryVersion,sourceDigest:s.sourceDigest,configurationDigest:s.configurationDigest},facts.factory);
  assert.deepEqual(s.configuration,facts.configuration);
});
