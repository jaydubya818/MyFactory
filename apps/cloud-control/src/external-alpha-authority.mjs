// Factory-side consumer of the MyEve per-Work external-alpha authority
// (MYEVE_EXTERNAL_ALPHA_WORK_AUTHORITY_V1). The Factory trusts nothing MyEve
// stores: it validates the signed document against its OWN pinned installation,
// consumes it exactly once in the same transaction as admission, and enforces
// the spend/operation ceilings on its own ledger. Absent installation = DENY.
// This module never reads canary/synthetic grants or global enable switches.
import {createHash,createPublicKey,createPrivateKey,verify,sign} from 'node:crypto';
import {digest} from '../../../packages/hosted-routing/src/result.ts';

export const AUTHORITY_SCHEMA='MYEVE_EXTERNAL_ALPHA_WORK_AUTHORITY_V1';
export const RECEIPT_SCHEMA='MYFACTORY_EXTERNAL_ALPHA_RECEIPT_V1';
export const projectTask='add a Priority field (exactly Low|Medium|High) shown on the task list';
export const acceptanceCriteria=Object.freeze([
 'Existing tasks still display and function',
 'Creating or editing a task supports exactly Low, Medium and High',
 'Priority persists after reload',
 "The task list displays each task's priority",
 'An invalid priority is rejected',
 'Existing tests pass',
 'Focused tests cover creation, editing, persistence, display and invalid input',
 'No unrelated product or UI changes',
 'No production deployment or external publication',
 'An independent verifier checks the exact resulting source and artifact against these criteria rather than trusting the producer'
]);
export const criteriaSha256=digest({version:1,criteria:[...acceptanceCriteria]});
export const tupleSha256=digest({version:1,project:'Alpha Tasks',task:projectTask,criteriaSha256});
// Factory-owned pins. Nothing in a presented document can widen these.
export const factoryPins=Object.freeze({
 environment:'CLOUD_PRODUCTION',executionProvider:'MYFACTORY_CLOUD_EXECUTION_V2',
 harness:Object.freeze({id:'myfactory-cloud-harness',version:'1'}),
 model:Object.freeze({provider:'vercel-ai-gateway/openai',id:'openai/gpt-5.4-mini'}),
 verifierId:'independent-exact-artifact-verifier',
 allowedEffects:Object.freeze(['candidate.create','repository.read','sandbox.write','verification.request']),
 forbiddenEffects:Object.freeze(['deploy','merge','production','publication','repository.admin','secrets.mutate','workflows.mutate']),
 limits:Object.freeze({work:{operations:5,microusd:1300000},factory:{operations:3,microusd:1000000},productiveSeconds:180,candidates:1,writers:1}),
 maxWindowMs:300000
});
const HEX64=/^[a-f0-9]{64}$/,HEX40=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[a-f0-9]{12}$/;
const TS=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,SIG=/^[A-Za-z0-9_-]{86}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');

