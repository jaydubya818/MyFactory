import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';
import {operatorValidationProvider} from '../src/production-validation-provider.mjs';
import {validationConfiguration,validationCheckpointPlan as plan,validationCandidate} from '../src/production-validation-plan.mjs';
import {validateCandidateBundle} from '../src/candidate-custody.mjs';
const exec=promisify(execFile);
test('LOCAL composed operator phase materializes pinned Git, executes real tests, and preserves exact candidate bytes without model capability',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'production-validation-local-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const root=fileURLToPath(new URL('../../../',import.meta.url)),map=path=>path.replace('/home/factoryproducer',dir);
 let modelCalls=0,networkClosed=false;const observations=[];
 const user={
  runCommand:async input=>{
   const args=input.args.map(arg=>arg.replaceAll('/home/factoryproducer',dir).replace('https://github.com/'+plan.source.repository+'.git',root));
   const result=await exec(input.cmd,args,{cwd:input.cwd?map(input.cwd):dir,timeout:input.timeoutMs,maxBuffer:256000});
   return{exitCode:0,stdout:async()=>result.stdout};
  },
  writeFiles:async files=>{assert(networkClosed);for(const f of files)await writeFile(map(f.path),f.content,{mode:f.mode});},
  readFile:async({path})=>Readable.from([await readFile(map(path))]),
 };
 const sandbox={image:validationConfiguration.cloud.workerImage,createUser:async()=>user,asUser:()=>user,updateNetworkPolicy:async policy=>{assert.equal(policy,'deny-all');networkClosed=true;}};
 const provider=operatorValidationProvider({execute:async()=>{modelCalls++;throw Error('MODEL_PATH');}});
 const source=await provider.materialize(sandbox);assert.equal(source.commit,plan.source.commit);
 const request={source:plan.source,input:{allowedPaths:plan.allowedPaths,checkCommands:[plan.checkCommand]}};
 const manifest=await provider.execute(sandbox,()=>{}, {request},async e=>observations.push(e));
 const candidate=validateCandidateBundle(await readFile(join(dir,'candidate.json')),request);
 assert.equal(candidate.sha256,manifest.sha256);assert.equal(candidate.bundle.files[plan.allowedPaths[0]],validationCandidate);assert.equal(candidate.bundle.checks[0].exitCode,0);
 assert.equal(modelCalls,0);assert.equal(observations[0].paidModelOperations,0);assert.equal(observations[0].completion,'NOT_APPLICABLE');
 await assert.rejects(provider.materialize({...sandbox,image:'mutable:latest'}),/IMAGE_MISMATCH/);
});
