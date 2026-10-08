import test from 'node:test';
import assert from 'node:assert/strict';
import {verify} from 'node:crypto';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {externalAlphaReadback,externalAlphaVerdict,readbackSigner,READBACK_SCHEMA,assertExternalAlphaResult} from '../src/external-alpha-readback.mjs';
import {externalAlphaSigning} from '../src/external-alpha-runtime.mjs';
import {makeKeys,makeInstallation,build} from './fixtures/external-alpha-authority.mjs';

function fixture(){
 const ctx=makeInstallation(),a=build(ctx),keys=makeKeys(),request=a.prepare;
 const row={request,request_id:request.requestId,work_order_id:'order',run_id:'run',work_id:request.workId,work_generation:request.workGeneration,
  snapshot:{requestDigest:digest(request),factoryVersion:a.document.factoryVersion,attemptNumber:1,configuration:{cloud:{verificationPolicySha256:'a'.repeat(64)}}},custody:null};
 const authority={authority_id:a.document.authorityId,authority_sha256:a.envelope.authoritySha256,work_id:request.workId,work_generation:request.workGeneration,document:a.document};
 const receipt={authorityReceipt:{authorityId:authority.authority_id,authoritySha256:authority.authority_sha256,requestId:request.requestId,workOrderId:'order',consumedAt:new Date().toISOString()},authorityReceiptSignature:'receipt'};
 const body={requestId:request.requestId,state:'PREPARED',quiescent:false,evidenceRef:null,blocker:null,spend:{version:'WORK_LEDGER_V2',operations:[]},snapshot:row.snapshot,identity:{private:true}};
 const signReadback=readbackSigner(keys.privateKey.export({type:'pkcs8',format:'pem'}));
 return{row,authority,receipt,body,signReadback,keys,challenge:'a'.repeat(32),now:Date.now()};
}

test('readback signs exact admitted request/Work/run/authority/spend and caller challenge under a distinct domain',()=>{
 const f=fixture(),out=externalAlphaReadback(f),a=out.readbackAttestation;
 assert.equal(a.schema,READBACK_SCHEMA);assert.equal(a.challenge,f.challenge);assert.equal(a.requestDigest,digest(f.row.request));
 assert.equal(a.receiptDigest,digest(f.receipt.authorityReceipt));assert.equal(a.spendDigest,digest(a.spend));assert.equal(a.verdict,'PENDING');
 assert.equal(Date.parse(a.expiresAt)-Date.parse(a.issuedAt),120000);assert.equal(out.snapshot,undefined);assert.equal(out.identity,undefined);
 const bytes=value=>Buffer.concat([Buffer.from(READBACK_SCHEMA),Buffer.from([0]),Buffer.from(digest(value))]);
 assert(verify(null,bytes(a),f.keys.publicKey,Buffer.from(out.readbackSignature,'base64url')));
 for(const patch of [{state:'COMPLETED'},{quiescent:true},{challenge:'b'.repeat(32)},{spend:{operations:[]}},{runId:'other'},{requestDigest:'0'.repeat(64)}])
  assert.equal(verify(null,bytes({...a,...patch}),f.keys.publicKey,Buffer.from(out.readbackSignature,'base64url')),false);
 assert.equal(verify(null,Buffer.concat([Buffer.from('MYFACTORY_EXTERNAL_ALPHA_RECEIPT_V1'),Buffer.from([0]),Buffer.from(digest(a))]),f.keys.publicKey,Buffer.from(out.readbackSignature,'base64url')),false);
});

test('cross Work/version/source/Factory binding failures and unsafe challenges fail closed',()=>{
 for(const patch of [{work_id:'other'},{work_generation:2},{snapshot:{requestDigest:'0'.repeat(64)}},{request_id:'other'}]){
  const f=fixture();f.row={...f.row,...patch};assert.throws(()=>externalAlphaReadback(f));
 }
 const f=fixture();assert.throws(()=>externalAlphaReadback({...f,challenge:'bad'}));
 assert.throws(()=>externalAlphaReadback({...f,signReadback:undefined}));
});

