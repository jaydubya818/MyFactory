import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {externalAlphaRuntimeComponents,externalAlphaFactoryVersion,externalAlphaCheckpointPlan,withExternalAlphaRuntime} from '../src/external-alpha-runtime.mjs';
import {loadExternalAlphaInstallations,parseExternalAlphaInstallation} from '../src/external-alpha-authority.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {makeInstallation,makeKeys,runtimePrivateSource} from './fixtures/external-alpha-authority.mjs';
import {buildSnapshot} from '../src/private-source.mjs';

const code=fn=>{try{fn();}catch(e){return e.code??e.message;}return 'ACCEPTED';};
function fixture(){
 const base=makeInstallation();
 const factoryVersion=externalAlphaFactoryVersion(base.installation,base.config.source.sourceDigest);
 const {installation}=makeInstallation(base.keys,{...base.config,factoryVersion});
 return {base,installation,sourceDigest:installation.source.sourceDigest,
  deps:{...runtimePrivateSource(installation),env:{},pool:{},queue:{},signing:{factoryId:'myfactory-external-alpha',key:{factoryId:'myfactory-external-alpha',keyId:'external-alpha-result-v1'}},signReceipt:()=>'s',signReadback:()=>'s',hostInstallation:{projectId:'prj_x',teamId:'team_x',custodyStoreId:'store_x'},deploymentId:'dpl_abc123'}};
}

test('composition refuses (fail closed) unless build and configuration equal what the pinned installation names',()=>{
 const f=fixture(),ok=()=>externalAlphaRuntimeComponents({...f.deps,provider:{},installation:f.installation,sourceDigest:f.sourceDigest});
 const c=ok();assert.equal(c.clientId,f.installation.application.clientId);assert.equal(typeof c.readbackWithReceipt,'function');
 assert.equal(code(()=>externalAlphaRuntimeComponents({...f.deps,installation:f.installation,sourceDigest:'0'.repeat(64)})),'AUTHORITY_SOURCE');
 const drift=makeInstallation(f.base.keys,{...f.base.config,factoryVersion:'1'.repeat(64)}).installation;
 assert.equal(code(()=>externalAlphaRuntimeComponents({...f.deps,installation:drift,sourceDigest:drift.source.sourceDigest})),'AUTHORITY_FACTORY_VERSION');
 for(const patch of [{installation:undefined},{signReceipt:undefined},{pool:undefined},{queue:undefined},{deploymentId:'prod'},{signing:{factoryId:'f',key:{factoryId:'g'}}}])
  assert.equal(code(()=>externalAlphaRuntimeComponents({...f.deps,installation:f.installation,sourceDigest:f.sourceDigest,...patch})),'AUTHORITY_DISABLED');
});

test('the checkpoint plan and FactoryVersion derive only from the pinned installation',()=>{
 const f=fixture(),plan=externalAlphaCheckpointPlan(f.installation);
 assert.equal(plan.checkCommand,f.installation.checkCommands[0]);assert.deepEqual(plan.allowedPaths,f.installation.source.allowedFiles);
 assert.equal(plan.source.commit,f.installation.source.baseSha);
 const other=externalAlphaFactoryVersion({...f.installation,checkCommands:['npm run other']},f.sourceDigest);
 assert.notEqual(other,f.installation.factoryVersion);
});

test('installation loader: one or two slots, digest-pinned, consistent cohort/build; anything else disables',()=>{
 const a=makeInstallation(),b=makeInstallation(a.keys,{...a.config,slot:'2',ownerId:'owner-2',application:{clientId:'external-alpha-'+'b'.repeat(32),projectId:'prj_fixture2'},source:{...a.config.source,repository:'fixture-org/fixture-two'},
  caller:{...a.config.caller,credentialSha256:'c'.repeat(64),oidc:{...a.config.caller.oidc,subject:'owner:fixture-team:project:two:environment:production'}}});
 const pin=list=>digest(list.map(c=>parseExternalAlphaInstallation(c).sha256));
 const env=list=>({FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify(list),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:pin(list)});
 assert.equal(loadExternalAlphaInstallations(env([a.config,b.config])).length,2);
 assert.equal(loadExternalAlphaInstallations(env([a.config])).length,1);
 assert.deepEqual(loadExternalAlphaInstallations({}),[]);
 const bad=[{...env([a.config,b.config]),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:'0'.repeat(64)},{FACTORY_EXTERNAL_ALPHA_INSTALLATION:env([a.config]).FACTORY_EXTERNAL_ALPHA_INSTALLATION},
  env([a.config,a.config]),env([a.config,{...b.config,cohortId:'00000000-0000-4000-a000-000000000000'}]),env([a.config,{...b.config,checkCommands:['npm run x']}]),
  env([a.config,{...b.config,caller:{...b.config.caller,credentialSha256:a.config.caller.credentialSha256}}]),env([a.config,b.config,b.config])];
 for(const e of bad)assert.equal(code(()=>loadExternalAlphaInstallations(e)),'AUTHORITY_DISABLED');
});

