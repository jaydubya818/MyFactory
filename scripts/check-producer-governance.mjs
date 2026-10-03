import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const inventory=JSON.parse(readFileSync(join(root,'docs/evidence/myfactory-private-alpha-reconstruction/source-inventory.json'),'utf8'));
const baseline=inventory.baseline;
if(baseline!=='8f5e3774129b5f9f4b1c9655ffbbb531cd20fa0f')throw Error('Unexpected reconstruction baseline');
const paths=[];
function walk(dir){for(const f of readdirSync(dir,{withFileTypes:true})){const path=join(dir,f.name);if(f.isDirectory())walk(path);else if(/\.(ts|mjs|js)$/.test(f.name))paths.push(relative(root,path));}}
walk(join(root,'apps/supervisor/src'));
walk(join(root,'apps/cloud-control/src'));
walk(join(root,'apps/cloud-control/api'));
for(const p of readdirSync(join(root,'packages'),{withFileTypes:true}).filter(p=>p.isDirectory())){
 const dir=join(root,'packages',p.name,'src');try{walk(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const changed=[];
for(const file of paths){
 const current=hash(readFileSync(join(root,file)));
 let previous=null;
 try{previous=hash(execFileSync('git',['show',`${baseline}:${file}`],{cwd:root,maxBuffer:5_000_000,stdio:['ignore','pipe','ignore']}));}catch{}
 if(current!==previous){
  changed.push(file);
  const entry=inventory.sources[file];
  if(!entry||entry.sha256!==current||!entry.classification||!entry.authorityBoundary)throw Error(`Unreviewed producer source: ${file}`);
 }
}
const listed=Object.keys(inventory.sources).sort();
if(JSON.stringify(changed.sort())!==JSON.stringify(listed))throw Error('Stale or missing source inventory');
console.log(`Reconstruction producer governance PASS: ${listed.length} reviewed changed runtime sources; UNKNOWN=0`);
