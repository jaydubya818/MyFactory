import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {cloudHarnessInstallScript} from '../src/cloud-harness-install.mjs';
import {cloudCodexPackage} from '../src/cloud-harness-plan.mjs';
const prefix='package/vendor/x86_64-unknown-linux-musl/';
async function install(entries,{version='codex-cli 0.157.0',fetchError,node='24.22.1',undici='7.30.1'}={}){
 const calls=[];let output='',error='',exitCode=0,fetches=0;
 const process={versions:{node,undici},getuid:()=>0,arch:'x64',platform:'linux',stdout:{write:s=>output+=s},stderr:{write:s=>error+=s},set exitCode(v){exitCode=v;}};
 const fs={mkdirSync(){},writeFileSync(){},unlinkSync(){},chmodSync(){},lstatSync(path){assert.equal(path,'/opt/factory-harness/bin/codex');return{isFile:()=>true,isSymbolicLink:()=>false,size:1000};}};
 const cp={execFileSync(file,args){calls.push([file,...args]);if(args[0]==='-tzf')return entries.join('\n')+'\n';if(args[0]==='-xzf')return '';assert.equal(file,'/opt/factory-harness/bin/codex');return version;}};
 const crypto={createHash:()=>({update:()=>({digest:()=>cloudCodexPackage.integrity.slice(7)})})};
 await runInNewContext(cloudHarnessInstallScript,{require:name=>({'node:fs':fs,'node:child_process':cp,'node:crypto':crypto}[name]),process,Buffer,AbortSignal,fetch:async()=>{fetches++;if(fetchError)throw Error(fetchError);return{ok:true,body:[Buffer.from('fixture')]};}});
 return{calls,output,error,exitCode,fetches};
}
test('Attempt 2: exact Codex package bin layout and companions install together',async()=>{
 const entries=[prefix+'codex-resources/bwrap',prefix+'bin/codex',prefix+'bin/codex-code-mode-host','package/package.json'];const r=await install(entries);
 assert.equal(r.exitCode,0);const extract=r.calls.find(x=>x[1]==='-xzf');assert(extract.includes('--strip-components=3'));for(const entry of entries.slice(0,3))assert(extract.includes(entry));assert(!extract.includes('package/package.json'));assert.equal(JSON.parse(r.output).version,'codex-cli 0.157.0');
});
test('old assumed layout, missing companion, traversal and wrong version fail closed',async()=>{
 for(const entries of [[prefix+'codex/codex'],[prefix+'bin/codex'],[prefix+'bin/codex','../escape']]){const r=await install(entries);assert.equal(r.exitCode,1);assert.equal(r.error,'HARNESS_PACKAGE_LAYOUT');}
 const r=await install([prefix+'bin/codex',prefix+'codex-resources/bwrap',prefix+'bin/codex-code-mode-host'],{version:'codex-cli other'});assert.equal(r.error,'HARNESS_VERSION_MISMATCH');
});
test('installer diagnostics never echo arbitrary provider data',async()=>{const r=await install([],{fetchError:'secret-provider-response'});assert.equal(r.error,'HARNESS_INSTALL_FAILED');assert.equal(r.output,'');assert.equal(r.exitCode,1);});

test('unsafe worker runtime fails before registry fetch or installation',async()=>{
 for(const runtime of [{node:'24.19.0',undici:'7.29.0'},{node:'24.22.1',undici:'7.30.0'},{node:'24.22.1',undici:undefined}]){
  const r=await install([],{...runtime,undici:runtime.undici??'unknown'});
  assert.equal(r.error,'PATCHED_NODE_RUNTIME_REQUIRED');assert.equal(r.exitCode,1);assert.equal(r.fetches,0);assert.deepEqual(r.calls,[]);
 }
});
