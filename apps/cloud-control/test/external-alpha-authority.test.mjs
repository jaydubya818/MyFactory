import test from 'node:test';
import assert from 'node:assert/strict';
import {verify} from 'node:crypto';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {parseCloudPrepare} from '../../../packages/contracts/src/cloud-execution.ts';
import {criteriaSha256,tupleSha256,acceptanceCriteria,validateExternalAlphaAuthority,validateStatic,loadExternalAlphaInstallation,parseExternalAlphaInstallation,deriveIdentifiers,receiptSigner,RECEIPT_SCHEMA,factoryPins} from '../src/external-alpha-authority.mjs';
import {makeKeys,makeInstallation,build,signDocument,uuid4} from './fixtures/external-alpha-authority.mjs';

const code=(fn)=>{try{fn();}catch(e){return e.code??e.message;}return 'ACCEPTED';};

test('contract constants are reproduced exactly', ()=>{
 assert.equal(acceptanceCriteria.length,10);
 assert.equal(criteriaSha256,'266874e4e72dcce0f02ff58bedf56801d6e9906080ed6e7b987dc6537a20b466');
 assert.equal(tupleSha256,'22768f0af6d9aa49f6f0c6553bf1a44ee7599377c1b1935904b998167bf70577');
 assert.deepEqual(deriveIdentifiers({policySha256:'a'.repeat(64),work:{id:uuid4(),version:1,generation:1},tupleSha256}).authorityId.slice(14,15),'8');
});

test('a valid authority passes every independent check', ()=>{
 const ctx=makeInstallation(),a=build(ctx);
 const v=validateExternalAlphaAuthority(a.envelope,a.prepare,ctx.installation,a.issuedAt+1000);
 assert.equal(v.document.work.generation,1);
 assert.equal(v.ids.requestId,a.prepare.requestId);
});

test('absent installation disables everything and a wrong digest pin refuses to load',()=>{
 const ctx=makeInstallation(),a=build(ctx);
 assert.equal(code(()=>validateExternalAlphaAuthority(a.envelope,a.prepare,null,a.issuedAt)),'AUTHORITY_DISABLED');
 assert.equal(loadExternalAlphaInstallation({}),null);
 const env={FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify(ctx.config)};
 assert.equal(code(()=>loadExternalAlphaInstallation(env)),'AUTHORITY_DISABLED');
 assert.equal(code(()=>loadExternalAlphaInstallation({...env,FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:'0'.repeat(64)})),'AUTHORITY_DISABLED');
 assert.equal(loadExternalAlphaInstallation({...env,FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:ctx.installation.sha256}).slot,'1');
 // An installation whose key id does not match its key material is refused, never partially pinned.
 const bad={...ctx.config,keys:[{...ctx.config.keys[0],keyId:'0'.repeat(64)}]};
 assert.equal(code(()=>parseExternalAlphaInstallation(bad)),'AUTHORITY_DISABLED');
 assert.equal(code(()=>parseExternalAlphaInstallation({...ctx.config,extra:1})),'AUTHORITY_DISABLED');
});

