import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {productionProjectId,productionCustodyStoreId,productionDatabaseResourceId} from '../src/production-installation.mjs';

/** Produces reviewable SQL only. Never opens a connection or runs on build.
 * Execute explicitly in the exact new resource's authenticated Query console.
 * A repeat, nonempty database, or existing Factory schema fails before mutation. */
export async function productionInstallationSql(ownerScope){
 if(typeof ownerScope!=='string'||!ownerScope.trim()||ownerScope.length>200||/[\x00-\x1f\x7f]/.test(ownerScope)||/qualification|synthetic|staging/i.test(ownerScope))throw Error('PRODUCTION_OWNER_REQUIRED');
 const directory=new URL('../migrations/',import.meta.url),names=(await readdir(directory)).filter(name=>/^\d{3}-[-a-z]+\.sql$/.test(name)).sort();
 if(names.length!==8||names.at(-1)!=='008-production-work-authority.sql')throw Error('PRODUCTION_MIGRATION_INVENTORY');
 const migrations=await Promise.all(names.map(async name=>{const sql=await readFile(new URL(name,directory),'utf8');return{name,sql,checksum:createHash('sha256').update(sql).digest('hex')};}));
 const literal=value=>"'"+value.replaceAll("'","''")+"'";
 return `-- Explicit one-time installation for ${productionDatabaseResourceId}.
-- Never execute against MyEve, staging, or any existing application database.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
SELECT pg_advisory_xact_lock(81427601);
DO $guard$ BEGIN
 IF current_database() <> 'neondb' OR to_regnamespace('factory') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema'))
 THEN RAISE EXCEPTION 'PRODUCTION_REQUIRES_EMPTY_FRESH_DATABASE'; END IF;
END $guard$;
${migrations.map(m=>`-- ${m.name} sha256:${m.checksum}\n${m.sql}`).join('\n')}
CREATE TABLE factory.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO factory.schema_migrations(version,sha256) VALUES
${migrations.map(m=>`(${literal(m.name.replace(/\.sql$/,''))},${literal(m.checksum)})`).join(',\n')};
UPDATE factory.environment SET environment='production',project_id=${literal(productionProjectId)},owner_scope=${literal(ownerScope)},custody_store_id=${literal(productionCustodyStoreId)},database_resource_id=${literal(productionDatabaseResourceId)} WHERE singleton;
REVOKE ALL ON ALL TABLES IN SCHEMA factory FROM PUBLIC;
COMMIT;
SELECT environment,project_id,custody_store_id,database_resource_id,(SELECT count(*) FROM factory.schema_migrations) AS migration_count FROM factory.environment WHERE singleton;
`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length!==4||process.argv[2]!=='--owner')throw Error('Usage: node scripts/prepare-production-installation.mjs --owner REAL_OWNER_ID > reviewed-installation.sql');
 process.stdout.write(await productionInstallationSql(process.argv[3]));
}
