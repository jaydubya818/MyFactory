import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile as callback} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {PostgresDispatchStore} from '../src/postgres-dispatch.mjs';
import {applyFactoryCapabilityControl} from '../src/capability-controls.mjs';
import {capabilityPolicyFixture} from './fixtures/capability-policy.mjs';

const bin=process.env.FACTORY_CAPABILITY_CONTROL_POSTGRES_BIN;
const externalUrl=process.env.FACTORY_CAPABILITY_CONTROL_POSTGRES_URL;
const execFile=promisify(callback);

test('retained Factory capability controls use disposable PostgreSQL and no provider', {skip:!bin&&!externalUrl}, async t=>{
 let directory,started=false,admin;
 t.after(async()=>{await admin?.end();try{if(started)await execFile(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-m','immediate','-w','stop']);}finally{if(directory)await rm(directory,{recursive:true,force:true});}});
 if(externalUrl){
  const url=new URL(externalUrl);
  assert(['postgres:','postgresql:'].includes(url.protocol));assert(['localhost','127.0.0.1'].includes(url.hostname));
  assert.equal(url.username,'fixture_admin');assert.equal(url.pathname,'/factory_retained_fixture');
  admin=new pg.Pool({connectionString:externalUrl});
 }else{
  directory=await mkdtemp(join(tmpdir(),'factory-retained-control-'));
  const socket=join(directory,'socket');await mkdir(socket);
  await execFile(join(bin,'initdb'),['-D',join(directory,'data'),'-U','fixture_admin','--auth-local=trust','--auth-host=reject','--no-locale','-E','UTF8']);
  await execFile(join(bin,'pg_ctl'),['-D',join(directory,'data'),'-l',join(directory,'postgres.log'),'-o',`-k ${socket} -h '' -p 55493`,'-w','start']);started=true;
  admin=new pg.Pool({host:socket,port:55493,user:'fixture_admin',database:'postgres'});
 }
 async function fixture(t){
  const schema='retained_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
  const rewrite=sql=>sql.replace(/\bfactory\.(verification_resources|candidate_custody|delivery_intents|intake_receipts|events|execution_resources|work_orders|runs|work_spend_budgets|work_spend_operations)\b/g,`${schema}.$1`).replaceAll('IN SCHEMA factory',`IN SCHEMA ${schema}`);
  for(const name of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification'])await admin.query(rewrite(await readFile(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8')));
  const isolated={connect:async()=>{const client=await admin.connect();return{query:(sql,args)=>client.query(rewrite(sql),args),release:()=>client.release()};}};
  let policy;
  const fixtureAdmin={query:(sql,args)=>{
   const created=sql.match(/CREATE SCHEMA(?: IF NOT EXISTS)? (capability_test_[a-f0-9]+)/);
   if(created){assert.equal(policy,undefined);policy=created[1];}
   return admin.query(sql,args);
  }};
  const capability=await capabilityPolicyFixture(fixtureAdmin,schema,isolated,{'client-a':'owner-a','client-b':'owner-b'});
  t.after(async()=>{await capability.cleanup();await admin.query(`DROP SCHEMA ${schema} CASCADE`);});
  assert.match(policy,/^capability_test_[a-f0-9]+$/);
  const scope=capability.bindings['client-a'];
  const store=new PostgresDispatchStore(capability.pool,{capabilityBindings:capability.bindings});
  const source={repository:'fixture/retained-control',commit:'a'.repeat(40),tree:'b'.repeat(40)};
  const grant={clientId:'client-a',ownerScope:scope.ownerId,source,commands:['node --test'],allowedPaths:['fixture.mjs'],maxDurationMs:120000,maxSpendUsd:1};
  const admit=()=>store.prepare(grant,{protocol:'MYFACTORY_EXECUTION_V2',requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:source.repository,source,deadline:new Date(Date.now()+110000).toISOString(),maxSpendUsd:1,input:{title:'Retained control',description:'Disposable fixture only',kind:'feature',acceptanceCriteria:['Exact retained scope'],checkCommands:grant.commands,allowedPaths:grant.allowedPaths}},(request,order,run)=>({requestId:request.requestId,workOrderId:order.id,runId:run.id,inputCommit:source.commit,factoryVersion:'c'.repeat(64)}));
  const query=(sql,args,client=admin)=>client.query(rewrite(sql).replaceAll('capability_control',policy),args);
  const control=async(operation='revoke',revision=2,owner=scope)=>{const id=randomUUID();await query('UPDATE capability_control.owner_state SET revision=$3 WHERE installation_id=$1 AND owner_id=$2',[owner.installationId,owner.ownerId,revision]);await query("INSERT INTO capability_control.commands VALUES($1,$2,$3,'synthetic','{}',DEFAULT)",[owner.installationId,owner.ownerId,id]);await query("INSERT INTO capability_control.control_requests(installation_id,owner_id,request_id,capability_id,revision,operation) VALUES($1,$2,$3,'myfactory',$4,$5)",[owner.installationId,owner.ownerId,id,revision,operation]);return id;};
  const events=async row=>(await query('SELECT type,payload FROM factory.events WHERE run_id=$1 ORDER BY id',[row.run_id])).rows;
  // This fixture models the existing server-owned assertRecordScope hook. It is
  // not transport authentication or an installed External Alpha identity claim.
  const retainedStore=rows=>new PostgresDispatchStore(capability.pool,{assertRecordScope:async(_client,row)=>{assert.equal(row.client_id,'client-a');assert(rows.some(own=>own.request_id===row.request_id&&own.work_id===row.work_id&&own.work_generation===row.work_generation),'AUTHORITY_OWNER');}});
  return {store,scope,capability,grant,admit,query,control,events,retainedStore,connect:()=>admin.connect()};
 }
 await t.test('inactive installation still fences its admitted Work with an existing server binding',async t=>{
  const f=await fixture(t),row=await f.admit(),id=await f.control();
  await f.query('UPDATE capability_control.installations SET active=false WHERE id=$1',[f.scope.installationId]);
  const result=await applyFactoryCapabilityControl(f.store,'client-a',id);
  assert.equal(result.status,'ACKNOWLEDGED');assert.equal(result.receipts[0].runId,row.run_id);assert.equal(result.receipts[0].accounting,'PRESERVE_UNKNOWN');
  await assert.rejects(f.admit(),/INSTALLATION_SCOPE/);
 });
 await t.test('missing current binding uses exact durable scope plus server ownership and preserves UNKNOWN on duplicate revoke',async t=>{
  const f=await fixture(t),row=await f.admit(),id=await f.control();
  await f.query('UPDATE capability_control.installations SET active=false WHERE id=$1',[f.scope.installationId]);
  await f.query("UPDATE capability_control.relay_agent_evidence SET status='REVOKED',expires_at=clock_timestamp()-interval '1 second'");
  await f.query("INSERT INTO factory.work_spend_budgets(work_id,work_generation,request_id,work_order_id,ceiling_microusd,deadline,created_at,contract_version,authority_state) VALUES($1,1,$2,$3,1000000,$4,$5,'WORK_LEDGER_V2','active')",[row.work_id,row.request_id,row.work_order_id,row.request.deadline,new Date().toISOString()]);
  await f.query("INSERT INTO factory.work_spend_operations(operation_id,work_id,work_generation,dispatch_identity,request_id,work_order_id,factory_version,run_id,model,pricing_revision,reserved_microusd,state,created_at,updated_at,phase) VALUES($1,$2,1,'synthetic-dispatch',$3,$4,'synthetic-version',$5,'synthetic-model','synthetic-pricing',100,'unknown',$6,$6,'productive')",[randomUUID(),row.work_id,row.request_id,row.work_order_id,row.run_id,new Date().toISOString()]);
  const before=(await f.query('SELECT * FROM factory.work_spend_operations')).rows,store=f.retainedStore([row]);
  const [a,b]=await Promise.all([applyFactoryCapabilityControl(store,'client-a',id),applyFactoryCapabilityControl(store,'client-a',id)]);
  assert.deepEqual(a,b);assert.equal(a.status,'ACKNOWLEDGED');assert.equal(a.receipts[0].environment,'qualification');
  assert.equal((await f.events(row)).filter(e=>e.type==='factory.capability_revoked').length,1);
  assert.equal((await f.query('SELECT authority_state FROM factory.work_spend_budgets')).rows[0].authority_state,'fenced');
  assert.deepEqual((await f.query('SELECT * FROM factory.work_spend_operations')).rows,before);
  await assert.rejects(store.prepare(f.grant,row.request,()=>{}),/INSTALLATION_UNQUALIFIED/);
 });
 await t.test('absent server binding cannot use intake events without the server ownership hook',async t=>{
  const f=await fixture(t),row=await f.admit(),id=await f.control(),before=await f.events(row);
  await assert.rejects(applyFactoryCapabilityControl(new PostgresDispatchStore(f.capability.pool),'client-a',id),/INSTALLATION_UNQUALIFIED/);
  assert.deepEqual(await f.events(row),before);
 });
 await t.test('control rechecks ownership and inventory after waiting for the canonical policy lock',async t=>{
  const f=await fixture(t),first=await f.admit(),id=await f.control(),writer=await f.connect();
  const late={...first,request_id:randomUUID(),work_id:randomUUID(),work_order_id:randomUUID(),run_id:randomUUID()};
  const owned=[first,late],checked=[],store=f.retainedStore(owned),assertOwned=store.assertRecordScope;
  store.assertRecordScope=async(client,row)=>{checked.push(row.run_id);await assertOwned(client,row);};
  let pending;
  try{
   await writer.query('BEGIN');
   await f.query('SELECT revision FROM capability_control.owner_state WHERE installation_id=$1 AND owner_id=$2 FOR UPDATE',[f.scope.installationId,f.scope.ownerId],writer);
   pending=applyFactoryCapabilityControl(store,'client-a',id).then(value=>({value}),error=>({error}));
   const deadline=Date.now()+5000;let waiting=false;
   while(Date.now()<deadline){
    waiting=(await f.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT capability_control.lock_admission_policy%' ")).rowCount>0;
    if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert(waiting,'control must reach the canonical policy lock before the late fixture commit');
   assert.deepEqual(checked,[first.run_id]);
   // A privileged fixture writer bypasses the Factory advisory lock here. Normal
   // prepare() cannot do so. This specifically tests stale discovery defense.
   await f.query("INSERT INTO factory.work_orders(id,record,state) SELECT $1,record||jsonb_build_object('id',$1::text),state FROM factory.work_orders WHERE id=$2",[late.work_order_id,first.work_order_id],writer);
   await f.query("INSERT INTO factory.runs(id,work_order_id,record,state) SELECT $1,$2,record||jsonb_build_object('id',$1::text,'workOrderId',$2::text),state FROM factory.runs WHERE id=$3",[late.run_id,late.work_order_id,first.run_id],writer);
   await f.query("INSERT INTO factory.intake_receipts(client_id,request_id,work_id,work_generation,input_digest,work_order_id,run_id,request,snapshot,deadline) SELECT client_id,$1::uuid,$2::uuid,work_generation,input_digest,$3,$4,request||jsonb_build_object('requestId',$1::text,'workId',$2::text),snapshot||jsonb_build_object('requestId',$1::text,'workOrderId',$3::text,'runId',$4::text),deadline FROM factory.intake_receipts WHERE run_id=$5",[late.request_id,late.work_id,late.work_order_id,late.run_id,first.run_id],writer);
   await f.query("INSERT INTO factory.events(work_order_id,run_id,type,payload) SELECT $1,$2,type,payload||jsonb_build_object('workId',$3::text)||CASE WHEN type='factory.owner_scope_bound' THEN jsonb_build_object('requestId',$4::text) ELSE '{}'::jsonb END FROM factory.events WHERE run_id=$5 AND type IN ('factory.owner_scope_bound','factory.capability_admitted')",[late.work_order_id,late.run_id,late.work_id,late.request_id,first.run_id],writer);
   await writer.query('COMMIT');
   const outcome=await pending;if(outcome.error)throw outcome.error;
   assert.equal(outcome.value.status,'ACKNOWLEDGED');assert.equal(outcome.value.inventoryComplete,true);
   assert.deepEqual(new Set(outcome.value.runIds),new Set([first.run_id,late.run_id]));
   assert.equal(checked.filter(run=>run===first.run_id).length,2);assert(checked.includes(late.run_id));
   assert.equal((await f.events(late)).filter(event=>event.type==='factory.capability_revoked').length,1);
  }finally{await writer.query('ROLLBACK');writer.release();if(pending)await pending;}
 });
 for(const field of ['environment','requestId','workId','workGeneration'])await t.test(`unqualified retained ${field} stays pending while another exact Run is fenced`,async t=>{
  const f=await fixture(t),legacy=await f.admit(),exact=await f.admit();
  if(field==='environment')await f.query("UPDATE factory.events SET payload=payload-'environment' WHERE run_id=$1 AND type='factory.owner_scope_bound'",[legacy.run_id]);
  else await f.query("UPDATE factory.events SET payload=jsonb_set(payload,$2,$3::jsonb) WHERE run_id=$1 AND type='factory.owner_scope_bound'",[legacy.run_id,[field],JSON.stringify(field==='workGeneration'?99:randomUUID())]);
  const before=await f.events(legacy),id=await f.control(),result=await applyFactoryCapabilityControl(f.retainedStore([legacy,exact]),'client-a',id);
  assert.equal(result.status,'PENDING_BACKEND');assert.equal(result.inventoryComplete,false);assert.equal(result.receipts.length,1);assert.equal(result.receipts[0].runId,exact.run_id);
  assert.equal(result.unqualifiedRuns[0].runId,legacy.run_id);assert.deepEqual(await f.events(legacy),before);
 });
 await t.test('old control replay cannot fence Work admitted after re-enable revision',async t=>{
  const f=await fixture(t),old=await f.admit(),id=await f.control();await f.query('UPDATE capability_control.owner_state SET revision=3');
  const newer=await f.admit(),before=await f.events(newer),result=await applyFactoryCapabilityControl(f.retainedStore([old,newer]),'client-a',id);
  assert.deepEqual(result.runIds,[old.run_id]);assert.deepEqual(await f.events(newer),before);
 });
 await t.test('foreign control requests and restored policy state cannot mutate admitted Work',async t=>{
  const f=await fixture(t),row=await f.admit(),id=await f.control('revoke',3),foreign=await f.control('revoke',2,f.capability.bindings['client-b']),before=await f.events(row),store=f.retainedStore([row]);
  await assert.rejects(applyFactoryCapabilityControl(store,'client-a',foreign),/CONTROL_SCOPE/);
  await f.query('UPDATE capability_control.owner_state SET revision=2 WHERE installation_id=$1',[f.scope.installationId]);
  await assert.rejects(applyFactoryCapabilityControl(store,'client-a',id),/POLICY_RESTORED/);
  assert.deepEqual(await f.events(row),before);
 });
 await t.test('a present mismatched binding cannot borrow retained authority',async t=>{
  const f=await fixture(t),row=await f.admit(),id=await f.control(),before=await f.events(row);
  const store=new PostgresDispatchStore(f.capability.pool,{capabilityBindings:{'client-a':{...f.scope,agentId:'foreign-agent'}}});
  const result=await applyFactoryCapabilityControl(store,'client-a',id);assert.equal(result.status,'PENDING_BACKEND');assert.equal(result.receipts.length,0);assert.deepEqual(await f.events(row),before);
 });
});
