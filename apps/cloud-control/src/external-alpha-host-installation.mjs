import {createHash} from 'node:crypto';
import {stagingProjectId,custodyStoreId as stagingCustodyStoreId} from './config.mjs';
import {productionProjectId,productionCallerProjectId,productionCustodyStoreId,productionDatabaseResourceId} from './production-installation.mjs';
import {loadExternalAlphaInstallations} from './external-alpha-authority.mjs';
const fail=()=>{throw Error('EXTERNAL_ALPHA_HOST_INSTALLATION_REQUIRED');};
/** A dedicated host registration. It cannot promote or replace the existing production canary or synthetic host. */
export function externalAlphaHostInstallation(env,installation){
 const text=env.FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_JSON,pin=env.FACTORY_EXTERNAL_ALPHA_HOST_INSTALLATION_SHA256;
 if(typeof text!=='string'||text.length>4096||!/^[a-f0-9]{64}$/.test(pin??'')||createHash('sha256').update(text).digest('hex')!==pin)fail();
 let c;try{c=JSON.parse(text);}catch{fail();}
 if(Object.keys(c??{}).sort().join(',')!=='custodyStoreId,databaseResourceId,environment,factoryId,ownerScope,projectId,teamId,version'||c.version!==1||c.factoryId!=='myfactory-external-alpha'||c.environment!=='production'||c.ownerScope!==`external-alpha:${installation.cohortId}`||!/^prj_[A-Za-z0-9]+$/.test(c.projectId??'')||!/^team_[A-Za-z0-9]+$/.test(c.teamId??'')||!/^store_[A-Za-z0-9]+$/.test(c.custodyStoreId??'')||!/^[a-z0-9-]{3,100}$/.test(c.databaseResourceId??''))fail();
 let callers;try{callers=loadExternalAlphaInstallations(env).map(i=>i.application.projectId);}catch{fail();}
 if([stagingProjectId,productionProjectId,productionCallerProjectId,installation.application.projectId,...callers].includes(c.projectId)||[stagingCustodyStoreId,productionCustodyStoreId].includes(c.custodyStoreId)||c.databaseResourceId===productionDatabaseResourceId)fail();
 if(env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||(env.VERCEL_TARGET_ENV&&env.VERCEL_TARGET_ENV!=='production')||env.VERCEL_PROJECT_ID!==c.projectId||env.VERCEL_ORG_ID!==c.teamId)fail();
 for(const key of ['FACTORY_PRODUCTION_INSTALLATION','FACTORY_PRODUCTION_APPLICATION_TOKEN','FACTORY_PRODUCTION_WORK_AUTHORIZATION','FACTORY_PROOF_TOKEN','FACTORY_PROOF_OWNER_SCOPE','FACTORY_PROOF_EXPIRES_AT','FACTORY_QUALIFICATION_TOKEN','FACTORY_SOFIE_STAGING_TOKEN','FACTORY_STAGING_PROTECTION_BYPASS','MYEVE_CLOUD_DETERMINISTIC_ENABLED','MYEVE_CLOUD_QUALIFICATION_CONFIG'])if(env[key])fail();
 return Object.freeze({...c});
}
