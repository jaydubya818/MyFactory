// Public tiny data and trusted deferred HTTP reads only. No native experiment,
// actual candidate execution, protected material or financial authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateLocalV4CandidateMaterial,LocalV4CandidatePolicy,candidatePolicyKind,candidatePolicyFailure} from '../src/local-v4-candidate-policy.ts';
import {LocalV4ServiceProducer} from '../src/service-producer.ts';
import {createLocalV4Supervisor} from '../src/server.ts';
import {ActionError} from '../src/actions.ts';
import {openStorage} from '../../../packages/storage/src/index.ts';

const objectHash=(kind,bytes)=>createHash('sha1').update(kind+' '+bytes.length+'\0').update(bytes).digest('hex');
function material(){
 const base='1'.repeat(40),blob=Buffer.from('after\n'),rawTree=Buffer.concat([Buffer.from('100644 sample.txt\0'),Buffer.from(objectHash('blob',blob),'hex')]);
 const tree=objectHash('tree',rawTree),rawCommit=Buffer.from(`tree ${tree}\nparent ${base}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nPublic tiny format fixture\n`);
 return {base:{inputCommit:base,inputTree:'2'.repeat(40),files:{'sample.txt':'before\n'}},candidate:{inputCommit:objectHash('commit',rawCommit),inputTree:tree,files:{'sample.txt':'after\n'}},rawCommit,rawTree,patch:Buffer.from('diff --git a/sample.txt b/sample.txt\nindex 1111111..2222222 100644\n--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-before\n+after\n'),numstat:Buffer.from('1\t1\tsample.txt\0')};
}
test('candidate format data: authentic-shaped regular text bytes remain unchanged',()=>{
 const value=material(),before=structuredClone(value);validateLocalV4CandidateMaterial(value);assert.deepEqual(structuredClone(value),before);
});
for(const [name,change] of [
 ['empty patch',m=>m.patch=Buffer.alloc(0)],
 ['binary marker',m=>m.patch=Buffer.from('diff --git a/sample.txt b/sample.txt\nGIT binary patch\n')],
 ['rename headers',m=>m.patch=Buffer.from('diff --git a/sample.txt b/other.txt\nsimilarity index 100%\nrename from sample.txt\nrename to other.txt\n')],
 ['copy marker',m=>m.patch=Buffer.from('diff --git a/sample.txt b/sample.txt\ncopy from sample.txt\n')],
 ['executable mode',m=>m.patch=Buffer.from('diff --git a/sample.txt b/sample.txt\nnew file mode 100755\n')],
 ['mode transform',m=>m.patch=Buffer.from('diff --git a/sample.txt b/sample.txt\nold mode 100644\nnew mode 100755\n')],
 ['duplicate path',m=>m.patch=Buffer.concat([m.patch,m.patch])],
 ['unlisted changed path',m=>m.candidate.files['other.txt']='data'],
 ['mismatched numstat',m=>m.numstat=Buffer.from('1\t1\tother.txt\0')],
 ['binary numstat',m=>m.numstat=Buffer.from('-\t-\tsample.txt\0')],
 ['NUL patch',m=>m.patch=Buffer.concat([m.patch,Buffer.from([0])])],
 ['wrong raw tree',m=>m.rawTree=Buffer.from('different')],
 ['wrong raw commit',m=>m.rawCommit=Buffer.from('different')],
 ['unsafe patch path',m=>m.patch=Buffer.from('diff --git a/../sample.txt b/../sample.txt\n')],
])test('candidate format data: '+name+' refuses without native operations',()=>{
 const value=material();change(value);assert.throws(()=>validateLocalV4CandidateMaterial(value),error=>error.code==='candidate_policy_hold'&&candidatePolicyKind(error)==='unsupported');
});
test('candidate format data: different or duplicate parent cannot replace the original input',()=>{
 for(const parent of ['f'.repeat(40),'1'.repeat(40)+'\nparent '+'f'.repeat(40)]){
  const value=material();value.rawCommit=Buffer.from(value.rawCommit.toString().replace('parent '+'1'.repeat(40),'parent '+parent));value.candidate.inputCommit=objectHash('commit',value.rawCommit);
  assert.throws(()=>validateLocalV4CandidateMaterial(value),{code:'candidate_policy_hold'});
 }
});
test('candidate format data: lossless commit text is mandatory without rewriting the object',()=>{
 const value=material();value.rawCommit=Buffer.concat([value.rawCommit,Buffer.from([0xc3,0x28])]);value.candidate.inputCommit=objectHash('commit',value.rawCommit);
 assert.throws(()=>validateLocalV4CandidateMaterial(value),{code:'candidate_policy_hold'});
});
test('candidate guard: pure objects and serialized or cloned data cannot mint native custody',t=>{
 const dir=mkdtempSync(join(tmpdir(),'candidate-opaque-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const policy=new LocalV4CandidatePolicy(dir);
 for(const forged of [{},Object.freeze({}),structuredClone({}),JSON.parse('{}')])assert.throws(()=>policy.consume(forged,'read','binding',{},'run'),{code:'candidate_policy_hold'});
 assert.equal(candidatePolicyKind(new Error('LOCAL_V4_CANDIDATE_FORMAT_UNSUPPORTED')),null);
 assert.equal(candidatePolicyKind(candidatePolicyFailure(new Error('unknown'))),'uncertain');
});

async function deferredRead(t,reject){
 const dir=mkdtempSync(join(tmpdir(),'candidate-auth-')),storage=openStorage(join(dir,'factory.sqlite'));
 const created=storage.createWorkOrder({title:'Public deferred read authority fixture',description:'No native or worker operation',kind:'feature',repositoryPath:dir,baseRef:'1'.repeat(40),acceptanceCriteria:['No stale disclosure'],reproductionCommand:null,expectedFailureText:null,checkCommands:['never-executed'],allowedPaths:['sample.txt'],workerProfile:'mac'});
 const work=storage.getWorkOrder(created.id),initial=storage.createRun({workOrderId:work.id,workerProfile:'mac',inputCommit:'1'.repeat(40),workspacePath:dir});
 const run=storage.saveRun({...initial,state:'failed',finishedAt:new Date().toISOString()});
 storage.appendEvent({workOrderId:work.id,runId:null,type:'factory.owner_scope_bound',payload:{clientId:'original',ownerScope:'owner:fixture'}});storage.close();
 const pair=generateKeyPairSync('ed25519'),key={factoryId:'public-deferred-read',keyId:'ephemeral',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const token='a'.repeat(64),clients=[{id:'original',name:'Public fixture',tokenSha256:createHash('sha256').update(token).digest('hex'),ownerScope:'owner:fixture',actions:['factory.observe','factory.stop'],repositoryPaths:[dir]}];
 const save=()=>writeFileSync(join(dir,'connections.json'),JSON.stringify({clients}));save();
 let release,entered;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 const original=LocalV4ServiceProducer.prototype.read;
 LocalV4ServiceProducer.prototype.read=function(){entered();return held.then(()=>{if(reject)throw new ActionError('Synthetic deferred candidate state','synthetic_candidate_hold',503);return {state:'FAILED',result:null}})};
 const supervisor=createLocalV4Supervisor({dataDir:dir,resultSigning:{factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]}});
 await new Promise((resolve,reject)=>{supervisor.server.once('error',reject);supervisor.server.listen(0,'127.0.0.1',resolve)});
 t.after(async()=>{release();LocalV4ServiceProducer.prototype.read=original;await supervisor.close();rmSync(dir,{recursive:true,force:true})});
 const pending=fetch('http://127.0.0.1:'+supervisor.server.address().port+`/api/connect/v1/work-orders/${work.id}/runs/${run.id}/result`,{headers:{authorization:'Bearer '+token}}).then(async response=>({status:response.status,body:await response.json()}));
 await ready;return {clients,save,release,pending,supervisor,work,run};
}
for(const rejection of [false,true])for(const variant of ['remove','token','owner','client','purpose','grant','repository','work-repository','expiry','nonfinite-expiry'])test(`candidate awaited ${rejection?'refusal':'success'}: current ${variant} authority is checked before disclosure`,async t=>{
 const f=await deferredRead(t,rejection),client=f.clients[0];
 if(variant==='remove')f.clients.length=0;
 if(variant==='token')client.tokenSha256=createHash('sha256').update('b'.repeat(64)).digest('hex');
 if(variant==='owner')client.ownerScope='owner:other';
 if(variant==='client')client.id='replacement';
 if(variant==='purpose'){client.purpose='myeve-proof';client.expiresAt='2099-01-01T00:00:00Z';client.actions=['evidence.read']}
 if(variant==='grant')client.actions=['factory.stop'];
 if(variant==='repository')client.repositoryPaths=['/private/tmp'];
 if(variant==='work-repository')f.supervisor.storage.saveWorkOrder({...f.work,repositoryPath:'/private/tmp'});
 if(variant==='expiry')client.expiresAt='2020-01-01T00:00:00Z';
 if(variant==='nonfinite-expiry')client.expiresAt='not-a-date';
 f.save();f.release();const response=await f.pending;assert([401,403,404].includes(response.status));assert.equal(response.body.result,undefined);assert.notEqual(response.body.code,'synthetic_candidate_hold');assert.notEqual(response.body.error,'Synthetic deferred candidate state');
});
for(const reject of [false,true])test(`candidate awaited ${reject?'refusal':'success'}: unchanged ordinary owner retains optional expiry semantics`,async t=>{
 const f=await deferredRead(t,reject);f.release();const response=await f.pending;assert.equal(response.status,reject?503:200);
 if(reject)assert.equal(response.body.code,'synthetic_candidate_hold');else assert.deepEqual(response.body,{state:'FAILED',result:null});
});
