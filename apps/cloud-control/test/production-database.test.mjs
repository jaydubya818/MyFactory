import {productionPaidLedgerMigrationSql} from '../scripts/prepare-production-paid-ledger-migration.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {databaseConfig} from '../src/config.mjs';
import {initializeProductionDatabase,assertProductionDatabaseMarker} from '../src/production-database.mjs';
import {productionProjectId,productionCustodyStoreId,productionDatabaseResourceId} from '../src/production-installation.mjs';

test('CONNECTED production initializer refuses qualification rows and pins a fresh database atomically',{skip:process.env.FACTORY_POSTGRES_TEST!=='1'},async t=>{
 const pool=new pg.Pool(databaseConfig(process.env.DATABASE_URL_UNPOOLED));
 const client=await pool.connect(),schema='factory_install_'+randomUUID().replaceAll('-','');
 // Isolate only schema identifiers/catalog filters, not values or authority.
 const rewrite=sql=>sql.replace(/\bfactory\./g,schema+'.').replace(/SCHEMA (IF NOT EXISTS )?factory\b/g,(_,optional)=>'SCHEMA '+(optional??'')+schema).replace(/schemaname='factory'/g,"schemaname='"+schema+"'");
 const isolated={query:(sql,args)=>client.query(rewrite(sql),args)};
 t.after(async()=>{await client.query('ROLLBACK');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();await pool.end();});
 const files=(await readdir(new URL('../migrations/',import.meta.url))).filter(p=>p.endsWith('.sql')).sort();
 assert.equal(files.length,9);
 for(const file of files)await isolated.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const install={projectId:productionProjectId,ownerScope:'real-owner',custodyStoreId:productionCustodyStoreId,databaseResourceId:productionDatabaseResourceId};
 await isolated.query("INSERT INTO factory.work_orders(id,record,state) VALUES ('historical-qualification','{}','queued')");
 await assert.rejects(initializeProductionDatabase(isolated,install),/PRODUCTION_REQUIRES_EMPTY_DATABASE/);
 assert.equal((await isolated.query('SELECT environment FROM factory.environment')).rows[0].environment,'staging');
 await isolated.query("DELETE FROM factory.work_orders WHERE id='historical-qualification'");
 assert.deepEqual(await initializeProductionDatabase(isolated,install),{initialized:true});
 await isolated.query('CREATE TABLE factory.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL)');
 for(const file of files.filter(f=>!f.startsWith('009-'))){
  const bytes=await readFile(new URL('../migrations/'+file,import.meta.url));
  await isolated.query('INSERT INTO factory.schema_migrations(version,sha256) VALUES($1,$2)',[file.replace('.sql',''),createHash('sha256').update(bytes).digest('hex')]);
 }
 const historical=randomUUID();
 await isolated.query("INSERT INTO factory.production_work_authority(request_id,work_id,client_id,manifest,manifest_sha256,state) VALUES($1,$2,'sofie-production-validation','{}',$3,'REVOKED')",[historical,randomUUID(),'a'.repeat(64)]);
 const operatorSql=await productionPaidLedgerMigrationSql();
 await isolated.query(operatorSql);await isolated.query(operatorSql);
 assert.equal((await isolated.query('SELECT count(*) FROM factory.schema_migrations')).rows[0].count,'9');
 assert.equal((await isolated.query('SELECT state FROM factory.production_work_authority WHERE request_id=$1',[historical])).rows[0].state,'REVOKED');

 assertProductionDatabaseMarker((await isolated.query('SELECT * FROM factory.environment')).rows[0],install);
 assert.deepEqual(await initializeProductionDatabase(isolated,install),{initialized:false});
 await assert.rejects(initializeProductionDatabase(isolated,{...install,ownerScope:'other-owner'}),/PRODUCTION_DATABASE_BOUNDARY/);
 await assert.rejects(isolated.query('UPDATE factory.environment SET custody_store_id=NULL'),/environment_production_binding/);
 await assert.rejects(isolated.query("UPDATE factory.environment SET environment='staging'"),/environment_production_binding/);
 // Forward migration can be replayed without converting or erasing the binding.
 await isolated.query(await readFile(new URL('../migrations/007-production-installation-boundary.sql',import.meta.url),'utf8'));
 assertProductionDatabaseMarker((await isolated.query('SELECT * FROM factory.environment')).rows[0],install);
});