const documentCases=[
 ['extra field','AUTHORITY_SCHEMA',d=>{d.extra=1;}],
 ['singleUse false','AUTHORITY_SCHEMA',d=>{d.singleUse=false;}],
 ['window over 300s','AUTHORITY_SCHEMA',d=>{d.expiresAt=new Date(Date.parse(d.issuedAt)+301000).toISOString();}],
 ['notBefore differs from issuedAt','AUTHORITY_SCHEMA',d=>{d.notBefore=new Date(Date.parse(d.issuedAt)+1).toISOString();}],
 ['authorityId altered','AUTHORITY_IDENTIFIER',d=>{d.authorityId=uuid4();}],
 ['writerId altered','AUTHORITY_IDENTIFIER',d=>{d.candidateWriter.writerId=uuid4();}],
 ['second candidate slot','AUTHORITY_IDENTIFIER',d=>{d.candidateWriter.candidateSlot=2;}],
 ['owner altered','AUTHORITY_OWNER',d=>{d.ownerId='other-owner';}],
 ['cohort altered','AUTHORITY_OWNER',d=>{d.cohortId=uuid4();}],
 ['slot altered','AUTHORITY_OWNER',d=>{d.slot='2';}],
 ['client altered','AUTHORITY_OWNER',d=>{d.application.clientId='external-alpha-'+'f'.repeat(32);}],
 ['project altered','AUTHORITY_OWNER',d=>{d.application.projectId='prj_other';}],
 ['repository altered','AUTHORITY_SOURCE',d=>{d.source.repository='fixture-org/other';}],
 ['base sha altered','AUTHORITY_SOURCE',d=>{d.source.baseSha='1'.repeat(40);}],
 ['tree sha altered','AUTHORITY_SOURCE',d=>{d.source.treeSha='2'.repeat(40);}],
 ['source digest altered','AUTHORITY_SOURCE',d=>{d.source.sourceDigest='3'.repeat(64);}],
 ['allowed files widened','AUTHORITY_FILES',d=>{d.source.allowedFiles=['src/app.js','src/other.js','test/app.test.js'];d.source.allowedFilesSha256=digest({version:1,files:d.source.allowedFiles});}],
 ['allowed files traversal','AUTHORITY_FILES',d=>{d.source.allowedFiles=['../escape.js'];}],
 ['allowed files digest','AUTHORITY_FILES',d=>{d.source.allowedFilesSha256='4'.repeat(64);}],
 ['criteria hash','AUTHORITY_TUPLE',d=>{d.work.criteriaSha256='5'.repeat(64);}],
 ['criteria count','AUTHORITY_TUPLE',d=>{d.work.criteriaCount=9;}],
 ['verifier criteria','AUTHORITY_TUPLE',d=>{d.verifier.criteriaSha256='6'.repeat(64);}],
 ['environment','AUTHORITY_ENVIRONMENT',d=>{d.environment='STAGING';}],
 ['provider','AUTHORITY_PROVIDER',d=>{d.executionProvider='OTHER';}],
 ['harness version','AUTHORITY_PROVIDER',d=>{d.harness.version='2';}],
 ['factory version','AUTHORITY_FACTORY_VERSION',d=>{d.factoryVersion='7'.repeat(64);}],
 ['model','AUTHORITY_MODEL',d=>{d.model.id='openai/gpt-5.4';}],
 ['verifier trusts producer','AUTHORITY_VERIFIER',d=>{d.verifier.trustProducer=true;}],
 ['verifier not exact','AUTHORITY_VERIFIER',d=>{d.verifier.verifiesExactArtifact=false;}],
 ['effects widened','AUTHORITY_EFFECTS',d=>{d.allowedEffects=[...d.allowedEffects,'publication'];}],
 ['forbidden effects narrowed','AUTHORITY_EFFECTS',d=>{d.forbiddenEffects=d.forbiddenEffects.filter(e=>e!=='deploy');}],
 ['factory microusd raised','AUTHORITY_LIMITS',d=>{d.limits.factory.microusd=2000000;}],
 ['factory operations raised','AUTHORITY_LIMITS',d=>{d.limits.factory.operations=4;}],
 ['two writers','AUTHORITY_LIMITS',d=>{d.limits.writers=2;}]
];
for(const [name,expected,mutate] of documentCases)test('denies document change: '+name,()=>{
 const ctx=makeInstallation(),a=build(ctx,{post:(d)=>mutate(d)});
 assert.equal(code(()=>validateExternalAlphaAuthority(a.envelope,a.prepare,ctx.installation,a.issuedAt+1000)),expected);
});
const prepareCases=[
 ['request id','AUTHORITY_IDENTIFIER',(d,p)=>{p.requestId=uuid4();}],
 ['repository','AUTHORITY_SOURCE',(d,p)=>{p.repository='fixture-org/other';}],
 ['commit','AUTHORITY_SOURCE',(d,p)=>{p.source.commit='9'.repeat(40);}],
 ['tree','AUTHORITY_SOURCE',(d,p)=>{p.source.tree='9'.repeat(40);}],
 ['allowed paths widened','AUTHORITY_FILES',(d,p)=>{p.input.allowedPaths=[...p.input.allowedPaths,'package.json'];}],
 ['work id','AUTHORITY_WORK',(d,p)=>{p.workId=uuid4();}],
 ['generation','AUTHORITY_WORK',(d,p)=>{p.workGeneration=2;}],
 ['objective text','AUTHORITY_WORK',(d,p)=>{p.input.description+=' and deploy';}],
 ['title','AUTHORITY_WORK',(d,p)=>{p.input.title='Other';}],
 ['criteria reordered','AUTHORITY_TUPLE',(d,p)=>{p.input.acceptanceCriteria.reverse();}],
 ['criteria dropped','AUTHORITY_TUPLE',(d,p)=>{p.input.acceptanceCriteria.pop();}],
 ['criteria reworded','AUTHORITY_TUPLE',(d,p)=>{p.input.acceptanceCriteria[0]+='.';}],
 ['spend above Factory ceiling','AUTHORITY_LIMITS',(d,p)=>{p.maxSpendUsd=1.01;}],
 ['spend zero','AUTHORITY_LIMITS',(d,p)=>{p.maxSpendUsd=0;}],
 ['deadline past authority expiry','AUTHORITY_EXPIRED',(d,p)=>{p.deadline=new Date(Date.parse(d.expiresAt)+1).toISOString();}]
];
for(const [name,expected,mutate] of prepareCases)test('denies request change: '+name,()=>{
 const ctx=makeInstallation(),a=build(ctx,{post:mutate});
 assert.equal(code(()=>validateExternalAlphaAuthority(a.envelope,a.prepare,ctx.installation,a.issuedAt+1000)),expected);
});

