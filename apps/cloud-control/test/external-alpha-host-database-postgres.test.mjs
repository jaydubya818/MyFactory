import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {initializeProductionDatabase,assertProductionDatabaseMarker} from '../src/production-database.mjs';
import {productionProjectId,productionCallerProjectId,productionCustodyStoreId,productionDatabaseResourceId} from '../src/production-installation.mjs';
import {stagingProjectId,custodyStoreId as stagingCustodyStoreId} from '../src/config.mjs';

const skip=process.env.FACTORY_POSTGRES_TEST!=='1';
const host={version:1,factoryId:'myfactory-external-alpha',environment:'production',ownerScope:'external-alpha:00000000-0000-4000-a000-000000000001',projectId:'prj_FixtureAlphaHost',teamId:'team_FixtureAlpha',custodyStoreId:'store_FixtureAlpha',databaseResourceId:'fixture-alpha-database'};
const canary={projectId:productionProjectId,ownerScope:'fixture-canary-owner',custodyStoreId:productionCustodyStoreId,databaseResourceId:productionDatabaseResourceId};
async function fixture(t,{registration=true}={}){
 const url=new URL(process.env.DATABASE_URL_UNPOOLED);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
 const pool=new pg.Pool({connectionString:url.href,max:6}),schema='ea_host_'+randomUUID().replaceAll('-','');
 const rewrite=sql=>sql.replace(/\bfactory\./g,schema+'.').replace(/SCHEMA (IF NOT EXISTS )?factory\b/g,(_,optional)=>'SCHEMA '+(optional??'')+schema).replace(/schemaname='factory'/g,"schemaname='"+schema+"'");
 const client=await pool.connect(),isolated={query:(sql,args)=>client.query(rewrite(sql),args)};
 t.after(async()=>{await client.query('ROLLBACK');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();await pool.end();});
 const names=(await readdir(new URL('../migrations/',import.meta.url))).filter(p=>p.endsWith('.sql')).sort();assert.equal(names.at(-1),'012-external-alpha-host-registration.sql');
 for(const name of names.filter(n=>registration||!n.startsWith('012-')))await isolated.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
 return {pool,client,isolated,rewrite,query:isolated.query,marker:async()=>(await isolated.query('SELECT * FROM factory.environment')).rows[0]};
}

test('dedicated host requires additive registration schema and initializes exact marker atomically',{skip},async t=>{
 const f=await fixture(t,{registration:false});
 await assert.rejects(initializeProductionDatabase(f.isolated,host),/PRODUCTION_SCHEMA_INCOMPLETE/);
 assert.equal((await f.marker()).environment,'staging');
 await f.query(await readFile(new URL('../migrations/012-external-alpha-host-registration.sql',import.meta.url),'utf8'));
 assert.equal((await f.query('SELECT count(*)::int n FROM factory.external_alpha_host_registration')).rows[0].n,0);
 // Shape-valid routing cannot establish a host before explicit registration.
 await assert.rejects(f.query("UPDATE factory.environment SET environment='production',project_id=$1,owner_scope=$2,custody_store_id=$3,database_resource_id=$4,external_alpha_host_registration=true",[host.projectId,host.ownerScope,host.custodyStoreId,host.databaseResourceId]),/environment_external_alpha_registration/);
 assert.deepEqual(await initializeProductionDatabase(f.isolated,host),{initialized:true});
 const marker=await f.marker();assert.equal(marker.external_alpha_host_registration,true);assertProductionDatabaseMarker(marker,host);
 assert.deepEqual(await initializeProductionDatabase(f.isolated,host),{initialized:false});
 assert.equal((await f.query('SELECT count(*)::int n FROM factory.external_alpha_host_registration')).rows[0].n,1);
 assert.equal((await f.query('SELECT count(*)::int n FROM factory.external_alpha_work_authority')).rows[0].n,0);
 for(const patch of [{projectId:'prj_Foreign'},{ownerScope:'external-alpha:00000000-0000-4000-a000-000000000002'},{custodyStoreId:'store_Foreign'},{databaseResourceId:'fixture-foreign-db'}]){
  assert.throws(()=>assertProductionDatabaseMarker(marker,{...host,...patch}),/PRODUCTION_DATABASE_BOUNDARY/);
  await assert.rejects(initializeProductionDatabase(f.isolated,{...host,...patch}),/PRODUCTION_DATABASE_BOUNDARY/);
 }
 assert.throws(()=>assertProductionDatabaseMarker({...marker,external_alpha_host_registration:null},host),/PRODUCTION_DATABASE_BOUNDARY/);
 assert.throws(()=>assertProductionDatabaseMarker(marker,{...host,factoryId:'myfactory-cloud-production'}),/PRODUCTION_DATABASE_BOUNDARY/);
});

test('registration and dedicated marker cannot be mutated, deleted, widened or demoted',{skip},async t=>{
 const f=await fixture(t);await initializeProductionDatabase(f.isolated,host);const before=await f.marker();
 for(const sql of ["UPDATE factory.external_alpha_host_registration SET project_id='prj_Foreign'",'DELETE FROM factory.external_alpha_host_registration',"UPDATE factory.environment SET project_id='prj_Foreign'",'UPDATE factory.environment SET external_alpha_host_registration=NULL',"UPDATE factory.environment SET environment='staging'",'DELETE FROM factory.environment'])await assert.rejects(f.query(sql),/immutable/);
 assert.deepEqual(await f.marker(),before);
 assert.equal((await f.query("SELECT has_table_privilege('public','factory.external_alpha_host_registration','INSERT') AS allowed")).rows[0].allowed,false);
});

