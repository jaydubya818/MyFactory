import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {consumeExternalAlphaDelivery,externalAlphaWorkTopic,externalAlphaRecoveryTopic} from '../src/external-alpha-delivery.mjs';
import {makeInstallation} from './fixtures/external-alpha-authority.mjs';

const setup=()=>{
 const a=makeInstallation(),b=makeInstallation(a.keys,{...a.config,slot:'2',ownerId:'owner-two',application:{clientId:'external-alpha-'+'b'.repeat(32),projectId:'prj_two'},source:{...a.config.source,repository:'fixture-org/fixture-two'},caller:{...a.config.caller,credentialSha256:'c'.repeat(64),oidc:{...a.config.caller.oidc,subject:'owner:fixture-team:project:two:environment:production'}}});
 const env={FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify([a.config,b.config]),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:digest([a.installation.sha256,b.installation.sha256]),VERCEL_DEPLOYMENT_ID:'dpl_fixture'};
 const payload={version:1,runId:randomUUID(),nonce:'a'.repeat(64)},metadata={topicName:externalAlphaWorkTopic,region:'iad1',messageId:'fixture-delivery'};
 return {a,b,env,payload,metadata};
};
test('untrusted delivery cannot choose owner, project, source, command, region or legacy topic',async()=>{
 const f=setup();let opened=0;const deps={withRuntime:async()=>{opened++;throw Error('MUST_NOT_OPEN');}};
 for(const p of [{...f.payload,slot:'2'},{...f.payload,command:'arbitrary'},{...f.payload,nonce:'x'},null])await assert.rejects(consumeExternalAlphaDelivery(f.env,p,f.metadata,false,deps),/INVALID_DELIVERY/);
 for(const m of [{...f.metadata,topicName:'factory-production-work-v1'},{...f.metadata,region:'sfo1'},null])await assert.rejects(consumeExternalAlphaDelivery(f.env,f.payload,m,false,deps),/INVALID_DELIVERY/);
 assert.equal(opened,0);
});
test('delivery resolves only the stored installation and replays terminal Result without execution',async()=>{
 const f=setup(),seen=[];let signed=0;
 const withRuntime=async(_env,installation,action)=>action({clientId:installation.application.clientId,installation,topics:{work:externalAlphaWorkTopic,recovery:externalAlphaRecoveryTopic},
  authority:{withClient:fn=>fn({query:async(_sql,args)=>{seen.push(args);return{rows:installation.slot==='2'?[{request_id:'request-two'}]:[]};}}),ownedRow:async()=>({})},
  store:{acceptDelivery:async(run,deployment,nonce,message)=>{assert.equal(run,f.payload.runId);assert.equal(deployment,f.env.VERCEL_DEPLOYMENT_ID);assert.equal(nonce,f.payload.nonce);assert.equal(message,f.metadata.messageId);return{client_id:installation.application.clientId,request_id:'request-two',identity:{}};},read:async()=>({resource:{cleanup_confirmed:true},events:[{type:'factory.terminal'}]})},
  provider:{allocate:()=>{throw Error('MUST_NOT_ALLOCATE');}},control:{result:async()=>{signed++;}}});
 await consumeExternalAlphaDelivery(f.env,f.payload,f.metadata,false,{withRuntime});
 assert.equal(signed,1);assert.deepEqual(seen.map(x=>x[1]),[f.a.config.application.clientId,f.b.config.application.clientId]);
});
test('absent installation and foreign run are binding denials, never a legacy fallback',async()=>{
 const f=setup();await assert.rejects(consumeExternalAlphaDelivery({},f.payload,f.metadata),/DELIVERY_BINDING_MISMATCH/);
 const withRuntime=async(_e,i,action)=>action({clientId:i.application.clientId,authority:{withClient:fn=>fn({query:async()=>({rows:[]})})}});
 await assert.rejects(consumeExternalAlphaDelivery(f.env,f.payload,f.metadata,false,{withRuntime}),/DELIVERY_BINDING_MISMATCH/);
});
test('productive and cleanup queue triggers precede wildcard and preserve all legacy topics',async()=>{
 const v=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8')),names=Object.keys(v.functions);
 for(const [name,topic,duration] of [['external-alpha-work',externalAlphaWorkTopic,180],['external-alpha-queue-recovery',externalAlphaRecoveryTopic,60]]){
  const path='api/'+name+'.mjs';assert(names.indexOf(path)<names.indexOf('api/*.mjs'));
  assert.equal(v.functions[path].maxDuration,duration);assert.deepEqual(v.functions[path].experimentalTriggers,[{type:'queue/v2beta',topic}]);
 }
 assert.equal(v.functions['api/production-work.mjs'].experimentalTriggers[0].topic,'factory-production-work-v1');
 assert.equal(v.functions['api/alpha-work.mjs'].experimentalTriggers[0].topic,'factory-alpha-work-v1');
});
