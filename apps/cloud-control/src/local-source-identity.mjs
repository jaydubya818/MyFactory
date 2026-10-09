import {readFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {digest,sha256} from '../../../packages/hosted-routing/src/result.ts';
export function localSourceIdentity(root) {
 const files={};
 function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isSymbolicLink())throw Error('LOCAL_SOURCE_SYMLINK');if(e.isDirectory())scan(path);else if(/\.(ts|mjs|js)$/.test(e.name))files[relative(root,path)]=sha256(readFileSync(path));}}
 for(const dir of ['apps/cloud-control/src','apps/supervisor/src','packages/hosted-routing/src','packages/contracts/src','packages/storage/src'])scan(join(root,dir));
 for(const p of ['package.json','package-lock.json'])files[p]=sha256(readFileSync(join(root,p)));
 return digest(files);
}
