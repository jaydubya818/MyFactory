import {authorized} from './readiness.mjs';
import {productionInstallation,productionCredentials,assertProductionAdmissionDisabled} from './production-installation.mjs';
/** Fail closed before opening the database or allocating any provider resource.
 * Installing the platform is not qualification of a production execution plan.
 * The retained Cloud implementation remains the single execution implementation;
 * this boundary cannot select its qualification grant or deterministic model. */
export async function handleProductionControl(request,env){
 const reply=(body,status)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
 if(!authorized(request,env.FACTORY_PRODUCTION_APPLICATION_TOKEN))return reply({error:'UNAUTHORIZED'},401);
 try{
  const installation=productionInstallation(env);productionCredentials(env,installation);assertProductionAdmissionDisabled(env);
  const url=new URL(request.url);
  const path=url.searchParams.get('path');
  const actions=(url.pathname==='/api/connect/v2/actions'&&!url.search)||(['/api/cloud','/api/connect/v2/actions'].includes(url.pathname)&&url.searchParams.size===1&&path==='actions');
  if(request.method==='GET'&&actions)return reply({controls:[],admission:'DISABLED',execution:{mode:'CLOUD',qualified:false},qualificationOnly:false,reason:'PRODUCTION_EXECUTION_CONTRACT_REQUIRED'},200);
  return reply({error:'PRODUCTION_WORK_NOT_AUTHORIZED',admission:'DISABLED'},403);
 }catch{return reply({error:'PRODUCTION_INSTALLATION_UNAVAILABLE',admission:'DISABLED'},503);}
}
