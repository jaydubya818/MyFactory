import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppReferenceController, EMPTY_APP_SOURCE_COMMIT } from '../src/myapps/controller.mjs';
const myeve=process.env.MYEVE_SOURCE_ROOT;
test('deterministic App candidate custody, separate verifier, duplicate delivery and restart', {skip:!myeve}, async()=>{
 const {makePackage}=await import(pathToFileURL(resolve(myeve,'packages/myapps/test/fixtures.mjs')).href);
 const directory=mkdtempSync(join(tmpdir(),'factory-myapps-'));const pkg=makePackage();pkg.source.repositoryCommit=EMPTY_APP_SOURCE_COMMIT;let active=true;
 const options={myeveRoot:myeve,custodyDirectory:directory,authorize:async work=>active&&work.ownerId===pkg.work.ownerId&&work.workId===pkg.work.workId};
 let controller=await AppReferenceController.open(options);
 try{
  const run=await controller.build({creationIntent:'crm-request-1',pkg});assert.equal(run.status,'CANDIDATE');assert.equal(run.producerStopped,true);
  assert.deepEqual(await controller.build({creationIntent:'crm-request-1',pkg}),run);
  assert.throws(()=>controller.readCandidate('foreign',run.id),/APP_UNAVAILABLE/);
  const result=await controller.verify(pkg.spec.ownerId,run.id);assert.equal(result.status,'PASS');assert.equal(result.cleanupConfirmed,true);assert.ok(result.claims.includes('metrics-derived'));
  assert.deepEqual(await controller.verify(pkg.spec.ownerId,run.id),result);
  controller.close();controller=await AppReferenceController.open(options);
  assert.deepEqual(await controller.build({creationIntent:'crm-request-1',pkg}),run);
  assert.deepEqual(await controller.verify(pkg.spec.ownerId,run.id),result);
  active=false;await assert.rejects(controller.build({creationIntent:'crm-request-1',pkg}),/AUTHORITY_DENIED/);active=true;
  const path=join(directory,run.id+'.json'),original=JSON.parse(readFileSync(path,'utf8'));original.source.candidateId='substituted';chmodSync(path,0o600);writeFileSync(path,JSON.stringify(original));
  assert.throws(()=>controller.readCandidate(pkg.spec.ownerId,run.id),/SUBSTITUTION/);
 }finally{controller.close();rmSync(directory,{recursive:true});}
});
test('App builder requires independent Work authority and rejects malicious declarations', {skip:!myeve}, async()=>{
 const {makePackage}=await import(pathToFileURL(resolve(myeve,'packages/myapps/test/fixtures.mjs')).href);
 const directory=mkdtempSync(join(tmpdir(),'factory-myapps-denial-'));
 const controller=await AppReferenceController.open({myeveRoot:myeve,custodyDirectory:directory,authorize:async()=>false});
 try{await assert.rejects(controller.build({creationIntent:'crm-request-1',pkg:makePackage()}),/AUTHORITY_DENIED/);const pkg=makePackage();pkg.source.repositoryCommit=EMPTY_APP_SOURCE_COMMIT;pkg.spec.network.hosts=['attacker.invalid'];await assert.rejects(controller.build({creationIntent:'crm-request-1',pkg}),/APP_SPEC_UNSUPPORTED/);}
 finally{controller.close();rmSync(directory,{recursive:true});}
});
test('App Result uses existing signature, artifact, correlation and duplicate-delivery verification', {skip:!myeve}, async()=>{
 const {generateKeyPairSync}=await import('node:crypto');const {digest}=await import('../../hosted-routing/src/result.ts');
 const {appResult,verifyAppResult,referenceConfiguration}=await import('../src/myapps/result.mjs');
 const {makePackage}=await import(pathToFileURL(resolve(myeve,'packages/myapps/test/fixtures.mjs')).href);
 const directory=mkdtempSync(join(tmpdir(),'factory-myapps-result-')),controller=await AppReferenceController.open({myeveRoot:myeve,custodyDirectory:directory,authorize:async()=>true});
 try{
  const pkg=makePackage();pkg.source.repositoryCommit=EMPTY_APP_SOURCE_COMMIT;pkg.factoryVersion.configurationDigest='sha256:'+digest(referenceConfiguration());
  const run=await controller.build({creationIntent:'crm-request-1',pkg}),verification=await controller.verify(pkg.spec.ownerId,run.id);
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),issuedAt='2026-10-08T12:00:00.000Z';
  const signed=appResult({pkg,run,verification,privateKey,keyId:'synthetic-key',issuedAt});
  const keys=[{factoryId:'myapps-reference-factory',keyId:'synthetic-key',publicKey:publicKey.export({type:'spki',format:'pem'}),activeFrom:'2026-10-08T00:00:00.000Z',notAfter:'2026-10-09T00:00:00.000Z'}];
  const input={signed,pkg,run,keys,now:Date.parse(issuedAt)};
  assert.equal(verifyAppResult(input).manifest.status,'COMPLETED');
  assert.throws(()=>verifyAppResult({...input,pkg:{...pkg,work:{...pkg.work,workId:'other-work'}}}),/correlation/);
  assert.throws(()=>verifyAppResult({...input,signed:{...signed,signature:signed.signature.slice(2)}}),/signature/);
 }finally{controller.close();rmSync(directory,{recursive:true});}
});
