import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,symlinkSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadPrivateSourceRegistry,registryEntryFor,registryKind} from '../src/external-alpha-registry.mjs';
import {privateSourceOwner} from '../src/private-source.mjs';

// Synthetic names only; the real registry is a deploy-time input and is never in this repository.
const sha=b=>createHash('sha256').update(b).digest('hex'),h=c=>c.repeat(40);
const entry=(n,c)=>({slot:'slot-'+n,owner:privateSourceOwner,repo:'fixture-workspace-0'+n,commit:h(c),tree:h(c==='a'?'b':'c')});
const registry={version:1,kind:registryKind,entries:{'slot-1':entry(1,'a'),'slot-2':entry(2,'d')}};
const json=JSON.stringify(registry),pin=sha(json);
const fails=async p=>{try{await p;}catch(e){return e.message;}return 'LOADED';};
const dir=mkdtempSync(join(tmpdir(),'registry-test-'));test.after(()=>rmSync(dir,{recursive:true,force:true}));

test('loads an inline registry only when its digest matches',async()=>{
 const r=await loadPrivateSourceRegistry({FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:json,FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:pin});
 assert.deepEqual(Object.keys(r),['slot-1','slot-2']);assert.ok(Object.isFrozen(r));
 for(const env of [{},{FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:json},{FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:json,FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:sha('x')},
  {FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:json+' ',FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:pin},
  {FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:json,FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_FILE:'/x',FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:pin}])
  assert.equal(await fails(loadPrivateSourceRegistry(env)),'PRIVATE_SOURCE_REGISTRY');
});

test('rejects structurally wrong registries even when the digest matches',async()=>{
 const bad=[{...registry,kind:'x'},{...registry,extra:1},{...registry,version:2},{version:1,kind:registryKind,entries:{}},
  {...registry,entries:{'slot-1':{...entry(1,'a'),owner:'../outside'}}},{...registry,entries:{'slot-1':entry(1,'a'),'slot-2':{...entry(1,'d'),slot:'slot-2'}}},
  {...registry,entries:{'slot-1':{...entry(1,'a'),commit:'zz'}}}];
 for(const b of bad){const s=JSON.stringify(b);assert.equal(await fails(loadPrivateSourceRegistry({FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:s,FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:sha(s)})),'PRIVATE_SOURCE_REGISTRY');}
});

test('file input: digest-checked, absolute, no symlink, not group/world writable',async()=>{
 const good=join(dir,'registry.json');writeFileSync(good,json,{mode:0o600});
 const env=f=>({FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_FILE:f,FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:pin});
 assert.equal(Object.keys(await loadPrivateSourceRegistry(env(good))).length,2);
 const link=join(dir,'link.json');symlinkSync(good,link);
 assert.equal(await fails(loadPrivateSourceRegistry(env(link))),'PRIVATE_SOURCE_REGISTRY');
 const open=join(dir,'open.json');writeFileSync(open,json);chmodSync(open,0o666);
 assert.equal(await fails(loadPrivateSourceRegistry(env(open))),'PRIVATE_SOURCE_REGISTRY');
 assert.equal(await fails(loadPrivateSourceRegistry(env('relative.json'))),'PRIVATE_SOURCE_REGISTRY');
 assert.equal(await fails(loadPrivateSourceRegistry(env(dir+'/../'+dir.split('/').pop()+'/registry.json'))),'PRIVATE_SOURCE_REGISTRY');
 assert.equal(await fails(loadPrivateSourceRegistry(env(join(dir,'missing.json')))),'PRIVATE_SOURCE_REGISTRY');
 const swapped=join(dir,'swapped.json');writeFileSync(swapped,json.replace(h('a'),h('e')),{mode:0o600});
 assert.equal(await fails(loadPrivateSourceRegistry(env(swapped))),'PRIVATE_SOURCE_REGISTRY');
});

test('the registry entry must equal the repository, commit and tree the Factory installation pins',async()=>{
 const r=await loadPrivateSourceRegistry({FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:json,FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:pin});
 const inst=(slot,over={})=>({slot,source:{repository:`${privateSourceOwner}/fixture-workspace-0${slot}`,baseSha:r['slot-'+slot]?.commit??h('9'),treeSha:r['slot-'+slot]?.tree??h('9'),...over}});
 assert.equal(registryEntryFor(r,inst('1')).repo,'fixture-workspace-01');
 for(const bad of [inst('1',{baseSha:h('f')}),inst('1',{treeSha:h('f')}),inst('1',{repository:`${privateSourceOwner}/fixture-workspace-02`}),inst('3')])
  assert.throws(()=>registryEntryFor(r,bad),/PRIVATE_SOURCE_REGISTRY/);
});

test('the public module carries no default registry',async()=>{
 const m=await import('../src/private-source.mjs');
 assert.deepEqual(Object.keys(m).filter(k=>/registry/i.test(k)),['assertRegistry']);
});


test('configured owner is bound to the installation; names and owner syntax do not create authority',async()=>{
 const changed=structuredClone(registry);changed.entries['slot-1'].owner='other-fixture-org';const bytes=JSON.stringify(changed);
 const r=await loadPrivateSourceRegistry({FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:bytes,FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:sha(bytes)});
 const e=r['slot-1'];assert.equal(registryEntryFor(r,{slot:'1',source:{repository:e.owner+'/'+e.repo,baseSha:e.commit,treeSha:e.tree}}),e);
 assert.throws(()=>registryEntryFor(r,{slot:'1',source:{repository:'fixture-org/'+e.repo,baseSha:e.commit,treeSha:e.tree}}),/PRIVATE_SOURCE_REGISTRY/);
 for(const owner of [null,undefined,['fixture-org'],true,'../outside','owner/repo','https://fixture','-invalid','invalid-', 'x'.repeat(40)]){
  const bad=structuredClone(changed);bad.entries['slot-1'].owner=owner;const text=JSON.stringify(bad);
  assert.equal(await fails(loadPrivateSourceRegistry({FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:text,FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:sha(text)})),'PRIVATE_SOURCE_REGISTRY');
 }
 const third=structuredClone(registry);third.entries['slot-3']={...entry(2,'d'),slot:'slot-3',repo:'fixture-workspace-03'};const text=JSON.stringify(third);
 assert.equal(await fails(loadPrivateSourceRegistry({FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_JSON:text,FACTORY_EXTERNAL_ALPHA_PRIVATE_SOURCE_REGISTRY_SHA256:sha(text)})),'PRIVATE_SOURCE_REGISTRY');
});
