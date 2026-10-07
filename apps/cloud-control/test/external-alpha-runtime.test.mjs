import test from 'node:test';
import assert from 'node:assert/strict';
import {externalAlphaRuntimeComponents,externalAlphaFactoryVersion,externalAlphaCheckpointPlan} from '../src/external-alpha-runtime.mjs';
import {loadExternalAlphaInstallations,parseExternalAlphaInstallation} from '../src/external-alpha-authority.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {makeInstallation,makeKeys} from './fixtures/external-alpha-authority.mjs';

const code=fn=>{try{fn();}catch(e){return e.code??e.message;}return 'ACCEPTED';};
function fixture(){
 const base=makeInstallation();
 const factoryVersion=externalAlphaFactoryVersion(base.installation,base.config.source.sourceDigest);
 const {installation}=makeInstallation(base.keys,{...base.config,factoryVersion});
 return {base,installation,sourceDigest:installation.source.sourceDigest,
  deps:{env:{},pool:{},queue:{},signing:{factoryId:'f',key:{factoryId:'f'}},signReceipt:()=>'s',hostInstallation:{projectId:'prj_x',teamId:'team_x',custodyStoreId:'store_x'},deploymentId:'dpl_abc123'}};
}

test('composition refuses (fail closed) unless build and configuration equal what the pinned installation names',()=>{
 const f=fixture(),ok=()=>externalAlphaRuntimeComponents({...f.deps,installation:f.installation,sourceDigest:f.sourceDigest});
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
