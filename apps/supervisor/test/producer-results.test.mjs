import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {JobManager} from '../src/jobs.ts';
import {ProducerResults,saveRunRecord,SNAPSHOT_EVENT,RESULT_EVENT,readRunRecord} from '../src/producer-results.ts';
import {canonical,digest,sha256,verifyResult,signResult,compareResults} from '../../../packages/hosted-routing/src/result.ts';
import {FactoryClient} from '../../../packages/client/src/index.ts';
import {EVIDENCE_LIMITS} from '../../../packages/verification/src/evidence.ts';

function signer(keyId='key-1') {
  const pair=generateKeyPairSync('ed25519');
  return {factoryId:'factory-local-test',currentKeyId:keyId,
    privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),
    keys:[{factoryId:'factory-local-test',keyId,publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'}]};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function deferred(){let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function finished(storage,id){for(let i=0;i<500;i++){const r=storage.getRun(id);if(r.finishedAt)return r;await sleep(10);}throw new Error('Attempt did not finish');}
async function fixture(t,{worker,verifier,notify=()=>{},signing=signer()}={}) {
  const dir=mkdtempSync(join(tmpdir(),'q37-producer-')), repo=join(dir,'repo');mkdirSync(repo);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Synthetic Q37');git('config','user.email','synthetic@example.invalid');
  writeFileSync(join(repo,'sample.txt'),'before\n');git('add','sample.txt');git('commit','-qm','Synthetic input');
  const storage=openStorage(join(dir,'factory.sqlite'));
  const producer=new ProducerResults(storage,dir,signing);
  const observed=[];
  const jobs=new JobManager(storage,dir,e=>notify(e,{storage,dir}),{
    preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-codex-1',workerProfile:'mac',error:null}),
    runCodex:async input=>{
      observed.push(input.model);
      if(worker)return worker(input);
      writeFileSync(join(input.workspacePath,'sample.txt'),'after\n');
      return {success:true,status:'completed',threadId:'synthetic',eventsPath:join(input.artifactsDir,'events.jsonl'),usage:null, factoryVersion:'UNTRUSTED_CALLBACK_VERSION'};
    },
    verifyCandidate:async input=>{
      if(verifier)return verifier(input);
      mkdirSync(input.artifactDir,{recursive:true});
      const checks=input.commands.map((command,i)=>{
        const logPath=join(input.artifactDir,`check-${i}.log`);writeFileSync(logPath,`Synthetic check ${i}\n`);
        const at=new Date().toISOString();
        return {candidateCommit:input.candidateSha,candidateTree:git('rev-parse',`${input.candidateSha}^{tree}`),command,status:'passed',exitCode:0,startedAt:at,finishedAt:at,logPath,reason:null};
      });
      return {checks,reason:null};
    },
  },producer);
  const order=storage.createWorkOrder({title:'Synthetic Q37',description:'Local fixture only',kind:'feature',repositoryPath:repo,baseRef:git('rev-parse','HEAD'),acceptanceCriteria:['Inspect returned bytes'],reproductionCommand:null,expectedFailureText:null,checkCommands:['check-one','check-two'],allowedPaths:['sample.txt'],workerProfile:'mac'});
  storage.appendEvent({workOrderId:order.id,runId:null,type:'hosted.intake_received',payload:{issueId:'11111111-1111-4111-a111-111111111111',actor:'connection:synthetic',transport:'synthetic-fixture'}});
  t.after(async()=>{await jobs.close();storage.close();rmSync(dir,{recursive:true,force:true});});
  return {dir,repo,storage,producer,jobs,order,signing,observed};
}
function expectation(f,s){return {keys:f.signing.keys,factoryId:s.factoryId,requestId:s.requestId,workOrderId:s.workOrderId,runId:s.runId,factoryVersion:s.factoryVersion};}
async function golden(t,options){const f=await fixture(t,options), run=await f.jobs.startRun(f.order);const snapshot=f.producer.snapshot(run);await finished(f.storage,run.id);await f.jobs.close();const read=f.producer.read(run);assert.ok(read.result);return {...f,run,snapshot,result:read.result,expected:expectation(f,snapshot)};}

test('Gateway model identity survives signed candidate provenance without normalization',async t=>{
  const previous=process.env.FACTORY_CODEX_MODEL;
  process.env.FACTORY_CODEX_MODEL='openai/gpt-5.4-mini';
  t.after(()=>{if(previous===undefined)delete process.env.FACTORY_CODEX_MODEL;else process.env.FACTORY_CODEX_MODEL=previous;});
  const f=await golden(t);
  const {manifest}=verifyResult(f.result,f.expected);
  assert.equal(manifest.execution.configuration.model,'openai/gpt-5.4-mini');
  assert.deepEqual(f.observed,['openai/gpt-5.4-mini']);
  assert.equal(manifest.status,'COMPLETED');
  assert.ok(manifest.candidate.commit);
});

test('golden producer admission captures actual F1 and returns independently verifiable C1/E1/E2 bytes',async t=>{
  const previous=process.env.FACTORY_CODEX_MODEL;process.env.FACTORY_CODEX_MODEL='synthetic-model-f1';
  t.after(()=>{if(previous===undefined)delete process.env.FACTORY_CODEX_MODEL;else process.env.FACTORY_CODEX_MODEL=previous;});
  const entered=deferred(),release=deferred();
  const f=await fixture(t,{worker:async input=>{entered.resolve();await release.promise;writeFileSync(join(input.workspacePath,'sample.txt'),'after\n');return {success:true,status:'completed',eventsPath:'unused',factoryVersion:'FRAUDULENT-F2'};}});
  const run=await f.jobs.startRun(f.order);await entered.promise;
  const before=f.producer.snapshot(run);assert.equal(before.configuration.model,'synthetic-model-f1');
  process.env.FACTORY_CODEX_MODEL='synthetic-model-f2';release.resolve();await finished(f.storage,run.id);await f.jobs.close();
  const result=f.producer.read(run).result, expected=expectation(f,before);
  const {manifest}=verifyResult(JSON.parse(JSON.stringify(result)),expected);
  assert.deepEqual(manifest.execution,before);assert.deepEqual(f.observed,['synthetic-model-f1']);
  assert.equal(manifest.status,'COMPLETED');assert.equal(manifest.evidence.length,2);assert.equal(manifest.artifacts.length,5);
  assert.notEqual(manifest.execution.factoryVersion,'FRAUDULENT-F2');
  assert.equal(Object.hasOwn(manifest,'ready'),false);assert.equal(Object.hasOwn(manifest,'writerAuthority'),false);
  assert.equal(readRunRecord(f.storage,run,RESULT_EVENT).manifestDigest,result.manifestDigest);
  const reopened=openStorage(join(f.dir,'factory.sqlite'));const observer=new ProducerResults(reopened,f.dir,f.signing);
  assert.deepEqual(observer.read(run).result,result);reopened.close();
  if(process.env.Q37_EVIDENCE_DIR){mkdirSync(process.env.Q37_EVIDENCE_DIR,{recursive:true});writeFileSync(join(process.env.Q37_EVIDENCE_DIR,'golden.json'),JSON.stringify({scope:'SYNTHETIC_PRODUCER_ONLY',expected,result,verification:{producer:'PASS',factoryVersion:'PASS',request:'PASS',candidate:'PASS',evidence:'PASS',artifacts:'PASS',signature:'PASS',consumerAuthority:0,liveFactory:'NOT_RUN'}},null,2)+'\n');}
  const second=await f.jobs.startRun(f.storage.getWorkOrder(f.order.id));await finished(f.storage,second.id);await f.jobs.close();
  assert.equal(f.producer.snapshot(second).configuration.model,'synthetic-model-f2');
  assert.notEqual(f.producer.snapshot(second).factoryVersion,before.factoryVersion);
  assert.deepEqual(f.producer.read(run).result,result); // Older attempt stays F1 after F2 exists.
});
test('immutable snapshot rejects wrong version and preserves the original',async t=>{
  const f=await golden(t);const changed=structuredClone(f.snapshot);changed.factoryVersion='f'.repeat(64);
  assert.throws(()=>saveRunRecord(f.storage,f.run,SNAPSHOT_EVENT,changed),/Conflicting/);
  assert.deepEqual(f.producer.snapshot(f.run),f.snapshot);
});
test('wrong request, WorkOrder, attempt, producer and expected version fail correlation',async t=>{
  const f=await golden(t);
  for(const key of ['requestId','workOrderId','runId','factoryId','factoryVersion'])assert.throws(()=>verifyResult(f.result,{...f.expected,[key]:'wrong'}));
});
test('changed candidate, artifact, evidence and manifest bytes are rejected',async t=>{
  const f=await golden(t);
  for(const id of ['candidate.commit','candidate.tree','candidate.patch',f.result.artifacts.at(-1).id]){
    const altered=structuredClone(f.result);altered.artifacts.find(a=>a.id===id).base64=Buffer.from('substituted').toString('base64');
    assert.throws(()=>verifyResult(altered,f.expected),/digest|size/i);
  }
  const altered=structuredClone(f.result), manifest=JSON.parse(Buffer.from(altered.encoded,'base64url').toString());
  manifest.evidence[0].command='forged';manifest.evidenceDigest=digest(manifest.evidence);
  altered.encoded=Buffer.from(canonical(manifest)).toString('base64url');altered.manifestDigest=digest(manifest);
  assert.throws(()=>verifyResult(altered,f.expected));
});
test('duplicate delivery and conflicting operation are distinguishable',async t=>{
  const f=await golden(t);assert.equal(compareResults(f.result,JSON.parse(JSON.stringify(f.result))),'DUPLICATE');
  assert.deepEqual(f.producer.read(f.run).result,f.result);
  const manifest=verifyResult(f.result,f.expected).manifest;manifest.status='FAILED';
  const conflict=signResult(manifest,f.result.artifacts,f.signing.privateKey);verifyResult(conflict,f.expected);
  assert.throws(()=>compareResults(f.result,conflict),/Conflicting/);
  assert.throws(()=>saveRunRecord(f.storage,f.run,RESULT_EVENT,conflict),/Conflicting/);
});
test('candidate or check-log mutation before freezing prevents signing',async t=>{
  for(const kind of ['patch','log']){
    const f=await fixture(t,{notify:(event,{storage})=>{
      if(event.type==='run.ready_for_review'){
        const path=kind==='patch'?storage.listEvents(event.workOrderId).find(e=>e.type==='run.candidate_committed').payload.diffPath:storage.listChecks(event.runId)[0].logPath;
        writeFileSync(path,'tampered before signing');
      }
    }});
    const run=await f.jobs.startRun(f.order);await finished(f.storage,run.id);await f.jobs.close();
    assert.equal(readRunRecord(f.storage,run,RESULT_EVENT),null);assert.throws(()=>f.producer.read(run),/changed/);
  }
});
test('unknown timeout produces UNKNOWN with no fabricated terminal receipt',async t=>{
  const f=await fixture(t,{worker:async()=>({success:false,status:'timed_out',error:'Outcome not known',eventsPath:'unused'})});
  const run=await f.jobs.startRun(f.order);await finished(f.storage,run.id);await f.jobs.close();
  assert.deepEqual(f.producer.read(run),{state:'UNKNOWN',result:null});assert.equal(f.producer.snapshot(run).runId,run.id);
  await assert.rejects(f.jobs.startRun(f.storage.getWorkOrder(f.order.id)),/held/);
});
test('unresolved baseline and candidate verification remain UNKNOWN with retry held',async t=>{
  for(const phase of ['baseline','candidate']){
    const f=await fixture(t,{verifier:async()=>({checks:[],reason:'Verifier outcome unresolved'})});
    if(phase==='baseline')Object.assign(f.order,{kind:'defect',reproductionCommand:'reproduce',expectedFailureText:'expected'});
    const run=await f.jobs.startRun(f.order);await finished(f.storage,run.id);await f.jobs.close();
    assert.deepEqual(f.producer.read(run),{state:'UNKNOWN',result:null});
    await assert.rejects(f.jobs.startRun(f.storage.getWorkOrder(f.order.id)),/held/);
    if(phase==='baseline')assert.equal(f.observed.length,0);
  }
});
test('cancellation is STOPPING until terminal and retains original version',async t=>{
  const entered=deferred(),release=deferred();
  const f=await fixture(t,{worker:async()=>{entered.resolve();await release.promise;return {success:false,status:'cancelled',eventsPath:'unused'};}});
  const run=await f.jobs.startRun(f.order);await entered.promise;const snapshot=f.producer.snapshot(run);
  await f.jobs.cancelRun(f.order);assert.deepEqual(f.producer.read(run),{state:'STOPPING',result:null});
  release.resolve();await finished(f.storage,run.id);await f.jobs.close();
  const read=f.producer.read(run);assert.equal(read.state,'CANCELLED');const result=verifyResult(read.result,expectation(f,snapshot));
  assert.equal(result.manifest.status,'CANCELLED');assert.deepEqual(result.manifest.execution,snapshot);
});
test('legacy attempts cannot be relabeled with current Factory configuration',async t=>{
  const f=await fixture(t);const run=f.storage.createRun({workOrderId:f.order.id,workerProfile:'mac',inputCommit:f.order.baseRef,workspacePath:f.repo});
  const ended={...run,state:'failed',finishedAt:new Date().toISOString()};f.storage.saveRun(ended);
  assert.throws(()=>f.producer.finalize(ended),/cannot backfill/);
});
test('key rotation preserves historical verification but denies retired/revoked current admission',async t=>{
  const f=await golden(t);const manifest=verifyResult(f.result,f.expected).manifest;
  const later=new Date(Date.parse(manifest.issuedAt)+1000).toISOString(), next=signer('key-2');
  const retired={...f.signing.keys[0],retiredAt:later};
  const options={...f.expected,now:Date.parse(later)+1000,keys:[retired,...next.keys]};
  assert.throws(()=>verifyResult(f.result,options),/retired/);
  assert.equal(verifyResult(f.result,{...options,historical:true}).keyValidForCurrentUse,false);
  const revoked={...f.signing.keys[0],revokedAt:later};
  assert.throws(()=>verifyResult(f.result,{...options,keys:[revoked]}),/revoked/);
  assert.equal(verifyResult(f.result,{...options,keys:[revoked],historical:true}).keyValidForCurrentUse,false);
  assert.throws(()=>verifyResult(f.result,{...f.expected,keys:next.keys}),/Unknown/);
  assert.throws(()=>verifyResult(f.result,{...f.expected,keys:[{...f.signing.keys[0],publicKey:next.keys[0].publicKey}]}),/signature/);
  assert.throws(()=>verifyResult(f.result,{...f.expected,now:Date.parse('2100-01-01T00:00:00Z')}),/expired/);
  assert.equal(verifyResult(f.result,{...f.expected,now:Date.parse('2100-01-01T00:00:00Z'),historical:true}).keyValidForCurrentUse,false);
});
test('unexpected authority fields and unsupported protocol are rejected even by a valid signer',async t=>{
  const f=await golden(t), manifest=verifyResult(f.result,f.expected).manifest;
  for(const field of ['ready','writerAuthority','publicationAuthority','approval','budgetAuthority','workScope']){
    assert.throws(()=>signResult({...manifest,[field]:true},f.result.artifacts,f.signing.privateKey),/Unexpected/);
  }
  assert.throws(()=>verifyResult({...f.result,protocol:'UNKNOWN'},f.expected),/protocol/);
});
test('valid producer signing a different configuration cannot satisfy the expected F1',async t=>{
  const f=await golden(t),manifest=verifyResult(f.result,f.expected).manifest;
  manifest.execution.configuration.model='different-model';
  assert.throws(()=>signResult(manifest,f.result.artifacts,f.signing.privateKey),/version mismatch/);
  manifest.execution.configurationDigest=digest(manifest.execution.configuration);
  manifest.execution.factoryVersion=digest({sourceDigest:manifest.execution.sourceDigest,configurationDigest:manifest.execution.configurationDigest});
  const signed=signResult(manifest,f.result.artifacts,f.signing.privateKey);
  assert.throws(()=>verifyResult(signed,f.expected),/correlation/);
});
test('scoped authenticated endpoint and client read only the exact attempt, including after restart',async t=>{
  const {createSupervisor}=await import('../src/server.ts');
  const f=await golden(t),token='a'.repeat(64);
  writeFileSync(join(f.dir,'connections.json'),JSON.stringify({clients:[{id:'consumer',name:'Synthetic consumer',tokenSha256:sha256(token),repositoryPaths:[f.repo],actions:[]}]}));
  let host;
  const open=async()=>{host=createSupervisor({dataDir:f.dir,resultSigning:f.signing,linear:{}});await new Promise(r=>host.server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${host.server.address().port}`;};
  try{
    let origin=await open();const path=`/api/connect/v1/work-orders/${f.order.id}/runs/${f.run.id}/result`;
    assert.equal((await fetch(origin+path)).status,401);
    const client=new FactoryClient({origin,token});const read=await client.getRunResult(f.order.id,f.run.id);
    assert.deepEqual(read.result,f.result);verifyResult(read.result,f.expected);
    assert.deepEqual(await client.getRunResult(f.order.id,f.run.id),read);
    assert.equal((await fetch(origin+path,{headers:{Authorization:`Bearer ${token}`,Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await fetch(origin+path.replace(f.run.id,'99999999-9999-4999-a999-999999999999'),{headers:{Authorization:`Bearer ${token}`}})).status,404);
    const other=join(f.dir,'other');mkdirSync(other);
    writeFileSync(join(f.dir,'connections.json'),JSON.stringify({clients:[{id:'consumer',name:'Synthetic consumer',tokenSha256:sha256(token),repositoryPaths:[other],actions:[]}]}));
    assert.equal((await fetch(origin+path,{headers:{Authorization:`Bearer ${token}`}})).status,404);
    writeFileSync(join(f.dir,'connections.json'),JSON.stringify({clients:[{id:'consumer',name:'Synthetic consumer',tokenSha256:sha256(token),repositoryPaths:[f.repo],actions:[]}]}));
    await host.close();host=null;origin=await open();
    assert.deepEqual((await new FactoryClient({origin,token}).getRunResult(f.order.id,f.run.id)).result,f.result);
    assert.equal(f.storage.listRuns(f.order.id).length,1);
  }finally{if(host)await host.close();}
});
test('one exact Proof evidence reference crosses the authenticated Work boundary and rejects scope substitutions', async t => {
  const {createSupervisor}=await import('../src/server.ts');
  const f=await golden(t), token='d'.repeat(64), ownerScope='owner:test', workId=randomUUID();
  const repository='fixture/golden', workGeneration=1;
  f.storage.appendEvent({workOrderId:f.order.id,runId:null,type:'factory.prepare_requested',payload:{
    requestId:f.snapshot.requestId,workId,workGeneration,repository,input:{repositoryPath:f.repo}}});
  f.storage.appendEvent({workOrderId:f.order.id,runId:null,type:'factory.owner_scope_bound',payload:{
    ownerScope,workId,workGeneration,repository,requestId:f.snapshot.requestId,clientId:'preparer'}});
  const refs=f.storage.listEvents(f.order.id).find(e=>e.runId===f.run.id&&e.type==='run.evidence_collected').payload.refs;
  assert.deepEqual(refs.map(ref=>ref.kind),['TestEvidence','DiffEvidence']);
  const client={id:'proof',name:'MyEve Proof fixture',tokenSha256:sha256(token),repositoryPaths:[f.repo],
    actions:['evidence.read'],ownerScope,purpose:'myeve-proof',expiresAt:new Date(Date.now()+60000).toISOString()};
  const config=join(f.dir,'connections.json');
  const configure=value=>writeFileSync(config,JSON.stringify({clients:value}));configure([client]);
  let host=createSupervisor({dataDir:f.dir,resultSigning:f.signing,linear:{}});
  await new Promise(resolve=>host.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>host.close());
  let origin=`http://127.0.0.1:${host.server.address().port}`;
  const path='/api/connect/v1/evidence/read';
  const request=ref=>({ownerScope,repository,workId,workGeneration,requestId:f.snapshot.requestId,
    workOrderId:f.order.id,runId:f.run.id,candidateCommit:f.storage.getRun(f.run.id).candidateCommit,
    factoryVersion:f.snapshot.factoryVersion,evidenceReference:ref.proofReference,expectedDigest:ref.sha256,evidenceKind:ref.kind});
  const post=(body,authorization=token)=>fetch(origin+path,{method:'POST',headers:{Authorization:`Bearer ${authorization}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const proof=new FactoryClient({origin,token});
  const detail=await proof.getWorkOrder(f.order.id);
  const advertised=detail.events.find(event=>event.type==='run.evidence_collected').payload.refs;
  assert.deepEqual(advertised.map(ref=>ref.proofReference),refs.map(ref=>ref.proofReference));
  assert.equal(JSON.stringify(detail).includes('relativePath'),false);
  assert.equal(JSON.stringify(detail).includes('/evidence/'),false);
  const localDetail=await (await fetch(origin+`/api/work-orders/${f.order.id}`)).text();
  assert.equal(localDetail.includes('relativePath'),false);
  assert.equal(localDetail.includes(ownerScope),false);
  for(const ref of refs){
    const read=await proof.readEvidence(request(ref));
    assert.equal(read.proofReference,ref.proofReference);
    assert.equal(sha256(read.bytes),ref.sha256);
    assert.equal(read.bytes.length,ref.size);
  }
  await host.close();
  host=createSupervisor({dataDir:f.dir,resultSigning:f.signing,linear:{}});
  await new Promise(resolve=>host.server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${host.server.address().port}`;
  assert.equal(sha256((await new FactoryClient({origin,token}).readEvidence(request(refs[0]))).bytes),refs[0].sha256);
  const evidenceFile=join(f.dir,refs[0].relativePath),original=readFileSync(evidenceFile);
  writeFileSync(evidenceFile,Buffer.alloc(EVIDENCE_LIMITS.TestEvidence+1));
  assert.equal((await post(request(refs[0]))).status,409);
  writeFileSync(evidenceFile,original);
  const valid=request(refs[0]);
  const substitutions=[{ownerScope:'owner:other'},{repository:'fixture/other'},{workId:randomUUID()},
    {workGeneration:2},{workOrderId:randomUUID()},{runId:randomUUID()},
    {candidateCommit:'f'.repeat(40)},{factoryVersion:'f'.repeat(64)},
    {evidenceReference:`factory-evidence:sha256:${'f'.repeat(64)}`},{expectedDigest:'f'.repeat(64)},
    {evidenceKind:'VideoEvidence'},{evidenceKind:'UnknownEvidence'},
    {path:'../../etc/passwd'}];
  for(const change of substitutions){const response=await post({...valid,...change});assert.notEqual(response.status,200,JSON.stringify(change));
    assert.equal((await response.text()).includes('Synthetic check'),false);}
  assert.equal((await post(valid,'e'.repeat(64))).status,401);
  assert.equal((await fetch(origin+path,{headers:{Authorization:`Bearer ${token}`}})).status,405);
  assert.equal((await post({...valid,evidenceReference:'../../etc/passwd'})).status,400);
  configure([{...client,ownerScope:'owner:other'}]);assert.notEqual((await post(valid)).status,200);
  assert.equal((await fetch(origin+`/api/connect/v1/work-orders/${f.order.id}`,{headers:{Authorization:`Bearer ${token}`}})).status,404);
  assert.deepEqual((await (await fetch(origin+'/api/connect/v1/work-orders',{headers:{Authorization:`Bearer ${token}`}})).json()).workOrders,[]);
  configure([{...client,repositoryPaths:[f.dir]}]);assert.notEqual((await post(valid)).status,200);
  configure([{...client,expiresAt:new Date(Date.now()-1000).toISOString()}]);assert.equal((await post(valid)).status,401);
  configure([]);assert.equal((await post(valid)).status,401);
  assert.ok(EVIDENCE_LIMITS.DiffEvidence<=4*1024*1024);
});
test('revoked current signing configuration denies capture before a worker starts',async t=>{
  const signing=signer();signing.keys[0].revokedAt=new Date().toISOString();
  const f=await fixture(t,{signing});await assert.rejects(f.jobs.startRun(f.order),/signing key/);
  assert.equal(f.observed.length,0);assert.equal(f.storage.listRuns(f.order.id).length,0);
});
test('separate processes serialize immutable attempt records without duplicate or replacement',async t=>{
  const f=await fixture(t);
  const run=f.storage.createRun({workOrderId:f.order.id,workerProfile:'mac',inputCommit:f.order.baseRef,workspacePath:f.repo});
  const code=`import {openStorage} from ${JSON.stringify(new URL('../../../packages/storage/src/index.ts',import.meta.url).href)};
import {saveRunRecord,SNAPSHOT_EVENT} from ${JSON.stringify(new URL('../src/producer-results.ts',import.meta.url).href)};
const storage=openStorage(process.argv[1]);try{saveRunRecord(storage,JSON.parse(process.argv[2]),SNAPSHOT_EVENT,{fixture:process.argv[3]});process.stdout.write('SAVED');}catch(error){process.stdout.write(error.message);process.exitCode=2;}finally{storage.close();}`;
  const save=value=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',code,join(f.dir,'factory.sqlite'),JSON.stringify(run),value]);let out='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',()=>{});child.on('error',reject);child.on('exit',exit=>resolve({exit,out}));});
  const results=await Promise.all([save('one'),save('two')]);
  assert.deepEqual(results.map(r=>r.exit).sort(),[0,2]);
  assert.match(results.find(r=>r.exit===2).out,/Conflicting/);
  assert.equal(f.storage.listEvents(f.order.id).filter(e=>e.type===SNAPSHOT_EVENT).length,1);
});
