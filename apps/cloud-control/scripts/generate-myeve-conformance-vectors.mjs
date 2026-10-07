#!/usr/bin/env node
// Regenerates the MyEve -> MyFactory external-alpha conformance vectors by RUNNING THE MYEVE ISSUER CODE.
//
//   node --experimental-transform-types --disable-warning=ExperimentalWarning \
//     apps/cloud-control/scripts/generate-myeve-conformance-vectors.mjs \
//     --myeve <path to a MyEve checkout with node_modules> --out <vectors.json> [--now <ISO>] [--live]
//
// The MyEve checkout is only READ. Everything is synthetic: a fixed, throwaway TEST-ONLY Ed25519 key
// derived from a public seed string (never pin it anywhere real), opaque ids, a fixture repository owner.
// No real tester, project, repository, sha or secret is used. Output is deterministic for a given
// MyEve commit and --now (Ed25519 signatures are deterministic), so a diff of the committed file is a
// meaningful review signal. --live uses the current clock (for end to end tests inside the validity window).
import {createHash,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const arg=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
const root=resolve(arg('myeve')??'');
const out=arg('out');
if(!arg('myeve')||!out){console.error('usage: --myeve <checkout> --out <file> [--now <ISO>] [--live]');process.exit(2);}
const NOW_FIXED='2026-10-07T12:00:00.000Z';
const nowMs=process.argv.includes('--live')?Date.now():Date.parse(arg('now')??NOW_FIXED);
const iso=ms=>new Date(ms).toISOString();
const imp=async rel=>import(pathToFileURL(resolve(root,'apps/eve/lib',rel)).href);
const A=await imp('external-alpha/work-authority.ts'),C=await imp('external-alpha/work-controller.ts'),T=await imp('external-alpha/work-tuple.ts'),P=await imp('external-alpha/policy.ts'),K=await imp('engineering/contract.ts');

const sha=v=>createHash('sha256').update(v).digest('hex');
const hex=(label,n)=>sha('myeve-conformance-fixture:'+label).slice(0,n);
const uuid4=label=>{const h=hex(label,32);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};

// TEST-ONLY key: PKCS8 wrapper around a seed derived from a public string. Never pin in a real installation.
const seed=createHash('sha256').update('MYFACTORY-CONFORMANCE-TEST-KEY-NEVER-PIN-IN-PRODUCTION').digest();
const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
const publicKey=createPublicKey(privateKey);
const privatePem=privateKey.export({type:'pkcs8',format:'pem'});
const signer=new A.WorkAuthoritySigner(privatePem);
const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
const keyId=A.publicKeyId(publicKey);
const resultSeed=createHash('sha256').update('MYFACTORY-CONFORMANCE-RESULT-TEST-KEY-NEVER-PIN-IN-PRODUCTION').digest();
const resultPublicKey=createPublicKey(createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),resultSeed]),format:'der',type:'pkcs8'})).export({type:'spki',format:'pem'});

const policy=P.externalAlphaPolicySchema.parse({version:1,kind:'TWO_EXTERNAL_OWNERS_V1',cohortId:uuid4('cohort'),slot:'1',ownerId:uuid4('owner'),
 projectId:'prj_ConformanceFixture1',clientId:'external-alpha-'+hex('client',32),repository:'fixture-org/myeve-alpha-workspace-01',
 baseSha:hex('base',40),treeSha:hex('tree',40),workspacePolicy:'ISOLATED_WORKSPACE_V1',dayBoundary:'UTC_MIDNIGHT',model:'openai/gpt-5.4-mini',
 provider:'vercel-ai-gateway/openai',sourceDigest:hex('source',64),factoryVersion:K.digest({sourceDigest:hex('source',64),configurationDigest:hex('configuration',64)}),limits:{...P.externalAlphaLimits},
 publication:false,automaticRepair:false,fallback:false});