test('injected providers cannot compose without the exact pinned source manifest',()=>{
 const f=fixture();
 for(const patch of [{registry:undefined},{snapshots:undefined},{snapshots:{}},{snapshots:{'slot-1':{...f.deps.snapshots['slot-1'],commit:'f'.repeat(40)}}},{registry:{'slot-1':{...f.deps.registry['slot-1'],owner:'foreign-org'}}}])
  assert.equal(code(()=>externalAlphaRuntimeComponents({...f.deps,installation:f.installation,sourceDigest:f.sourceDigest,provider:{},...patch})),'AUTHORITY_SOURCE');
});
test('injected provider source preflight and verifier reread retain independent digest and cross-workspace denial',async()=>{
 const f=fixture(),receipt=f.deps.snapshots['slot-1'],entry=f.deps.registry['slot-1'];
 const good=(await f.deps.sourceCustody.read(entry,receipt)).bytes,candidate={base:entry.commit,sourceFiles:JSON.parse(good).files};let reads=0,prepareCalls=0;
 const c=externalAlphaRuntimeComponents({...f.deps,installation:f.installation,sourceDigest:f.sourceDigest,sourceCustody:{read:async()=>{reads++;return{bytes:Buffer.from(good),sha256:'f'.repeat(64)};}},provider:{prepareSource:async()=>prepareCalls++,readCustody:async()=>candidate}});
 const row={request:{source:{repository:receipt.repository,commit:entry.commit,tree:entry.tree}},resource:{evidence:{}}};
 await c.provider.prepareSource(row,async e=>Object.assign(row.resource.evidence,e));assert.equal(prepareCalls,1);assert.equal(reads,1);
 assert.deepEqual(await c.provider.readCustody(row),candidate);assert.equal(reads,2);
 await assert.rejects(c.provider.prepareSource({...row,request:{source:{...row.request.source,repository:'foreign/workspace-02'}}}),/PRIVATE_SOURCE_BINDING/);assert.equal(prepareCalls,1);
 const bad=Buffer.from(good);bad[bad.length-2]^=1;
 const corrupt=externalAlphaRuntimeComponents({...f.deps,installation:f.installation,sourceDigest:f.sourceDigest,sourceCustody:{read:async()=>({bytes:bad,sha256:receipt.sha256})},provider:{prepareSource:async()=>prepareCalls++,readCustody:async()=>candidate}});
 await assert.rejects(corrupt.provider.prepareSource(row),/PRIVATE_SOURCE_DIGEST_MISMATCH/);assert.equal(prepareCalls,1);
 await assert.rejects(corrupt.provider.readCustody(row),/PRIVATE_SOURCE_DIGEST_MISMATCH/);
});

test('SDK provider factory receives the actual runtime ledger and cannot be combined with a replacement provider',()=>{
 const f=fixture();let captured;
 const c=externalAlphaRuntimeComponents({...f.deps,installation:f.installation,sourceDigest:f.sourceDigest,providerFactory:context=>{captured=context;return{};}});
 assert.equal(captured.spend,c.spend);assert.deepEqual(captured.plan.source,externalAlphaCheckpointPlan(f.installation).source);
 assert.equal(captured.privateSource.receipt.sha256,f.deps.snapshots['slot-1'].sha256);assert.equal(typeof captured.assertWorkAuthorized,'function');
 assert.equal(code(()=>externalAlphaRuntimeComponents({...f.deps,installation:f.installation,sourceDigest:f.sourceDigest,provider:{},providerFactory:()=>({})})),'AUTHORITY_DISABLED');
});

