import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {loadExternalAlphaCapabilityBindings,externalAlphaCapabilityRuntimeRole,externalAlphaSlotCapability,restrictedRolePool,
 externalAlphaCapabilityProvisioning,externalAlphaRequiredCapabilities} from '../src/external-alpha-capability.mjs';

const installations=[{ownerId:'owner-one',application:{clientId:'external-alpha-one'}},{ownerId:'owner-two',application:{clientId:'external-alpha-two'}}];
const binding=(clientId='external-alpha-one',ownerId='owner-one',extra={})=>({clientId,ownerId,organizationId:`org-${clientId}`,installationId:`install-${clientId}`,agentId:`agent-${clientId}`,environment:'qualification',...extra});
const env=list=>({FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS:JSON.stringify(list),FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS_SHA256:digest(list)});
const denied=fn=>assert.throws(fn,error=>error.code==='AUTHORITY_CAPABILITY'&&error.status===403);

test('bindings are absent unless configured, digest-pinned, exact, slot-owned and unique',()=>{
 assert.equal(loadExternalAlphaCapabilityBindings({},installations),null);
 const list=[binding(),binding('external-alpha-two','owner-two')];
 const loaded=loadExternalAlphaCapabilityBindings(env(list),installations);
 assert.deepEqual(Object.keys(loaded).sort(),['external-alpha-one','external-alpha-two']);
 assert.equal(loaded['external-alpha-one'].ownerId,'owner-one');
 assert.ok(Object.isFrozen(loaded)&&Object.isFrozen(loaded['external-alpha-one']));
 assert.equal('clientId' in loaded['external-alpha-one'],false);
 denied(()=>loadExternalAlphaCapabilityBindings({...env(list),FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS_SHA256:'0'.repeat(64)},installations));
 denied(()=>loadExternalAlphaCapabilityBindings({FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS:JSON.stringify(list)},installations));
 denied(()=>loadExternalAlphaCapabilityBindings({FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS_SHA256:digest(list)},installations));
 denied(()=>loadExternalAlphaCapabilityBindings(env([binding('external-alpha-one','owner-two')]),installations));
 denied(()=>loadExternalAlphaCapabilityBindings(env([binding('external-alpha-unknown','owner-one')]),installations));
 denied(()=>loadExternalAlphaCapabilityBindings(env([binding(undefined,undefined,{environment:'development'})]),installations));
 denied(()=>loadExternalAlphaCapabilityBindings(env([binding(undefined,undefined,{extra:'x'})]),installations));
 denied(()=>loadExternalAlphaCapabilityBindings(env([binding(),binding()]),installations));
 denied(()=>loadExternalAlphaCapabilityBindings(env([binding(),binding('external-alpha-two','owner-two',{installationId:'install-external-alpha-one'})]),installations));
 denied(()=>loadExternalAlphaCapabilityBindings(env([binding(undefined,undefined,{agentId:"x'; DROP"})]),installations));
 denied(()=>loadExternalAlphaCapabilityBindings(env([]),installations));
});

test('the restricted runtime role is required, validated, and only the slot binding is exposed',()=>{
 assert.equal(externalAlphaCapabilityRuntimeRole({}),null);
 assert.equal(externalAlphaCapabilityRuntimeRole({FACTORY_EXTERNAL_ALPHA_CAPABILITY_RUNTIME_ROLE:'factory_capability_runtime'}),'factory_capability_runtime');
 denied(()=>externalAlphaCapabilityRuntimeRole({FACTORY_EXTERNAL_ALPHA_CAPABILITY_RUNTIME_ROLE:'Bad-Role; RESET ROLE'}));
 const list=[binding(),binding('external-alpha-two','owner-two')];
 assert.equal(externalAlphaSlotCapability(env(list),installations,installations[0]),null);
 const slot=externalAlphaSlotCapability({...env(list),FACTORY_EXTERNAL_ALPHA_CAPABILITY_RUNTIME_ROLE:'factory_capability_runtime'},installations,installations[0]);
 assert.deepEqual(Object.keys(slot.bindings),['external-alpha-one']);
 assert.equal(slot.role,'factory_capability_runtime');
 assert.equal(externalAlphaSlotCapability({...env([binding()]),FACTORY_EXTERNAL_ALPHA_CAPABILITY_RUNTIME_ROLE:'r'},installations,installations[1]),null);
});

