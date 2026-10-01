import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {executionContext,assertImplementationProgress} from '../src/execution-context.ts';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'factory-context-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const git=(...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');mkdirSync(join(dir,'test'));writeFileSync(join(dir,'package.json'),'{}');writeFileSync(join(dir,'README.md'),'Positive integers only.');writeFileSync(join(dir,'test/quantity.test.mjs'),'// protected tests');git('add','.');git('commit','-qm','approved');return{dir,git,sha:git('rev-parse','HEAD')};}
test('Attempt 4 inspection is deterministic zero-call context with missing target explicitly represented',async t=>{
 const f=fixture(t);const c=JSON.parse(await executionContext(f.dir,f.sha,['quantity.mjs']));
 assert.equal(c.files['quantity.mjs'],null);assert.equal(c.files['README.md'],'Positive integers only.');assert(c.files['test/quantity.test.mjs']);assert(c.files['package.json']);
 await assert.rejects(assertImplementationProgress(f.dir,f.sha,['quantity.mjs']),/no source changes/);
 writeFileSync(join(f.dir,'quantity.mjs'),'console.log(1)');await assertImplementationProgress(f.dir,f.sha,['quantity.mjs']);
 assert.equal(JSON.parse(await executionContext(f.dir,f.sha,['quantity.mjs'],true)).files['quantity.mjs'],'console.log(1)');
 writeFileSync(join(f.dir,'README.md'),'unallowed');await assert.rejects(assertImplementationProgress(f.dir,f.sha,['quantity.mjs']),/outside/);
});
test('untracked credentials are not context; symlinks, changed HEAD and oversized source fail closed',async t=>{
 const f=fixture(t);writeFileSync(join(f.dir,'.env'),'synthetic-secret');assert(!(await executionContext(f.dir,f.sha,['quantity.mjs'])).includes('synthetic-secret'));rmSync(join(f.dir,'.env'));
 symlinkSync('/etc/passwd',join(f.dir,'quantity.mjs'));await assert.rejects(executionContext(f.dir,f.sha,['quantity.mjs'],true),/Symlink/);rmSync(join(f.dir,'quantity.mjs'));
 writeFileSync(join(f.dir,'README.md'),'x'.repeat(70000));f.git('add','.');f.git('commit','-qm','oversized');await assert.rejects(executionContext(f.dir,f.sha,['quantity.mjs']),/base changed/);await assert.rejects(executionContext(f.dir,f.git('rev-parse','HEAD'),['quantity.mjs']));
});
