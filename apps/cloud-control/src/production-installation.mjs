import {stagingProjectId,stagingTeamId} from './config.mjs';
const keys=value=>Object.keys(value??{}).sort().join(',');
export const productionProjectId='prj_4hfceCN8l6wN1gUyYOzZLQ7aJapK';
export const productionCallerProjectId='prj_L6faw25wnFGUZtrLKBIccg8gIDLR';
export const productionCustodyStoreId='store_qBuivS8MmRxnBNnU';
export const productionDatabaseResourceId='dry-morning-22844424';
/** Reviewed server installation data, never request/model-selected routing.
 * Qualification remains pinned separately. This does not authorize any Work. */
export function productionInstallation(env){
 const raw=env.FACTORY_PRODUCTION_INSTALLATION??'';
 if(raw.length>4000)throw Error('PRODUCTION_INSTALLATION_BOUND');
 let config;try{config=JSON.parse(raw);}catch{throw Error('PRODUCTION_INSTALLATION_REQUIRED');}
 if(keys(config)!=='callerProjectId,custodyStoreId,databaseResourceId,environment,factoryId,ownerScope,projectId,teamId,version'||config.version!==1||config.environment!=='production'||config.factoryId!=='myfactory-cloud-production'||config.teamId!==stagingTeamId||config.callerProjectId!==productionCallerProjectId||
  config.projectId!==productionProjectId||[stagingProjectId,productionCallerProjectId].includes(config.projectId)||config.custodyStoreId!==productionCustodyStoreId||config.databaseResourceId!==productionDatabaseResourceId||
  typeof config.ownerScope!=='string'||!config.ownerScope.trim()||config.ownerScope.length>200||/qualification|synthetic|staging/i.test(config.ownerScope))throw Error('PRODUCTION_INSTALLATION_BINDING');
 if(env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||(env.VERCEL_TARGET_ENV&&env.VERCEL_TARGET_ENV!=='production')||env.VERCEL_PROJECT_ID!==config.projectId||env.VERCEL_ORG_ID!==config.teamId)throw Error('PRODUCTION_WORKLOAD_BINDING');
 if(['FACTORY_QUALIFICATION_TOKEN','FACTORY_SOFIE_STAGING_TOKEN','FACTORY_STAGING_PROTECTION_BYPASS','MYEVE_CLOUD_DETERMINISTIC_ENABLED','MYEVE_CLOUD_QUALIFICATION_CONFIG'].some(key=>env[key]))throw Error('QUALIFICATION_CONFIGURATION_FORBIDDEN');
 return Object.freeze(config);
}
export function productionCredentials(env,installation){
 const execution=env.FACTORY_PRODUCTION_APPLICATION_TOKEN,proof=env.FACTORY_PROOF_TOKEN;
 if(!/^[a-f0-9]{64}$/.test(execution??'')||!/^[a-f0-9]{64}$/.test(proof??'')||execution===proof||env.FACTORY_PROOF_OWNER_SCOPE!==installation.ownerScope||!Number.isFinite(Date.parse(env.FACTORY_PROOF_EXPIRES_AT))||Date.parse(env.FACTORY_PROOF_EXPIRES_AT)<=Date.now())throw Error('PRODUCTION_CREDENTIAL_BINDING');
 return {execution,proof};
}
/** Platform deployment is not a grant to prepare/dispatch productive Work.
 * Enabling the first paid canary requires a separately reviewed exact envelope. */
export function assertProductionAdmissionDisabled(env){
 if(env.FACTORY_PRODUCTION_WORK_AUTHORIZATION)throw Error('PRODUCTION_WORK_REQUIRES_SEPARATE_QUALIFICATION');
 return 'DISABLED';
}