test('two exact source bases share the cohort/build but retain distinct runtime versions and isolated custody',async()=>{
 const f=fixture(),a={...f.base.config,factoryVersion:f.installation.factoryVersion};
 const sourceBytes=(await f.deps.sourceCustody.read(f.deps.registry['slot-1'],f.deps.snapshots['slot-1'])).bytes;
 const snapshot=JSON.parse(sourceBytes),commitBytes=Buffer.from(Buffer.from(snapshot.commitBase64,'base64').toString().replace(/fixture\n$/,'second fixture base\n'));
 const commit=createHash('sha1').update(Buffer.concat([Buffer.from('commit '+commitBytes.length+'\0'),commitBytes])).digest('hex');
 assert.notEqual(commit,a.source.baseSha);
 const b={...a,slot:'2',ownerId:'owner-opaque-2',policySha256:'b'.repeat(64),application:{clientId:'external-alpha-'+'b'.repeat(32),projectId:'prj_FixtureTester2'},
  source:{...a.source,repository:'fixture-org/fixture-workspace-02',baseSha:commit},
  caller:{credentialSha256:'c'.repeat(64),oidc:{...a.caller.oidc,subject:'owner:fixture-team:project:fixture-tester-2:environment:production'}}};
 b.factoryVersion=externalAlphaFactoryVersion(b,a.source.sourceDigest);
 assert.notEqual(b.factoryVersion,a.factoryVersion);assert.equal(b.source.treeSha,a.source.treeSha);
 const configs=[a,b],installations=loadExternalAlphaInstallations({FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify(configs),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:digest(configs.map(c=>parseExternalAlphaInstallation(c).sha256))});
 const entry={slot:'slot-2',owner:'fixture-org',repo:'fixture-workspace-02',commit,tree:b.source.treeSha},second=buildSnapshot(entry,{commitBytes,files:snapshot.files});
 const receipt={repository:b.source.repository,commit,tree:entry.tree,path:`factory/private-source/slot-2/${second.sha256}.json`,sha256:second.sha256,bytes:second.bytes.length};
 const registry={...f.deps.registry,'slot-2':entry},snapshots={...f.deps.snapshots,'slot-2':receipt},reads=[];
 const sourceCustody={async read(e,r){reads.push(e.slot);return {bytes:Buffer.from(e.slot==='slot-1'?sourceBytes:second.bytes),sha256:r.sha256};}};
 const components=installations.map(installation=>externalAlphaRuntimeComponents({...f.deps,registry,snapshots,sourceCustody,installation,sourceDigest:a.source.sourceDigest,provider:{}}));
 assert.notEqual(components[0].clientId,components[1].clientId);assert.notEqual(components[0].authority.installation?.ownerId,components[1].authority.installation?.ownerId);
 for(let i=0;i<2;i++){
  const own=installations[i],foreign=installations[1-i];
  await components[i].provider.prepareSource({request:{source:{repository:own.source.repository,commit:own.source.baseSha,tree:own.source.treeSha}}});
  await assert.rejects(components[i].provider.prepareSource({request:{source:{repository:foreign.source.repository,commit:foreign.source.baseSha,tree:foreign.source.treeSha}}}),/PRIVATE_SOURCE_BINDING/);
  assert.equal(code(()=>externalAlphaRuntimeComponents({...f.deps,registry,snapshots,sourceCustody,installation:{...own,factoryVersion:foreign.factoryVersion},sourceDigest:a.source.sourceDigest,provider:{}})),'AUTHORITY_FACTORY_VERSION');
 }
 assert.deepEqual(reads,['slot-1','slot-2']);
});

test('hosted runtime refuses shared/canary host or missing profile before database, source transport or action',async()=>{
 const f=fixture(),profile=JSON.stringify({version:1,kind:'EXTERNAL_ALPHA_VERIFIER_PROFILES_V1',entries:[{id:'alpha-tasks-node-json-v1',kind:'PRODUCT',tree:f.installation.source.treeSha}]}),sha=s=>createHash('sha256').update(s).digest('hex');
 let actions=0,registryReads=0;
 const deps={registryLoader:async()=>{registryReads++;throw Error('UNEXPECTED_SOURCE_READ');}};
 const run=env=>withExternalAlphaRuntime(env,f.installation,()=>{actions++;},deps);
 const profiles={FACTORY_EXTERNAL_ALPHA_VERIFIER_PROFILES_JSON:profile,FACTORY_EXTERNAL_ALPHA_VERIFIER_PROFILES_SHA256:sha(profile)};
 await assert.rejects(run({}),/^Error: VERIFIER_PROFILE_REQUIRED$/);
 await assert.rejects(run({...profiles,FACTORY_PRODUCTION_INSTALLATION:'fixture-shared-canary-host'}),/^Error: EXTERNAL_ALPHA_HOST_INSTALLATION_REQUIRED$/);
 const host={version:1,factoryId:'myfactory-external-alpha',environment:'production',ownerScope:'external-alpha:'+f.installation.cohortId,projectId:'prj_FixtureAlphaHost',teamId:'team_FixtureAlpha',custodyStoreId:'store_FixtureAlpha',databaseResourceId:'fixture-alpha-db'};
 const raw=JSON.stringify(host),env={...profiles,FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_JSON:raw,FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_SHA256:sha(raw),VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:host.projectId,VERCEL_ORG_ID:host.teamId};
 await assert.rejects(run({...env,VERCEL_PROJECT_ID:'prj_Foreign'}),/^Error: EXTERNAL_ALPHA_HOST_INSTALLATION_REQUIRED$/);
 await assert.rejects(run({...env,FACTORY_PROOF_TOKEN:'fixture-old-canary-token'}),/^Error: EXTERNAL_ALPHA_HOST_INSTALLATION_REQUIRED$/);
 // A valid dedicated host proceeds to its dedicated signing prerequisite; no pool or provider is opened.
 await assert.rejects(run(env),/^Error: EXTERNAL_ALPHA_SIGNER_REQUIRED$/);
 assert.equal(actions,0);assert.equal(registryReads,0);
});