export class ExternalAlphaError extends Error {
 constructor(code){super(code);this.name='ExternalAlphaError';this.code=code;this.status=code==='AUTHORITY_CONSUMED'?409:403;}
}
const deny=code=>{throw new ExternalAlphaError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys,code)=>{if(!plain(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))deny(code);return v;};
const str=(v,code,max=1000)=>typeof v==='string'&&v.length>=1&&v.length<=max?v:deny(code);
const same=(a,b)=>digest(a)===digest(b);
const posInt=(v,code)=>Number.isSafeInteger(v)&&v>0?v:deny(code);
export const uuidV8=hex=>`${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
export const deriveIdentifiers=({policySha256,work,tupleSha256:tuple})=>{
 const idempotencyKey=digest({kind:'EXTERNAL_ALPHA_WORK_AUTHORITY_KEY_V1',policySha256,workId:work.id,workVersion:work.version,workGeneration:work.generation,tupleSha256:tuple});
 const authorityId=uuidV8(idempotencyKey);
 return {idempotencyKey,authorityId,requestId:uuidV8(sha('EXTERNAL_ALPHA_REQUEST_V1:'+authorityId)),writerId:uuidV8(sha('EXTERNAL_ALPHA_WRITER_V1:'+authorityId))};
};
export const keyIdOf=publicKey=>sha(publicKey.export({type:'spki',format:'der'}));

/** Parses the operator-reviewed installation. Returns null when absent, which
 * means every external-alpha route is DISABLED. A present-but-wrong installation
 * throws: it never degrades to a partial pin. */
export function parseExternalAlphaInstallation(config){
 if(config===undefined||config===null)return null;
 exact(config,['cohortId','slot','ownerId','policySha256','application','source','factoryVersion','keys','checkCommands','caller'],'AUTHORITY_DISABLED');
 const c=config;
 if(!UUID.test(c.cohortId)||!['1','2'].includes(c.slot)||!HEX64.test(c.policySha256)||!HEX64.test(c.factoryVersion))deny('AUTHORITY_DISABLED');
 str(c.ownerId,'AUTHORITY_DISABLED',200);
 exact(c.application,['clientId','projectId'],'AUTHORITY_DISABLED');
 if(!/^external-alpha-[a-f0-9]{32}$/.test(c.application.clientId)||!/^prj_[A-Za-z0-9]+$/.test(c.application.projectId))deny('AUTHORITY_DISABLED');
 exact(c.source,['repository','baseSha','treeSha','sourceDigest','allowedFiles'],'AUTHORITY_DISABLED');
 if(!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(c.source.repository)||!HEX40.test(c.source.baseSha)||!HEX40.test(c.source.treeSha)||!HEX64.test(c.source.sourceDigest))deny('AUTHORITY_DISABLED');
 filesOk(c.source.allowedFiles,'AUTHORITY_DISABLED');
 // The exact check commands the Factory will run; MyEve's request must repeat them verbatim.
 if(!Array.isArray(c.checkCommands)||c.checkCommands.length<1||c.checkCommands.length>20||c.checkCommands.some(x=>typeof x!=='string'||!x.trim()||x.length>500))deny('AUTHORITY_DISABLED');
 // Exact per-slot caller tuple: the sha256 of this slot's bearer credential and the Vercel OIDC identity of
 // the tester deployment. The credential itself never appears in configuration, code or logs.
 exact(c.caller,['credentialSha256','oidc'],'AUTHORITY_DISABLED');
 exact(c.caller.oidc,['issuer','audience','subject','teamId'],'AUTHORITY_DISABLED');
 const o=c.caller.oidc;
 if(!HEX64.test(c.caller.credentialSha256)||!/^https:\/\/oidc\.vercel\.com\/[a-z0-9-]{1,100}$/.test(o.issuer)||!/^https:\/\/vercel\.com\/[a-z0-9-]{1,100}$/.test(o.audience)||
  typeof o.subject!=='string'||o.subject.length>300||!/^owner:[A-Za-z0-9._-]+:project:[A-Za-z0-9._-]+:environment:production$/.test(o.subject)||!/^team_[A-Za-z0-9]+$/.test(o.teamId))deny('AUTHORITY_DISABLED');
 if(!Array.isArray(c.keys)||c.keys.length<1||c.keys.length>8)deny('AUTHORITY_DISABLED');
 const keys=new Map();
 for(const k of c.keys){
  exact(k,['keyId','publicKeyPem','notBefore','notAfter'],'AUTHORITY_DISABLED');
  if(!TS.test(k.notBefore)||!TS.test(k.notAfter)||Date.parse(k.notAfter)<=Date.parse(k.notBefore))deny('AUTHORITY_DISABLED');
  let publicKey;try{publicKey=createPublicKey(str(k.publicKeyPem,'AUTHORITY_DISABLED',4000));}catch{deny('AUTHORITY_DISABLED');}
  if(publicKey.asymmetricKeyType!=='ed25519'||keyIdOf(publicKey)!==k.keyId||keys.has(k.keyId))deny('AUTHORITY_DISABLED');
  keys.set(k.keyId,{publicKey,notBefore:Date.parse(k.notBefore),notAfter:Date.parse(k.notAfter)});
 }
 return Object.freeze({...c,source:{...c.source,allowedFiles:[...c.source.allowedFiles]},checkCommands:[...c.checkCommands],caller:Object.freeze({credentialSha256:c.caller.credentialSha256,oidc:Object.freeze({...c.caller.oidc})}),keys,sha256:digest({...c,keys:c.keys})});
}
/** Loads the installation from reviewed configuration and requires its pinned digest.
 * Single-installation form (one object); unchanged behaviour. */
export function loadExternalAlphaInstallation(env){
 const raw=env?.FACTORY_EXTERNAL_ALPHA_INSTALLATION;
 if(!raw)return null;
 let config;try{config=JSON.parse(raw);}catch{deny('AUTHORITY_DISABLED');}
 const installation=parseExternalAlphaInstallation(config);
 if(!HEX64.test(env.FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256??'')||installation.sha256!==env.FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256)deny('AUTHORITY_DISABLED');
 return installation;
}
/** One Factory deployment serves both tester slots: FACTORY_EXTERNAL_ALPHA_INSTALLATION is either one
 * installation object or an array of 1..2 (one per slot). The pinned digest covers the whole value. Returns
 * [] when absent (everything DISABLED). Anything present but inconsistent throws AUTHORITY_DISABLED. */
export function loadExternalAlphaInstallations(env){
 const raw=env?.FACTORY_EXTERNAL_ALPHA_INSTALLATION;
 if(!raw)return [];
 if(raw.length>40000)deny('AUTHORITY_DISABLED');
 let config;try{config=JSON.parse(raw);}catch{deny('AUTHORITY_DISABLED');}
 const list=(Array.isArray(config)?config:[config]).map(parseExternalAlphaInstallation);
 if(list.length<1||list.length>2)deny('AUTHORITY_DISABLED');
 const pin=Array.isArray(config)?digest(list.map(i=>i.sha256)):list[0].sha256;
 if(!HEX64.test(env.FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256??'')||pin!==env.FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256)deny('AUTHORITY_DISABLED');
 const uniq=pick=>new Set(list.map(pick)).size===list.length;
 const one=pick=>new Set(list.map(pick)).size===1;
 if(!uniq(i=>i.slot)||!uniq(i=>i.application.clientId)||!uniq(i=>i.application.projectId)||!uniq(i=>i.caller.credentialSha256)||!uniq(i=>i.ownerId)||!uniq(i=>i.caller.oidc.subject)||!uniq(i=>i.source.repository)||
  !one(i=>i.cohortId)||!one(i=>i.source.sourceDigest)||!one(i=>digest(i.checkCommands)))deny('AUTHORITY_DISABLED');
 return list;
}
function filesOk(files,code){
 if(!Array.isArray(files)||files.length<1||files.length>30)deny(code);
 for(const f of files)if(typeof f!=='string'||f.length>200||f.startsWith('/')||f.includes('\\')||f.includes('\0')||f.split('/').some(p=>p===''||p==='.'||p==='..'))deny(code);
 const sorted=[...files].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
 if(sorted.some((f,i)=>f!==files[i]||(i>0&&f===sorted[i-1])))deny(code);
}
const sorted=a=>[...a].sort((x,y)=>Buffer.compare(Buffer.from(x),Buffer.from(y)));

/** Everything except the clock. Pure; no database. */
export function validateStatic(envelope,prepare,installation){
 if(!installation)deny('AUTHORITY_DISABLED');
 exact(envelope,['document','authoritySha256','signature','keyId'],'AUTHORITY_SCHEMA');
 const d=envelope.document;
 exact(d,['schema','authorityId','idempotencyKey','singleUse','cohortId','slot','ownerId','policySha256','application','source','work','project','environment','executionProvider','harness','factoryVersion','model','limits','candidateWriter','verifier','allowedEffects','forbiddenEffects','issuedAt','notBefore','expiresAt'],'AUTHORITY_SCHEMA');
 if(d.schema!==AUTHORITY_SCHEMA||d.singleUse!==true||!UUID.test(d.authorityId)||!HEX64.test(d.idempotencyKey)||!UUID.test(d.cohortId)||!['1','2'].includes(d.slot)||!HEX64.test(d.policySha256))deny('AUTHORITY_SCHEMA');
 str(d.ownerId,'AUTHORITY_SCHEMA',200);
 exact(d.application,['clientId','projectId'],'AUTHORITY_SCHEMA');
 exact(d.source,['repository','baseSha','treeSha','sourceDigest','allowedFiles','allowedFilesSha256'],'AUTHORITY_SCHEMA');
 filesOk(d.source.allowedFiles,'AUTHORITY_FILES');
 if(!HEX40.test(d.source.baseSha)||!HEX40.test(d.source.treeSha)||!HEX64.test(d.source.sourceDigest)||!HEX64.test(d.source.allowedFilesSha256))deny('AUTHORITY_SCHEMA');
 exact(d.work,['id','version','generation','title','objectiveSha256','criteriaSha256','criteriaCount'],'AUTHORITY_SCHEMA');
 posInt(d.work.version,'AUTHORITY_SCHEMA');posInt(d.work.generation,'AUTHORITY_SCHEMA');str(d.work.title,'AUTHORITY_SCHEMA',300);
 if(!UUID.test(d.work.id)||!HEX64.test(d.work.objectiveSha256)||!HEX64.test(d.work.criteriaSha256)||!Number.isSafeInteger(d.work.criteriaCount))deny('AUTHORITY_SCHEMA');
 exact(d.project,['name','task','criteriaSha256','tupleSha256'],'AUTHORITY_SCHEMA');
 exact(d.harness,['id','version'],'AUTHORITY_SCHEMA');exact(d.model,['provider','id'],'AUTHORITY_SCHEMA');
 exact(d.candidateWriter,['candidateSlot','writerId','requestId'],'AUTHORITY_SCHEMA');
 exact(d.verifier,['id','verifiesExactArtifact','trustProducer','criteriaSha256'],'AUTHORITY_SCHEMA');
 if(!Array.isArray(d.allowedEffects)||!Array.isArray(d.forbiddenEffects)||!plain(d.limits))deny('AUTHORITY_SCHEMA');
 for(const t of ['issuedAt','notBefore','expiresAt'])if(typeof d[t]!=='string'||!TS.test(d[t])||new Date(d[t]).toISOString()!==d[t])deny('AUTHORITY_SCHEMA');
 if(!HEX64.test(envelope.authoritySha256)||!SIG.test(envelope.signature)||!HEX64.test(envelope.keyId))deny('AUTHORITY_SCHEMA');
 // Signature: pinned key, bytes bound to the digest recomputed here.
 const key=installation.keys.get(envelope.keyId);
 if(!key)deny('AUTHORITY_SIGNATURE');
 if(digest(d)!==envelope.authoritySha256)deny('AUTHORITY_SIGNATURE');
 let good=false;
 try{good=verify(null,Buffer.concat([Buffer.from(AUTHORITY_SCHEMA),Buffer.from([0]),Buffer.from(envelope.authoritySha256)]),key.publicKey,Buffer.from(envelope.signature,'base64url'));}catch{good=false;}
 if(!good)deny('AUTHORITY_SIGNATURE');
 // Window shape (clock checked separately so identical replays stay idempotent).
 const issued=Date.parse(d.issuedAt),from=Date.parse(d.notBefore),to=Date.parse(d.expiresAt);
 if(from!==issued||to<=from||to-issued>factoryPins.maxWindowMs)deny('AUTHORITY_SCHEMA');
 // Derived identifiers.
 const ids=deriveIdentifiers({policySha256:d.policySha256,work:d.work,tupleSha256:d.project.tupleSha256});
 if(ids.idempotencyKey!==d.idempotencyKey||ids.authorityId!==d.authorityId||ids.requestId!==d.candidateWriter.requestId||ids.writerId!==d.candidateWriter.writerId||d.candidateWriter.candidateSlot!==1)deny('AUTHORITY_IDENTIFIER');
 if(!plain(prepare)||prepare.requestId!==ids.requestId)deny('AUTHORITY_IDENTIFIER');
 // Owner/application/cohort/slot/policy against the Factory's own installation.
 if(d.ownerId!==installation.ownerId||d.cohortId!==installation.cohortId||d.slot!==installation.slot||d.policySha256!==installation.policySha256||d.application.clientId!==installation.application.clientId||d.application.projectId!==installation.application.projectId)deny('AUTHORITY_OWNER');
 // Source.
 const s=installation.source,p=prepare;
 if(d.source.repository!==s.repository||d.source.baseSha!==s.baseSha||d.source.treeSha!==s.treeSha||d.source.sourceDigest!==s.sourceDigest)deny('AUTHORITY_SOURCE');
 if(p.repository!==s.repository||!plain(p.source)||p.source.repository!==s.repository||p.source.commit!==s.baseSha||p.source.tree!==s.treeSha)deny('AUTHORITY_SOURCE');
 const input=p.input;
 if(!plain(input)||!Array.isArray(input.allowedPaths))deny('AUTHORITY_FILES');
 if(!same(d.source.allowedFiles,s.allowedFiles)||!same(sorted(input.allowedPaths),s.allowedFiles)||d.source.allowedFilesSha256!==digest({version:1,files:d.source.allowedFiles}))deny('AUTHORITY_FILES');
 // The Factory runs only the commands IT pinned; the request cannot choose them.
 if(!Array.isArray(input.checkCommands)||!same(input.checkCommands,installation.checkCommands))deny('AUTHORITY_FILES');
 // Work.
 if(p.workId!==d.work.id||p.workGeneration!==d.work.generation||typeof input.description!=='string'||sha(input.description)!==d.work.objectiveSha256||input.title!==d.work.title||input.kind!=='feature')deny('AUTHORITY_WORK');
 // Tuple recomputed from the request, never from the document.
 const crit=input.acceptanceCriteria;
 if(!Array.isArray(crit)||crit.length!==acceptanceCriteria.length||crit.some((c,i)=>c!==acceptanceCriteria[i]))deny('AUTHORITY_TUPLE');
 if(d.project.name!=='Alpha Tasks'||d.project.task!==projectTask||d.project.criteriaSha256!==criteriaSha256||d.project.tupleSha256!==tupleSha256||d.work.criteriaSha256!==criteriaSha256||d.work.criteriaCount!==10||d.verifier.criteriaSha256!==criteriaSha256)deny('AUTHORITY_TUPLE');
 // Execution pins.
 if(d.environment!==factoryPins.environment)deny('AUTHORITY_ENVIRONMENT');
 if(d.executionProvider!==factoryPins.executionProvider||!same(d.harness,factoryPins.harness))deny('AUTHORITY_PROVIDER');
 if(d.factoryVersion!==installation.factoryVersion)deny('AUTHORITY_FACTORY_VERSION');
 if(!same(d.model,factoryPins.model))deny('AUTHORITY_MODEL');
 if(d.verifier.id!==factoryPins.verifierId||d.verifier.verifiesExactArtifact!==true||d.verifier.trustProducer!==false)deny('AUTHORITY_VERIFIER');
 if(!same(d.allowedEffects,factoryPins.allowedEffects)||!same(d.forbiddenEffects,factoryPins.forbiddenEffects))deny('AUTHORITY_EFFECTS');
 // Limits: document must equal the Factory pin; the request may not ask for more.
 const microusd=typeof p.maxSpendUsd==='number'&&Number.isFinite(p.maxSpendUsd)&&p.maxSpendUsd>0?Math.round(p.maxSpendUsd*1e6):deny('AUTHORITY_LIMITS');
 if(!same(d.limits,factoryPins.limits)||microusd>factoryPins.limits.factory.microusd)deny('AUTHORITY_LIMITS');
 const deadline=Date.parse(p.deadline);
 if(!Number.isFinite(deadline)||deadline>Date.parse(d.expiresAt))deny('AUTHORITY_EXPIRED');
 return {document:d,authoritySha256:envelope.authoritySha256,keyId:envelope.keyId,ids,keyWindow:key,expiresAtMs:Date.parse(d.expiresAt),notBeforeMs:from};
}
export function assertTime(v,now){
 if(now<v.notBeforeMs)deny('AUTHORITY_NOT_YET_VALID');
 if(now>=v.expiresAtMs)deny('AUTHORITY_EXPIRED');
 if(now<v.keyWindow.notBefore||now>=v.keyWindow.notAfter)deny('AUTHORITY_SIGNATURE');
}
export const validateExternalAlphaAuthority=(envelope,prepare,installation,now)=>{const v=validateStatic(envelope,prepare,installation);assertTime(v,now);return v;};

export function receiptSigner(privateKeyPem){
 const key=createPrivateKey(privateKeyPem);
 if(key.asymmetricKeyType!=='ed25519')throw Error('RECEIPT_KEY_INVALID');
 return receipt=>sign(null,Buffer.concat([Buffer.from(RECEIPT_SCHEMA),Buffer.from([0]),Buffer.from(digest(receipt))]),key).toString('base64url');
}
const envelopes=new WeakMap();
/** Attaches the envelope to the exact prepare object that the dispatch store will admit. */
export const bindAuthorityEnvelope=(prepare,envelope)=>{if(!plain(prepare))deny('AUTHORITY_SCHEMA');envelopes.set(prepare,envelope);return prepare;};

const lockKey=cohortId=>"SELECT pg_advisory_xact_lock(hashtextextended('external-alpha-cohort:'||$1,0))";
const nowMs=async client=>Number((await client.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now')).rows[0].now);
export class ExternalAlphaAuthorityStore {
 constructor(pool,installation,{signReceipt}={}){
  if(!installation)deny('AUTHORITY_DISABLED');
  this.pool=pool;this.installation=installation;this.signReceipt=signReceipt;
 }
 async transaction(action){
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');
   // Same discipline as PostgresDispatchStore/PostgresSpendLedger: the global ledger lock first, then the cohort lock.
   // Without it a standalone consume could interleave with a spend operation going UNKNOWN.
   await client.query('SELECT pg_advisory_xact_lock(81427603)');
   const result=await action(client,await nowMs(client));await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
 }
 async fenced(client,cohortId){
  const unknownRow=(await client.query("SELECT 1 FROM factory.external_alpha_work_authority WHERE cohort_id=$1 AND state IN ('UNKNOWN','FENCED') LIMIT 1",[cohortId])).rowCount;
  const unknownSpend=(await client.query("SELECT 1 FROM factory.work_spend_operations o JOIN factory.external_alpha_work_authority a ON a.work_id::text=o.work_id WHERE a.cohort_id=$1 AND o.state='unknown' LIMIT 1",[cohortId])).rowCount;
  return unknownRow>0||unknownSpend>0;
 }
 async revoked(client,v){
  const r=await client.query("SELECT 1 FROM factory.external_alpha_revocation WHERE (subject_kind='AUTHORITY' AND subject=$1) OR (subject_kind='COHORT' AND subject=$2) OR (subject_kind='KEY' AND subject=$3) LIMIT 1",[v.document.authorityId,v.document.cohortId,v.keyId]);
  return r.rowCount>0;
 }
 /** Runs read-only work on a pooled connection (no transaction, no locks). */
 async withClient(action){const client=await this.pool.connect();try{return await action(client);}finally{client.release();}}
 /** The authority row for requestId only if it belongs to THIS installation (cohort, slot, owner, policy, client).
  * Any other caller gets null, indistinguishable from an unknown request. */
 async ownedRow(client,requestId,{currentGeneration=true}={}){
  if(typeof requestId!=='string'||!UUID.test(requestId))return null;
  const row=(await client.query('SELECT * FROM factory.external_alpha_work_authority WHERE request_id=$1',[requestId])).rows[0];
  const i=this.installation;
  if(!row||row.cohort_id!==i.cohortId||row.slot!==i.slot||row.owner_id!==i.ownerId||row.policy_sha256!==i.policySha256)return null;
  const doc=row.document;
  if(doc?.application?.clientId!==i.application.clientId||doc?.application?.projectId!==i.application.projectId)return null;
  // A superseded Work generation cannot read or mutate the current external-alpha Result boundary.
  if(currentGeneration&&(await client.query('SELECT 1 FROM factory.external_alpha_work_authority WHERE work_id=$1 AND work_generation>$2 LIMIT 1',[row.work_id,row.work_generation])).rowCount)return null;
  return row;
 }
 /** The deadline of an already admitted request for this slot's client, or null. Used to normalize an identical redelivery. */
 async priorDeadline(client,requestId){
  if(typeof requestId!=='string'||!UUID.test(requestId))return null;
  const r=(await client.query("SELECT request->>'deadline' AS deadline FROM factory.intake_receipts WHERE client_id=$1 AND request_id=$2",[this.installation.application.clientId,requestId])).rows[0];
  return typeof r?.deadline==='string'?r.deadline:null;
 }
 /** Ledger hook: a spend operation going UNKNOWN atomically fences its cohort. Called by PostgresSpendLedger inside
  * its transaction (global ledger lock already held) BEFORE it commits, and takes the cohort lock exactly like
  * consume() does. The durable FENCED state is never silently cleared (database trigger). */
 fenceUnknownSpend(){
  return async(client,workIds)=>{
   const rows=(await client.query('SELECT DISTINCT cohort_id FROM factory.external_alpha_work_authority WHERE work_id::text = ANY($1::text[]) ORDER BY cohort_id',[workIds.map(String)])).rows;
   for(const {cohort_id} of rows)await client.query(lockKey(cohort_id),[cohort_id]);
   if(rows.length)await client.query("UPDATE factory.external_alpha_work_authority SET state='FENCED',state_reason='SPEND_UNKNOWN' WHERE work_id::text = ANY($1::text[]) AND state='CONSUMED'",[workIds.map(String)]);
  };
 }
 /** Must run inside an open transaction (the dispatch store's, or transaction()). */
 async consume(client,envelope,prepare,now){
  const v=validateStatic(envelope,prepare,this.installation);
  const d=v.document;
  await client.query(lockKey(d.cohortId),[d.cohortId]);
  const found=(await client.query('SELECT * FROM factory.external_alpha_work_authority WHERE authority_id=$1 OR request_id=$2 OR writer_id=$3 OR idempotency_key=$4 OR (work_id=$5 AND work_generation=$6)',[d.authorityId,v.ids.requestId,v.ids.writerId,d.idempotencyKey,d.work.id,d.work.generation])).rows;
  if(found.length>0){
   const row=found[0];
   if(found.length===1&&row.authority_id===d.authorityId&&row.authority_sha256===v.authoritySha256&&row.request_id===v.ids.requestId&&row.writer_id===v.ids.writerId)return {replayed:true,row};
   deny('AUTHORITY_CONSUMED');
  }
  assertTime(v,now);
  if(await this.revoked(client,v))deny('AUTHORITY_REVOKED');
  if(await this.fenced(client,d.cohortId))deny('AUTHORITY_UNKNOWN_FENCE');
  try{
   const row=(await client.query('INSERT INTO factory.external_alpha_work_authority(authority_id,authority_sha256,idempotency_key,request_id,writer_id,work_id,work_generation,cohort_id,slot,owner_id,policy_sha256,key_id,document,max_operations,max_microusd,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',
    [d.authorityId,v.authoritySha256,d.idempotencyKey,v.ids.requestId,v.ids.writerId,d.work.id,d.work.generation,d.cohortId,d.slot,d.ownerId,d.policySha256,v.keyId,JSON.stringify(d),factoryPins.limits.factory.operations,factoryPins.limits.factory.microusd,d.expiresAt])).rows[0];
   return {replayed:false,row};
  }catch(error){if(error?.code==='23505')deny('AUTHORITY_CONSUMED');throw error;}
 }
 /** Standalone atomic consumption (own transaction). */
 consumeAtomically(envelope,prepare){return this.transaction((client,now)=>this.consume(client,envelope,prepare,now));}
 /** Sets the operator-resolved state. REVOKED is terminal; UNKNOWN fences the cohort. */
 async setState(authorityId,state,reason){
  if(!['REVOKED','UNKNOWN','FENCED'].includes(state))deny('AUTHORITY_SCHEMA');
  return this.transaction(async client=>{
   const row=(await client.query('SELECT cohort_id FROM factory.external_alpha_work_authority WHERE authority_id=$1',[authorityId])).rows[0];
   if(!row)deny('AUTHORITY_DISABLED');
   await client.query(lockKey(row.cohort_id),[row.cohort_id]);
   await client.query('UPDATE factory.external_alpha_work_authority SET state=$2,state_reason=$3 WHERE authority_id=$1',[authorityId,state,String(reason).slice(0,200)]);
   if(state==='REVOKED')await client.query("INSERT INTO factory.external_alpha_revocation(subject_kind,subject,reason) VALUES('AUTHORITY',$1,$2) ON CONFLICT DO NOTHING",[authorityId,String(reason).slice(0,200)]);
  });
 }
 async revoke(kind,subject,reason){
  if(!['AUTHORITY','COHORT','KEY'].includes(kind))deny('AUTHORITY_SCHEMA');
  await this.transaction(async client=>{
   await client.query("INSERT INTO factory.external_alpha_revocation(subject_kind,subject,reason) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[kind,String(subject),String(reason).slice(0,200)]);
  });
 }
 /** Re-checks a consumed authority for a later phase. Fail closed on every doubt. */
 async assertPhase(client,request,now,phase){
  const row=request?.requestId?(await client.query('SELECT * FROM factory.external_alpha_work_authority WHERE request_id=$1 FOR UPDATE',[request.requestId])).rows[0]:undefined;
  if(!row)deny('AUTHORITY_DISABLED');
  const inst=this.installation;
  if(row.cohort_id!==inst.cohortId||row.slot!==inst.slot||row.owner_id!==inst.ownerId||row.policy_sha256!==inst.policySha256)deny('AUTHORITY_OWNER');
  if(request.workId!==row.work_id||request.workGeneration!==row.work_generation)deny('AUTHORITY_WORK');
  if((await client.query('SELECT 1 FROM factory.external_alpha_work_authority WHERE work_id=$1 AND work_generation>$2 LIMIT 1',[row.work_id,row.work_generation])).rowCount)deny('AUTHORITY_WORK');
  const rev=await client.query("SELECT 1 FROM factory.external_alpha_revocation WHERE (subject_kind='AUTHORITY' AND subject=$1) OR (subject_kind='COHORT' AND subject=$2) OR (subject_kind='KEY' AND subject=$3) LIMIT 1",[row.authority_id,row.cohort_id,row.key_id]);
  if(row.state==='REVOKED'||rev.rowCount>0)deny('AUTHORITY_REVOKED');
  const paid=['prepare','claim','dispatch','model'].includes(phase);
  if(!paid&&!['heartbeat','verifier'].includes(phase))deny('AUTHORITY_SCHEMA');
  if(paid){
   if(row.state!=='CONSUMED')deny('AUTHORITY_UNKNOWN_FENCE');
   if(now>=new Date(row.expires_at).getTime())deny('AUTHORITY_EXPIRED');
   if(await this.fenced(client,row.cohort_id))deny('AUTHORITY_UNKNOWN_FENCE');
  }
  return row;
 }
 /** Factory-side operation and micro-USD ceilings, independent of MyEve. */
 async assertPaid(client,binding){
  const row=await this.assertPhase(client,{requestId:binding?.requestId,workId:binding?.workId,workGeneration:binding?.workGeneration},await nowMs(client),'model');
  const ops=(await client.query("SELECT operation_id,state,reserved_microusd,actual_microusd FROM factory.work_spend_operations WHERE work_id=$1",[String(row.work_id)])).rows;
  const isNew=binding.operationId!==undefined&&!ops.some(o=>o.operation_id===binding.operationId);
  const used=ops.reduce((sum,o)=>sum+(o.state==='released'?0:Number(o.state==='settled'?o.actual_microusd:o.reserved_microusd)),0);
  const added=isNew?Number(binding.reservedMicrousd):0;
  if(isNew&&(!Number.isSafeInteger(added)||added<1))deny('AUTHORITY_LIMITS');
  if(ops.length+(isNew?1:0)>row.max_operations||used+added>Number(row.max_microusd))deny('AUTHORITY_LIMITS');
  return row;
 }
 /** Dispatch-store adapter: prepare consumes, later phases re-check the stored row. */
 assertAuthority(){
  return async(client,input,now,phase)=>{
   if(phase==='prepare'){
    const envelope=envelopes.get(input);
    if(!envelope)deny('AUTHORITY_DISABLED');
    const consumed=await this.consume(client,envelope,input,now);
    // A replay never re-admits work whose authority was since revoked or fenced.
    if(consumed.row.state==='REVOKED')deny('AUTHORITY_REVOKED');
    if(consumed.row.state!=='CONSUMED')deny('AUTHORITY_UNKNOWN_FENCE');
    return undefined;
   }
   await this.assertPhase(client,input,now,phase);
   return undefined;
  };
 }
 assertPaidAuthority(){return (client,binding)=>this.assertPaid(client,binding);}
 /** Readback receipt for EVERY readback of a consumed requestId. */
 async readback(client,requestId){
  const row=(await client.query('SELECT * FROM factory.external_alpha_work_authority WHERE request_id=$1',[requestId])).rows[0];
  if(!row)return null;
  let workOrderId=row.work_order_id;
  if(!workOrderId){
   workOrderId=(await client.query('SELECT work_order_id FROM factory.intake_receipts WHERE request_id=$1',[requestId])).rows[0]?.work_order_id??null;
   if(workOrderId)await client.query('UPDATE factory.external_alpha_work_authority SET work_order_id=$2 WHERE authority_id=$1 AND work_order_id IS NULL',[row.authority_id,workOrderId]);
  }
  if(!workOrderId||!this.signReceipt)return {state:row.state,authorityReceipt:null,authorityReceiptSignature:null};
  const authorityReceipt={authorityId:row.authority_id,authoritySha256:row.authority_sha256,requestId:row.request_id,workOrderId,consumedAt:new Date(row.consumed_at).toISOString()};
  return {state:row.state,authorityReceipt,authorityReceiptSignature:this.signReceipt(authorityReceipt)};
 }
}