const allowedFiles=['src/app.js','src/store.js','test/app.test.mjs'];
const checkCommands=['node --test test/app.test.mjs'];
const factoryOrigin='https://myfactory-cloud-production.vercel.app';
const workConfig=C.externalAlphaWorkConfigSchema.parse({allowedFiles,checkCommands,factory:{origin:factoryOrigin,trustedTeamId:'team_ConformanceFixture',receiptKeys:[{keyId,publicKey:publicKeyPem.trim()}],
 resultVerification:{factoryId:'myfactory-external-alpha',sourceDigest:policy.sourceDigest,configurationDigest:hex('configuration',64),verifierPolicySha256:hex('verifier-policy',64),
 resultKeys:[{factoryId:'myfactory-external-alpha',keyId:'external-alpha-result-v1',publicKey:resultPublicKey.trim(),activeFrom:'2020-01-01T00:00:00.000Z',notAfter:'2100-01-01T00:00:00.000Z'}]}}});
const W=await imp('external-alpha/work-config.ts');
W.assertExternalAlphaFactoryKeys(workConfig);
W.assertExternalAlphaWorkBinding(policy,workConfig,{MYEVE_EXTERNAL_ALPHA_FACTORY_PIN_SHA256:W.externalAlphaFactoryPinSha256(policy,workConfig)});

const canon=T.canonicalAlphaTasksWork(policy.repository,policy.ownerId);
const work={id:uuid4('work'),scopeId:policy.ownerId,title:canon.title,objective:canon.objective,repository:canon.repository,lifecycle:'active',control:'agent',
 version:1,generation:1,criteriaVersion:1,criteria:canon.criteria.map(c=>({...c})),maxCostUsd:canon.maxCostUsd,maxDurationSeconds:canon.maxDurationSeconds,
 createdAt:iso(nowMs-60000),updatedAt:iso(nowMs-60000)};
const document=A.buildWorkAuthority({policy,work,allowedFiles,now:new Date(nowMs)});
const envelope=signer.sign(document);
// The REAL MyEve controller code builds the request body it sends.
const record={envelope,requestId:document.candidateWriter.requestId,id:document.authorityId,documentSha256:envelope.authoritySha256,workId:work.id,workGeneration:work.generation,receipt:null};
const prepare=C.prepareRequest(record,work,workConfig,nowMs);

// ---- additional authorities issued by the same MyEve code ----
const issueVariant=(pol,wk)=>{
 const doc=A.buildWorkAuthority({policy:pol,work:wk,allowedFiles,now:new Date(nowMs)}),env=signer.sign(doc);
 const rec={envelope:env,requestId:doc.candidateWriter.requestId,id:doc.authorityId,documentSha256:env.authoritySha256};
 return {envelope:env,prepare:C.prepareRequest(rec,wk,workConfig,nowMs)};
};
// Same Work generation, different Work version: a competing authority the Factory must refuse after the first.
const competing=issueVariant(policy,{...work,version:2});
// Second tester slot (distinct owner, project, client, workspace) in the same cohort and Factory build.
const policy2=P.externalAlphaPolicySchema.parse({...policy,slot:'2',ownerId:uuid4('owner-2'),projectId:'prj_ConformanceFixture2',clientId:'external-alpha-'+hex('client-2',32),
 repository:'fixture-org/myeve-alpha-workspace-02',baseSha:hex('base-2',40),treeSha:hex('tree-2',40)});
const canon2=T.canonicalAlphaTasksWork(policy2.repository,policy2.ownerId);
const work2={...work,id:uuid4('work-2'),scopeId:policy2.ownerId,repository:canon2.repository,criteria:canon2.criteria.map(c=>({...c}))};
const slot2=issueVariant(policy2,work2);
const installationView=(pol)=>({cohortId:pol.cohortId,slot:pol.slot,ownerId:pol.ownerId,policySha256:A.authorityDigest(pol),application:{clientId:pol.clientId,projectId:pol.projectId},
 source:{repository:pol.repository,baseSha:pol.baseSha,treeSha:pol.treeSha,sourceDigest:pol.sourceDigest,allowedFiles},factoryVersion:pol.factoryVersion,checkCommands});

