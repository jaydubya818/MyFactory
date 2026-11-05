import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSupervisor} from '../src/server.ts';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const IMAGE='sha256:'+'c'.repeat(64);
async function fixture(t,{checkStatus='passed',actions=['factory.prepare','factory.dispatch','factory.observe','factory.stop','factory.preview']}={}){
 const dir=mkdtempSync(join(tmpdir(),'factory-preview-')),repo=join(dir,'repo'),dataDir=join(dir,'data'),bin=join(dir,'bin');mkdirSync(repo);mkdirSync(dataDir);mkdirSync(bin);
 const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','Factory fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(repo,'App.jsx'),'old\n');git('add','.');git('commit','-qm','base');
 writeFileSync(join(bin,'docker'),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);if(args[0]!=='run')process.exit(0);
const mounts=args.flatMap((a,i)=>a==='--mount'?[args[i+1]]:[]);if(!mounts.some(m=>m.includes('target=/out')))process.exit(0);const out=mounts.find(m=>m.includes('target=/out')).match(/source=([^,]+)/)[1];
const src=mounts.find(m=>m.includes('target=/src')).match(/source=([^,]+)/)[1];
fs.writeFileSync(path.join(out,'index.html'),'<h1>'+fs.readFileSync(path.join(src,'App.jsx'),'utf8').trim()+'</h1>');process.exit(0);`);chmodSync(join(bin,'docker'),0o755);
 const path=process.env.PATH;process.env.PATH=bin+':'+path;
 const pair=generateKeyPairSync('ed25519'),token='a'.repeat(64),key={factoryId:'factory-fixture',keyId:'fixture',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
 const resultSigning={factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]};
 writeFileSync(join(dataDir,'connections.json'),JSON.stringify({clients:[{id:'myeve',name:'Local fixture',tokenSha256:createHash('sha256').update(token).digest('hex'),repositoryPaths:[repo],ownerScope:'owner:fixture',actions}]}));
 const jobDependencies={preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'synthetic-codex-1',workerProfile:'mac',error:null}),runCodex:async input=>{writeFileSync(join(input.workspacePath,'App.jsx'),'counter\n');return {success:true,status:'completed',threadId:'fixture',eventsPath:'fixture',usage:null};},verifyCandidate:async input=>{mkdirSync(input.artifactDir,{recursive:true});return {checks:input.commands.map((command,i)=>{const logPath=join(input.artifactDir,i+'.log');writeFileSync(logPath,'fixture check\n');const at=new Date().toISOString();return {candidateCommit:input.candidateSha,candidateTree:git('rev-parse',input.candidateSha+'^{tree}'),command,status:checkStatus,exitCode:checkStatus==='passed'?0:1,startedAt:at,finishedAt:at,logPath,reason:null};}),reason:null};}};
 const options={dataDir,resultSigning,jobDependencies,localFactoryFixture:true,verificationImage:IMAGE,candidatePreview:{command:'build --outDir /out'}};
 let supervisor=createSupervisor(options);
 const listen=async()=>{await new Promise(r=>supervisor.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+supervisor.server.address().port;};
 let origin=await listen();
 const request=async(p,body)=>{const res=await fetch(origin+'/api/connect/v1/'+p,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()};};
 const input={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/app',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1,input:{title:'Counter',description:'Counter',kind:'feature',repositoryPath:repo,baseRef:git('rev-parse','HEAD'),acceptanceCriteria:['Counter'],reproductionCommand:null,expectedFailureText:null,checkCommands:['build','test'],allowedPaths:['App.jsx'],workerProfile:'mac'}};
 t.after(async()=>{process.env.PATH=path;await supervisor.close();rmSync(dir,{recursive:true,force:true});});
 return {request,input,get origin(){return origin;},async restart(){await supervisor.close();supervisor=createSupervisor(options);origin=await listen();},
  async complete(){const p=await request('dispatches',input);assert.equal(p.status,200);const s=p.body.snapshot;
   const id={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:input.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:input.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:input.deadline};
   assert.equal((await request('dispatches/'+input.requestId+'/dispatch',id)).status,200);
   for(let i=0;i<800;i++){const r=await request("dispatches/"+input.requestId);if(r.body.quiescent)return r.body;await sleep(25);if(i===799)throw Error("not terminal "+JSON.stringify(r.body).slice(-700));}}};
}
test('a completed, fully passed candidate gets one private static preview that survives restart',async t=>{
 const f=await fixture(t);assert.equal((await f.complete()).state,'COMPLETED');
 const first=await f.request('dispatches/'+f.input.requestId+'/preview',{});
 assert.equal(first.status,200);assert.equal(first.body.state,'READY');assert.match(first.body.path,/^\/preview\/[a-f0-9]{64}\/$/);
 assert.match(first.body.candidateCommit,/^[a-f0-9]{40}$/);
 const page=await fetch(f.origin+first.body.path);
 assert.equal(page.status,200);assert.equal(await page.text(),'<h1>counter</h1>');
 assert.match(page.headers.get('content-security-policy'),/^sandbox allow-scripts/);
 assert.equal(page.headers.get('cache-control'),'no-store');
 assert.deepEqual((await f.request('dispatches/'+f.input.requestId+'/preview',{})).body,first.body);
 await f.restart();
 assert.equal((await fetch(f.origin+first.body.path)).status,200);
 assert.equal((await fetch(f.origin+'/preview/'+'0'.repeat(64)+'/')).status,404);
 assert.equal((await fetch(f.origin+first.body.path+'..%2f..%2fconnections.json')).status,404);
});
test('a candidate with a failed check is not previewable',async t=>{
 const f=await fixture(t,{checkStatus:'failed'});assert.equal((await f.complete()).state,'FAILED');
 const denied=await f.request('dispatches/'+f.input.requestId+'/preview',{});
 assert.equal(denied.status,409);
});
test('a connection without the preview grant cannot create one',async t=>{
 const f=await fixture(t,{actions:['factory.prepare','factory.dispatch','factory.observe','factory.stop']});assert.equal((await f.complete()).state,'COMPLETED');
 assert.equal((await f.request('dispatches/'+f.input.requestId+'/preview',{})).status,403);
});