test('legacy staging and canary markers remain unchanged and cannot be promoted to external alpha',{skip},async t=>{
 const f=await fixture(t);const staged=await f.marker();assert.equal(staged.environment,'staging');assert.equal(staged.external_alpha_host_registration,null);
 await assert.rejects(f.query("UPDATE factory.environment SET project_id='prj_Foreign'"),/environment_production_binding/);
 await assert.rejects(f.query("UPDATE factory.environment SET environment='production',project_id=$1,owner_scope=$2,custody_store_id=$3,database_resource_id=$4",[host.projectId,host.ownerScope,host.custodyStoreId,host.databaseResourceId]),/environment_production_binding/);
 assert.deepEqual(await initializeProductionDatabase(f.isolated,canary),{initialized:true});const bound=await f.marker();assertProductionDatabaseMarker(bound,canary);assert.equal(bound.external_alpha_host_registration,null);
 assert.deepEqual(await initializeProductionDatabase(f.isolated,canary),{initialized:false});
 await assert.rejects(f.query('UPDATE factory.environment SET external_alpha_host_registration=true'),/requires a fresh database/);
 await assert.rejects(initializeProductionDatabase(f.isolated,host),/PRODUCTION_DATABASE_BOUNDARY/);assert.deepEqual(await f.marker(),bound);
 assert.equal((await f.query('SELECT count(*)::int n FROM factory.external_alpha_host_registration')).rows[0].n,0);
 for(const patch of [{projectId:stagingProjectId},{projectId:productionProjectId},{projectId:productionCallerProjectId},{custodyStoreId:stagingCustodyStoreId},{custodyStoreId:productionCustodyStoreId},{databaseResourceId:productionDatabaseResourceId},{ownerScope:'canary-owner'}])await assert.rejects(initializeProductionDatabase(f.isolated,{...host,...patch}),/PRODUCTION_DATABASE_BOUNDARY/);
});

test('qualification history or mid-installation failure leaves no registration and no partial marker',{skip},async t=>{
 const f=await fixture(t),before=await f.marker();
 await f.query("INSERT INTO factory.work_orders(id,record,state) VALUES ('fixture-existing-work','{}','queued')");
 await assert.rejects(initializeProductionDatabase(f.isolated,host),/PRODUCTION_REQUIRES_EMPTY_DATABASE/);
 assert.deepEqual(await f.marker(),before);assert.equal((await f.query('SELECT count(*)::int n FROM factory.external_alpha_host_registration')).rows[0].n,0);
 await f.query("DELETE FROM factory.work_orders WHERE id='fixture-existing-work'");
 const fault={query:async(sql,args)=>{if(sql.startsWith('UPDATE factory.environment'))throw Error('FIXTURE_INSTALL_FAULT');return f.query(sql,args);}};
 await assert.rejects(initializeProductionDatabase(fault,host),/FIXTURE_INSTALL_FAULT/);
 assert.deepEqual(await f.marker(),before);assert.equal((await f.query('SELECT count(*)::int n FROM factory.external_alpha_host_registration')).rows[0].n,0);
 assert.deepEqual(await initializeProductionDatabase(f.isolated,host),{initialized:true});
});

test('concurrent exact installers converge to one immutable registration without duplicate installation',{skip},async t=>{
 const f=await fixture(t),clients=await Promise.all([f.pool.connect(),f.pool.connect()]);
 try{const outcomes=await Promise.all(clients.map(c=>initializeProductionDatabase({query:(sql,args)=>c.query(f.rewrite(sql),args)},host)));assert.deepEqual(outcomes.map(o=>o.initialized).sort(),[false,true]);}
 finally{for(const c of clients)c.release();}
 assert.equal((await f.query('SELECT count(*)::int n FROM factory.external_alpha_host_registration')).rows[0].n,1);assertProductionDatabaseMarker(await f.marker(),host);
});

test('racing different host registrations bind exactly one tuple and reject the competitor',{skip},async t=>{
 const f=await fixture(t),other={...host,projectId:'prj_FixtureOtherHost',custodyStoreId:'store_FixtureOther',databaseResourceId:'fixture-other-db'},clients=await Promise.all([f.pool.connect(),f.pool.connect()]);
 let outcomes;try{outcomes=await Promise.allSettled(clients.map((c,i)=>initializeProductionDatabase({query:(sql,args)=>c.query(f.rewrite(sql),args)},[host,other][i])));}finally{for(const c of clients)c.release();}
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected').length,1);assert.match(outcomes.find(o=>o.status==='rejected').reason.message,/PRODUCTION_DATABASE_BOUNDARY/);
 const winner=outcomes[0].status==='fulfilled'?host:other;assertProductionDatabaseMarker(await f.marker(),winner);assert.equal((await f.query('SELECT count(*)::int n FROM factory.external_alpha_host_registration')).rows[0].n,1);
});
