import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {digest,operationId,validateManifest,signResult,verifyResult,RESULT_PROTOCOL} from '../../../packages/hosted-routing/src/result.ts';
import {qualifiedImage} from '../src/infrastructure-plan.mjs';
function manifest(){
 const configuration={model:'fixture-model',executor:'deterministic-qualification',executorVersion:'1',skillRevision:'none',workerProfile:'container',verificationImage:qualifiedImage,nodeVersion:'v24.19.0',platform:'linux',architecture:'x64',commands:['node --test'],allowedPaths:['slug.mjs'],timeoutMs:120000,cloud:{provider:'vercel-sandbox',providerVersion:'3.5.1',region:'iad1',workerImage:qualifiedImage,networkPolicy:'deny-all-after-materialization-v1',toolPolicySha256:'a'.repeat(64),contextPolicySha256:'b'.repeat(64),verificationPolicySha256:'c'.repeat(64),evidenceClass:'DETERMINISTIC',resources:{vcpus:1,memoryMb:2048,timeoutMs:120000,maxArtifactBytes:256000},skills:[]}};
 const configurationDigest=digest(configuration),sourceDigest='d'.repeat(64),at='2026-10-02T00:00:00.000Z';
 const execution={version:2,inputTree:'e'.repeat(40),factoryId:'staging-fixture',factoryVersion:digest({sourceDigest,configurationDigest}),sourceDigest,configurationDigest,configuration,requestId:randomUUID(),requestDigest:'f'.repeat(64),workOrderId:randomUUID(),runId:randomUUID(),attemptNumber:1,inputCommit:'a'.repeat(40),capturedAt:at};
 return{protocol:RESULT_PROTOCOL,keyId:'test',producer:execution.factoryId,operationId:operationId(execution),execution,status:'FAILED',candidate:null,evidence:[],artifacts:[],evidenceDigest:digest([]),artifactDigest:digest([]),completedAt:at,issuedAt:at};
}
test('signed cloud snapshot pins source tree, immutable image, policies, envelope and evidence class',()=>{
 const m=manifest(),pair=generateKeyPairSync('ed25519');
 const key={factoryId:m.producer,keyId:'test',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const signed=signResult(m,[],pair.privateKey),expected={keys:[key],factoryId:m.producer,requestId:m.execution.requestId,workOrderId:m.execution.workOrderId,runId:m.execution.runId,factoryVersion:m.execution.factoryVersion};
 assert.deepEqual(verifyResult(signed,expected).manifest,m);
 if(process.env.CLOUD_PROTOCOL_VECTOR_PATH)writeFileSync(process.env.CLOUD_PROTOCOL_VECTOR_PATH,JSON.stringify({purpose:'PUBLIC_SYNTHETIC_PROTOCOL_VECTOR_NO_AUTHORITY',signed,expected},null,2)+'\n');
 const changed=structuredClone(m);changed.execution.configuration.cloud.evidenceClass='LIVE';
 assert.throws(()=>validateManifest(changed),/version mismatch/);
});
test('cloud snapshot rejects mutable images, local profiles, missing policy/source and excess resources',()=>{
 for(const mutate of [m=>delete m.execution.inputTree,m=>m.execution.configuration.cloud.workerImage='vercel/sandbox/node:24',m=>m.execution.configuration.workerProfile='mac',m=>m.execution.configuration.cloud.resources.vcpus=8,m=>m.execution.configuration.cloud.resources.timeoutMs=1,m=>m.execution.configuration.cloud.toolPolicySha256='',m=>m.execution.configuration.cloud.skills=[{name:'unversioned'}],m=>m.execution.version=1]){
  const m=manifest();mutate(m);assert.throws(()=>validateManifest(m));
 }
});
