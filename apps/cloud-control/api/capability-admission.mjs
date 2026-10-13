import {receiverJson} from '../src/receiver-http.mjs';
const response=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
/** Runtime injection must come from the original verified constructor. No env
 * fallback, caller-supplied enrollment or ordinary prepare bypass is allowed. */
export async function handleFactoryCapabilityAdmission(request,runtime){
  if(!runtime?.receiver||typeof runtime.authenticate!=='function')return response({error:'CAPABILITY_UNAVAILABLE'},503);
  if(request.method!=='POST'||!(await runtime.authenticate(request)))return response({error:'UNAUTHORIZED'},401);
  try{
    const input=await receiverJson(request);
    const path=new URL(request.url).pathname;
    const keys=Object.keys(input??{}).sort().join(',');
    if(path==='/api/capability-admission/challenge'&&keys==='missionId,request,schema'&&input.schema==='factory-capability-admission-challenge/v1')
      return response(await runtime.receiver.challenge(input.request,input.missionId));
    if(path==='/api/capability-admission/prepare'&&keys==='capabilityPermits,missionId,request,schema'&&input.schema==='factory-capability-admission-prepare/v1')
      return response(await runtime.receiver.prepare(input.request,input.missionId,input.capabilityPermits));
    if(path==='/api/capability-admission/readback'&&keys==='missionId,request,schema'&&input.schema==='factory-capability-admission-readback/v1')
      return response(await runtime.receiver.terminal(input.request,input.missionId));
    if(path==='/api/capability-admission/fence'&&keys==='envelope,schema'&&input.schema==='factory-capability-fence/v1')
      return response(await runtime.receiver.receiveFence(input.envelope));
    if(path==='/api/capability-admission/control'&&keys==='envelope,schema'&&input.schema==='factory-capability-control/v1')
      return response(await runtime.receiver.observeControl(input.envelope));
    return response({error:'INVALID_REQUEST'},400);
  }catch(error){return response({error:error.message==='FACTORY_TERMINAL_UNAVAILABLE'?'NOT_FOUND':'CAPABILITY_UNAVAILABLE'},error.message==='FACTORY_TERMINAL_UNAVAILABLE'?404:503);}
}
// No verified installed receiving profile exists yet. Deployment alone cannot
// turn the sidecar on or create an execution grant.
export default {fetch:request=>handleFactoryCapabilityAdmission(request)};
