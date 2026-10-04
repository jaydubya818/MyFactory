import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {productionProjectId,productionCustodyStoreId,productionDatabaseResourceId} from '../src/production-installation.mjs';
/** Operator SQL only; no connection, build hook or automatic migration. */
export async function productionAuthorityMigrationSql(){
 const previous=['001-staging-boundary','002-canonical-execution-ledger','003-queue-delivery-checks','004-canonical-dispatch','005-cloud-custody','006-cloud-verification','007-production-installation-boundary'];
 const hash=sql=>createHash('sha256').update(sql).digest('hex');
 const migrations=await Promise.all(previous.map(async version=>({version,sha:hash(await readFile(new URL('../migrations/'+version+'.sql',import.meta.url)))})));
 const version='008-production-work-authority',sql=await readFile(new URL('../migrations/'+version+'.sql',import.meta.url),'utf8'),sha=hash(sql);
 return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
SELECT pg_advisory_xact_lock(81427601);
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM factory.environment WHERE singleton AND environment='production' AND project_id='${productionProjectId}' AND custody_store_id='${productionCustodyStoreId}' AND database_resource_id='${productionDatabaseResourceId}' AND owner_scope IS NOT NULL) THEN RAISE EXCEPTION 'PRODUCTION_DATABASE_BOUNDARY'; END IF;
 IF (SELECT count(*) FROM factory.schema_migrations WHERE version <> '${version}') <> 7 THEN RAISE EXCEPTION 'PRODUCTION_LEDGER_INVENTORY'; END IF;
 ${migrations.map(m=>`IF NOT EXISTS(SELECT 1 FROM factory.schema_migrations WHERE version='${m.version}' AND sha256='${m.sha}') THEN RAISE EXCEPTION 'PRODUCTION_LEDGER_CHECKSUM'; END IF;`).join('\n ')}
 IF EXISTS(SELECT 1 FROM factory.schema_migrations WHERE version='${version}' AND sha256<>'${sha}') THEN RAISE EXCEPTION 'PRODUCTION_LEDGER_CHECKSUM'; END IF;
 IF NOT EXISTS(SELECT 1 FROM factory.schema_migrations WHERE version='${version}') THEN
  ${sql.replaceAll('$$','$authority$')}
  INSERT INTO factory.schema_migrations(version,sha256) VALUES('${version}','${sha}');
 END IF;
END $guard$;
COMMIT;
SELECT version,sha256 FROM factory.schema_migrations WHERE version='${version}';
`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.stdout.write(await productionAuthorityMigrationSql());
