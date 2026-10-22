import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {externalAlphaCapabilityProvisioning} from '../src/external-alpha-capability.mjs';

/**
 * Operator SQL only; no connection, build hook or automatic provisioning. Prints one transaction for the external-alpha
 * Factory database that creates capability_control when absent (canonical docs SQL), the restricted runtime role and
 * the owner-scoped installation policy for each slot binding, plus the exact FACTORY_EXTERNAL_ALPHA_CAPABILITY_* values
 * (non-secret) the host needs. Review it, run it with the database owner role, then set the printed environment.
 */
export async function externalAlphaCapabilitySql({bindings,runtimeRole,connectingRole,evidenceExpiresAt,policyRecord}){
 let schemaSql='';
 for(const part of ['migration','enforcement','decisions','ordering','lifecycle'])
  schemaSql+=await readFile(new URL(`../../../docs/capability-control/${part}.sql`,import.meta.url),'utf8')+'\n';
 if(['$capability$','$guard$'].some(tag=>schemaSql.includes(tag)))throw Error('SCHEMA_SQL_DOLLAR_TAG');
 const {createSchema,statements}=externalAlphaCapabilityProvisioning({bindings,runtimeRole,connectingRole,evidenceExpiresAt,policyRecord,schemaSql});
 const sql=`BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF to_regclass('factory.environment') IS NULL OR to_regclass('factory.intake_receipts') IS NULL THEN RAISE EXCEPTION 'FACTORY_DATABASE_REQUIRED'; END IF;
 IF to_regnamespace('capability_control') IS NULL THEN
${createSchema.replaceAll('$$','$capability$')}
 END IF;
END $guard$;
${statements.map(s=>s+';').join('\n')}
COMMIT;
`;
 const list=bindings.map(({clientId,ownerId,organizationId,installationId,agentId,environment})=>({clientId,ownerId,organizationId,installationId,agentId,environment}));
 return {sql,env:{FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS:JSON.stringify(list),FACTORY_EXTERNAL_ALPHA_CAPABILITY_BINDINGS_SHA256:digest(list),
  FACTORY_EXTERNAL_ALPHA_CAPABILITY_RUNTIME_ROLE:runtimeRole}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const arg=name=>{const i=process.argv.indexOf(`--${name}`);if(i<0||!process.argv[i+1])throw Error(`--${name} is required`);return process.argv[i+1];};
 const bindings=JSON.parse(await readFile(arg('bindings'),'utf8'));
 const out=await externalAlphaCapabilitySql({bindings,runtimeRole:arg('runtime-role'),connectingRole:arg('connecting-role'),evidenceExpiresAt:arg('expires'),policyRecord:arg('policy-record')});
 process.stdout.write(out.sql);
 process.stderr.write(Object.entries(out.env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
}
