import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import * as codec from '../src/result.ts';

// Dependency-free Node 24 boundary suite; no application runtime or SDK.
const {test}=await import('node:test');
const LEGACY_MODEL_REFERENCE_IS_STRICT=true;
const now=Date.parse('2026-10-26T12:00:00Z');
const objectId=(kind,bytes)=>createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
function fixture(){
 const pair=generateKeyPairSync('ed25519');
 const tree=(body)=>Buffer.concat([Buffer.from('100644 input.txt\0'),Buffer.from(objectId('blob',Buffer.from(body)),'hex')]);
 const inputTree=tree('before\n'),inputTreeId=objectId('tree',inputTree);
 const base=Buffer.from(`tree ${inputTreeId}\nauthor Synthetic <codec@example.invalid> 1793016000 +0000\ncommitter Synthetic <codec@example.invalid> 1793016000 +0000\n\nSynthetic admitted input\n`);
 const inputCommit=objectId('commit',base),candidateTree=tree('after\n'),candidateTreeId=objectId('tree',candidateTree);
 const commit=Buffer.from(`tree ${candidateTreeId}\nparent ${inputCommit}\nauthor Synthetic <codec@example.invalid> 1793016001 +0000\ncommitter Synthetic <codec@example.invalid> 1793016001 +0000\n\nSynthetic candidate\n`);
 const candidate=objectId('commit',commit),patch=Buffer.from('Synthetic inert patch\n'),log=Buffer.from('Synthetic producer check; not independent verification\n');
 const configuration={model:'openai/gpt-5.4-mini',executor:'codex-cli',executorVersion:'synthetic-codec-only',skillRevision:'synthetic-skill',workerProfile:'mac',verificationImage:'synthetic-verifier',nodeVersion:'v24.18.1',platform:'darwin',architecture:'arm64',commands:['node --test synthetic.test.mjs'],allowedPaths:['input.txt'],timeoutMs:1000};
 const sourceDigest='1'.repeat(64),configurationDigest=codec.digest(configuration),factoryId='synthetic-v4-factory';
 const request={ownerId:'synthetic-owner',workId:'33333333-3333-4333-8333-333333333333',workVersion:1,criteriaVersion:1,profile:{id:'synthetic-local-profile',version:1,configuration}};
 const execution={version:4,factoryId,factoryVersion:codec.digest({sourceDigest,configurationDigest}),sourceDigest,configurationDigest,configuration,requestId:'synthetic-v4-request',requestDigest:codec.digest(request),workOrderId:'11111111-1111-4111-8111-111111111111',runId:'22222222-2222-4222-8222-222222222222',attemptNumber:1,inputCommit,inputTree:inputTreeId,workspace:{kind:'GIT_WORKTREE',path:'/synthetic/owned-worktrees/attempt-one',branch:null},capturedAt:'2026-10-26T10:00:00.000Z'};
 const metadata=[['commit','git-commit',commit],['tree','git-tree',candidateTree],['patch','patch',patch],['check','check-log',log]];
 const artifacts=metadata.map(([id,,bytes])=>({id,base64:bytes.toString('base64')}));
 const artifactMetadata=metadata.map(([id,kind,bytes])=>({id,kind,producer:factoryId,runId:execution.runId,candidateCommit:candidate,sha256:codec.sha256(bytes),size:bytes.length,createdAt:'2026-10-26T10:00:00.200Z'}));
 const evidence=[{id:'synthetic-check',producer:factoryId,runId:execution.runId,candidateCommit:candidate,command:configuration.commands[0],status:'passed',exitCode:0,startedAt:'2026-10-26T10:00:00.100Z',finishedAt:'2026-10-26T10:00:00.200Z',logArtifactId:'check'}];
 const manifest={protocol:codec.RESULT_PROTOCOL,keyId:'synthetic-key',producer:factoryId,operationId:codec.digest([codec.RESULT_PROTOCOL,factoryId,execution.requestId,execution.workOrderId,execution.runId]),execution,status:'COMPLETED',candidate:{commit:candidate,tree:candidateTreeId,base:inputCommit,patchDigest:codec.sha256(patch),commitArtifactId:'commit',treeArtifactId:'tree',patchArtifactId:'patch'},evidence,artifacts:artifactMetadata,evidenceDigest:codec.digest(evidence),artifactDigest:codec.digest(artifactMetadata),completedAt:'2026-10-26T10:00:00.300Z',issuedAt:'2026-10-26T10:00:00.400Z'};
 const {version,workspace,capturedAt,...expected}=structuredClone(execution);
 const key={factoryId,keyId:manifest.keyId,publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 return {manifest,artifacts,expected,privateKey:pair.privateKey,options:{expected,keys:[key],now},request};
}
// Deliberately signs hostile synthetic data to test receiver validation, not
// merely the producer signer's refusal to construct an invalid envelope.
function rawSigned(f,change=()=>{}){
 const m=structuredClone(f.manifest);change(m);const encoded=Buffer.from(codec.canonical(m)).toString('base64url');
 return {protocol:codec.RESULT_PROTOCOL,encoded,signature:sign(null,Buffer.from(codec.RESULT_PROTOCOL+'\0'+encoded),f.privateKey).toString('base64url'),manifestDigest:codec.digest(m),artifacts:structuredClone(f.artifacts)};
}
function legacy(f,version){
 const m=structuredClone(f.manifest);m.execution.version=version;delete m.execution.workspace;
 if(version!==2)delete m.execution.inputTree;
 if(version===2){
  const c=m.execution.configuration;c.workerProfile='container';c.platform='linux';c.architecture='x64';c.verificationImage='synthetic/verifier@sha256:'+'2'.repeat(64);
  c.cloud={provider:'vercel-sandbox',providerVersion:'synthetic',region:'iad1',workerImage:'synthetic/worker@sha256:'+'3'.repeat(64),networkPolicy:'synthetic-offline',toolPolicySha256:'4'.repeat(64),contextPolicySha256:'5'.repeat(64),verificationPolicySha256:'6'.repeat(64),evidenceClass:'DETERMINISTIC',resources:{vcpus:1,memoryMb:2048,timeoutMs:1000,maxArtifactBytes:1024},skills:[]};
 }
 if(version===3)m.execution.workspace=structuredClone(f.manifest.execution.workspace);
 m.execution.configurationDigest=codec.digest(m.execution.configuration);m.execution.factoryVersion=codec.digest({sourceDigest:m.execution.sourceDigest,configurationDigest:m.execution.configurationDigest});return m;
}

test('explicit V4 roundtrip uses the unchanged envelope/domain and exact admitted profile',()=>{
 const f=fixture(),result=codec.signLocalResultV4(f.manifest,f.artifacts,f.privateKey),read=codec.verifyLocalResultV4(result,f.options);
 assert.deepEqual(read.manifest,f.manifest);assert.equal(read.keyValidForCurrentUse,true);
 assert.equal(result.protocol,'MYFACTORY_RESULT_V1');assert.deepEqual(Object.keys(result).sort(),['artifacts','encoded','manifestDigest','protocol','signature']);
 console.log('V4_VECTOR_ID '+codec.digest({manifest:f.manifest,expected:f.expected,artifacts:f.artifacts}));
});
test('legacy validate/sign/verify reject V4; separate V4 APIs reject historical and unknown versions',()=>{
 const f=fixture(),result=codec.signLocalResultV4(f.manifest,f.artifacts,f.privateKey);
 assert.throws(()=>codec.validateManifest(f.manifest));assert.throws(()=>codec.signResult(f.manifest,f.artifacts,f.privateKey));
 assert.throws(()=>codec.verifyResult(result,{...f.expected,keys:f.options.keys,now}));
 for(const version of [1,2,3]){const m=legacy(f,version),r=codec.signResult(m,f.artifacts,f.privateKey);
  codec.validateManifest(m);assert.deepEqual(codec.verifyResult(r,{...m.execution,keys:f.options.keys,now}).manifest,m);
  assert.throws(()=>codec.validateLocalResultManifestV4(m));assert.throws(()=>codec.signLocalResultV4(m,f.artifacts,f.privateKey));assert.throws(()=>codec.verifyLocalResultV4(r,f.options));
 }
 assert.throws(()=>codec.verifyLocalResultV4(rawSigned(f,m=>m.execution.version=5),f.options));
});
test('historical model-reference differences remain independent from the shared V4 grammar',()=>{
 const f=fixture(),m=legacy(f,1);m.execution.configuration.model='legacy model with spaces';m.execution.configurationDigest=codec.digest(m.execution.configuration);m.execution.factoryVersion=codec.digest({sourceDigest:m.execution.sourceDigest,configurationDigest:m.execution.configurationDigest});
 if(LEGACY_MODEL_REFERENCE_IS_STRICT)assert.throws(()=>codec.validateManifest(m));else codec.validateManifest(m);
 for(const model of ['legacy model with spaces','provider/model/extra','../model','https://model','a'.repeat(121)])assert.throws(()=>codec.verifyLocalResultV4(rawSigned(f,m=>{m.execution.configuration.model=model;m.execution.configurationDigest=codec.digest(m.execution.configuration);m.execution.factoryVersion=codec.digest({sourceDigest:m.execution.sourceDigest,configurationDigest:m.execution.configurationDigest});}),f.options));
});
test('missing, extra, mixed-version and malformed fields fail at the receiver',()=>{
 const f=fixture();const changes=[
  m=>delete m.execution.inputTree,m=>delete m.execution.workspace,m=>m.execution.inputTree=null,m=>m.execution.workspace=null,
  m=>m.execution.extra=true,m=>m.extra=true,m=>m.execution.workspace.extra=true,m=>m.execution.workspace.branch='main',
  m=>m.execution.workspace.path='relative',m=>m.execution.workspace.path='/bad\0path',m=>m.execution.workspace.kind='DIRECTORY',
  m=>m.execution.inputTree='not-a-tree',m=>m.execution.inputTree='a'.repeat(64),m=>m.execution.attemptNumber=0,
  m=>m.execution.configuration.executor='cloud',m=>m.execution.configuration.workerProfile='remote',
  m=>m.execution.configuration.commands=[],m=>m.execution.configuration.allowedPaths=[],m=>m.execution.configuration.timeoutMs=0,
  m=>m.artifacts[0].size=codec.MAX_ARTIFACT_BYTES+1,m=>m.execution.workspace.path='/'+ 'a'.repeat(4000),m=>m.status='RUNNING',
  m=>m.execution.capturedAt='2099-01-01',m=>m.evidence[0].finishedAt='2099-01-01',m=>m.completedAt='2026-10-26T09:00:00Z',
  m=>m.candidate.base='f'.repeat(40),m=>m.evidence[0].exitCode=1,m=>m.evidence[0].candidateCommit='e'.repeat(40),m=>m.artifacts[0].createdAt='2099-01-01',
 ];
 for(const change of changes)assert.throws(()=>codec.verifyLocalResultV4(rawSigned(f,change),f.options));
});
test('local V4 rejects cloud configuration and every verification field, including null',()=>{
 const f=fixture();for(const value of [null,{}, {kind:'INDEPENDENT_CLOUD_VERIFICATION'}]){
  assert.throws(()=>codec.verifyLocalResultV4(rawSigned(f,m=>m.verification=value),f.options));
  assert.throws(()=>codec.verifyLocalResultV4(rawSigned(f,m=>m.execution.configuration.cloud=value),f.options));
 }
});
test('all immutable admission expectations are required, including owner/Work material in the request digest',()=>{
 const f=fixture(),r=rawSigned(f);
 for(const field of ['factoryId','factoryVersion','sourceDigest','configurationDigest','requestId','requestDigest','workOrderId','runId','attemptNumber','inputCommit','inputTree']){
  const expected={...f.expected,[field]:field==='attemptNumber'?2:'f'.repeat(field==='inputCommit'||field==='inputTree'?40:64)};
  assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,expected}));
  const absent={...f.expected};delete absent[field];assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,expected:absent}));
 }
 assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,expected:{...f.expected,requestDigest:codec.digest({...f.request,ownerId:'foreign-owner'})}}));
 assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,expected:{...f.expected,requestDigest:codec.digest({...f.request,workVersion:2})}}));
 for(const field of ['model','commands','allowedPaths','verificationImage','timeoutMs']){const configuration={...f.expected.configuration,[field]:field==='timeoutMs'?2000:field==='commands'||field==='allowedPaths'?['changed']:'changed'};assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,expected:{...f.expected,configuration}}));}
});
test('signed commit/tree and worktree metadata cannot be tampered or used as tree authority',()=>{
 const f=fixture(),r=rawSigned(f);for(const field of ['inputTree','workspace']){const m=structuredClone(f.manifest);if(field==='inputTree')m.execution.inputTree='f'.repeat(40);else m.execution.workspace.path='/changed';const encoded=Buffer.from(codec.canonical(m)).toString('base64url');assert.throws(()=>codec.verifyLocalResultV4({...r,encoded,manifestDigest:codec.digest(m)},f.options));}
 assert.throws(()=>codec.verifyLocalResultV4(rawSigned(f,m=>m.execution.inputTree='f'.repeat(40)),f.options));
 const signedPath=rawSigned(f,m=>m.execution.workspace.path='/synthetic/'+f.expected.inputTree);
 assert.throws(()=>codec.verifyLocalResultV4(signedPath,{...f.options,expected:{...f.expected,inputTree:'f'.repeat(40)}}));
});
test('artifact substitution, noncanonical encoding, signature and byte limits fail',()=>{
 const f=fixture(),r=rawSigned(f),artifact=structuredClone(r);artifact.artifacts[0].base64=Buffer.from('changed').toString('base64');assert.throws(()=>codec.verifyLocalResultV4(artifact,f.options));
 assert.throws(()=>codec.verifyLocalResultV4({...r,signature:'a'.repeat(86)},f.options));assert.throws(()=>codec.verifyLocalResultV4({...r,manifestDigest:'0'.repeat(64)},f.options));
 const encoded=Buffer.from(JSON.stringify(f.manifest,null,2)).toString('base64url');assert.throws(()=>codec.verifyLocalResultV4({...r,encoded,signature:sign(null,Buffer.from(codec.RESULT_PROTOCOL+'\0'+encoded),f.privateKey).toString('base64url')},f.options));
 assert.throws(()=>codec.verifyLocalResultV4({...r,encoded:'a'.repeat(codec.MAX_RESULT_BYTES)},f.options));
 assert.throws(()=>codec.verifyLocalResultV4({...r,artifacts:[...r.artifacts,r.artifacts[0]]},f.options));
});
test('current and historical key rules never promote historical signatures to current admission',()=>{
 const f=fixture(),r=rawSigned(f),key=f.options.keys[0];assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,keys:[]}));assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,keys:[key,key]}));
 const wrong=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,keys:[{...key,publicKey:wrong}]}));
 for(const change of [{revokedAt:'2026-10-26T11:00:00Z'},{retiredAt:'2026-10-26T11:00:00Z'},{notAfter:'2026-10-26T11:00:00Z'}]){
  const options={...f.options,keys:[{...key,...change}]};assert.throws(()=>codec.verifyLocalResultV4(r,options));assert.equal(codec.verifyLocalResultV4(r,{...options,historical:true}).keyValidForCurrentUse,false);
 }
 for(const change of [{activeFrom:'2026-10-26T11:00:00Z'},{notAfter:'2026-10-26T09:00:00Z'},{retiredAt:'2026-10-26T09:00:00Z'}])assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,keys:[{...key,...change}],historical:true}));
 assert.throws(()=>codec.verifyLocalResultV4(r,{...f.options,now:Date.parse('2026-10-26T09:00:00Z')}));
});
test('changed manifests do not become duplicates merely because the operation identity is unchanged',()=>{
 const f=fixture(),first=rawSigned(f),next=rawSigned(f,m=>m.execution.workspace.path='/synthetic/another-association');
 assert.equal(codec.verifyLocalResultV4(first,f.options).manifest.operationId,codec.verifyLocalResultV4(next,f.options).manifest.operationId);assert.notEqual(first.manifestDigest,next.manifestDigest);
 assert.equal(codec.signLocalResultV4(f.manifest,f.artifacts,f.privateKey).signature,codec.signLocalResultV4(f.manifest,f.artifacts,f.privateKey).signature);
});
test('paired explicit V4 codecs produce identical bytes and cross-verify the same vector', {skip:!process.env.V4_CODEC_PEER_MODULE}, async()=>{
 const peer=await import(pathToFileURL(process.env.V4_CODEC_PEER_MODULE).href),f=fixture();
 const a=codec.signLocalResultV4(f.manifest,f.artifacts,f.privateKey),b=peer.signLocalResultV4(f.manifest,f.artifacts,f.privateKey);
 assert.deepEqual(a,b);assert.deepEqual(codec.verifyLocalResultV4(b,f.options),peer.verifyLocalResultV4(a,f.options));
 for(const change of [(m)=>m.execution.inputTree=null,(m)=>m.verification=null,(m)=>m.execution.workspace.path='relative']){const r=rawSigned(f,change);assert.throws(()=>codec.verifyLocalResultV4(r,f.options));assert.throws(()=>peer.verifyLocalResultV4(r,f.options));}
});
