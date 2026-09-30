import {GATEWAY_MODEL,type OidcProviderConfig} from './oidc-provider.ts';
import {providerAuthorization,type ProviderConnection} from './provider-connection.ts';

/** Non-generating authenticated eligibility check. Never returns provider bodies or identity material. */
export async function oidcPreflight(config:OidcProviderConfig,provider:ProviderConnection,request:typeof fetch=fetch) {
 let stage='identity';
 try {
  const token=await providerAuthorization(provider);
  async function get(path:string){
   const response=await request(new URL(path,provider.upstreamOrigin),{
    method:'GET',headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000),
   });
   if(!response.ok)throw Error();
   return response.json();
  }
  stage='authenticated-model-eligibility';
  const catalog=await get('/v1/models?include_availability');
  const model=catalog.data?.find((entry:{id:string})=>entry.id===GATEWAY_MODEL);
  if(model?.model_eligibility?.status!=='eligible'||model.model_eligibility.evaluated_runtime!=='http'||
   catalog.request_context_availability?.http?.status!=='available'||
   catalog.evaluation_context?.credential_mode!=='runtime_default'||
   catalog.evaluation_context?.request_constraints!=='default_only')throw Error();
  stage='pinned-openai-route';
  const {data}=await get('/v1/models/openai/gpt-5.4-mini/endpoints');
  const endpoint=data?.endpoints?.find((entry:{provider_name:string})=>entry.provider_name==='openai');
  if(data?.id!==GATEWAY_MODEL||endpoint?.status!==0||
   endpoint.context_length<config.price.contextLimitTokens||endpoint.max_completion_tokens<config.price.outputLimitTokens||
   !['tools','tool_choice'].every(parameter=>endpoint.supported_parameters?.includes(parameter))||
   Number(endpoint.pricing?.prompt)*1e12!==config.price.inputMicrousdPerMillion||
   Number(endpoint.pricing?.completion)*1e12!==config.price.outputMicrousdPerMillion||
   ['request','internal_reasoning'].some(key=>Number(endpoint.pricing?.[key]??0)!==0))throw Error();
  return {status:'PASS',identity:'VERIFIED_PROJECT_OIDC',gatewayAuthentication:'PASS',
   model:GATEWAY_MODEL,provider:'openai',modelEligibility:'eligible',httpAvailability:'available',
   pinnedRoute:'PASS',pricing:'PASS',modelOperations:0,
   limitation:'Eligibility and endpoint metadata only; generation and client tool-search round trip remain unexecuted.'};
 }catch{throw Error(`Private-alpha provider preflight failed: ${stage}`);}
}
