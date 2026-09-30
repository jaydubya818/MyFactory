import type {SpendPrice} from './spend-gateway.ts';

/** Trusted host implementation only. Never accepted from Work or child input. */
export interface ProviderConnection {
 upstreamOrigin:string;
 price:SpendPrice;
 upstreamApiKey?:string;
 authorize?:()=>Promise<string>;
 prepareRequest?:(payload:Record<string,unknown>)=>Record<string,unknown>;
}

export async function providerAuthorization(provider:ProviderConnection):Promise<string> {
 try {
  const credential=provider.authorize?await provider.authorize():provider.upstreamApiKey;
  if(typeof credential!=='string'||!credential||/[\r\n]/.test(credential))throw Error();
  return credential;
 } catch {throw new Error('Provider identity unavailable');}
}
