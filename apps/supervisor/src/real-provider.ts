import {execFileSync} from 'node:child_process';
import {validatePrice,type SpendPrice} from './spend-gateway.ts';
import {oidcProvider,GATEWAY_ENDPOINT,GATEWAY_MODEL,PRIVATE_ALPHA_IDENTITY,type OidcProviderConfig} from './oidc-provider.ts';
import type {ProviderConnection} from './provider-connection.ts';

export const PRIVATE_ALPHA_ENDPOINT='https://api.openai.com/v1/responses';
export const PRIVATE_ALPHA_MODEL='gpt-5.4-mini-2026-03-17';
export const PRIVATE_ALPHA_SECRET_REF='keychain://com.myeve.myfactory.q37/openai-provider';

export interface KeychainProviderConfig {
 mode:'OPENAI_RESPONSES_PRIVATE_ALPHA';
 endpoint:string;
 model:string;
 secretRef:string;
 price:SpendPrice;
}
export type RealProviderConfig=KeychainProviderConfig|OidcProviderConfig;

export function validateRealProvider(config:RealProviderConfig):void {
 if(config?.mode==='VERCEL_OIDC_GATEWAY_PRIVATE_ALPHA'){
  if(Object.keys(config).sort().join(',')!=='endpoint,identity,mode,model,price'||
   config.endpoint!==GATEWAY_ENDPOINT||config.model!==GATEWAY_MODEL||config.price?.model!==GATEWAY_MODEL||
   !config.identity||Object.keys(config.identity).sort().join(',')!==Object.keys(PRIVATE_ALPHA_IDENTITY).sort().join(',')||
   Object.entries(PRIVATE_ALPHA_IDENTITY).some(([key,value])=>config.identity[key as keyof typeof PRIVATE_ALPHA_IDENTITY]!==value))
   throw new Error('Private-alpha provider configuration is unqualified');
  validatePrice(config.price);
  if(config.price.contextLimitTokens>400000||config.price.outputLimitTokens>8192)
   throw new Error('Private-alpha provider limits exceed the reviewed envelope');
  return;
 }
 if(!config||Object.keys(config).sort().join(',')!=='endpoint,mode,model,price,secretRef'||
  config.mode!=='OPENAI_RESPONSES_PRIVATE_ALPHA'||config.endpoint!==PRIVATE_ALPHA_ENDPOINT||
  config.model!==PRIVATE_ALPHA_MODEL||config.secretRef!==PRIVATE_ALPHA_SECRET_REF||
  !config.price||config.price.model!==PRIVATE_ALPHA_MODEL)
  throw new Error('Private-alpha provider configuration is unqualified');
 validatePrice(config.price);
 if(config.price.contextLimitTokens>400000||config.price.outputLimitTokens>8192)
  throw new Error('Private-alpha provider limits exceed the reviewed envelope');
}

function keychainSecret():string {
 try {
  const secret=execFileSync('/usr/bin/security',[
   'find-generic-password','-s','com.myeve.myfactory.q37','-a','openai-provider','-w',
  ],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:5000,maxBuffer:4096}).trim();
  if(!/^sk-[A-Za-z0-9_-]{20,}$/.test(secret))throw new Error('invalid');
  return secret;
 } catch { throw new Error('Private-alpha Keychain credential unavailable'); }
}

/** Explicit loader only. The supervisor does not activate paid mode by default. */
export function loadRealProvider(config:RealProviderConfig, readSecret:()=>string=keychainSecret):
 ProviderConnection {
 validateRealProvider(config);
 if(config.mode==='VERCEL_OIDC_GATEWAY_PRIVATE_ALPHA')return oidcProvider(config);
 let secret:string;
 try{secret=readSecret();}catch{throw new Error('Private-alpha Keychain credential unavailable');}
 if(typeof secret!=='string'||!/^sk-[A-Za-z0-9_-]{20,}$/.test(secret))
  throw new Error('Private-alpha Keychain credential unavailable');
 return {upstreamOrigin:'https://api.openai.com',upstreamApiKey:secret,price:config.price};
}
