import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {externalAlphaRuntimeComponents,externalAlphaFactoryVersion} from '../src/external-alpha-runtime.mjs';
import {consumeExternalAlphaDelivery,externalAlphaWorkTopic} from '../src/external-alpha-delivery.mjs';
import {externalAlphaIdentity} from '../src/external-alpha-control.mjs';
import {bindAuthorityEnvelope,receiptSigner} from '../src/external-alpha-authority.mjs';
import {readbackSigner} from '../src/external-alpha-readback.mjs';
import {productionVerifierPolicy as policy,productionVerifierPolicySha256 as policySha256} from '../src/production-verifier-policy.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {makeInstallation,makeKeys,build,runtimePrivateSource} from './fixtures/external-alpha-authority.mjs';

const skip=process.env.FACTORY_POSTGRES_TEST!=='1';
async function setup(t,{queueUnknown=false}={}){
 const url=new URL(process.env.DATABASE_URL_UNPOOLED);assert(['localhost','127.0.0.1'].includes(url.hostname));
 const pool=new pg.Pool({connectionString:url.href,max:12}),schema='ea_delivery_'+randomUUID().replaceAll('-','');
 await pool.query('CREATE SCHEMA '+schema);
 const rewrite=sql=>sql.replace(/(?<!')\bfactory\./g,schema+'.').replace(/IN SCHEMA factory\b/g,'IN SCHEMA '+schema);
 const query=(sql,args)=>pool.query(rewrite(sql),args),isolated={connect:async()=>{const c=await pool.connect();return{query:(sql,args)=>c.query(rewrite(sql),args),release:()=>c.release()};}};
 t.after(async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();});
 for(const m of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification','009-paid-operation-release','011-external-alpha-work-authority'])await query(await readFile(new URL('../migrations/'+m+'.sql',import.meta.url),'utf8'));
 const initial=makeInstallation(),ctx=makeInstallation(initial.keys,{...initial.config,factoryVersion:externalAlphaFactoryVersion(initial.installation,initial.config.source.sourceDigest,policySha256)}),keys=makeKeys();
 const signing={factoryId:'myfactory-external-alpha',privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}),key:{factoryId:'myfactory-external-alpha',keyId:'external-alpha-result-v1',publicKey:keys.publicKeyPem,activeFrom:'2020-01-01T00:00:00Z',notAfter:'2100-01-01T00:00:00Z'}};
 const calls={allocate:0,execute:0,destroy:0},sent=[];
 // Deterministic provider failure fixture: executes the real lifecycle without contacting any model or sandbox provider.
 const provider={allocate:async()=>{calls.allocate++;return{currentSession:()=>({sessionId:'sbx_fixture'})};},materialize:async()=>({commit:ctx.config.source.baseSha,tree:ctx.config.source.treeSha}),execute:async()=>{calls.execute++;throw Error('DETERMINISTIC_EXECUTION_FAILURE');},destroy:async()=>{calls.destroy++;}};
 const queue={send:async(topic,payload)=>{sent.push({topic,payload});if(queueUnknown&&topic===externalAlphaWorkTopic)throw Error('ACK_LOST');return{messageId:'message-'+sent.length};}};
 const runtimeDeps={...runtimePrivateSource(ctx.installation),pool:isolated,queue,installation:ctx.installation,signing,sourceDigest:ctx.config.source.sourceDigest,signReceipt:receiptSigner(keys.privateKey.export({type:'pkcs8',format:'pem'})),signReadback:readbackSigner(keys.privateKey.export({type:'pkcs8',format:'pem'})),provider,verification:{policy,policySha256,provider:{}},deploymentId:'dpl_fixture'};let runtime=externalAlphaRuntimeComponents(runtimeDeps);
 const env={FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify([ctx.config]),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:digest([ctx.installation.sha256]),VERCEL_DEPLOYMENT_ID:'dpl_fixture'},a=build(ctx);
 await runtime.control.prepare(bindAuthorityEnvelope(a.prepare,a.envelope));
 const row=await runtime.store.read(runtime.clientId,a.prepare.requestId),identity=externalAlphaIdentity(row);
 const deliver=(payload=sent[0].payload,metadata={topicName:externalAlphaWorkTopic,region:'iad1',messageId:'message-1'})=>consumeExternalAlphaDelivery(env,payload,metadata,false,{withRuntime:async(_e,_i,action)=>action(runtime)});
 return{query,ctx,a,get runtime(){return runtime;},restart:()=>{runtime=externalAlphaRuntimeComponents(runtimeDeps);},env,calls,sent,identity,deliver};
}
test('real admitted dispatch executes once, cleans up, signs terminal truth and replays after restart',{skip},async t=>{
 const f=await setup(t);await Promise.all(Array.from({length:6},()=>f.runtime.control.dispatch(f.identity)));
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].topic,externalAlphaWorkTopic);
 await f.deliver();assert.deepEqual(f.calls,{allocate:1,execute:1,destroy:1});
 const read=await f.runtime.readbackWithReceipt(f.a.prepare.requestId,'a'.repeat(32));
 assert.equal(read.readbackAttestation.state,'FAILED');assert.equal(read.readbackAttestation.quiescent,true);
 f.restart();for(let n=0;n<4;n++)await f.deliver();assert.deepEqual(f.calls,{allocate:1,execute:1,destroy:1});
 assert.equal((await f.query("SELECT count(*)::int n FROM factory.events WHERE type='run.signed_result'")).rows[0].n,1);
});
test('cancellation before delivery allocates nothing and retains one CANCELLED terminal Result',{skip},async t=>{
 const f=await setup(t);await f.runtime.control.dispatch(f.identity);await f.runtime.store.stop(f.runtime.clientId,f.identity);
 await f.deliver();assert.deepEqual(f.calls,{allocate:0,execute:0,destroy:0});
 assert.equal((await f.runtime.control.read(f.a.prepare.requestId)).state,'CANCELLED');
 await f.deliver();assert.equal((await f.query("SELECT count(*)::int n FROM factory.events WHERE type='run.signed_result'")).rows[0].n,1);
});
test('lost queue acknowledgment fences the consumed authority and never retries productive dispatch',{skip},async t=>{
 const f=await setup(t,{queueUnknown:true});await f.runtime.control.dispatch(f.identity);
 const row=(await f.query('SELECT state,state_reason FROM factory.external_alpha_work_authority')).rows[0];
 assert.deepEqual(row,{state:'UNKNOWN',state_reason:'DELIVERY_UNKNOWN'});
 await assert.rejects(f.deliver(),/^Error: DELIVERY_BINDING_MISMATCH$/);
 assert.deepEqual(f.calls,{allocate:0,execute:0,destroy:0});
 assert.equal((await f.query('SELECT state FROM factory.delivery_intents')).rows[0].state,'UNKNOWN');
 assert.deepEqual((await f.query('SELECT state,state_reason FROM factory.external_alpha_work_authority')).rows[0],row);
 assert.equal((await f.query('SELECT count(*)::int n FROM factory.execution_resources')).rows[0].n,0);
 await assert.rejects(f.runtime.control.dispatch(f.identity),/AUTHORITY_UNKNOWN_FENCE|SPEND_AUTHORITY|Active exact Work authority/);assert.equal(f.sent.length,1);
});
test('foreign nonce or deployment cannot accept the stored delivery or allocate',{skip},async t=>{
 const f=await setup(t);await f.runtime.control.dispatch(f.identity);
 await assert.rejects(f.deliver({...f.sent[0].payload,nonce:'f'.repeat(64)}),/DELIVERY_BINDING_MISMATCH/);
 await assert.rejects(consumeExternalAlphaDelivery({...f.env,VERCEL_DEPLOYMENT_ID:'dpl_other'},f.sent[0].payload,{topicName:externalAlphaWorkTopic,region:'iad1',messageId:'message-1'},false,{withRuntime:async(_e,_i,action)=>action(f.runtime)}),/DELIVERY_BINDING_MISMATCH/);
 assert.equal(f.calls.allocate,0);
});
