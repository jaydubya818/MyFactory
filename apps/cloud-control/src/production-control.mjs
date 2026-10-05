import {authorized} from './readiness.mjs';
import {productionInstallation,productionCredentials,assertProductionAdmissionDisabled} from './production-installation.mjs';
import {withProductionRuntime} from './production-runtime.mjs';
import {proofCredential,cloudEvidence,cloudEvidenceRead} from './cloud-evidence.mjs';
import {boundedBytes} from './infrastructure-provider.mjs';
import {reconcileCloudWork} from './cloud-work-lifecycle.mjs';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
/** Ordinary production Work remains closed. Release validation and the future
 * owner-approved canary have distinct explicit paths and durable exact grants. */
export async function handleProductionControl(request,env,withRuntime=withProductionRuntime){
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
 const proof=proofCredential(request,env);
 if(!proof&&!authorized(request,env.FACTORY_PRODUCTION_APPLICATION_TOKEN))return reply({error:'UNAUTHORIZED'},401);
 try{
  const installation=productionInstallation(env);productionCredentials(env,installation);assertProductionAdmissionDisabled(env);
  const url=new URL(request.url);
  const tail=url.searchParams.size===1?url.searchParams.get('path'):!url.search&&url.pathname.startsWith('/api/connect/v2/')?url.pathname.slice('/api/connect/v2/'.length):null;
  if(!tail||!/^[-a-z0-9/]+$/.test(tail)||tail.split('/').some(p=>!p)||url.search&&!['/api/cloud',`/api/connect/v2/${tail}`].includes(url.pathname))return reply({error:'PRODUCTION_WORK_NOT_AUTHORIZED',admission:'DISABLED'},403);
  if(tail==='actions'&&request.method==='GET'&&!proof)return reply({controls:[],admission:'DISABLED',execution:{mode:'CLOUD',qualified:false},qualificationOnly:false,reason:'PRODUCTION_EXECUTION_CONTRACT_REQUIRED'});
  const validation=tail.startsWith('release-validation/'),canary=tail.startsWith('production-canary/');
  const path=validation?tail.slice('release-validation/'.length):canary?tail.slice('production-canary/'.length):tail;
  const detail=new RegExp(`^work-orders/(${uuid})$`).exec(path),evidence=!!detail||path==='evidence/read';
  if(proof&&!evidence)return reply({error:'UNAUTHORIZED'},401);
  if(!validation&&!canary&&!evidence)return reply({error:'PRODUCTION_WORK_NOT_AUTHORIZED',admission:'DISABLED'},403);
  if(evidence&&!proof)return reply({error:'UNAUTHORIZED'},401);
  const cleanupOnly=canary&&(evidence||request.method==='GET'&&path!=='actions'||request.method==='POST'&&new RegExp(`^dispatches/${uuid}/stop$`).test(path));
  return await withRuntime(env,async({store,control,provider,clientId})=>{
   if(detail&&request.method==='GET'){
    const found=(await store.pool.query('SELECT run_id FROM factory.intake_receipts WHERE client_id=$1 AND work_order_id=$2',[clientId,detail[1]])).rows[0];
    if(!found)return reply({error:'NOT_FOUND'},404);
    const id=await store.findRun(clientId,detail[1],found.run_id),row=await store.read(clientId,id.request_id),items=await cloudEvidence(row,provider,installation.ownerScope);
    return reply({events:[{runId:row.run_id,type:'run.evidence_collected',payload:{refs:items.map(e=>({proofReference:e.proofReference,kind:e.ref.kind,sha256:e.ref.sha256,candidateCommit:e.ref.candidateCommit,factoryVersion:e.ref.factoryVersion,workOrderId:e.ref.workOrderId,runId:e.ref.runId}))}}]});
   }
   const body=async()=>JSON.parse((await boundedBytes(request.body,32000)).toString('utf8'));
   if(path==='evidence/read'&&request.method==='POST')return reply(await cloudEvidenceRead(await body(),{store,provider},installation.ownerScope,clientId));
   if(path==='actions'&&request.method==='GET')return reply({controls:['factory.prepare','factory.dispatch','factory.observe','factory.stop'],execution:{mode:canary?'LIVE':'CLOUD_PRODUCTION_VALIDATION',spendEnforced:true},admission:'DISABLED',qualificationOnly:false,...(canary?{}:{modelOperations:0})});
   if(path==='dispatches'&&request.method==='POST')return reply(await control.prepare(await body()));
   const dispatch=new RegExp(`^dispatches/(${uuid})(?:/(dispatch|stop|custody))?$`).exec(path);
   if(dispatch){
    const [,id,action]=dispatch;
    if(request.method==='GET'&&!action)return reply(await control.read(id));
    if(request.method==='GET'&&action==='custody')return reply(await control.source(id));
    if(request.method==='POST'&&['dispatch','stop'].includes(action)){
     const identity=await body();if(identity.requestId!==id)throw Error('PRODUCTION_WORK_NOT_AUTHORIZED');
     if(action==='dispatch')return reply(await control.dispatch(identity));
     await store.stop(clientId,identity);try{await reconcileCloudWork(store,provider,clientId,id);}catch{}
     return reply(await control.read(id));
    }
   }
   const result=new RegExp(`^work-orders/(${uuid})/runs/(${uuid})/result$`).exec(path);
   if(result&&request.method==='GET'){const row=await store.findRun(clientId,result[1],result[2]);return reply(await control.result(row.request_id));}
   return reply({error:'NOT_FOUND'},404);
  },{validation:!canary,cleanupOnly});
 }catch(error){
  if(error.message==='PRODUCTION_VALIDATION_GRANT_PENDING')return reply({error:'PRODUCTION_VALIDATION_GRANT_PENDING',admission:'DISABLED'},403);
  if(error.message==='PRODUCTION_WORK_NOT_AUTHORIZED')return reply({error:'PRODUCTION_WORK_NOT_AUTHORIZED',admission:'DISABLED'},403);
  if(error.status===404||error.message==='FACTORY_REQUEST_NOT_FOUND')return reply({error:'NOT_FOUND'},404);
  if(error.code==='waiting_for_evidence')return reply({code:error.code},409);
  return reply({error:'PRODUCTION_INSTALLATION_UNAVAILABLE',admission:'DISABLED'},503);
 }
}
