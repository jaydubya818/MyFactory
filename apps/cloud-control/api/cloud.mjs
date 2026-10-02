import {authorized} from '../src/readiness.mjs';
import {assertStagingEnvironment} from '../src/config.mjs';
import {withCloudRuntime} from '../src/cloud-runtime.mjs';
import {cloudGrant} from '../src/cloud-work-plan.mjs';
import {reconcileCloudWork} from '../src/cloud-work-lifecycle.mjs';
import {boundedBytes} from '../src/infrastructure-provider.mjs';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
export async function handleCloud(request,env,withRuntime=withCloudRuntime){
 const respond=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
 if(!authorized(request,env.FACTORY_SOFIE_STAGING_TOKEN))return respond({error:'UNAUTHORIZED'},401);
 try{assertStagingEnvironment(env);}catch{return respond({error:'STAGING_BOUNDARY_MISMATCH'},503);}
 const url=new URL(request.url),path=url.pathname;
 if(url.search||!['GET','POST'].includes(request.method))return respond({error:'INVALID_REQUEST'},400);
 try{
  return await withRuntime(env,async({store,control,provider})=>{
   if(path==='/api/connect/v2/actions'&&request.method==='GET')return respond({controls:['factory.prepare','factory.dispatch','factory.observe','factory.stop'],execution:{mode:'CLOUD_DETERMINISTIC',spendEnforced:true},admission:'DISABLED',qualificationOnly:true});
   if(path==='/api/connect/v2/dispatches'&&request.method==='POST')return respond(await control.prepare(JSON.parse((await boundedBytes(request.body,32000)).toString('utf8'))));
   const dispatch=new RegExp(`^/api/connect/v2/dispatches/(${uuid})(?:/(dispatch|stop|custody))?$`).exec(path);
   if(dispatch){
    const [,id,action]=dispatch;
    if(!action&&request.method==='GET')return respond(await control.read(id));
    if(action==='custody'&&request.method==='GET')return respond(await control.source(id));
    if(['dispatch','stop'].includes(action)&&request.method==='POST'){
     const identity=JSON.parse((await boundedBytes(request.body,16000)).toString('utf8'));
     if(identity.requestId!==id)return respond({error:'REQUEST_ID_MISMATCH'},400);
     if(action==='dispatch')return respond(await control.dispatch(identity));
     await store.stop(cloudGrant.clientId,identity);
     // Cancellation fences in PostgreSQL before requesting physical termination.
     // A pending create remains UNKNOWN until the delayed recovery delivery.
     try{await reconcileCloudWork(store,provider,cloudGrant.clientId,id);}catch{}
     return respond(await control.read(id));
    }
   }
   const result=new RegExp(`^/api/connect/v2/work-orders/(${uuid})/runs/(${uuid})/result$`).exec(path);
   if(result&&request.method==='GET'){
    const row=await store.findRun(cloudGrant.clientId,result[1],result[2]);
    return respond(await control.result(row.request_id));
   }
   return respond({error:'NOT_FOUND'},404);
  });
 }catch(error){
  if(['CLOUD_SOURCE_NOT_GRANTED','CLOUD_CAPABILITIES_NOT_GRANTED','WRITER_BINDING_MISMATCH','WRITER_BINDING_CONFLICT','WORK_SCOPE_OR_GENERATION_CONFLICT'].includes(error.message))return respond({error:'WORK_AUTHORITY_DENIED',admission:'DISABLED'},403);
  const missing=error.message==='FACTORY_REQUEST_NOT_FOUND';
  return respond({error:missing?'NOT_FOUND':'CLOUD_WORK_UNAVAILABLE',admission:'DISABLED'},missing?404:503);
 }
}
export default {fetch:request=>handleCloud(request,process.env)};
