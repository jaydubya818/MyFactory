import {stagingProjectId,custodyStoreId as stagingCustodyStoreId} from './config.mjs';
import {productionProjectId,productionCallerProjectId,productionCustodyStoreId,productionDatabaseResourceId} from './production-installation.mjs';

const externalHost=installation=>installation?.factoryId==='myfactory-external-alpha';
function assertExternalHostRegistration(installation){
 if(!/^external-alpha:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(installation.ownerScope??'')||installation.environment!=='production'||
  !/^prj_[A-Za-z0-9]+$/.test(installation.projectId??'')||!/^team_[A-Za-z0-9]+$/.test(installation.teamId??'')||!/^store_[A-Za-z0-9]+$/.test(installation.custodyStoreId??'')||!/^[a-z0-9-]{3,100}$/.test(installation.databaseResourceId??'')||
  [stagingProjectId,productionProjectId,productionCallerProjectId].includes(installation.projectId)||[stagingCustodyStoreId,productionCustodyStoreId].includes(installation.custodyStoreId)||installation.databaseResourceId===productionDatabaseResourceId)throw Error('PRODUCTION_DATABASE_BOUNDARY');
}
/** Explicit installation operation, never called from a request handler.
 * Refuses promotion of any qualification rows. All application tables are
 * locked while emptiness and the one existing marker are checked. */
export async function initializeProductionDatabase(client,installation){
 const alpha=externalHost(installation);if(alpha)assertExternalHostRegistration(installation);
 await client.query('BEGIN');
 try{
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('factory-production-installation',0))");
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='factory' ORDER BY tablename")).rows;
  if(!tables.some(r=>r.tablename==='environment')||!tables.some(r=>r.tablename==='verification_resources'))throw Error('PRODUCTION_SCHEMA_INCOMPLETE');
  if(alpha&&!tables.some(r=>r.tablename==='external_alpha_host_registration'))throw Error('PRODUCTION_SCHEMA_INCOMPLETE');
  for(const {tablename} of tables){
   if(!/^[a-z_]+$/.test(tablename))throw Error('UNEXPECTED_FACTORY_TABLE');
   await client.query(`LOCK TABLE factory.${tablename} IN ACCESS EXCLUSIVE MODE`);
  }
  const marker=(await client.query('SELECT * FROM factory.environment WHERE singleton')).rows[0];
  if(marker?.environment==='production'){
   assertProductionDatabaseMarker(marker,installation);
   await client.query('COMMIT');return {initialized:false};
  }
  if(marker?.environment!=='staging'||marker.project_id!=='prj_IRXTY6HOzS2q9wRPdabsJnmddzl4'||marker.schema_version!==1)throw Error('PRODUCTION_INITIAL_MARKER');
  for(const {tablename} of tables){
   if(tablename==='environment'||tablename==='schema_migrations')continue;
   if((await client.query(`SELECT EXISTS(SELECT 1 FROM factory.${tablename}) AS present`)).rows[0].present)throw Error('PRODUCTION_REQUIRES_EMPTY_DATABASE');
  }
  if(alpha){
   await client.query('INSERT INTO factory.external_alpha_host_registration(singleton,project_id,owner_scope,custody_store_id,database_resource_id) VALUES(true,$1,$2,$3,$4)',[installation.projectId,installation.ownerScope,installation.custodyStoreId,installation.databaseResourceId]);
   await client.query("UPDATE factory.environment SET environment='production',project_id=$1,owner_scope=$2,custody_store_id=$3,database_resource_id=$4,external_alpha_host_registration=true WHERE singleton",[installation.projectId,installation.ownerScope,installation.custodyStoreId,installation.databaseResourceId]);
  }else{
   await client.query("UPDATE factory.environment SET environment='production',project_id=$1,owner_scope=$2,custody_store_id=$3,database_resource_id=$4 WHERE singleton",[installation.projectId,installation.ownerScope,installation.custodyStoreId,installation.databaseResourceId]);
  }
  await client.query('COMMIT');return {initialized:true};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
export function assertProductionDatabaseMarker(marker,installation){
 if(externalHost(installation)){assertExternalHostRegistration(installation);if(marker?.external_alpha_host_registration!==true)throw Error('PRODUCTION_DATABASE_BOUNDARY');}
 else if(marker?.external_alpha_host_registration===true)throw Error('PRODUCTION_DATABASE_BOUNDARY');
 if(marker?.environment!=='production'||marker.schema_version!==1||marker.project_id!==installation.projectId||marker.owner_scope!==installation.ownerScope||marker.custody_store_id!==installation.custodyStoreId||marker.database_resource_id!==installation.databaseResourceId)throw Error('PRODUCTION_DATABASE_BOUNDARY');
}
