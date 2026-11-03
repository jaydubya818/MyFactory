import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {assertPatchedNodeRuntime} from '../../../packages/contracts/src/node-runtime.ts';

const require=createRequire(import.meta.url);
const queueRequire=createRequire(require.resolve('@vercel/queue'));
const sandboxRequire=createRequire(require.resolve('@vercel/sandbox'));

test('patched minimatch preserves Queue development route matching',()=>{
 const {minimatch}=queueRequire('minimatch');
 // Same two-argument call as Queue 0.7.0 matchesFunctionsPattern.
 for(const [file,pattern,expected] of [
  ['api/alpha-work.mjs','api/*.mjs',true],['src/api/alpha-work.mjs','api/*.mjs',false],
  ['api/nested/work.mjs','api/*.mjs',false],['api/nested/work.mjs','api/**/*.mjs',true],
  ['api/work.ts','api/*.{ts,mjs}',true],['api/work.js','api/*.{ts,mjs}',false],
  ['api/.hidden.mjs','api/*.mjs',false],['api/work.mjs','api/work.mjs',true],
  ['src/app/api/work/route.ts','src/app/**/route.ts',true],
 ]) assert.equal(file===pattern||minimatch(file,pattern),expected,`${file} / ${pattern}`);
});

test('both exact CLI-config parents retain auth and global config parsing',t=>{
 const directory=mkdtempSync(join(tmpdir(),'factory-config-compat-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const supervisorRequire=createRequire(new URL('../../supervisor/package.json',import.meta.url));
 for(const parent of [require,supervisorRequire]){
  const oidc=createRequire(parent.resolve('@vercel/oidc'));
  const {readAuthConfigFile,readGlobalConfigFile}=oidc('@vercel/cli-config');
  const auth={token:'synthetic-token-only',refreshToken:'synthetic-refresh-only',expiresAt:123,custom:'preserved'};
  const config={currentTeam:'synthetic-team',credStorage:'file',telemetry:{enabled:false},custom:'preserved'};
  const path=join(directory,'config.json');
  writeFileSync(path,JSON.stringify(auth));assert.deepEqual(readAuthConfigFile(path),auth);
  writeFileSync(path,JSON.stringify(config));assert.deepEqual(readGlobalConfigFile(path),config);
  writeFileSync(path,JSON.stringify({token:123}));assert.throws(()=>readAuthConfigFile(path));
 }
});

test('oversized constrained Zod collections reject within bounded memory',()=>{
 const program=`import {z} from 'zod';
  for(const [schema,input] of [[z.array(z.number()).max(4),Array(100000).fill('bad')],
   [z.set(z.number()).max(4),new Set(Array.from({length:100000},(_,i)=>String(i)))],
   [z.map(z.string(),z.number()).max(4),new Map(Array.from({length:100000},(_,i)=>[i,'bad']))]]){
   const r=schema.safeParse(input);if(r.success||r.error.issues.length!==1)throw Error('collection did not fail early');
  }`;
 execFileSync(process.execPath,['--max-old-space-size=64','--input-type=module','-e',program],
  {cwd:new URL('../../../',import.meta.url),timeout:10000,stdio:'pipe'});
});

test('patched npm and bundled fetch reject excessive content encodings',async t=>{
 const server=createServer((_request,response)=>{
  response.writeHead(200,{'content-encoding':Array(100).fill('gzip').join(',')});response.end('fixture');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 for(const transport of [globalThis.fetch,require('undici').fetch,sandboxRequire('undici').fetch]){
  await assert.rejects(async()=>{const response=await transport(origin,{signal:AbortSignal.timeout(3000)});await response.text();},
   error=>/too many content-encodings/.test(String(error.cause?.message??error.message)));
 }
});

test('old or malformed Node transports cannot pass the runtime prerequisite',()=>{
 assertPatchedNodeRuntime();
 for(const [node,undici] of [['24.19.0','7.29.0'],['24.22.0','7.30.1'],['24.22.1','7.30.0'],
  ['25.0.0','7.30.1'],['24.22.1-rc.1','7.30.1'],['24.22.1','unknown']]){
  assert.throws(()=>assertPatchedNodeRuntime(node,undici),/PATCHED_NODE_RUNTIME_REQUIRED/);
 }
 assertPatchedNodeRuntime('24.22.1','7.30.1');
 assertPatchedNodeRuntime('24.23.0','7.31.0');
});

test('unsafe host bootstraps reject before storage or network initialization',t=>{
 const directory=mkdtempSync(join(tmpdir(),'factory-runtime-rejection-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const dataDir=join(directory,'must-not-exist');
 for(const entry of ['supervisor','cloud']){
  const program=`import assert from 'node:assert/strict';
   Object.defineProperty(process,'versions',{value:{...process.versions,node:'24.19.0',undici:'7.29.0'}});
   let fetches=0;globalThis.fetch=()=>{fetches++;throw Error('unexpected network');};
   await assert.rejects(async()=>{
    if(${JSON.stringify(entry)}==='supervisor'){
     const {createSupervisor}=await import('./apps/supervisor/src/server.ts');createSupervisor({dataDir:${JSON.stringify(dataDir)}});
    }else await import('./apps/cloud-control/api/alpha-work.mjs');
   },/PATCHED_NODE_RUNTIME_REQUIRED/);assert.equal(fetches,0);`;
  execFileSync(process.execPath,['--input-type=module','-e',program],
   {cwd:new URL('../../../',import.meta.url),timeout:10000,stdio:'pipe'});
  assert.equal(existsSync(dataDir),false);
 }
});
