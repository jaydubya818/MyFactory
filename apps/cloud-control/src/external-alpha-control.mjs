import {createHash,timingSafeEqual} from 'node:crypto';
import {verifyVercelOidcToken} from '@vercel/oidc';
import {loadExternalAlphaInstallations,validateStatic,bindAuthorityEnvelope,ExternalAlphaError} from './external-alpha-authority.mjs';
import {reconcileCloudWork} from './cloud-work-lifecycle.mjs';
import {withExternalAlphaRuntime} from './external-alpha-runtime.mjs';

/*
 * HTTP entry for external-alpha Work (MYEVE_EXTERNAL_ALPHA_WORK_AUTHORITY_V1). Deliberately SEPARATE from the
 * canary/production handlers:
 *   - its own route prefix /api/connect/v2/external-alpha/ and its own function (api/external-alpha.mjs);
 *   - it is enabled ONLY by a digest-pinned Factory installation (absent or wrong installation => 403 for everything);
 *   - the caller is authorized by an exact per-slot tuple from that installation: sha256 of the slot's own bearer
 *     credential AND a verified Vercel OIDC identity (issuer, audience, subject, team, project, production);
 *   - canary/production/staging credentials and client ids can never authenticate here (and this handler can never
 *     reach canary state: its client ids are external-alpha-* and every record is scoped to the pinned slot);
 *   - bodies are bounded, errors are fixed codes (no messages, no secrets, no stack traces).
 */
const MAX_DISPATCH_BYTES=40000,MAX_SMALL_BYTES=1000;
const PREFIX='/api/connect/v2/external-alpha/';
const derivedId='[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}';
const sha256=value=>createHash('sha256').update(value).digest();
const sha256hex=value=>createHash('sha256').update(value).digest('hex');
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
const denied=(code,status=403)=>reply({error:'EXTERNAL_ALPHA_AUTHORITY_DENIED',code,admission:'DISABLED'},status);

/** Same fixed Work identity every time, derived only from the stored admission. Used for dispatch and stop. */
export function externalAlphaIdentity(row){
 const q=row.request,s=row.snapshot,h=sha256hex('EXTERNAL_ALPHA_DISPATCH_V1:'+q.requestId);
 return {allowedPaths:q.input.allowedPaths,baseSha:q.source.commit,deadline:q.deadline,
  dispatchIdentity:`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`,
  factoryId:s.factoryId,factoryVersion:s.factoryVersion,remoteRunId:row.run_id,repository:q.repository,requestId:q.requestId,runId:row.run_id,
  workGeneration:q.workGeneration,workId:q.workId,workOrderId:row.work_order_id,writerGeneration:1};
}

function routeOf(request){
 const url=new URL(request.url);let tail;
 if(url.search){
  // Vercel rewrite projection: exactly ?path=..., never arbitrary query options.
  const entries=[...url.searchParams];tail=url.searchParams.get('path');
  if(entries.length!==1||entries[0][0]!=='path'||!tail||!['/api/external-alpha',PREFIX+tail].includes(url.pathname))return null;
 }else if(url.pathname.startsWith(PREFIX))tail=url.pathname.slice(PREFIX.length);
 else return null;
 if(!/^[-a-z0-9/]+$/.test(tail)||tail.split('/').some(p=>!p))return null;
 if(tail==='dispatches')return {kind:'prepare',method:'POST'};
 const m=new RegExp(`^dispatches/(${derivedId})(?:/(dispatch|stop|result))?$`).exec(tail);
 if(!m)return null;
 return m[2]?{kind:m[2],id:m[1],method:m[2]==='result'?'GET':'POST'}:{kind:'read',id:m[1],method:'GET'};
}

async function readBody(request,limit){
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^[0-9]{1,9}$/.test(declared)||Number(declared)>limit))throw Object.assign(Error('PAYLOAD_TOO_LARGE'),{status:413});
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw Object.assign(Error('INVALID_REQUEST'),{status:400});
 if(!request.body)throw Object.assign(Error('INVALID_REQUEST'),{status:400});
 const chunks=[];let length=0;
 for await(const chunk of request.body){
  const bytes=Buffer.from(chunk);length+=bytes.length;
  if(length>limit)throw Object.assign(Error('PAYLOAD_TOO_LARGE'),{status:413});
  chunks.push(bytes);
 }
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('INVALID_REQUEST'),{status:400});}
}

/** Returns the installation whose exact caller tuple this request proves, or null. Never throws a message. */
export async function authenticateExternalAlphaCaller(request,installations,env,verifyToken=verifyVercelOidcToken,now=Date.now){
 const header=request.headers.get('authorization')??'';
 if(!/^Bearer [!-~]{16,512}$/.test(header))return null;
 const token=header.slice(7),presented=sha256(token);
 // Compare against EVERY pinned slot without an early exit.
 let selected=null;
 for(const installation of installations){
  const expected=Buffer.from(installation.caller.credentialSha256,'hex');
  if(timingSafeEqual(presented,expected))selected=installation;
 }
 if(!selected)return null;
 // Defence in depth: no canary/production/staging/proof secret may ever double as an external-alpha credential.
 for(const [name,value] of Object.entries(env))if(/^FACTORY_.*(TOKEN|CREDENTIAL|SECRET)/.test(name)&&typeof value==='string'&&value===token)return null;
 const oidc=request.headers.get('x-vercel-trusted-oidc-idp-token');
 if(!oidc||oidc.length>16384||oidc.split('.').length!==3)return null;
 const o=selected.caller.oidc;
 try{
  const {payload}=await verifyToken(oidc,{projectId:selected.application.projectId,ownerId:o.teamId,environment:'production',issuer:o.issuer,audience:o.audience,algorithms:['RS256']});
  if(!payload||payload.project_id!==selected.application.projectId||payload.owner_id!==o.teamId||payload.environment!=='production'||payload.iss!==o.issuer||
   payload.aud!==o.audience||payload.sub!==o.subject||!Number.isSafeInteger(payload.exp)||payload.exp*1000<=now())return null;
 }catch{return null;}
 return selected;
}

