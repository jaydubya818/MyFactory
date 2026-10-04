import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {canonical,digest} from '../../../packages/hosted-routing/src/result.ts';
import {productionCanarySource,productionCanaryPath,productionVerifierPolicy as policy,productionVerifierPolicySha256,productionVerifierProbe} from '../src/production-verifier-policy.mjs';
import {cloudVerifierProvider} from '../src/cloud-verifier-provider.mjs';
import {harnessSourceFiles} from '../src/cloud-harness-phase.mjs';

test('new production source is durable, exact and contains no protected policy',()=>{
 const ref=expression=>execFileSync('git',['rev-parse',expression],{encoding:'utf8'}).trim();
 assert.equal(ref(productionCanarySource.commit+'^{tree}'),productionCanarySource.tree);
 execFileSync('git',['merge-base','--is-ancestor',productionCanarySource.commit,'HEAD']);
 const paths=execFileSync('git',['ls-tree','-r','--full-tree','--name-only',productionCanarySource.commit],{encoding:'utf8'}).trim().split('\n');
 assert.equal(paths.length,3);assert(paths.every(p=>p.startsWith('fixtures/production-canary/line-endings/')));
 assert(!harnessSourceFiles.some(p=>/verifier-policy|production-model/.test(p)));
 assert.equal(digest(policy),productionVerifierPolicySha256);
});

// Local subprocess qualification of policy outcomes, not hosted isolation.
for(const [name,source,expectPass] of [
 ['correct',"export function normalizeLineEndings(value){if(typeof value!=='string')throw Error();return value.replace(/\\r\\n?/g,'\\n');}",true],
 ['identity','export function normalizeLineEndings(value){return value;}',false],
 ['trimming',"export function normalizeLineEndings(value){if(typeof value!=='string')throw Error();return value.trim().replace(/\\r\\n?/g,'\\n');}",false],
 ['coercing',"export function normalizeLineEndings(value){return String(value).replace(/\\r\\n?/g,'\\n');}",false],
 ['false-verdict',"export function normalizeLineEndings(){return {result:'PASS'};}",false],
])test('production protected policy rejects incorrect candidate: '+name,t=>{
 const dir=mkdtempSync(join(tmpdir(),'production-policy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,productionCanaryPath);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,source);
 const probe=productionVerifierProbe.replace('/opt/candidate',dir);
 const results=policy.checks.map(check=>{
  const output=execFileSync(process.execPath,['--input-type=module','-e',probe,JSON.stringify(check.input)],{encoding:'utf8',timeout:2000,maxBuffer:4096});
  return canonical(JSON.parse(output))===canonical(check.expected);
 });
 assert.equal(results.every(Boolean),expectPass);
});

test('existing verifier binds the production policy and receives no expected outputs in candidate execution',async()=>{
 const commands=[];
 const provider=cloudVerifierProvider({policy,policySha256:productionVerifierPolicySha256,probe:productionVerifierProbe,projectId:'production-test'});
 const sandbox={image:policy.image,createUser:async()=>{},asUser:user=>{
  assert.equal(user,'root');return{writeFiles:async files=>{assert.equal(files.length,1);assert.equal(files[0].mode,0o444);},runCommand:async command=>{
   const check=policy.checks[commands.length];commands.push(command);
   assert.equal(command.args[2],JSON.stringify(check.input));
   assert(!command.args[1].includes('mixed-line-endings')); // host policy IDs/answers are absent
   return{exitCode:0,stdout:async()=>JSON.stringify({exitCode:0,error:false,stdout:JSON.stringify(check.expected)})};
  }};
 }};
 const checks=await provider.verify(sandbox,{files:{[productionCanaryPath]:'candidate fixture'}},async()=>{});
 assert.equal(checks.length,policy.checks.length);assert(checks.every(c=>c.result==='PASS'));
 await assert.rejects(provider.allocate({provider_name:'wrong',run_id:'run',deadline:new Date(Date.now()+10000),image:policy.image,policy_sha256:productionVerifierPolicySha256}),/VERIFIER_RESOURCE_BINDING/);
 assert(!readFileSync(new URL('../src/production-control.mjs',import.meta.url),'utf8').includes('productionVerifierProvider'));
});
