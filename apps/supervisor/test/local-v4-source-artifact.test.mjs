// Tiny pure preparation/registration denials before any filesystem effect.
// These data-only probes issue no genuine artifact, native/C guard or authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createLocalV4SourceArtifacts} from '../src/local-v4-source-artifact.ts';
const binding='a'.repeat(64),deadline=()=>performance.now()+30000;
const source=files=>Object.freeze({schema:'local-v4-fixture-source/v1',runId:'public-run',workOrderId:'public-work',
  kind:'IMPLEMENTATION',commit:null,tree:'0'.repeat(40),files:Object.freeze(files)});
for(const path of ['relative','/not/../canonical','/nul\0path'])test('owned source constructor refuses noncanonical path data '+JSON.stringify(path),()=>assert.throws(()=>createLocalV4SourceArtifacts(path),{code:'local_verification_input_hold'}));
test('owned source construction has no eager filesystem effects',()=>{assert(createLocalV4SourceArtifacts('/public-nonexistent-inert-data-only'))});
for(const fields of [{},{'../escape':'tiny'},{'.git/config':'tiny'},{'sample.txt':'tiny\0text'},{'file.txt':123}])test('owned source pure graph refusal before filesystem '+JSON.stringify(fields),async()=>{
 const store=createLocalV4SourceArtifacts('/public-nonexistent-inert-data-only');await assert.rejects(store.prepare(source(fields),binding,deadline(),()=>{}),{code:'local_verification_input_hold'});
});
test('owned source rejects wrong tree before creating its namespace',async()=>{const store=createLocalV4SourceArtifacts('/public-nonexistent-inert-data-only');await assert.rejects(store.prepare(source({'sample.txt':'tiny\n'}),binding,deadline(),()=>{}),{code:'local_verification_input_hold'})});
for(const fence of [undefined,()=>true,async()=>{}])test('owned source requires synchronous void current denial '+String(fence),async()=>{
 const store=createLocalV4SourceArtifacts('/public-nonexistent-inert-data-only');await assert.rejects(store.prepare(source({'sample.txt':'tiny\n'}),binding,deadline(),fence),{code:'local_verification_input_hold'});
});
test('owned source preserves the actual current-authority exception',async()=>{const store=createLocalV4SourceArtifacts('/public-nonexistent-inert-data-only'),error=Error('Current authority denied');await assert.rejects(store.prepare(source({'sample.txt':'tiny'}),binding,deadline(),()=>{throw error}),e=>e===error)});
test('owned source refuses a plain descriptor without private registration',()=>{const store=createLocalV4SourceArtifacts('/public-nonexistent-inert-data-only');assert.throws(()=>store.assert({schema:'local-v4-source-artifact/v1',path:'/inert',tree:'0'.repeat(40),manifestSha256:binding},source({'sample.txt':'tiny'}),binding,()=>{}),{code:'local_verification_input_hold'})});
test('owned source refuses an expired preparation budget before filesystem',async()=>{const store=createLocalV4SourceArtifacts('/public-nonexistent-inert-data-only');await assert.rejects(store.prepare(source({'sample.txt':'tiny'}),binding,performance.now()-1,()=>{}),{code:'local_verification_input_hold'})});

test('unregistered descriptor data does not poison unrelated current-authority validation',async()=>{const store=createLocalV4SourceArtifacts('/public-nonexistent-inert-data-only');assert.throws(()=>store.assert({},source({'sample.txt':'tiny'}),binding,()=>{}),{code:'local_verification_input_hold'});const error=Error('Actual current authority denied');await assert.rejects(store.prepare(source({'sample.txt':'tiny'}),binding,deadline(),()=>{throw error}),e=>e===error)});

// Actual descriptor-lifetime bodies with inert numeric handles, no native I/O.
for(const name of ['write','read'])test('owned source '+name+' closes its descriptor when the post-open denial throws',()=>{
 const sourceText=readFileSync(new URL('../src/local-v4-source-artifact.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('artifact.ts',sourceText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let declaration;
 function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)declaration=n;ts.forEachChild(n,visit)}visit(ast);assert(declaration);
 let guards=0,opens=0,closes=0;const denied=Error('Current connection denied after open');
 const deps={guard:()=>{if(++guards===2)throw denied},openSync:()=>{opens++;return 42},closeSync:fd=>{assert.equal(fd,42);closes++},constants:{O_WRONLY:1,O_CREAT:2,O_EXCL:4,O_NOFOLLOW:8,O_RDONLY:16,O_NONBLOCK:32}};
 const code=ts.transpileModule('const '+declaration.getText(ast)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const call=new Function(...Object.keys(deps),code+'return '+name+';')(...Object.values(deps));
 assert.throws(()=>name==='write'?call('/inert',Buffer.from('tiny'),0o444,()=>{}):call('/inert',{size:4,identity:'inert',sha256:binding},100,()=>{}),error=>error===denied);assert.equal(opens,1);assert.equal(closes,1);
});
