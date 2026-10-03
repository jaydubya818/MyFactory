import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cloudSource,cloudGrant,deterministicWorkerScript} from '../src/cloud-work-plan.mjs';
import {validateCandidateBundle} from '../src/candidate-custody.mjs';
import {generateKeyPairSync} from 'node:crypto';
import {cloudResult} from '../src/cloud-work-result.mjs';
import {CloudWorkControl} from '../src/cloud-work-control.mjs';
import {verifyResult,validateManifest} from '../../../packages/hosted-routing/src/result.ts';
import {cloudVerifierPolicy,cloudVerifierPolicySha256} from '../src/cloud-verifier-policy.mjs';

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
  assert.throws(()=>cloudResult(row,validated.bundle,signing),/VERIFIER_RESULT_REQUIRED/);
  Object.assign(row,{work_id:'synthetic-work',work_generation:1,custody:{artifact_sha256:validated.sha256},resource:{provider_session_id:'sbx_producer'},verification:{run_id:'run',cleanup_confirmed:true,candidate_commit:validated.commit,candidate_tree:validated.tree,custody_sha256:validated.sha256,policy_sha256:cloudVerifierPolicySha256,image:cloudVerifierPolicy.image,provider_session_id:'sbx_independentVerifier',outcome:'PASS',checks:cloudVerifierPolicy.checks.map(c=>({id:c.id,result:'PASS'})),created_at:finishedAt,updated_at:finishedAt}});
  const result=cloudResult(row,validated.bundle,signing);
  const expected={keys:[signing.key],factoryId:signing.factoryId,requestId:'request',workOrderId:'order',runId:'run',factoryVersion:snapshot.factoryVersion};
  const manifestVerified=verifyResult(result,expected).manifest;
  assert.equal(manifestVerified.candidate.commit,validated.commit);assert.equal(manifestVerified.verification.outcome,'PASS');
  if(process.env.CLOUD_VERIFICATION_VECTOR_PATH)writeFileSync(process.env.CLOUD_VERIFICATION_VECTOR_PATH,JSON.stringify({purpose:'PUBLIC_SYNTHETIC_PROTOCOL_VECTOR_NO_AUTHORITY',signed:result,expected},null,2)+'\n');
  for(const change of [m=>m.verification.cleanupConfirmed=false,m=>m.verification.candidateTree='a'.repeat(40),m=>m.verification.policySha256='f'.repeat(64),m=>m.verification.providerSessionId='sbx_producer',m=>m.verification.checks[0].result='FAIL',m=>m.verification.checks.push(m.verification.checks[0]),m=>m.verification.extra='secret',m=>m.verification.finishedAt='2099-01-01T00:00:00Z']){
   const changed=structuredClone(manifestVerified);change(changed);assert.throws(()=>validateManifest(changed));
  }
  row.verification.outcome='FAIL';row.verification.checks[0].result='FAIL';
  const failed=verifyResult(cloudResult(row,validated.bundle,signing),expected).manifest;
  assert.equal(failed.status,'COMPLETED');assert.equal(failed.verification.outcome,'FAIL','producer completion is not protected verification success');
  row.verification.cleanup_confirmed=false;assert.throws(()=>cloudResult(row,validated.bundle,signing),/VERIFIER_RESULT_BINDING/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
