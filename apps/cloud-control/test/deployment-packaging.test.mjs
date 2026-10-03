import test from 'node:test';
import {globSync} from 'node:fs';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,copyFile,symlink,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../../..');
// Vercel's Node builder emits traced TS as .js but leaves explicit .ts imports
// in .mjs. includeFiles preserves reviewed source for Node 24 type stripping.
test('deployed MJS entries retain the explicit TypeScript dependency closure',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'factory-deployed-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(join(dir,'package.json'),'{"type":"module"}');
 await cp(join(root,'apps/cloud-control/api'),join(dir,'apps/cloud-control/api'),{recursive:true});
 await cp(join(root,'apps/cloud-control/src'),join(dir,'apps/cloud-control/src'),{recursive:true,filter:p=>!p.endsWith('.ts')});
 await mkdir(join(dir,'packages/hosted-routing/src'),{recursive:true});
 await copyFile(join(root,'packages/hosted-routing/src/index.mjs'),join(dir,'packages/hosted-routing/src/index.mjs'));
 await symlink(join(root,'node_modules'),join(dir,'node_modules'));
 const run=()=>execFileSync(process.execPath,['--input-type=module','-e',`import {handleCloud} from './apps/cloud-control/api/cloud.mjs'; const r=await handleCloud(new Request('https://staging.invalid/api/connect/v2/actions'),{}); if(r.status!==401)throw Error('AUTH_NOT_ENFORCED');`],{cwd:dir,encoding:'utf8',stdio:'pipe'});
 assert.throws(run,e=>String(e.stderr).includes('ERR_MODULE_NOT_FOUND'));
 const config=JSON.parse(await readFile(join(root,'apps/cloud-control/vercel.json'),'utf8'));
 for(const f of Object.values(config.functions))assert.equal(f.includeFiles,config.functions['api/*.mjs'].includeFiles);
 const pattern=config.functions['api/*.mjs'].includeFiles;assert(pattern.length<=256,'Vercel includeFiles schema bound');
 const files=pattern.slice(1,-1).split(',').flatMap(part=>globSync(part,{cwd:join(root,'apps/cloud-control')}));
 for(const path of files){const source=resolve(root,'apps/cloud-control',path),relative=source.slice(root.length+1),target=join(dir,relative);assert(!relative.startsWith('..'));await mkdir(dirname(target),{recursive:true});await copyFile(source,target);}
 assert.equal(run(),'');
});
