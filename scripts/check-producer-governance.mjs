import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const inventory=JSON.parse(readFileSync(join(root,'docs/evidence/q37-producer-attestation/source-inventory.json'),'utf8'));
const extension=JSON.parse(readFileSync(join(root,'docs/evidence/connected-execution/source-inventory.json'),'utf8'));
const baseline=new Set(execFileSync('git',['ls-tree','-r','--name-only',inventory.baseline],{cwd:root,encoding:'utf8'}).trim().split('\n'));
const sources=[];
function walk(dir){for(const f of readdirSync(dir,{withFileTypes:true})){const path=join(dir,f.name);if(f.isDirectory())walk(path);else if(/\.(ts|mjs|js)$/.test(f.name))sources.push(relative(root,path));}}
walk(join(root,'apps/supervisor/src'));
for(const p of readdirSync(join(root,'packages'),{withFileTypes:true}).filter(p=>p.isDirectory())){
  const src=join(root,'packages',p.name,'src');try{walk(src);}catch(e){if(e.code!=='ENOENT')throw e;}
}
const added=sources.filter(p=>!baseline.has(p)).sort(), entries=[...new Set([
  ...Object.keys(inventory.sources),...Object.keys(extension.added)
])].sort();
if(JSON.stringify(added)!==JSON.stringify(entries))throw new Error('UNKNOWN producer runtime source or stale inventory');
for(const [file,entry] of Object.entries({...inventory.sources,...extension.added,...extension.modified})){
  if(!entry.classification||!entry.authorityBoundary)throw new Error(`Missing review: ${file}`);
  if(createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')!==entry.sha256)throw new Error(`Unreviewed source change: ${file}`);
}
console.log(`Q37 producer governance PASS: ${added.length} inventoried new runtime sources; ${Object.keys(extension.modified).length} reviewed modified sources; UNKNOWN=0`);
