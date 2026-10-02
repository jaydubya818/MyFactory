import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileTree,validateCandidateBundle} from '../src/candidate-custody.mjs';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'factory-custody-test-'));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:dir,env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@invalid'}});
 try{
  git('init','-q');const sourceFiles={'folder/file.mjs':'export const value = 0;\n','folder.other':'preserved\n'};
  for(const [path,text] of Object.entries(sourceFiles)){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),text);}
  git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD').toString().trim(),baseTree=git('rev-parse','HEAD^{tree}').toString().trim();
  const files={...sourceFiles,'folder/file.mjs':'export const value = 1;\n'};writeFileSync(join(dir,'folder/file.mjs'),files['folder/file.mjs']);git('add','.');git('commit','-qm','candidate');
  const commit=git('rev-parse','HEAD').toString().trim(),tree=git('rev-parse','HEAD^{tree}').toString().trim(),at=new Date().toISOString();
  const bundle={version:1,base,commit,tree,sourceFiles,files,commitBase64:git('cat-file','commit',commit).toString('base64'),treeBase64:git('cat-file','tree',tree).toString('base64'),patchBase64:git('show','--format=','--binary','--no-ext-diff','--no-textconv',commit).toString('base64'),checks:[{command:'node --test',exitCode:0,startedAt:at,finishedAt:at,log:'pass'}]};
  return{bundle,request:{source:{commit:base,tree:baseTree},input:{allowedPaths:['folder/file.mjs'],checkCommands:['node --test']}}};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('cloud custody computes exactly the same nested tree and commit as Git without invoking Git during validation',()=>{
 const {bundle,request}=fixture();assert.equal(fileTree(bundle.sourceFiles).sha,request.source.tree);assert.equal(validateCandidateBundle(Buffer.from(JSON.stringify(bundle)),request).commit,bundle.commit);
});
test('cloud custody rejects source substitution, candidate tampering, scope escalation and malformed files',()=>{
 const f=fixture();for(const mutate of [b=>b.sourceFiles['folder.other']='other',b=>b.files['folder/file.mjs']='changed',b=>b.commit='a'.repeat(40),b=>b.treeBase64='',b=>b.commitBase64+='=',b=>b.patchBase64=Buffer.from(Buffer.from(b.patchBase64,'base64').toString().replace('+export const value = 1;','+export const value = 9;')).toString('base64'),b=>b.checks[0].command='unauthorized',b=>b.files['../escape']='x',b=>b.files.folder='collision',b=>b.files['folder/file.mjs']='\0']){const b=structuredClone(f.bundle);mutate(b);assert.throws(()=>validateCandidateBundle(Buffer.from(JSON.stringify(b)),f.request));}
 assert.throws(()=>validateCandidateBundle(Buffer.from(JSON.stringify(f.bundle)),{...f.request,input:{...f.request.input,allowedPaths:['other']}}),/PATH_DENIED/);
});
