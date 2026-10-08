import {createHash} from 'node:crypto';
import {readPinnedFile,assertExternalAlphaRegistry} from './external-alpha-registry.mjs';
import {snapshotByteLimit} from './private-source.mjs';

const fail=()=>{throw Error('PRIVATE_SOURCE_SNAPSHOT_MANIFEST');};
export const snapshotsKind='EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_V1';
/** Deployment custody references only. Credentials and private source bytes are never configuration or caller input. */
export async function loadPrivateSnapshots(env,registry,{reader=readPinnedFile}={}){
 assertExternalAlphaRegistry(registry);
 const inline=env?.FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_JSON,file=env?.FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_FILE,pin=env?.FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_SHA256;
 if(!!inline===!!file||!/^[a-f0-9]{64}$/.test(pin??''))fail();
 let bytes;try{bytes=inline?Buffer.from(inline):await reader(file);}catch{fail();}
 if(!Buffer.isBuffer(bytes)||bytes.length<2)fail();
 if(bytes.length>16384||createHash('sha256').update(bytes).digest('hex')!==pin)fail();
 let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail();}
 if(Object.keys(value??{}).sort().join(',')!=='entries,kind,version'||value.version!==1||value.kind!==snapshotsKind||Object.keys(value.entries??{}).sort().join(',')!==Object.keys(registry).sort().join(','))fail();
 const out={};
 for(const [slot,e] of Object.entries(registry)){
  const r=value.entries[slot];
  assertPrivateSnapshotReceipt(e,r);
  out[slot]=Object.freeze({...r});
 }
 return Object.freeze(out);
}

export function assertPrivateSnapshotReceipt(entry,receipt){
 const r=receipt;
 if(Object.keys(r??{}).sort().join(',')!=='bytes,commit,path,repository,sha256,tree'||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256)||r.path!==`factory/private-source/${entry.slot}/${r.sha256}.json`||!Number.isSafeInteger(r.bytes)||r.bytes<2||r.bytes>snapshotByteLimit||r.repository!==`${entry.owner}/${entry.repo}`||r.commit!==entry.commit||r.tree!==entry.tree)fail();
 return r;
}