// ---- independent recomputation of every derived value with MyEve's own exported helpers ----
const uuidFrom=h=>`${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
const identifiers={
 idempotencyKey:document.idempotencyKey,authorityId:document.authorityId,requestId:document.candidateWriter.requestId,writerId:document.candidateWriter.writerId,
 derivation:{idempotencyKeyInput:{kind:'EXTERNAL_ALPHA_WORK_AUTHORITY_KEY_V1',policySha256:document.policySha256,workId:work.id,workVersion:work.version,workGeneration:work.generation,tupleSha256:T.alphaTasksTupleSha256},
  requestSeed:'EXTERNAL_ALPHA_REQUEST_V1:'+document.authorityId,writerSeed:'EXTERNAL_ALPHA_WRITER_V1:'+document.authorityId},
};
if(A.authorityIdFor(document.idempotencyKey)!==uuidFrom(document.idempotencyKey.slice(0,32))||uuidFrom(sha(identifiers.derivation.requestSeed))!==identifiers.requestId||uuidFrom(sha(identifiers.derivation.writerSeed))!==identifiers.writerId)throw Error('GENERATOR_SELF_CHECK_IDENTIFIERS');
if(A.authorityDigest(document)!==envelope.authoritySha256||A.canonicalJson(document)!==A.canonicalJson(JSON.parse(JSON.stringify(document))))throw Error('GENERATOR_SELF_CHECK_DIGEST');
const signedBytes=Buffer.concat([Buffer.from(A.WORK_AUTHORITY_DOMAIN,'utf8'),Buffer.from([0]),Buffer.from(envelope.authoritySha256,'ascii')]);
if(!verify(null,signedBytes,publicKey,Buffer.from(envelope.signature,'base64url')))throw Error('GENERATOR_SELF_CHECK_SIGNATURE');

// ---- canonicalization vectors: MyEve digest() over inputs designed to expose ordering/escaping differences ----
const canonicalCases={
 'key-order':{b:1,a:{d:[3,2,1],c:null},A:true},
 'utf16-order':{'\u{1F600}':1,'\uFB01':2,'z':3,'\u00e9':4,'Z':5,'':6,'a10':7,'a9':8},
 'escapes':{s:'quote " backslash \\ newline \n tab \t nul \u0000 del \u007f unicode \u2028 \u2029 emoji \u{1F680}'},
 'numbers':{ints:[0,-1,1,9007199254740991],decimals:[0.5,1.25,1e21,1e-7,-0.0],nested:{n:1.0}},
 'empty':{a:[],b:{},c:''},
 'arrays-keep-order':{list:['b','a',['d','c'],{y:1,x:2}]},
 'authority-subset':{version:1,files:allowedFiles},
};
const canonicalVectors=Object.entries(canonicalCases).map(([name,value])=>({name,value,canonical:A.canonicalJson(value),sha256:K.digest(value)}));
// KNOWN DIVERGENCE (documented, not reachable by any authority field): JS engines order integer-like object keys
// numerically at construction, so MyEve's Object.fromEntries(sorted) canonicalization yields 9 before 10, while a
// string-sorting canonicalizer yields "10" before "9". Both sides use strict schemas without such keys.
{const value={'10':'a','9':'b'};canonicalVectors.push({name:'integer-like-keys-known-divergence',expectDivergence:true,value,canonical:A.canonicalJson(value),sha256:K.digest(value)});}

// ---- mutations ----
const clone=v=>JSON.parse(JSON.stringify(v));
const leaves=(v,path=[])=>v!==null&&typeof v==='object'?Object.entries(v).flatMap(([k,x])=>leaves(x,[...path,Array.isArray(v)?Number(k):k])):[{path,value:v}];
const getAt=(o,p)=>p.reduce((x,k)=>x[k],o);
const setAt=(o,p,val)=>{getAt(o,p.slice(0,-1))[p.at(-1)]=val;};
const delAt=(o,p)=>{const parent=getAt(o,p.slice(0,-1));if(Array.isArray(parent))parent.splice(p.at(-1),1);else delete parent[p.at(-1)];};
const TS=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const flip=value=>{
 if(typeof value==='boolean')return !value;
 if(typeof value==='number')return value+1;
 if(typeof value!=='string')return null;
 if(TS.test(value))return iso(Date.parse(value)+1000);
 const head=value[0];
 const next=/[0-9a-f]/.test(head)?(head==='f'?'0':head==='9'?'a':String.fromCharCode(head.charCodeAt(0)+1)):head==='x'?'y':'x';
 return next+value.slice(1);
};
const pathName=p=>p.join('.');
function resign(doc){const authoritySha256=A.authorityDigest(doc);return {document:doc,authoritySha256,keyId,signature:sign(null,Buffer.concat([Buffer.from(A.WORK_AUTHORITY_DOMAIN,'utf8'),Buffer.from([0]),Buffer.from(authoritySha256,'ascii')]),privateKey).toString('base64url')};}
// A mutation is a small patch against the base document/prepare/envelope. Document patches carry the
// signature MyEve-format signing produced over the mutated document, so the Factory must reject them on the
// specific bound field (not merely on a broken signature) while the test reconstructs them deterministically.
const mutations=[];
const add=(name,target,op,path,value,base)=>{
 const m={name,target,op,path,value};
 if(target==='document'){const d=clone(document);apply(d,{op,path,value});const e=resign(d);m.authoritySha256=e.authoritySha256;m.signature=e.signature;}
 mutations.push(m);
};
const apply=(o,{op,path,value})=>{if(op==='set')setAt(o,path,value);else if(op==='delete')delAt(o,path);else if(op==='unknown')getAt(o,path)['unexpected']=1;else if(op==='replace')setAt(o,path,value);};
const objectPaths=[[],...leaves(document).map(l=>l.path.slice(0,-1)).filter((p,i,a)=>p.length>0&&a.findIndex(q=>q.join('.')===p.join('.'))===i&&!Array.isArray(getAt(document,p)))];
for(const {path,value} of leaves(document)){add('document:'+pathName(path),'document','set',path,flip(value));}
for(const p of objectPaths)add('document:+unknown@'+(pathName(p)||'root'),'document','unknown',p);
for(const {path} of leaves(document)){if(typeof path.at(-1)!=='number')add('document:-'+pathName(path),'document','delete',path);}
for(const p of [['source','allowedFiles'],['allowedEffects'],['forbiddenEffects']]){add('document:-'+pathName(p),'document','delete',p);add('document:'+pathName(p)+'.dropped-last','document','replace',p,getAt(document,p).slice(0,-1));add('document:'+pathName(p)+'.reversed','document','replace',p,[...getAt(document,p)].reverse());add('document:'+pathName(p)+'.extended','document','replace',p,[...getAt(document,p),'extra']);}
for(const f of ['authoritySha256','signature','keyId'])add('envelope:'+f,'envelope','set',[f],f==='signature'?flip(envelope.signature).replace(/[^A-Za-z0-9_-]/g,'A'):flip(envelope[f]));
for(const {path,value} of leaves(prepare))add('prepare:'+pathName(path),'prepare','set',path,flip(value));
for(const p0 of [[],['source'],['input']])add('prepare:+unknown@'+(pathName(p0)||'root'),'prepare','unknown',p0);
for(const {path} of leaves(prepare)){if(typeof path.at(-1)!=='number')add('prepare:-'+pathName(path),'prepare','delete',path);}
for(const p of [['input','acceptanceCriteria'],['input','checkCommands'],['input','allowedPaths']])add('prepare:-'+pathName(p),'prepare','delete',p);
add('prepare:checkCommands.extended','prepare','replace',['input','checkCommands'],[...prepare.input.checkCommands,'node -e 1']);
const crit=prepare.input.acceptanceCriteria;
for(const [name,list] of [['reordered',[crit[1],crit[0],...crit.slice(2)]],['dropped',crit.slice(0,9)],['added',[...crit,'An extra criterion']],['reworded-trailing-space',[...crit.slice(0,9),crit[9]+' ']]])add('prepare:acceptanceCriteria.'+name,'prepare','replace',['input','acceptanceCriteria'],list);
add('prepare:allowedPaths.unsorted','prepare','replace',['input','allowedPaths'],[...prepare.input.allowedPaths].reverse());
add('prepare:allowedPaths.widened','prepare','replace',['input','allowedPaths'],[...prepare.input.allowedPaths,'src/extra.js']);

// ---- Factory readback receipts verified by MyEve's OWN verifyReadback (the check MyEve runs on every Factory response) ----
// The receipt is signed by the FACTORY's receiptSigner (same code the HTTP entry uses); MyEve decides acceptance.
const {receiptSigner}=await import(pathToFileURL(resolve(new URL('../src/external-alpha-authority.mjs',import.meta.url).pathname)).href);
const signReceipt=receiptSigner(privatePem);
const receipt={authorityId:document.authorityId,authoritySha256:envelope.authoritySha256,requestId:document.candidateWriter.requestId,workOrderId:uuid4('work-order'),consumedAt:iso(nowMs+500)};
const {externalAlphaReadback,readbackSigner}=await import(pathToFileURL(resolve(new URL('../src/external-alpha-readback.mjs',import.meta.url).pathname)).href);
const challenge=hex('readback-challenge',48),readbackNow=nowMs+1000;
const binding={requestDigest:K.digest(prepare),admittedDeadline:prepare.deadline};
const spend={status:'KNOWN',currency:'USD',unit:'microUSD',workId:work.id,workGeneration:work.generation,requestId:receipt.requestId,workOrderId:receipt.workOrderId,deadline:prepare.deadline,
 ceilingMicrousd:1000000,settledMicrousd:0,retainedMicrousd:0,availableMicrousd:1000000,cancelled:false,operations:[],contractVersion:'WORK_LEDGER_V2',pricingRevision:'fixture-pricing',
 plannedProductiveOperations:2,plannedCompletionOperations:1,perOperationReserveMicrousd:200000,completionReserveMicrousd:300000,completionReserveRemainingMicrousd:300000,
 productiveAllowanceRemainingMicrousd:700000,unknownExposureMicrousd:0,paidOperationsUsed:0,maxPaidOperations:3,completionOperationsUsed:0,completionOperationSlotsRemaining:1,
 accountingComplete:true,pricingQualified:true,authorityState:'active',phase:'productive'};
const readbackBase=externalAlphaReadback({body:{requestId:receipt.requestId,workOrderId:receipt.workOrderId,runId:uuid4('run'),state:'RUNNING',quiescent:false,evidenceRef:null,blocker:null,spend},
 row:{request_id:receipt.requestId,work_order_id:receipt.workOrderId,run_id:uuid4('run'),work_id:work.id,work_generation:work.generation,request:prepare,
 snapshot:{attemptNumber:1,requestDigest:binding.requestDigest,factoryVersion:policy.factoryVersion}},
 receipt:{authorityReceipt:receipt,authorityReceiptSignature:signReceipt(receipt)},authority:{authority_id:document.authorityId,authority_sha256:envelope.authoritySha256,work_id:work.id,work_generation:work.generation,document},
 challenge,signReadback:readbackSigner(privatePem),now:readbackNow});
const receiptKeyMap=C.receiptKeys(workConfig);
const otherReceipt={...receipt,workOrderId:uuid4('work-order-2')};
const readbackCases=[
 ['valid',readbackBase],
 ['extra-passthrough-fields',{...readbackBase,snapshot:{a:1},identity:null,delivery:'x'}],
 ['unsigned-compatibility-fields',{...readbackBase,state:'COMPLETED',quiescent:true,spend:null}],
 ['receipt-only',(({readbackAttestation,readbackSignature,...r})=>r)(readbackBase)],
 ['tampered-attestation',{...readbackBase,readbackAttestation:{...readbackBase.readbackAttestation,quiescent:true}}],
 ['wrong-attested-challenge',{...readbackBase,readbackAttestation:{...readbackBase.readbackAttestation,challenge:hex('other-challenge',48)}}],
 ['signature-of-other-receipt',{...readbackBase,authorityReceiptSignature:signReceipt(otherReceipt)}],
 ['tampered-work-order',{...readbackBase,authorityReceipt:{...receipt,workOrderId:uuid4('work-order-3')}}],
 ['wrong-authority-sha',{...readbackBase,authorityReceipt:{...receipt,authoritySha256:flip(receipt.authoritySha256)}}],
 ['wrong-authority-id',{...readbackBase,authorityReceipt:{...receipt,authorityId:uuid4('other-authority')}}],
 ['wrong-receipt-request',{...readbackBase,authorityReceipt:{...receipt,requestId:uuid4('other-request')}}],
 ['wrong-body-request',{...readbackBase,requestId:uuid4('other-request')}],
 ['missing-signature',(({authorityReceiptSignature,...r})=>r)(readbackBase)],
 ['null-receipt',{...readbackBase,authorityReceipt:null,authorityReceiptSignature:null}],
 ['unknown-state',{...readbackBase,state:'BOGUS'}],
].map(([name,value])=>{let outcome='ACCEPTED',verified=null;try{const r=C.verifyReadback(value,record,receiptKeyMap,binding,challenge,readbackNow);
 verified={state:r.state,quiescent:r.quiescent,spendDigest:K.digest(r.spend)};}catch(e){outcome=e.message;}return {name,value,outcome,verified};});

let myeveCommit='unknown';
try{myeveCommit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{myeveCommit=arg('myeve-commit')??'unknown (no git metadata; pass --myeve-commit)';}
const vectors={
 kind:'MYEVE_EXTERNAL_ALPHA_CONFORMANCE_VECTORS_V1',synthetic:true,
 generator:'apps/cloud-control/scripts/generate-myeve-conformance-vectors.mjs',myeveCommit:arg('myeve-commit')??myeveCommit,
 nowMs,issuedAt:document.issuedAt,
 testKey:{purpose:'TEST ONLY: seed is public in the generator; never pin in a real installation',keyId,publicKeyPem},
 policy,workConfig:{allowedFiles,checkCommands,factoryOrigin},
 installation:installationView(policy),
 tuple:{project:T.alphaTasksProject,criteria:[...T.alphaTasksCriteria],criteriaSha256:T.alphaTasksCriteriaSha256,tupleSha256:T.alphaTasksTupleSha256,title:T.alphaTasksTitle,objective:T.alphaTasksObjective,objectiveSha256:T.sha256Hex(T.alphaTasksObjective)},
 allowedFilesSha256:A.allowedFilesDigest(allowedFiles),
 identifiers,work:{id:work.id,version:work.version,generation:work.generation},
 canonicalDocument:A.canonicalJson(document),signedBytesHex:signedBytes.toString('hex'),
 canonicalVectors,envelope,prepare,variants:{competing,slot2:{...slot2,installation:installationView(policy2)}},
 prepareBodyBytes:Buffer.byteLength(JSON.stringify({authority:envelope,prepare})),
 mutations,
 readback:{receipt,receiptDomain:C.RECEIPT_DOMAIN,challenge,binding,nowMs:readbackNow,cases:readbackCases},
};
writeFileSync(out,JSON.stringify(vectors,null,1)+'\n');
console.log(JSON.stringify({out,myeveCommit:vectors.myeveCommit,mutations:vectors.mutations.length,prepareBodyBytes:vectors.prepareBodyBytes}));
