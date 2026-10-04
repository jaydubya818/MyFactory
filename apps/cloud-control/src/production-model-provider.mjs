import {getVercelOidcToken,verifyVercelOidcToken} from '@vercel/oidc';
import {validatePrice} from '../../supervisor/src/spend-gateway.ts';
import {productionInstallation} from './production-installation.mjs';

// Independently pinned production rate card; never import the deterministic
// qualification price. Limits below deliberately bound the provider's larger
// advertised context/output capacities. No model call occurs in this module.
export const productionModelPrice=Object.freeze({
 revision:'production-openai-mini-20261003-v1',model:'openai/gpt-5.4-mini',
 validUntil:'2026-10-10T00:00:00.000Z',contextLimitTokens:64000,outputLimitTokens:8192,
 inputMicrousdPerMillion:750000,outputMicrousdPerMillion:4500000,
});
export const productionModelEndpoint='https://ai-gateway.vercel.sh/v1/responses';
const issuer='https://oidc.vercel.com/jaydubya818',audience='https://vercel.com/jaydubya818';

/** Host-only ProviderConnection for the existing SpendGateway. Installation
 * is not execution authority: a separately bound Work authorization callback
 * must succeed on every operation before acquiring any workload credential.
 * This adapter is not yet wired into production admission. */
export function productionModelProvider({env,assertWorkAuthorized},dependencies={getToken:getVercelOidcToken,verifyToken:verifyVercelOidcToken}){
 const installation=productionInstallation(env);
 if(typeof assertWorkAuthorized!=='function')throw Error('PRODUCTION_MODEL_AUTHORITY_REQUIRED');
 validatePrice(productionModelPrice);
 return {
  upstreamOrigin:new URL(productionModelEndpoint).origin,price:{...productionModelPrice},
  async authorize(){
   try{
    await assertWorkAuthorized();
    validatePrice(productionModelPrice);
    // Runtime acquisition only, without CLI project arguments or API-key fallback.
    const token=await dependencies.getToken();
    if(typeof token!=='string'||token.length>16384||token.split('.').length!==3)throw Error();
    const {payload}=await dependencies.verifyToken(token,{projectId:installation.projectId,ownerId:installation.teamId,
     issuer,audience,environment:'production',algorithms:['RS256']});
    if(payload.project_id!==installation.projectId||payload.owner_id!==installation.teamId||payload.iss!==issuer||
     payload.aud!==audience||payload.environment!=='production'||!Number.isSafeInteger(payload.exp)||payload.exp*1000<=Date.now()+60000)throw Error();
    return token;
   }catch{throw Error('PRODUCTION_MODEL_AUTHORITY_UNAVAILABLE');}
  },
  prepareRequest(payload){
   if(payload.model!==productionModelPrice.model)throw Error('PRODUCTION_MODEL_NOT_QUALIFIED');
   // Fixed provider, no automatic model/provider substitution or caller BYOK.
   return {...payload,store:false,service_tier:'default',providerOptions:{gateway:{only:['openai']}}};
  },
 };
}