const ADMISSION_REJECTIONS={INVALID_CLOUD_REQUEST:'AUTHORITY_SCHEMA',INVALID_CLOUD_LIST:'AUTHORITY_SCHEMA',INVALID_CLOUD_PATH:'AUTHORITY_FILES',CLOUD_ENVELOPE_EXCEEDED:'AUTHORITY_LIMITS',
 CLOUD_SOURCE_NOT_GRANTED:'AUTHORITY_SOURCE',CLOUD_CAPABILITIES_NOT_GRANTED:'AUTHORITY_FILES',EXTERNAL_ALPHA_WORK_LIMIT:'AUTHORITY_LIMITS',WORK_SCOPE_OR_GENERATION_CONFLICT:'AUTHORITY_CONSUMED',PREPARATION_REPLAY_CONFLICT:'AUTHORITY_CONSUMED'};
function failure(error){
 if(error instanceof ExternalAlphaError)return denied(error.code,error.status);
 const status=error?.status;
 if(status===413)return reply({error:'PAYLOAD_TOO_LARGE'},413);
 if(status===400)return reply({error:'INVALID_REQUEST'},400);
 const message=typeof error?.message==='string'?error.message:'';
 // Rejections raised INSIDE the admission transaction roll it back: nothing was consumed, so these are definitive.
 if(Object.hasOwn(ADMISSION_REJECTIONS,message)){const code=ADMISSION_REJECTIONS[message];return denied(code,code==='AUTHORITY_CONSUMED'?409:403);}
 if(message==='FACTORY_REQUEST_NOT_FOUND'||error?.status===404)return reply({error:'NOT_FOUND'},404);
 // Anything else is ambiguous (the caller must treat it as UNKNOWN). Fixed body, never the message.
 return reply({error:'EXTERNAL_ALPHA_UNAVAILABLE'},503);
}

/**
 * request handler. `withRuntime(env, installation, action)` supplies {authority, store, control, provider, clientId};
 * tests inject a real PostgreSQL-backed composition with a fake queue/provider.
 */
export async function handleExternalAlpha(request,env,{withRuntime=withExternalAlphaRuntime,verifyToken=verifyVercelOidcToken,now=Date.now}={}){
 let installations;
 try{installations=loadExternalAlphaInstallations(env);}catch{return denied('AUTHORITY_DISABLED');}
 if(!installations.length)return denied('AUTHORITY_DISABLED');
 try{
  const installation=await authenticateExternalAlphaCaller(request,installations,env,verifyToken,now);
  if(!installation)return reply({error:'UNAUTHORIZED'},401);
  const route=routeOf(request);
  if(!route)return reply({error:'NOT_FOUND'},404);
  if(request.method!==route.method)return reply({error:'METHOD_NOT_ALLOWED'},405);
  const challenge=request.headers.get('x-external-alpha-challenge');
  if(challenge!==null&&!/^[a-f0-9]{16,64}$/.test(challenge))return reply({error:'INVALID_REQUEST'},400);

  if(route.kind==='prepare'){
   const body=await readBody(request,MAX_DISPATCH_BYTES);
   if(!plain(body)||Object.keys(body).sort().join(',')!=='authority,prepare'||!plain(body.prepare))return reply({error:'INVALID_REQUEST'},400);
   // Pure pre-flight against THIS slot's pinned installation: no database, nothing consumed.
   validateStatic(body.authority,body.prepare,installation);
   return await withRuntime(env,installation,async c=>{
    const prior=await c.authority.withClient(client=>c.authority.priorDeadline(client,body.prepare.requestId));
    // An identical redelivery (browser refresh, retry after a lost response) rebuilds the request at a later clock; only
    // the deadline may differ. It is normalized to the ADMITTED value so the replay observes the original admission.
    const prepare=prior?{...body.prepare,deadline:prior}:body.prepare;
    bindAuthorityEnvelope(prepare,body.authority);
    await c.control.prepare(prepare);
    return reply(await c.readbackWithReceipt(prepare.requestId,challenge));
   });
  }

  const small=async()=>{const b=await readBody(request,MAX_SMALL_BYTES);if(!plain(b)||Object.keys(b).length!==0)throw Object.assign(Error('INVALID_REQUEST'),{status:400});};
  if(!['read','result'].includes(route.kind))await small();
  return await withRuntime(env,installation,async c=>{
   // Owner scope: only the pinned slot's own Work. Anything else is indistinguishable from an unknown request.
   const owned=await c.authority.withClient(client=>c.authority.ownedRow(client,route.id));
   if(!owned)return reply({error:'NOT_FOUND'},404);
   if(route.kind==='read')return reply(await c.readbackWithReceipt(route.id,challenge));
   if(route.kind==='result'){const result=await c.readResult(route.id,challenge);return reply(result,result.pending?202:200);}
   const row=await c.store.read(c.clientId,route.id),identity=externalAlphaIdentity(row);
   if(route.kind==='dispatch'){await c.control.dispatch(identity);return reply(await c.readbackWithReceipt(route.id,challenge));}
   // stop: fence in PostgreSQL first, then request physical termination (best effort, reconciled later).
   await c.store.stop(c.clientId,identity);
   try{await reconcileCloudWork(c.store,c.provider,c.clientId,route.id);}catch{/* recovery path owns the rest */}
   return reply(await c.readbackWithReceipt(route.id,challenge));
  });
 }catch(error){return failure(error);}
}
