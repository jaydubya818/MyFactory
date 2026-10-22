import {capabilityRegistry} from '@mission-control/capability-control';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {ExternalAlphaError} from './external-alpha-authority.mjs';

/*
 * Owner-scoped capability bindings for the external-alpha host (one per slot client).
 *
 * Capability admission runs inside the Factory's own admission transaction against
 * capability_control rows in the SAME database, under a restricted runtime role. This module only
 * loads the operator-pinned bindings and that role; it never grants execution by itself: the
 * capability rows, the signed per-Work authority, the installation pin and pricing all still apply.
 * Absent configuration keeps admission closed.
 */
const FIELDS='agentId,clientId,environment,installationId,organizationId,ownerId';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/;
const ROLE=/^[a-z_][a-z0-9_]{0,62}$/;
const deny=code=>{throw new ExternalAlphaError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;

/** The capabilities an external-alpha Work admission requires (work + myfactory and their dependencies). */
export function externalAlphaRequiredCapabilities(registry=capabilityRegistry){
 const required=new Set();
 const include=id=>{if(required.has(id))return;const item=registry.capabilities.find(entry=>entry.id===id);if(!item)throw Error('UNKNOWN_CAPABILITY');required.add(id);item.dependencies.forEach(include);};
 include('work');include('myfactory');
 return [...required].sort();
}

/**
 * FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS: JSON array of {clientId, ownerId, organizationId, installationId, agentId,
 * environment:'qualification'}; FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS_SHA256 = digest(array). Each binding must name
 * a loaded installation's slot client and that installation's owner. Returns null when neither variable is set.
 */
export function loadExternalAlphaCapabilityBindings(env,installations){
 const raw=env?.FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS,pin=env?.FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS_SHA256;
 if(raw===undefined&&pin===undefined)return null;
 if(typeof raw!=='string'||raw.length>8000||!/^[a-f0-9]{64}$/.test(pin??''))deny('AUTHORITY_CAPABILITY');
 let list;try{list=JSON.parse(raw);}catch{deny('AUTHORITY_CAPABILITY');}
 if(!Array.isArray(list)||list.length<1||list.length>2||digest(list)!==pin)deny('AUTHORITY_CAPABILITY');
 const bindings={},installationIds=new Set();
 for(const binding of list){
  if(!plain(binding)||Object.keys(binding).sort().join(',')!==FIELDS)deny('AUTHORITY_CAPABILITY');
  for(const key of FIELDS.split(','))if(typeof binding[key]!=='string'||!ID.test(binding[key]))deny('AUTHORITY_CAPABILITY');
  if(binding.environment!=='qualification')deny('AUTHORITY_CAPABILITY');
  const installation=(installations??[]).find(entry=>entry?.application?.clientId===binding.clientId);
  if(!installation||binding.ownerId!==installation.ownerId)deny('AUTHORITY_CAPABILITY');
  if(Object.hasOwn(bindings,binding.clientId)||installationIds.has(binding.installationId))deny('AUTHORITY_CAPABILITY');
  installationIds.add(binding.installationId);
  bindings[binding.clientId]=Object.freeze({ownerId:binding.ownerId,organizationId:binding.organizationId,
   installationId:binding.installationId,agentId:binding.agentId,environment:binding.environment});
 }
 return Object.freeze(bindings);
}

/** FACTORY_EXTERNAL_ALPHA_CAPABILITY_RUNTIME_ROLE: the restricted role assumed for every admission transaction. */
export function externalAlphaCapabilityRuntimeRole(env){
 const role=env?.FACTORY_EXTERNAL_ALPHA_CAPABILITY_RUNTIME_ROLE;
 if(role===undefined)return null;
 if(typeof role!=='string'||!ROLE.test(role))deny('AUTHORITY_CAPABILITY');
 return role;
}

/** The slot's binding only, or null when admission must stay closed. */
export function externalAlphaSlotCapability(env,installations,installation){
 const bindings=loadExternalAlphaCapabilityBindings(env,installations),role=externalAlphaCapabilityRuntimeRole(env);
 const binding=bindings?.[installation?.application?.clientId];
 if(!binding||!role)return null;
 return Object.freeze({bindings:Object.freeze({[installation.application.clientId]:binding}),role});
}

/** Every transaction opened through this pool runs as `role` (SET LOCAL ROLE right after BEGIN). */
export function restrictedRolePool(pool,role){
 if(!ROLE.test(role??''))throw Error('CAPABILITY_RUNTIME_ROLE_INVALID');
 return {
  query:(sql,args)=>pool.query(sql,args),
  end:()=>pool.end(),
  async connect(){
   const client=await pool.connect();
   return {
    async query(sql,args){const result=await client.query(sql,args);if(typeof sql==='string'&&/^\s*BEGIN\b/i.test(sql))await client.query(`SET LOCAL ROLE ${role}`);return result;},
    release:(...a)=>client.release(...a),
   };
  },
 };
}

const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const json=value=>`${quote(JSON.stringify(value))}::jsonb`;

/**
 * Operator provisioning SQL for the external-alpha Factory database (reviewed and run by the custodian; never by the
 * runtime). `createSchema` is the canonical capability_control SQL (applied only when absent); `statements` create the
 * restricted runtime role and its grants, and one installation/owner policy per binding with evidence bounded by
 * `evidenceExpiresAt` (at most 8 days; re-provisioning is an explicit operator act, never automatic). Re-provisioning
 * never overwrites owner preferences or controls and never reactivates revoked agent evidence.
 */
export function externalAlphaCapabilityProvisioning({bindings,runtimeRole,evidenceExpiresAt,schemaSql,connectingRole,registry=capabilityRegistry,policyRecord}){
 if(!Array.isArray(bindings)||bindings.length<1||bindings.length>2)throw Error('BINDINGS_REQUIRED');
 if(!ROLE.test(runtimeRole??'')||!ROLE.test(connectingRole??''))throw Error('ROLE_REQUIRED');
 if(typeof schemaSql!=='string'||!schemaSql.includes('CREATE SCHEMA capability_control'))throw Error('SCHEMA_SQL_REQUIRED');
 const until=Date.parse(evidenceExpiresAt??'');
 if(!Number.isFinite(until)||until<=Date.now()||until>Date.now()+8*24*3600*1000)throw Error('EVIDENCE_WINDOW_INVALID');
 if(!ID.test(policyRecord??''))throw Error('POLICY_RECORD_REQUIRED');
 const required=externalAlphaRequiredCapabilities(registry);
 const facts=Object.fromEntries(required.map(id=>{const item=registry.capabilities.find(entry=>entry.id===id);return [id,{supported:true,deployed:true,entitled:true,administrator:'ALLOW',lifecycle:'ACTIVE',
  setup:Object.fromEntries(item.setupRequirements.map(key=>[key,true])),qualification:Object.fromEntries(item.qualificationRequirements.map(key=>[key,'QUALIFIED']))}];}));
 const preferences=Object.fromEntries(required.map(id=>[id,'ENABLED']));
 const expires=`${quote(new Date(until).toISOString())}::timestamptz`;
 const statements=[];
 statements.push(`DO $role$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=${quote(runtimeRole)}) THEN CREATE ROLE ${runtimeRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $role$`);
 statements.push(`GRANT ${runtimeRole} TO ${connectingRole}`);
 statements.push(`GRANT USAGE ON SCHEMA factory, capability_control TO ${runtimeRole}`);
 statements.push(`GRANT SELECT ON ALL TABLES IN SCHEMA capability_control TO ${runtimeRole}`);
 statements.push(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA factory TO ${runtimeRole}`);
 statements.push(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA factory TO ${runtimeRole}`);
 statements.push(`GRANT EXECUTE ON FUNCTION capability_control.lock_admission_policy(text,text,text) TO ${runtimeRole}`);
 for(const b of bindings){
  for(const key of FIELDS.split(','))if(typeof b[key]!=='string'||!ID.test(b[key]))throw Error('BINDING_INVALID');
  if(b.environment!=='qualification')throw Error('BINDING_INVALID');
  statements.push(`INSERT INTO capability_control.installations(id,organization_id,environment,active) VALUES(${quote(b.installationId)},${quote(b.organizationId)},'qualification',true) ON CONFLICT (id) DO NOTHING`);
  statements.push(`INSERT INTO capability_control.owner_state(installation_id,owner_id,preferences) VALUES(${quote(b.installationId)},${quote(b.ownerId)},${json(preferences)}) ON CONFLICT (installation_id,owner_id) DO NOTHING`);
  statements.push(`INSERT INTO capability_control.evidence VALUES(${quote(b.installationId)},${quote(b.organizationId)},${quote(b.ownerId)},${quote(registry.version)},${json(facts)},clock_timestamp(),${expires},${quote(policyRecord)}) ON CONFLICT (installation_id,owner_id) DO UPDATE SET facts=EXCLUDED.facts,registry_version=EXCLUDED.registry_version,observed_at=EXCLUDED.observed_at,expires_at=EXCLUDED.expires_at,source_record_id=EXCLUDED.source_record_id`);
  statements.push(`INSERT INTO capability_control.relay_agent_evidence VALUES(${quote(b.installationId)},${quote(b.ownerId)},${quote(b.organizationId)},${quote(b.agentId)},1,${json(required)},'ACTIVE',${expires},${quote(policyRecord)}) ON CONFLICT (installation_id,owner_id,agent_id) DO UPDATE SET capability_ids=EXCLUDED.capability_ids,expires_at=EXCLUDED.expires_at,source_record_id=EXCLUDED.source_record_id,revision=capability_control.relay_agent_evidence.revision+1 WHERE capability_control.relay_agent_evidence.status='ACTIVE'`);
 }
 return Object.freeze({createSchema:schemaSql,statements:Object.freeze(statements)});
}

/** Apply provisioning atomically through a pg client (custodian tooling and disposable tests only). */
export async function applyExternalAlphaCapabilityProvisioning(client,{createSchema,statements}){
 await client.query('BEGIN');
 try{
  const exists=(await client.query("SELECT to_regnamespace('capability_control') IS NOT NULL AS present")).rows[0].present;
  if(!exists)await client.query(createSchema);
  for(const sql of statements)await client.query(sql);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