test('signature, key, digest and clock failures',()=>{
 const ctx=makeInstallation(),a=build(ctx),at=a.issuedAt+1000,v=e=>code(()=>validateExternalAlphaAuthority(e,a.prepare,ctx.installation,at));
 assert.equal(v(a.envelope),'ACCEPTED');
 const flip=a.envelope.signature.startsWith('A')?'B':'A';
 assert.equal(v({...a.envelope,signature:flip+a.envelope.signature.slice(1)}),'AUTHORITY_SIGNATURE');
 assert.equal(v({...a.envelope,keyId:'0'.repeat(64)}),'AUTHORITY_SIGNATURE');
 assert.equal(v({...a.envelope,authoritySha256:'0'.repeat(64)}),'AUTHORITY_SIGNATURE');
 assert.equal(v({...a.envelope,document:{...a.envelope.document,ownerId:'owner-opaque-1 '}}),'AUTHORITY_SIGNATURE'); // tampered after signing
 const other=makeKeys();
 assert.equal(v(signDocument(a.document,other,ctx.keys.keyId)),'AUTHORITY_SIGNATURE'); // pinned key id, foreign signer
 assert.equal(v(signDocument(a.document,other)),'AUTHORITY_SIGNATURE'); // unpinned key
 assert.equal(v({...a.envelope,unexpected:1}),'AUTHORITY_SCHEMA');
 assert.equal(code(()=>validateExternalAlphaAuthority(a.envelope,a.prepare,ctx.installation,a.issuedAt-1)),'AUTHORITY_NOT_YET_VALID');
 assert.equal(code(()=>validateExternalAlphaAuthority(a.envelope,a.prepare,ctx.installation,a.issuedAt+290000)),'AUTHORITY_EXPIRED');
 // A pinned key outside its own validity window cannot authorize.
 const expiredKey=makeInstallation(ctx.keys,{...ctx.config,keys:[{...ctx.config.keys[0],notAfter:new Date(a.issuedAt+500).toISOString()}]});
 assert.equal(code(()=>validateExternalAlphaAuthority(a.envelope,a.prepare,expiredKey.installation,at)),'AUTHORITY_SIGNATURE');
});

test('the receipt signature is over the schema-prefixed receipt digest',()=>{
 const keys=makeKeys(),sign=receiptSigner(keys.privateKey.export({type:'pkcs8',format:'pem'}));
 const receipt={authorityId:uuid4(),authoritySha256:'a'.repeat(64),requestId:uuid4(),workOrderId:'wo',consumedAt:new Date().toISOString()};
 const signature=sign(receipt);
 assert.equal(verify(null,Buffer.concat([Buffer.from(RECEIPT_SCHEMA),Buffer.from([0]),Buffer.from(digest(receipt))]),keys.publicKey,Buffer.from(signature,'base64url')),true);
 assert.equal(verify(null,Buffer.concat([Buffer.from(RECEIPT_SCHEMA),Buffer.from([0]),Buffer.from(digest({...receipt,workOrderId:'x'}))]),keys.publicKey,Buffer.from(signature,'base64url')),false);
});

test('derived request ids are admitted only by an explicit external-alpha grant',()=>{
 const ctx=makeInstallation(),a=build(ctx),s=ctx.config.source;
 const grant={clientId:ctx.config.application.clientId,source:{repository:s.repository,commit:s.baseSha,tree:s.treeSha},commands:['npm test'],allowedPaths:s.allowedFiles,maxDurationMs:300000,maxSpendUsd:1};
 const now=a.issuedAt;
 assert.throws(()=>parseCloudPrepare(a.prepare,grant,now),/INVALID_CLOUD_REQUEST/);
 assert.equal(parseCloudPrepare(a.prepare,{...grant,derivedRequestId:true},now).requestId,a.prepare.requestId);
 // The flag never relaxes the Work id and never admits another uuid version.
 assert.throws(()=>parseCloudPrepare({...a.prepare,workId:a.ids.requestId},{...grant,derivedRequestId:true},now),/INVALID_CLOUD_REQUEST/);
 assert.throws(()=>parseCloudPrepare({...a.prepare,requestId:a.prepare.requestId.slice(0,19)+'c'+a.prepare.requestId.slice(20)},{...grant,derivedRequestId:true},now),/INVALID_CLOUD_REQUEST/);
});