test('restricted pool assumes the role immediately after every BEGIN and nowhere else',async()=>{
 const seen=[];
 const pool={query:async sql=>{seen.push(`pool:${sql}`);return {rows:[]};},end:async()=>seen.push('end'),connect:async()=>({query:async sql=>{seen.push(sql);return {rows:[]};},release:()=>seen.push('release')})};
 assert.throws(()=>restrictedRolePool(pool,'bad role'),/CAPABILITY_RUNTIME_ROLE_INVALID/);
 const wrapped=restrictedRolePool(pool,'factory_capability_runtime');
 const client=await wrapped.connect();
 await client.query('BEGIN');await client.query('SELECT 1');await client.query('COMMIT');client.release();
 await wrapped.query('SELECT 2');await wrapped.end();
 assert.deepEqual(seen,['BEGIN','SET LOCAL ROLE factory_capability_runtime','SELECT 1','COMMIT','release','pool:SELECT 2','end']);
});

test('provisioning is bounded, scoped to work+myfactory, and never re-enables owner controls',()=>{
 assert.deepEqual(externalAlphaRequiredCapabilities(),['myfactory','work']);
 const base={bindings:[binding()],runtimeRole:'factory_capability_runtime',connectingRole:'neondb_owner',schemaSql:'CREATE SCHEMA capability_control;',policyRecord:'unified-beta-capability-20261022',evidenceExpiresAt:new Date(Date.now()+3600e3).toISOString()};
 const out=externalAlphaCapabilityProvisioning(base);
 assert.equal(out.createSchema,base.schemaSql);
 const all=out.statements.join('\n');
 assert.match(all,/NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/);
 assert.doesNotMatch(all,/GRANT [^\n]*(INSERT|UPDATE|DELETE|TRUNCATE)[^\n]*capability_control/);
 assert.match(all,/owner_state[^\n]*ON CONFLICT \(installation_id,owner_id\) DO NOTHING/);
 assert.match(all,/relay_agent_evidence[^\n]*WHERE capability_control\.relay_agent_evidence\.status='ACTIVE'/);
 assert.doesNotMatch(all,/status='ACTIVE',/);
 // Renewal never re-enables non-ALLOW/ACTIVE evidence, never widens agent capabilities, refuses unsafe existing roles
 // and scopes FORCE RLS rows to each binding.
 assert.match(all,/evidence[^\n]*DO UPDATE SET[^\n]*WHERE NOT EXISTS \(SELECT 1 FROM jsonb_each\(capability_control\.evidence\.facts\)/);
 assert.doesNotMatch(all,/capability_ids=EXCLUDED/);
 assert.match(all,/RAISE EXCEPTION 'CAPABILITY_RUNTIME_ROLE_UNSAFE'/);
 assert.match(all,/set_config\('myeve\.capability_owner','owner-one',true\)/);
 for(const bad of [{evidenceExpiresAt:new Date(Date.now()-1000).toISOString()},{evidenceExpiresAt:new Date(Date.now()+9*24*3600e3).toISOString()},{policyRecord:''},
  {runtimeRole:'bad role'},{runtimeRole:'postgres'},{runtimeRole:'pg_read_all_data'},{runtimeRole:'pg_write_all_data'},{runtimeRole:'public'},
  {runtimeRole:'neondb_owner'},{connectingRole:'pg_monitor'},{bindings:[]},{bindings:[binding(undefined,undefined,{environment:'development'})]},{schemaSql:''}])
  assert.throws(()=>externalAlphaCapabilityProvisioning({...base,...bad}));
});
