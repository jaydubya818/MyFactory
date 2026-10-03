import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,sha256} from '../../../packages/hosted-routing/src/result.ts';
const root=fileURLToPath(new URL('../../../',import.meta.url)),files={};
function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isSymbolicLink())throw Error('SOURCE_SYMLINK');if(e.isDirectory())scan(path);else if(/\.(?:ts|mjs|js)$/.test(e.name))files[relative(root,path)]=sha256(readFileSync(path));}}
for(const dir of ['apps/cloud-control/src','apps/cloud-control/api','apps/supervisor/src'])scan(join(root,dir));
for(const p of readdirSync(join(root,'packages'),{withFileTypes:true}).filter(p=>p.isDirectory())){try{scan(join(root,'packages',p.name,'src'));}catch(e){if(e.code!=='ENOENT')throw e;}}
for(const path of ['apps/cloud-control/scripts/cloud-source-identity.mjs','tsconfig.json','tsconfig.producer.json','package.json','package-lock.json','apps/cloud-control/package.json','apps/cloud-control/vercel.json','apps/cloud-control/tsconfig.json'])files[path]=sha256(readFileSync(join(root,path)));
const record={version:1,sourceDigest:digest(files)},destination=join(root,'apps/cloud-control/src/source-identity.json');
if(process.argv.includes('--write'))writeFileSync(destination,JSON.stringify(record,null,2)+'\n');
else if(JSON.stringify(JSON.parse(readFileSync(destination,'utf8')))!==JSON.stringify(record))throw Error('SOURCE_IDENTITY_CHANGED_REVIEW_AND_REPIN');
console.log(JSON.stringify(record));
