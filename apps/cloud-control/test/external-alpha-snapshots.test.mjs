import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,symlinkSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadPrivateSnapshots,snapshotsKind} from '../src/external-alpha-snapshots.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const registry=Object.fromEntries([1,2].map(n=>['slot-'+n,{slot:'slot-'+n,owner:'fixture-org',repo:'fixture-workspace-0'+n,commit:String(n).repeat(40),tree:String(n+2).repeat(40)}]));
const entries=Object.fromEntries(Object.entries(registry).map(([slot,e])=>[slot,{repository:e.owner+'/'+e.repo,commit:e.commit,tree:e.tree,path:`factory/private-source/${slot}/${'a'.repeat(64)}.json`,sha256:'a'.repeat(64),bytes:100}]));
const value={version:1,kind:snapshotsKind,entries},text=JSON.stringify(value);
const env=s=>({FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_JSON:s,FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_SHA256:sha(s)});
const denied=p=>assert.rejects(p,/PRIVATE_SOURCE_SNAPSHOT_MANIFEST/);
test('manifest is byte pinned, immutable, and exact for both configured owner slots',async()=>{
 const loaded=await loadPrivateSnapshots(env(text),registry);assert.deepEqual(loaded,entries);assert(Object.isFrozen(loaded));assert(Object.isFrozen(loaded['slot-1']));
 for(const config of [{},undefined,{...env(text),FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_SHA256:'0'.repeat(64)},{...env(text+' '),FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_SHA256:sha(text)},{...env(text),FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_FILE:'/fixture'}])await denied(loadPrivateSnapshots(config,registry));
});
test('correct digest cannot authorize cross-owner/base/tree/path, omitted slots, credentials or unbounded receipts',async()=>{
 const mutations=[v=>v.kind='OTHER',v=>v.version=2,v=>v.extra=true,v=>delete v.entries['slot-2'],v=>v.entries['slot-1'].repository='foreign/fixture-workspace-01',v=>v.entries['slot-1'].commit='f'.repeat(40),v=>v.entries['slot-1'].tree='f'.repeat(40),v=>v.entries['slot-1'].path=v.entries['slot-2'].path,v=>v.entries['slot-1'].sha256=['a'.repeat(64)],v=>v.entries['slot-1'].bytes=700001,v=>v.entries['slot-1'].bytes=0,v=>v.entries['slot-1'].credential='fixture-secret'];
 for(const mutate of mutations){const v=structuredClone(value);mutate(v);await denied(loadPrivateSnapshots(env(JSON.stringify(v)),registry));}
 await denied(loadPrivateSnapshots(env('null'),registry));await denied(loadPrivateSnapshots(env('{'),registry));
 await assert.rejects(loadPrivateSnapshots(env(text),{'slot-3':{...registry['slot-1'],slot:'slot-3'}}),/PRIVATE_SOURCE_REGISTRY/);
});
test('manifest file refuses symlink, writable permissions, reader failures and non-byte input',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'snapshot-manifest-'));try{
  const path=join(dir,'manifest.json');writeFileSync(path,text,{mode:0o600});
  const config={FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_FILE:path,FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_SHA256:sha(text)};
  assert.deepEqual(await loadPrivateSnapshots(config,registry),entries);
  const link=join(dir,'link');symlinkSync(path,link);await denied(loadPrivateSnapshots({...config,FACTORY_EXTERNAL_ALPHA_PRIVATE_SNAPSHOTS_FILE:link},registry));
  chmodSync(path,0o666);await denied(loadPrivateSnapshots(config,registry));
  await denied(loadPrivateSnapshots(config,registry,{reader:async()=>{throw Error('uncontrolled secret');}}));
  await denied(loadPrivateSnapshots(config,registry,{reader:async()=>text}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
