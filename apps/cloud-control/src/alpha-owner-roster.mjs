import {timingSafeEqual} from 'node:crypto';
import {verifyVercelOidcToken} from '@vercel/oidc';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {productionInstallation,productionProjectId,productionCallerProjectId} from './production-installation.mjs';
const slots=['A','B','C'];
export const alphaClientIds=Object.freeze(slots.map(s=>'sofie-alpha-'+s.toLowerCase()));
const keys=o=>Object.keys(o??{}).sort().join(',');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const denied=()=>Error('ALPHA_OWNER_AUTHORITY_UNAVAILABLE');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
/** Installation identity only. Three fixed slots, no groups or standing Work
 * authority. The roster digest never includes grants or approval digests. */
export function alphaOwnerRoster(env){
 const installation=productionInstallation(env),raw=env.FACTORY_ALPHA_OWNER_ROSTER;
 if(!raw||raw.length>8000||!sha(env.FACTORY_ALPHA_OWNER_ROSTER_SHA256))throw denied();
 let roster;try{roster=JSON.parse(raw)}catch{throw denied()}
 if(keys(roster)!=='environment,factoryProjectId,kind,owners,version'||roster.version!==1||roster.kind!=='THREE_SYNTHETIC_OWNER_CLOUD_V1'||roster.environment!=='production'||roster.factoryProjectId!==productionProjectId||digest(roster)!==env.FACTORY_ALPHA_OWNER_ROSTER_SHA256||!Array.isArray(roster.owners)||roster.owners.length!==3)throw denied();
 for(const [i,o] of roster.owners.entries()){
  if(keys(o)!=='clientId,ownerScope,slot,sourceProjectId'||o.slot!==slots[i]||o.clientId!==alphaClientIds[i]||!/^prj_[A-Za-z0-9]+$/.test(o.sourceProjectId)||[productionProjectId,productionCallerProjectId].includes(o.sourceProjectId)||!/^[-a-zA-Z0-9_]{1,200}$/.test(o.ownerScope)||o.ownerScope===installation.ownerScope)throw denied();
 }
 for(const key of ['ownerScope','sourceProjectId','clientId'])if(new Set(roster.owners.map(o=>o[key])).size!==3)throw denied();
 return Object.freeze({roster,sha256:digest(roster),installation});
}
export function alphaOwnerBinding(env,clientId){
 const {roster,sha256,installation}=alphaOwnerRoster(env),owner=roster.owners.find(o=>o.clientId===clientId);if(!owner)throw denied();
 return Object.freeze({...owner,rosterSha256:sha256,environment:'production',factoryProjectId:installation.projectId});
}
export function alphaOwnerCredentials(env,binding,now=Date.now(),allowExpired=false){
 const credentials=slots.flatMap(slot=>['APPLICATION','PROOF'].map(kind=>env[`FACTORY_ALPHA_${slot}_${kind}_TOKEN`]));
 if(credentials.some(c=>!sha(c))||new Set(credentials).size!==6||credentials.some(c=>[env.FACTORY_PRODUCTION_APPLICATION_TOKEN,env.FACTORY_PROOF_TOKEN,env.FACTORY_SOFIE_STAGING_TOKEN].includes(c)))throw denied();
 const prefix=`FACTORY_ALPHA_${binding.slot}_`,expiresAt=env[prefix+'PROOF_EXPIRES_AT'];
 if(!Number.isFinite(Date.parse(expiresAt))||(!allowExpired&&Date.parse(expiresAt)<=now))throw denied();
 return {execution:env[prefix+'APPLICATION_TOKEN'],proof:env[prefix+'PROOF_TOKEN'],proofExpiresAt:expiresAt,authorizationSha256:env[prefix+'AUTHORIZATION_SHA256']};
}
export function assertAlphaApprovalBinding(envelope,binding){
 const approval=envelope?.approval,expected={...binding};
 if(digest(approval?.ownerBinding)!==digest(expected)||approval?.manifestTemplate?.clientId!==binding.clientId||approval?.manifestTemplate?.ownerScope!==binding.ownerScope)throw denied();
}
/** Both a distinct app/proof credential and verified short-lived source OIDC
 * are required. A roster entry, trust relationship or Passport alone is inert. */
export async function authenticateAlphaOwner(request,env,verifyToken=verifyVercelOidcToken){
 if(!env.FACTORY_ALPHA_OWNER_ROSTER)return null;
 const {roster,installation}=alphaOwnerRoster(env),authorization=request.headers.get('authorization')??'';
 let selected;
 for(const o of roster.owners){const binding=alphaOwnerBinding(env,o.clientId),credentials=alphaOwnerCredentials(env,binding,Date.now(),true);for(const [kind,token]of [['execution',credentials.execution],['proof',credentials.proof]])if(equal(authorization,'Bearer '+token))selected={binding,credentials,kind};}
 if(!selected)return null;
 if(selected.kind==='proof'&&Date.parse(selected.credentials.proofExpiresAt)<=Date.now())throw denied();
 const token=request.headers.get('x-myfactory-source-oidc');
 if(!token||token.length>16384||token.split('.').length!==3)throw denied();
 const issuer='https://oidc.vercel.com/jaydubya818',audience='https://vercel.com/jaydubya818';
 const {payload}=await verifyToken(token,{projectId:selected.binding.sourceProjectId,ownerId:installation.teamId,environment:'production',issuer,audience,algorithms:['RS256']});
 if(payload.project_id!==selected.binding.sourceProjectId||payload.owner_id!==installation.teamId||payload.environment!=='production'||payload.iss!==issuer||payload.aud!==audience||!Number.isSafeInteger(payload.exp)||payload.exp*1000<=Date.now())throw denied();
 return selected;
}

/** Historical access uses immutable admission ownership, independent of live
 * grant state or expiry. Reassigning a roster slot cannot transfer old data. */
export function alphaRecordScope(binding){
 return async(client,row)=>{
  if(row.client_id!==binding.clientId)throw denied();
  const grant=(await client.query('SELECT manifest,manifest_sha256,client_id,work_id FROM factory.production_work_authority WHERE request_id=$1',[row.request_id])).rows[0];
  const m=grant?.manifest;
  if(!m||grant.client_id!==binding.clientId||grant.work_id!==row.work_id||m.ownerScope!==binding.ownerScope||digest(m)!==grant.manifest_sha256||digest(m.request)!==digest(row.request))throw denied();
  assertAlphaApprovalBinding(m.authorizationEnvelope,binding);
 };
}
