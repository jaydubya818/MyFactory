import test from 'node:test';
import assert from 'node:assert/strict';
import {verify,createPublicKey} from 'node:crypto';
import {digest,canonical} from '../../../packages/hosted-routing/src/result.ts';
import {parseCloudPrepare} from '../../../packages/contracts/src/cloud-execution.ts';
import {criteriaSha256,tupleSha256,acceptanceCriteria,projectTask,deriveIdentifiers,validateExternalAlphaAuthority,AUTHORITY_SCHEMA,keyIdOf,RECEIPT_SCHEMA} from '../src/external-alpha-authority.mjs';
import {loadVectors,installationOf,grantFor,applyMutation,sha,regenerateLive} from './fixtures/myeve-conformance/support.mjs';
import {READBACK_SCHEMA} from '../src/external-alpha-readback.mjs';

// Vectors run the MyEve issuer/controller code; see docs/private-alpha/external-alpha-entry.md. Synthetic data only.
const v=loadVectors(),inst=installationOf(v),grant=grantFor(inst),AT=v.nowMs+1000;
const verdict=fn=>{try{fn();}catch(e){return e.code??e.message;}return 'ACCEPTED';};
/** The Factory admission decision made before any state is written: independent validation then the request parser. */
const admit=(envelope,prepare,at=AT)=>{validateExternalAlphaAuthority(envelope,prepare,inst,at);return parseCloudPrepare(prepare,grant,at);};

test('vectors are MyEve-generated, synthetic and complete',()=>{
 assert.equal(v.kind,'MYEVE_EXTERNAL_ALPHA_CONFORMANCE_VECTORS_V1');
 assert.equal(v.synthetic,true);
 assert.match(v.myeveCommit,/^[a-f0-9]{40}$/);
 assert.ok(v.mutations.length>=190);
 assert.equal(new Set(v.mutations.map(m=>m.name)).size,v.mutations.length);
 assert.doesNotMatch(JSON.stringify(v),/BEGIN [A-Z ]*PRIVATE KEY/); // only a public test key is committed
});

test('project tuple, criteria and objective hashes match MyEve exactly',()=>{
 assert.deepEqual(v.tuple.criteria,[...acceptanceCriteria]);
 assert.equal(v.tuple.project.name,'Alpha Tasks');
 assert.equal(v.tuple.project.task,projectTask);
 assert.equal(v.tuple.criteriaSha256,criteriaSha256);
 assert.equal(v.tuple.tupleSha256,tupleSha256);
 assert.equal(digest({version:1,criteria:v.tuple.criteria}),v.tuple.criteriaSha256);
 assert.equal(digest({version:1,project:'Alpha Tasks',task:projectTask,criteriaSha256}),v.tuple.tupleSha256);
 assert.equal(sha(v.tuple.objective),v.tuple.objectiveSha256);
 assert.equal(v.envelope.document.work.objectiveSha256,v.tuple.objectiveSha256);
 assert.equal(digest({version:1,files:v.installation.source.allowedFiles}),v.allowedFilesSha256);
 assert.equal(v.envelope.document.source.allowedFilesSha256,v.allowedFilesSha256);
});

test('canonical JSON and digests agree on every vector except the documented integer-like-key divergence',()=>{
 for(const c of v.canonicalVectors){
  if(c.expectDivergence){
   // MyEve (engine-ordered Object.fromEntries) and the Factory (string-sorted) differ ONLY for integer-like keys.
   // No signed field can carry such a key (strict schemas on both sides); see CONFORMANCE-DISCREPANCIES.md #1.
   assert.notEqual(digest(c.value),c.sha256,'divergence disappeared: update the discrepancy record');
   assert.equal(canonical(c.value),'{"10":"a","9":"b"}');
   continue;
  }
  assert.equal(digest(c.value),c.sha256,c.name);
  assert.equal(canonical(c.value),c.canonical,c.name);
 }
});

