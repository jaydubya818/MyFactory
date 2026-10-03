import pg from 'pg';
import {list} from '@vercel/blob';
import {Sandbox} from '@vercel/sandbox';
import {databaseConfig} from './config.mjs';
import {authorized} from './readiness.mjs';
import {productionInstallation,productionCredentials,assertProductionAdmissionDisabled} from './production-installation.mjs';
import {assertProductionDatabaseMarker} from './production-database.mjs';
import {productionWorkloadIdentity} from './production-identity.mjs';
import sourceIdentity from './source-identity.json' with {type:'json'};

export function productionDependencies(env,installation){
 return {
  database:async()=>{
   const pool=new pg.Pool(databaseConfig(env.DATABASE_URL_UNPOOLED??env.DATABASE_URL));
   try{assertProductionDatabaseMarker((await pool.query('SELECT * FROM factory.environment WHERE singleton')).rows[0],installation);}
   finally{await pool.end();}
  },
  artifacts:async()=>{const oidcToken=await productionWorkloadIdentity(installation);await list({oidcToken,storeId:installation.custodyStoreId,prefix:'factory/production/',limit:1,abortSignal:AbortSignal.timeout(5000)});},
  provider:async()=>{const token=await productionWorkloadIdentity(installation);await Sandbox.list({token,projectId:installation.projectId,teamId:installation.teamId,limit:1,signal:AbortSignal.timeout(5000)});},
 };
}
export async function handleProductionReadiness(request,env,makeChecks=productionDependencies){
 const reply=(body,status)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
 if(request.method!=='GET')return reply({error:'METHOD_NOT_ALLOWED'},405);
 if(!authorized(request,env.FACTORY_PRODUCTION_APPLICATION_TOKEN))return reply({error:'UNAUTHORIZED'},401);
 try{
  const installation=productionInstallation(env);productionCredentials(env,installation);assertProductionAdmissionDisabled(env);
  const checks=makeChecks(env,installation),names=['database','artifacts','provider'];
  const results=await Promise.allSettled(names.map(name=>Promise.resolve().then(()=>checks[name]())));
  const platformReady=results.every(result=>result.status==='fulfilled');
  return reply({service:'myfactory',environment:'production',projectId:installation.projectId,sourceDigest:sourceIdentity.sourceDigest,
   alive:true,platformReady,ready:false,executionAdmission:'DISABLED',admission:'DISABLED',
   dependencies:Object.fromEntries(names.map((name,i)=>[name,results[i].status==='fulfilled'?'AVAILABLE':'UNAVAILABLE'])),
   executionQualification:'AWAITING_PRODUCTION_EXECUTION_CONTRACT',publication:'DISABLED'},platformReady?200:503);
 }catch{return reply({error:'PRODUCTION_INSTALLATION_UNAVAILABLE',ready:false,executionAdmission:'DISABLED'},503);}
}