test('producer completion and candidate existence never imply independent PASS',()=>{
 const f=fixture(),row=f.row;
 assert.equal(externalAlphaVerdict(row,'COMPLETED'),'NONE');
 row.custody={candidate_commit:'c',candidate_tree:'t',artifact_sha256:'d'};
 assert.equal(externalAlphaVerdict(row,'COMPLETED'),'PARTIAL');
 row.verification={run_id:row.run_id,candidate_commit:'c',candidate_tree:'t',custody_sha256:'d',policy_sha256:'a'.repeat(64),outcome:'PASS',cleanup_confirmed:false};
 assert.equal(externalAlphaVerdict(row,'COMPLETED'),'PARTIAL');
 row.verification.cleanup_confirmed=true;assert.equal(externalAlphaVerdict(row,'COMPLETED'),'PASS');
 assert.equal(externalAlphaVerdict(row,'CANCELLED'),'PARTIAL');
 row.verification.outcome='FAIL';assert.equal(externalAlphaVerdict(row,'FAILED'),'FAIL');
 row.verification.candidate_tree='wrong';assert.equal(externalAlphaVerdict(row,'COMPLETED'),'PARTIAL');
});

test('external-alpha signing cannot inherit production/canary keys; missing, mismatched or expired keys deny',()=>{
 const keys=makeKeys(),publicKey=keys.publicKeyPem,privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'});
 const config={factoryId:'myfactory-external-alpha',key:{factoryId:'myfactory-external-alpha',keyId:'external-alpha-result-v1',publicKey,activeFrom:'2020-01-01T00:00:00.000Z',notAfter:'2100-01-01T00:00:00.000Z'},privateKey};
 const env=c=>({FACTORY_EXTERNAL_ALPHA_RESULT_SIGNING_JSON:JSON.stringify(c)});
 assert.equal(externalAlphaSigning(env(config)).factoryId,config.factoryId);
 for(const c of [{...config,factoryId:'myfactory-cloud-production'},{...config,key:{...config.key,keyId:'production-cloud-v1'}},{...config,key:{...config.key,revokedAt:'2026-01-01'}},{...config,key:{...config.key,notAfter:'2020-01-02'}},{...config,privateKey:makeKeys().privateKey.export({type:'pkcs8',format:'pem'})}])assert.throws(()=>externalAlphaSigning(env(c)));
 assert.throws(()=>externalAlphaSigning({}));
 assert.throws(()=>externalAlphaSigning({...env(config),FACTORY_PRODUCTION_RESULT_SIGNING_JSON:JSON.stringify({...config,factoryId:'myfactory-cloud-production',key:{...config.key,factoryId:'myfactory-cloud-production',keyId:'production-cloud-v1'}})}),/SIGNER_REUSED/);
 assert.throws(()=>externalAlphaSigning({...env(config),FACTORY_EXTERNAL_ALPHA_RECEIPT_SIGNING_KEY:privateKey}),/SIGNER_REUSED/);
});

test('Result boundary refuses a different candidate, execution or signing family',()=>{
 const f=fixture(),manifest={execution:f.row.snapshot,producer:'myfactory-external-alpha',keyId:'external-alpha-result-v1',status:'CANCELLED',candidate:null};
 const result=m=>({encoded:Buffer.from(JSON.stringify(m)).toString('base64url')});
 assertExternalAlphaResult(f.row,result(manifest));
 for(const patch of [{producer:'myfactory-cloud-production'},{keyId:'production-cloud-v1'},{execution:{...manifest.execution,runId:'other'}},{candidate:{commit:'other',tree:'other'}},{status:'COMPLETED'}])assert.throws(()=>assertExternalAlphaResult(f.row,result({...manifest,...patch})));
});
