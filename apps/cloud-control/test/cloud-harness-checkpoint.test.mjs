import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {harnessCheckpointScript,unchangedCandidateScript} from '../src/cloud-harness-checkpoint.mjs';
import {cloudSource,allowedPaths,checkCommand,deterministicSolution} from '../src/cloud-work-plan.mjs';
import {validateCandidateBundle} from '../src/candidate-custody.mjs';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
for(const mode of ['passing','failing','outside-scope'])test('host checkpoint preserves exact custody and visible checks: '+mode,t=>{
 const dir=mkdtempSync(join(tmpdir(),'cloud-checkpoint-')),repo=join(dir,'repo');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 execFileSync('git',['clone','--quiet','--no-checkout',repository,repo],{stdio:'pipe'});execFileSync('git',['checkout','--quiet','--detach',cloudSource.commit],{cwd:repo});
 writeFileSync(join(repo,allowedPaths[0]),mode==='failing'?'export function projectSlug(value) { return "incorrect"; }\n':deterministicSolution);
 if(mode==='outside-scope')writeFileSync(join(repo,'unexpected.txt'),'outside');
 const script=harnessCheckpointScript.replaceAll('/home/factoryproducer',dir),run=()=>execFileSync(process.execPath,['-e',script,'1'],{cwd:repo,encoding:'utf8',stdio:'pipe'});
 if(mode==='outside-scope'){assert.throws(run);return;}
 const manifest=JSON.parse(run()),bytes=readFileSync(join(dir,'checkpoint-1.json'));
 const validated=validateCandidateBundle(bytes,{source:cloudSource,input:{allowedPaths,checkCommands:[checkCommand]}});
 assert.equal(manifest.sha256,validated.sha256);assert.equal(manifest.tree,validated.tree);assert.equal(manifest.passed,mode==='passing');
 assert.equal(execFileSync(process.execPath,['-e',unchangedCandidateScript(validated.tree)],{cwd:repo,encoding:'utf8'}),'UNCHANGED');
 writeFileSync(join(repo,allowedPaths[0]),'mutated');assert.throws(()=>execFileSync(process.execPath,['-e',unchangedCandidateScript(validated.tree)],{cwd:repo,stdio:'pipe'}));
});
