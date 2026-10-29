// Tiny ordinary pinned Mac repository and disposable connection files. This
// qualifies authorization/preparation only; no worker, provider or paid Work.
import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalV4Supervisor} from '../src/server.ts';
import {SpendLedger} from '../../../packages/storage/src/spend.ts';

const GIT='/opt/homebrew/Cellar/git/2.48.1/bin/git',token='c'.repeat(64),hash=value=>createHash('sha256').update(value).digest('hex');
const mutations={revoke:()=>[],id:c=>[{...c[0],id:'other'}],token:c=>[{...c[0],tokenSha256:hash('d'.repeat(64))}],owner:c=>[{...c[0],ownerScope:'owner:other'}],
 purpose:c=>[{...c[0],purpose:'myeve-proof',expiresAt:new Date(Date.now()+60000).toISOString()}],expiry:c=>[{...c[0],expiresAt:new Date(Date.now()-1000).toISOString()}],
 grant:c=>[{...c[0],actions:['factory.observe']}],repository:(c,p)=>[{...c[0],repositoryPaths:[p]}]};
async function fixture(t){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'strict-request-authority-'))),repo=join(dir,'repo'),other=join(dir,'other');mkdirSync(repo,{mode:0o700});mkdirSync(other,{mode:0o700});
 const env={PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',GIT_EXEC_PATH:'/opt/homebrew/Cellar/git/2.48.1/libexec/git-core',LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'};
 const git=(...args)=>execFileSync(GIT,['-c','core.hooksPath=/dev/null','-c','protocol.allow=never','-C',repo,...args],{env,timeout:10000,maxBuffer:1024*1024}).toString().trim();
 git('init','-q','--template=','--object-format=sha1');git('config','user.name','Public authority fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(repo,'sample.txt'),'ordinary\n');git('add','.');git('commit','-qm','Input');
 const clients=[{id:'public',name:'Public synthetic connection',tokenSha256:hash(token),ownerScope:'owner:public',repositoryPaths:[repo],actions:['factory.prepare','factory.dispatch','factory.observe','factory.stop']}],path=join(dir,'connections.json'),save=value=>writeFileSync(path,JSON.stringify({clients:value}));save(clients);
 const pair=generateKeyPairSync('ed25519'),key={factoryId:'public-authority-fixture',keyId:'ephemeral',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 let workers=0,verifiers=0;
 const host=createLocalV4Supervisor({dataDir:dir,resultSigning:{factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]},jobDependencies:{
  preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'public-authority-fixture',workerProfile:'mac',error:null}),
  runCodex:async()=>{workers++;throw Error('No worker permitted')},verifyCandidate:async()=>{verifiers++;throw Error('No verifier permitted')},
 }});
 await new Promise(resolve=>host.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+host.server.address().port;
 const input={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'public/repository',deadline:new Date(Date.now()+60000).toISOString(),maxSpendUsd:1,input:{title:'Public prepare authorization',description:'No execution',kind:'feature',repositoryPath:repo,baseRef:git('rev-parse','HEAD'),acceptanceCriteria:['Current connection only'],reproductionCommand:null,expectedFailureText:null,checkCommands:['synthetic-check'],allowedPaths:['sample.txt'],workerProfile:'mac'}};
 const ledger=new SpendLedger(join(dir,'factory.sqlite'));
 t.after(async()=>{ledger.close();await host.close();rmSync(dir,{recursive:true,force:true})});
 async function post(mutate){
  if(!mutate){const response=await fetch(origin+'/api/connect/v1/dispatches',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input)});return {status:response.status,body:await response.json()}}
  const body=JSON.stringify(input);let observed;const seen=new Promise(resolve=>observed=resolve);
  host.server.once('request',()=>{save(mutate(clients,other));observed()});
  return new Promise((resolve,reject)=>{const req=httpRequest(origin+'/api/connect/v1/dispatches',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));res.on('error',reject);
  });req.on('error',reject);req.write(body.slice(0,1));seen.then(()=>req.end(body.slice(1)))})
 }
 return {host,ledger,input,post,get workers(){return workers},get verifiers(){return verifiers}};
}
test('strict ordinary preparation retains one actual original pair without execution',async t=>{
 const f=await fixture(t),response=await f.post();assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.state,'PREPARED');
 assert.equal(f.host.storage.listWorkOrders().length,1);const runs=f.host.storage.listRuns(response.body.workOrderId);assert.equal(runs.length,1);
 const pair=f.host.storage.listEvents(response.body.workOrderId).filter(e=>['run.execution_snapshot','run.local_v4_admission'].includes(e.type));assert.equal(pair.length,2);assert.equal(f.workers,0);assert.equal(f.verifiers,0);
});
for(const [name,mutate] of Object.entries(mutations))test('strict pending prepare body: '+name+' creates no Work, Run, original pair or budget',async t=>{
 const f=await fixture(t),response=await f.post(mutate);assert([401,403,404,...(name==='repository'?[400]:[])].includes(response.status),'status='+response.status);
 assert.equal(f.host.storage.listWorkOrders().length,0);assert.equal(f.ledger.read(f.input.workId),null);assert.equal(f.workers,0);assert.equal(f.verifiers,0);
});
