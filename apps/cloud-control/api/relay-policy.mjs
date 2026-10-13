import {receiverJson} from '../src/receiver-http.mjs';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
export async function handleRelayPolicy(request,runtime){
 if(!runtime?.relayPolicy||typeof runtime.authenticate!=='function')return reply({error:'RELAY_POLICY_UNAVAILABLE'},503);
 if(request.method!=='POST'||!await runtime.authenticate(request))return reply({error:'UNAUTHORIZED'},401);
 try{const input=await receiverJson(request);if(!input||Object.keys(input).join(',')!=='envelope')return reply({error:'INVALID_REQUEST'},400);
  return reply(await runtime.relayPolicy.receive(input.envelope));
 }catch{return reply({error:'RELAY_POLICY_UNAVAILABLE'},503);}
}
export default {fetch:request=>handleRelayPolicy(request)};
