import {getVercelOidcToken,verifyVercelOidcToken} from '@vercel/oidc';
import type {ProviderConnection} from './provider-connection.ts';
import type {SpendPrice} from './spend-gateway.ts';

export const GATEWAY_ENDPOINT='https://ai-gateway.vercel.sh/v1/responses';
export const GATEWAY_MODEL='openai/gpt-5.4-mini';
export const PRIVATE_ALPHA_IDENTITY=Object.freeze({
 projectId:'prj_L6faw25wnFGUZtrLKBIccg8gIDLR',
 teamId:'team_p8z8exJRTGfOPk1GC9vUOpv3',
 issuer:'https://oidc.vercel.com/jaydubya818',
 audience:'https://vercel.com/jaydubya818',
 environment:'development',
});
export interface OidcProviderConfig {
 mode:'VERCEL_OIDC_GATEWAY_PRIVATE_ALPHA';endpoint:string;model:string;
 identity:typeof PRIVATE_ALPHA_IDENTITY;price:SpendPrice;
}
const refreshBufferMs=120000;
const identityTimeoutMs=20000;
type Dependencies={getToken:typeof getVercelOidcToken;verifyToken:typeof verifyVercelOidcToken;now:()=>number};
const defaults:Dependencies={getToken:getVercelOidcToken,verifyToken:verifyVercelOidcToken,now:Date.now};

/** Reuses MyEve's explicit project/team SDK acquisition; no static-key fallback. */
export function oidcProvider(config:OidcProviderConfig,deps:Dependencies=defaults):ProviderConnection {
 const identity={...config.identity};
 let cached:{token:string;expiresAt:number}|undefined;
 let pending:Promise<string>|undefined;
 async function acquire():Promise<string> {
  try {
   const token=await deps.getToken({project:identity.projectId,team:identity.teamId,expirationBufferMs:refreshBufferMs});
   if(typeof token!=='string'||!token||token.length>16384)throw Error();
   const {payload}=await deps.verifyToken(token,{projectId:identity.projectId,ownerId:identity.teamId,
    issuer:identity.issuer,audience:identity.audience,environment:identity.environment,algorithms:['RS256']});
   if(payload.project_id!==identity.projectId||payload.owner_id!==identity.teamId||payload.iss!==identity.issuer||
    payload.aud!==identity.audience||payload.environment!==identity.environment||!Number.isSafeInteger(payload.exp)||
    Number(payload.exp)*1000<=deps.now()+refreshBufferMs)throw Error();
   cached={token,expiresAt:Number(payload.exp)*1000};
   return token;
  } catch {throw new Error('Private-alpha OIDC identity unavailable');}
 }
 return {
  upstreamOrigin:new URL(GATEWAY_ENDPOINT).origin,price:{...config.price},
  async authorize(){
   if(cached&&cached.expiresAt>deps.now()+refreshBufferMs)return cached.token;
   if(!pending)pending=acquire().finally(()=>{pending=undefined;});
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{return await Promise.race([pending,new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('Private-alpha OIDC identity unavailable')),identityTimeoutMs);
   })]);}finally{if(timer)clearTimeout(timer);}
  },
  prepareRequest(payload){
   if(payload.model!==GATEWAY_MODEL)throw new Error('Unqualified provider model');
   return {...payload,store:false,providerOptions:{gateway:{only:['openai']}}};
  },
 };
}
