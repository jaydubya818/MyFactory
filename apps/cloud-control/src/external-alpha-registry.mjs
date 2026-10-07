import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,normalize} from 'node:path';
import {assertRegistry} from './private-source.mjs';

/*
 * The private-source registry (private repository names, base commits and trees of the tester workspaces) is a
 * DEPLOY-TIME input, never source code. This module loads it from exactly one of:
 *   FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON  inline value (a secret environment variable), or
 *   FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_FILE  absolute path of a root-owned secret file (name only here)
 * and requires FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256 to equal the sha256 of the exact bytes read.
 * Format: {"version":1,"kind":"EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_V1","entries":{"slot-1":{slot,owner,repo,commit,tree},...}}
 * Absent, malformed or digest-mismatched input fails closed with PRIVATE_SOURCE_REGISTRY.
 */
export const registryKind='EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_V1';
const maxBytes=16384;
const fail=()=>{throw Error('PRIVATE_SOURCE_REGISTRY');};

async function readPinnedFile(path){
 if(typeof path!=='string'||path.length>1024||!isAbsolute(path)||normalize(path)!==path||path.includes('\0'))fail();
 // O_NOFOLLOW: a symlink at the final component is refused by the kernel; the digest is of the bytes read from this handle.
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW).catch(fail);
 try{
  const stat=await handle.stat();
  if(!stat.isFile()||stat.size<2||stat.size>maxBytes||(stat.mode&0o022)!==0)fail();
  const {bytesRead,buffer}=await handle.read(Buffer.alloc(maxBytes+1),0,maxBytes+1,0);
  if(bytesRead!==stat.size)fail();
  return buffer.subarray(0,bytesRead);
 }finally{await handle.close();}
}

/** Loads and digest-checks the registry. `reader` is a test seam for the file read only. */
export async function loadPrivateSourceRegistry(env,{reader=readPinnedFile}={}){
 const inline=env?.FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON,file=env?.FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_FILE,pin=env?.FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256;
 if(!!inline===!!file||!/^[a-f0-9]{64}$/.test(pin??''))fail();
 const bytes=inline?Buffer.from(inline,'utf8'):await reader(file);
 if(bytes.length<2||bytes.length>maxBytes||createHash('sha256').update(bytes).digest('hex')!==pin)fail();
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail();}
 if(!value||Object.keys(value).sort().join(',')!=='entries,kind,version'||value.version!==1||value.kind!==registryKind)fail();
 const entries=assertRegistry(value.entries);
 return Object.freeze(Object.fromEntries(Object.entries(entries).map(([slot,e])=>[slot,Object.freeze({slot:e.slot,owner:e.owner,repo:e.repo,commit:e.commit,tree:e.tree})])));
}

/** The registry entry must be the very workspace this Factory installation pins (repository, base commit and tree). */
export function registryEntryFor(registry,installation){
 assertRegistry(registry);
 const entry=Object.hasOwn(registry,'slot-'+installation.slot)?registry['slot-'+installation.slot]:undefined;
 if(!entry||`${entry.owner}/${entry.repo}`!==installation.source.repository||entry.commit!==installation.source.baseSha||entry.tree!==installation.source.treeSha)fail();
 return entry;
}