test('the authority document digest, canonical bytes and signed bytes match MyEve; the Ed25519 signature verifies',()=>{
 const e=v.envelope;
 assert.equal(canonical(e.document),v.canonicalDocument);
 assert.equal(digest(e.document),e.authoritySha256);
 const signed=Buffer.concat([Buffer.from(AUTHORITY_SCHEMA),Buffer.from([0]),Buffer.from(e.authoritySha256,'ascii')]);
 assert.equal(signed.toString('hex'),v.signedBytesHex);
 const key=createPublicKey(v.testKey.publicKeyPem);
 assert.equal(keyIdOf(key),v.testKey.keyId);
 assert.equal(e.keyId,v.testKey.keyId);
 assert.match(e.signature,/^[A-Za-z0-9_-]{86}$/);
 assert.equal(verify(null,signed,key,Buffer.from(e.signature,'base64url')),true);
});

test('authority, request and writer ids are derived identically (uuid v8, variant a) from MyEve inputs',()=>{
 const d=v.envelope.document,ids=deriveIdentifiers({policySha256:d.policySha256,work:d.work,tupleSha256:d.project.tupleSha256});
 assert.deepEqual({idempotencyKey:ids.idempotencyKey,authorityId:ids.authorityId,requestId:ids.requestId,writerId:ids.writerId},
  {idempotencyKey:v.identifiers.idempotencyKey,authorityId:v.identifiers.authorityId,requestId:v.identifiers.requestId,writerId:v.identifiers.writerId});
 assert.equal(digest(v.identifiers.derivation.idempotencyKeyInput),ids.idempotencyKey);
 for(const id of [ids.authorityId,ids.requestId,ids.writerId])assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.equal(v.prepare.requestId,ids.requestId);
 assert.equal(v.envelope.document.candidateWriter.requestId,ids.requestId);
 assert.equal(v.envelope.document.candidateWriter.writerId,ids.writerId);
 // MyEve Work ids are version-4: the Factory parser admits them; the derived request id needs the explicit grant flag.
 assert.match(v.prepare.workId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('the real MyEve prepare request body is accepted by parseCloudPrepare and by the Factory validator',()=>{
 const parsed=admit(v.envelope,v.prepare);
 assert.deepEqual(parsed,v.prepare); // structurally identical: no field is dropped or rewritten
 assert.equal(parsed.input.checkCommands.length,1);
 assert.ok(v.prepareBodyBytes<16384,'authority + prepare body stays far below the route bound');
 // Without the external-alpha grant flag the version-8 request id is refused (no widening of canary/production paths).
 assert.throws(()=>parseCloudPrepare(v.prepare,{...grant,derivedRequestId:undefined},AT),/INVALID_CLOUD_REQUEST/);
 assert.throws(()=>parseCloudPrepare(v.prepare,(({derivedRequestId,...g})=>g)(grant),AT),/INVALID_CLOUD_REQUEST/);
 // Clock edges use the Factory clock, not the document alone.
 assert.equal(verdict(()=>admit(v.envelope,v.prepare,v.nowMs-1)),'AUTHORITY_NOT_YET_VALID');
 assert.equal(verdict(()=>admit(v.envelope,v.prepare,Date.parse(v.envelope.document.expiresAt))),'AUTHORITY_EXPIRED');
 assert.equal(verdict(()=>validateExternalAlphaAuthority(v.envelope,v.prepare,inst,Date.parse(v.envelope.document.expiresAt)-1)),'ACCEPTED');
});

// Expected Factory decision per mutated field, derived from the contract (sections 5 and 8), NOT from observed behaviour.
// ACCEPTED rows are fields the authority deliberately does not pin to a single value (a signed shorter/longer window
// within the Factory ceiling, or an earlier request deadline); they are re-checked for single consumption below.
const rules=[
 [/^envelope:/,'AUTHORITY_SIGNATURE'],
 // document: value flips
 [/^document:(schema|singleUse)$/,'AUTHORITY_SCHEMA'],
 [/^document:(authorityId|idempotencyKey|policySha256|work\.id|work\.version|work\.generation|project\.tupleSha256|candidateWriter\.(candidateSlot|writerId|requestId))$/,'AUTHORITY_IDENTIFIER'],
 [/^document:(cohortId|slot|ownerId|application\.clientId|application\.projectId)$/,'AUTHORITY_OWNER'],
 [/^document:source\.(repository|baseSha|treeSha|sourceDigest)$/,'AUTHORITY_SOURCE'],
 [/^document:source\.allowedFiles(\.\d+|\.dropped-last|\.reversed|\.extended)?$|^document:source\.allowedFilesSha256$/,'AUTHORITY_FILES'],
 [/^document:work\.(title|objectiveSha256)$/,'AUTHORITY_WORK'],
 [/^document:(work\.criteriaSha256|work\.criteriaCount|project\.name|project\.task|project\.criteriaSha256|verifier\.criteriaSha256)$/,'AUTHORITY_TUPLE'],
 [/^document:environment$/,'AUTHORITY_ENVIRONMENT'],
 [/^document:(executionProvider|harness\.(id|version))$/,'AUTHORITY_PROVIDER'],
 [/^document:factoryVersion$/,'AUTHORITY_FACTORY_VERSION'],
 [/^document:model\./,'AUTHORITY_MODEL'],
 [/^document:verifier\.(id|verifiesExactArtifact|trustProducer)$/,'AUTHORITY_VERIFIER'],
 [/^document:(allowedEffects|forbiddenEffects)(\.\d+|\.dropped-last|\.reversed|\.extended)$/,'AUTHORITY_EFFECTS'],
 [/^document:limits\./,'AUTHORITY_LIMITS'],
 [/^document:(issuedAt|notBefore)$/,'AUTHORITY_SCHEMA'],
 [/^document:expiresAt$/,'ACCEPTED'],
 // document: structure
 [/^document:\+unknown@(limits|limits\.work|limits\.factory)$/,'AUTHORITY_LIMITS'],
 [/^document:\+unknown@/,'AUTHORITY_SCHEMA'],
 [/^document:-limits\.(work|factory)\.|^document:-limits\.(productiveSeconds|candidates|writers)$/,'AUTHORITY_LIMITS'],
 [/^document:-/,'AUTHORITY_SCHEMA'],
 // prepare
 [/^prepare:(protocol|-protocol|\+unknown@.*)$/,'INVALID_CLOUD_REQUEST'],
 [/^prepare:(requestId|-requestId)$/,'AUTHORITY_IDENTIFIER'],
 [/^prepare:(workId|workGeneration|-workId|-workGeneration|input\.title|input\.description|input\.kind|-input\.title|-input\.description|-input\.kind)$/,'AUTHORITY_WORK'],
 [/^prepare:(repository|-repository|source\.repository|source\.commit|source\.tree|-source\.repository|-source\.commit|-source\.tree)$/,'AUTHORITY_SOURCE'],
 [/^prepare:(deadline)$/,'ACCEPTED'],
 [/^prepare:-deadline$/,'AUTHORITY_EXPIRED'],
 [/^prepare:(maxSpendUsd|-maxSpendUsd)$/,'AUTHORITY_LIMITS'],
 [/^prepare:(input\.acceptanceCriteria\.\d+|acceptanceCriteria\.[a-z-]+|-input\.acceptanceCriteria)$/,'AUTHORITY_TUPLE'],
 [/^prepare:(input\.checkCommands\.\d+|-input\.checkCommands|checkCommands\.extended|input\.allowedPaths\.\d+|-input\.allowedPaths|allowedPaths\.widened)$/,'AUTHORITY_FILES'],
 [/^prepare:allowedPaths\.unsorted$/,'CLOUD_CAPABILITIES_NOT_GRANTED'],
];
const expectedFor=name=>{for(const [re,code] of rules)if(re.test(name))return code;throw Error('NO EXPECTATION FOR '+name);};

test('every bound field of the MyEve document, envelope and prepare body is enforced one mutation at a time',()=>{
 const seen={};
 for(const m of v.mutations){
  const {envelope,prepare}=applyMutation(v,m);
  if(m.target==='document')assert.equal(digest(envelope.document),m.authoritySha256,m.name+' (patch must reproduce the signed digest)');
  const got=verdict(()=>admit(envelope,prepare)),want=expectedFor(m.name);
  assert.equal(got,want,m.name);
  seen[want]=(seen[want]??0)+1;
 }
 for(const code of ['AUTHORITY_SCHEMA','AUTHORITY_SIGNATURE','AUTHORITY_IDENTIFIER','AUTHORITY_OWNER','AUTHORITY_SOURCE','AUTHORITY_FILES','AUTHORITY_WORK','AUTHORITY_TUPLE','AUTHORITY_ENVIRONMENT','AUTHORITY_PROVIDER','AUTHORITY_FACTORY_VERSION','AUTHORITY_MODEL','AUTHORITY_VERIFIER','AUTHORITY_EFFECTS','AUTHORITY_LIMITS','AUTHORITY_EXPIRED','INVALID_CLOUD_REQUEST'])
  assert.ok(seen[code]>0,'no mutation exercised '+code);
 // Re-signed document mutations really are signed by the pinned key: they fail on the field, not on the signature.
 const resigned=v.mutations.filter(m=>m.target==='document');
 assert.ok(resigned.length>130);
 assert.ok(resigned.filter(m=>expectedFor(m.name)!=='AUTHORITY_SIGNATURE').length===resigned.length);
});

function assertMyEveReadbackOutcomes(current){
 const cases=current.readback.cases;
 assert.deepEqual(cases.filter(c=>c.outcome==='ACCEPTED').map(c=>c.name),['valid','extra-passthrough-fields','unsigned-compatibility-fields']);
 for(const c of cases){
  if(c.outcome==='ACCEPTED')assert.deepEqual(c.verified,{state:'RUNNING',quiescent:false,spendDigest:digest(c.value.readbackAttestation.spend)},c.name);
  else assert.ok(['EXTERNAL_ALPHA_RECEIPT_INVALID','EXTERNAL_ALPHA_READBACK_UNVERIFIED'].includes(c.outcome),c.name+': '+c.outcome);
 }
}

test('real Factory challenged readback: MyEve accepts signed bindings and denies receipt-only or tampered attestation',()=>{
 const key=createPublicKey(v.testKey.publicKeyPem),rb=v.readback;
 assert.equal(rb.receiptDomain,RECEIPT_SCHEMA);
 const factoryVerifies=r=>{try{return verify(null,Buffer.concat([Buffer.from(RECEIPT_SCHEMA),Buffer.from([0]),Buffer.from(digest(r.authorityReceipt))]),key,Buffer.from(r.authorityReceiptSignature,'base64url'))
  &&r.authorityReceipt.authorityId===v.identifiers.authorityId&&r.authorityReceipt.authoritySha256===v.envelope.authoritySha256&&r.authorityReceipt.requestId===v.identifiers.requestId&&r.requestId===v.identifiers.requestId
  &&verify(null,Buffer.concat([Buffer.from(READBACK_SCHEMA),Buffer.from([0]),Buffer.from(digest(r.readbackAttestation))]),key,Buffer.from(r.readbackSignature,'base64url'))
  &&r.readbackAttestation.challenge===rb.challenge&&r.readbackAttestation.receiptDigest===digest(r.authorityReceipt)
  &&r.readbackAttestation.requestDigest===rb.binding.requestDigest&&r.readbackAttestation.admittedDeadline===rb.binding.admittedDeadline
  &&r.readbackAttestation.spendDigest===digest(r.readbackAttestation.spend);}catch{return false;}};
 for(const c of rb.cases){
  // Outcomes were produced by running MyEve's own verifyReadback; the Factory's receipt format must agree on accept/reject.
  // schema-only rejections (state enum, missing/null receipt) are MyEve response-shape checks, not receipt cryptography
  if(!['unknown-state','missing-signature','null-receipt'].includes(c.name))assert.equal(factoryVerifies(c.value),c.outcome==='ACCEPTED',c.name);
 }
 assertMyEveReadbackOutcomes(v);
 assert.match(rb.cases[0].value.authorityReceiptSignature,/^[A-Za-z0-9_-]{86}$/);
});

// Opt-in: MYEVE_CHECKOUT=<throwaway copy of a MyEve checkout with node_modules>. Regenerates at the current clock.
test('LIVE: a fresh MyEve checkout still produces vectors this Factory accepts',{skip:!process.env.MYEVE_CHECKOUT},()=>{
 const live=regenerateLive(process.env.MYEVE_CHECKOUT),inst2=installationOf(live),grant2=grantFor(inst2),at=live.nowMs+1000;
 assert.deepEqual(live.installation,v.installation);
 assert.equal(live.tuple.tupleSha256,v.tuple.tupleSha256);
 assertMyEveReadbackOutcomes(live);
 validateExternalAlphaAuthority(live.envelope,live.prepare,inst2,at);
 assert.deepEqual(parseCloudPrepare(live.prepare,grant2,at),live.prepare);
});
