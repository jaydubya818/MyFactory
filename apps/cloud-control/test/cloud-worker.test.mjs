import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cloudSource,cloudGrant,deterministicWorkerScript} from '../src/cloud-work-plan.mjs';
import {validateCandidateBundle} from '../src/candidate-custody.mjs';
import {generateKeyPairSync} from 'node:crypto';
import {cloudResult} from '../src/cloud-work-result.mjs';
import {CloudWorkControl} from '../src/cloud-work-control.mjs';
import {verifyResult} from '../../../packages/hosted-routing/src/result.ts';

test('deterministic executor produces a real exact-source Git candidate accepted by custody and signed protocol (LOCAL fixture, not cloud)',()=>{
 const dir=mkdtempSync(join(tmpdir(),'factory-cloud-worker-test-')),repo=join(dir,'source'),root=fileURLToPath(new URL('../../../',import.meta.url));
 const env={PATH:process.env.PATH,HOME:dir,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 try{
  // Reconstruct pinned public Git objects from checked-in fixture data. This
  // also works in a shallow CI checkout without another branch or network.
  mkdirSync(repo);execFileSync('git',['init','-q'],{cwd:repo,env});
  cpSync(join(root,'fixtures'),join(repo,'fixtures'),{recursive:true});
  execFileSync('git',['add','--all'],{cwd:repo,env});
  assert.equal(execFileSync('git',['write-tree'],{cwd:repo,env,encoding:'utf8'}).trim(),cloudSource.tree);
  const sourceVector=JSON.parse(readFileSync(new URL('./fixtures/project-slug-source.json',import.meta.url),'utf8'));
  assert.equal(execFileSync('git',['hash-object','-w','-t','commit','--stdin'],{cwd:repo,env,encoding:'utf8',input:sourceVector.rawCommit}).trim(),cloudSource.commit);
  execFileSync('git',['checkout','-q','--detach',cloudSource.commit],{cwd:repo,env});
  const output=join(dir,'candidate.json'),startedAt=new Date(Date.now()-1000).toISOString();
  const manifest=JSON.parse(execFileSync(process.execPath,['-e',deterministicWorkerScript.replace('/home/factoryproducer/candidate.json',output)],{cwd:repo,env,encoding:'utf8',maxBuffer:500000,timeout:30000}));
  const bytes=readFileSync(output),request={source:cloudSource,input:{allowedPaths:cloudGrant.allowedPaths,checkCommands:cloudGrant.commands}};
  const validated=validateCandidateBundle(bytes,request);assert.equal(validated.sha256,manifest.sha256);assert.equal(validated.bundle.checks[0].exitCode,0);
  const pair=generateKeyPairSync('ed25519'),signing={factoryId:'myfactory-cloud-staging',key:{keyId:'test',factoryId:'myfactory-cloud-staging',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00.000Z',notAfter:'2099-01-01T00:00:00.000Z'},privateKey:pair.privateKey};
  const control=new CloudWorkControl({signing,sourceDigest:'a'.repeat(64)}),snapshot=control.snapshot({...request,requestId:'request'}, {id:'order'},{id:'run',startedAt});
  const finishedAt=new Date().toISOString(),row={run_id:'run',snapshot,events:[{type:'factory.terminal',payload:{status:'COMPLETED',finishedAt,candidateCommit:validated.commit}}]};
  const result=cloudResult(row,validated.bundle,signing);
  assert.equal(verifyResult(result,{keys:[signing.key],factoryId:signing.factoryId,requestId:'request',workOrderId:'order',runId:'run',factoryVersion:snapshot.factoryVersion}).manifest.candidate.commit,validated.commit);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
