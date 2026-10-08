import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {externalAlphaHostInstallation} from '../src/external-alpha-host-installation.mjs';
import {stagingProjectId,custodyStoreId as stagingCustodyStoreId} from '../src/config.mjs';
import {productionProjectId,productionCallerProjectId,productionCustodyStoreId,productionDatabaseResourceId} from '../src/production-installation.mjs';
import {makeInstallation} from './fixtures/external-alpha-authority.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';

const sha=text=>createHash('sha256').update(text).digest('hex');
const installation={cohortId:'00000000-0000-4000-a000-000000000001',application:{projectId:'prj_FixtureTester'}};
const config={version:1,factoryId:'myfactory-external-alpha',environment:'production',ownerScope:'external-alpha:'+installation.cohortId,projectId:'prj_FixtureAlphaHost',teamId:'team_FixtureAlpha',custodyStoreId:'store_FixtureAlpha',databaseResourceId:'fixture-alpha-database'};
function env(value=config){const text=JSON.stringify(value);return {FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_JSON:text,FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_SHA256:sha(text),VERCEL:'1',VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production',VERCEL_PROJECT_ID:value.projectId,VERCEL_ORG_ID:value.teamId};}
const denies=e=>assert.throws(()=>externalAlphaHostInstallation(e,installation),/^Error: EXTERNAL_ALPHA_HOST_INSTALLATION_REQUIRED$/);

test('dedicated alpha host is byte-pinned, cohort-bound, production-only and immutable',()=>{
 const host=externalAlphaHostInstallation(env(),installation);assert.deepEqual(host,config);assert.ok(Object.isFrozen(host));
 for(const patch of [{FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_JSON:undefined},{FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_SHA256:'0'.repeat(64)},{FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_JSON:JSON.stringify(config)+' '},{VERCEL:'0'},{VERCEL_ENV:'preview'},{VERCEL_TARGET_ENV:'development'},{VERCEL_PROJECT_ID:'prj_Foreign'},{VERCEL_ORG_ID:'team_Foreign'}])denies({...env(),...patch});
 for(const patch of [{version:2},{factoryId:'myfactory-cloud-production'},{environment:'preview'},{ownerScope:'external-alpha:another-cohort'},{ownerScope:'production-owner'},{projectId:'not-a-project'},{teamId:'not-a-team'},{custodyStoreId:'not-a-store'},{databaseResourceId:'../../other'},{extra:'caller-selected'}])denies(env({...config,...patch}));
 for(const text of ['null','[]','{', 'x'.repeat(4097)])denies({...env(),FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_JSON:text,FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_SHA256:sha(text)});
});

test('host installation cannot replace any canary, synthetic or caller resource',()=>{
 for(const projectId of [stagingProjectId,productionProjectId,productionCallerProjectId,installation.application.projectId])denies(env({...config,projectId}));
 for(const custodyStoreId of [stagingCustodyStoreId,productionCustodyStoreId])denies(env({...config,custodyStoreId}));
 denies(env({...config,databaseResourceId:productionDatabaseResourceId}));
});

test('dedicated host refuses ambient canary, staging, deterministic and qualification credentials',()=>{
 for(const key of ['FACTORY_PRODUCTION_INSTALLATION','FACTORY_PRODUCTION_APPLICATION_TOKEN','FACTORY_PRODUCTION_WORK_AUTHORIZATION','FACTORY_PROOF_TOKEN','FACTORY_PROOF_OWNER_SCOPE','FACTORY_PROOF_EXPIRES_AT','FACTORY_QUALIFICATION_TOKEN','FACTORY_SOFIE_STAGING_TOKEN','FACTORY_STAGING_PROTECTION_BYPASS','MYEVE_CLOUD_DETERMINISTIC_ENABLED','MYEVE_CLOUD_QUALIFICATION_CONFIG'])denies({...env(),[key]:'fixture-present'});
});

test('one shared host cannot be either registered tester project',()=>{
 const a=makeInstallation(undefined,{cohortId:installation.cohortId}),b=makeInstallation(undefined,{cohortId:installation.cohortId,slot:'2',ownerId:'owner-opaque-2',application:{clientId:'external-alpha-'+'2'.repeat(32),projectId:'prj_OtherTester'}});
 b.config.source.repository='fixture-org/fixture-workspace-02';b.config.source.sourceDigest=a.config.source.sourceDigest;
 const pin=digest([makeInstallation(undefined,a.config).installation.sha256,makeInstallation(undefined,b.config).installation.sha256]);
 const e={...env({...config,projectId:b.config.application.projectId}),FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify([a.config,b.config]),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:pin};
 assert.throws(()=>externalAlphaHostInstallation(e,a.installation),/EXTERNAL_ALPHA_HOST_INSTALLATION_REQUIRED/);
});
