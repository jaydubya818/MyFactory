import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const inventory=JSON.parse(readFileSync(join(root,'docs/evidence/q37-producer-attestation/source-inventory.json'),'utf8'));
const spend=JSON.parse(readFileSync(join(root,'docs/evidence/myfactory-spend/source-inventory.json'),'utf8'));
const baseline=new Set(execFileSync('git',['ls-tree','-r','--name-only',inventory.baseline],{cwd:root,encoding:'utf8'}).trim().split('\n'));
const sources=[];
function walk(dir){for(const f of readdirSync(dir,{withFileTypes:true})){const path=join(dir,f.name);if(f.isDirectory())walk(path);else if(/\.(ts|mjs|js)$/.test(f.name))sources.push(relative(root,path));}}
walk(join(root,'apps/supervisor/src'));
for(const p of readdirSync(join(root,'packages'),{withFileTypes:true}).filter(p=>p.isDirectory())){
  const src=join(root,'packages',p.name,'src');try{walk(src);}catch(e){if(e.code!=='ENOENT')throw e;}
}
const added=sources.filter(p=>!baseline.has(p)).sort(), entries=[...Object.keys(inventory.sources),...Object.keys(spend.newSources)].sort();
if(JSON.stringify(added)!==JSON.stringify(entries))throw new Error('UNKNOWN producer runtime source or stale inventory');
for(const [file,entry] of Object.entries(inventory.sources)){
  if(!entry.classification||!entry.authorityBoundary)throw new Error(`Missing review: ${file}`);
  const current=spend.changedSources[file]?.sha256??entry.sha256;
  if(createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')!==current)throw new Error(`Unreviewed source change: ${file}`);
}
for(const [file,entry] of Object.entries({...spend.newSources,...spend.changedSources})){
  if(!entry.classification||!entry.authorityBoundary||!entry.sha256)throw new Error(`Missing spend review: ${file}`);
  if(createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')!==entry.sha256)throw new Error(`Unreviewed spend source change: ${file}`);
}
console.log(`Q37 + spend producer governance PASS: ${added.length} new runtime sources; UNKNOWN=0; historical inventory preserved`);
