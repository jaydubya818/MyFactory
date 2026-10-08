import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {checkpointScript} from '../src/cloud-harness-checkpoint.mjs';
import {validateCandidateBundle} from '../src/candidate-custody.mjs';

for(const baselinePassed of [true,false])test(`npm test checkpoint executes the complete pinned suite: baseline ${baselinePassed?'passes':'fails'}`,t=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-checkpoint-')),repo=join(dir,'repo');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(repo,'test'),{recursive:true});mkdirSync(join(repo,'src'));
 writeFileSync(join(repo,'package.json'),JSON.stringify({private:true,type:'module',scripts:{test:'node --test'}}));
 writeFileSync(join(repo,'src/app.mjs'),'export const value=1;\n');
 writeFileSync(join(repo,'test/focus.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {value} from '../src/app.mjs';test('focus passes',()=>assert.equal(value,2));\n");
 writeFileSync(join(repo,'test/baseline.test.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';test('whole-suite baseline',()=>assert.equal(${baselinePassed},true));\n`);
 const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:'pipe'}).trim();
 git(['init','--quiet']);git(['add','--all']);git(['-c','user.name=Fixture','-c','user.email=fixture@invalid','commit','--quiet','-m','Pinned baseline']);
 const source={repository:'fixture/alpha',commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}'])};
 writeFileSync(join(repo,'src/app.mjs'),'export const value=2;\n');
 // The former single-file implementation would pass both cases.
 execFileSync(process.execPath,['--test','test/focus.test.mjs'],{cwd:repo,stdio:'pipe'});
 const plan={source,allowedPaths:['src/app.mjs'],testPath:'test/focus.test.mjs',checkCommand:'npm test',commitMessage:'Fixture candidate',authorName:'Fixture',authorEmail:'fixture@invalid'};
 const manifest=JSON.parse(execFileSync(process.execPath,['-e',checkpointScript(plan).replaceAll('/home/factoryproducer',dir),'1'],{cwd:repo,encoding:'utf8',stdio:'pipe'}));
 const candidate=validateCandidateBundle(readFileSync(join(dir,'checkpoint-1.json')),{source,input:{allowedPaths:plan.allowedPaths,checkCommands:['npm test']}});
 const check=candidate.bundle.checks[0];
 assert.equal(manifest.passed,baselinePassed);assert.equal(check.command,'npm test');assert.equal(check.exitCode===0,baselinePassed);
 assert.match(check.log,/> node --test\n/);assert.match(check.log,/whole-suite baseline/);assert.match(check.log,/focus passes/);
 assert.equal(candidate.tree,manifest.tree);assert.equal(candidate.bundle.sourceFiles['test/baseline.test.mjs'],candidate.bundle.files['test/baseline.test.mjs']);
});

test('checkpoint refuses arbitrary or mislabeled test commands before execution',()=>{
 for(const checkCommand of ['npm test -- --extra','npm test; echo altered','node --test other.test.mjs','node -e 1']){
  assert.throws(()=>checkpointScript({checkCommand,testPath:'test/focus.test.mjs'}),/CHECK_COMMAND_UNSUPPORTED/);
 }
});
