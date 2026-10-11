import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseCloudPrepare} from '../../../packages/contracts/src/cloud-execution.ts';
import {ExternalAlphaAuthorityStore,receiptSigner,validateExternalAlphaAuthority} from '../src/external-alpha-authority.mjs';
import {makeKeys} from './fixtures/external-alpha-authority.mjs';
import {loadVectors,installationOf,grantFor,applyMutation} from './fixtures/myeve-conformance/support.mjs';

// The REAL MyEve-generated vectors against REAL PostgreSQL consumption. Time is pinned to the vector clock.
const skip=process.env.FACTORY_POSTGRES_TEST!=='1';
const v=loadVectors(),AT=v.nowMs+1000;
const code=async p=>{try{await p;}catch(e){return e.code??e.message;}return 'ACCEPTED';};

async function setup(t,view){
 const url=new URL(process.env.DATABASE_URL_UNPOOLED);assert(['localhost','127.0.0.1'].includes(url.hostname),'Disposable localhost only');
 const pool=new pg.Pool({connectionString:url.href,max:16}),schema='ea_conf_'+randomUUID().replaceAll('-','');
 await pool.query('CREATE SCHEMA '+schema);
 const rewrite=sql=>sql.replace(/\bfactory\./g,schema+'.').replace(/IN SCHEMA factory\b/g,'IN SCHEMA '+schema);
 const isolated={connect:async()=>{const c=await pool.connect();return {query:(sql,args)=>c.query(rewrite(sql),args),release:()=>c.release()};}};
 const query=(sql,args)=>pool.query(rewrite(sql),args);
 t.after(async()=>{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();});
 for(const m of ['002-canonical-execution-ledger','004-canonical-dispatch','005-cloud-custody','006-cloud-verification','009-paid-operation-release','011-external-alpha-work-authority'])await query(await readFile(new URL('../migrations/'+m+'.sql',import.meta.url),'utf8'));
 const installation=installationOf(v,undefined,view),keys=makeKeys();
 const store=new ExternalAlphaAuthorityStore(isolated,installation,{signReceipt:receiptSigner(keys.privateKey.export({type:'pkcs8',format:'pem'}))});
 const admit=(e,p)=>store.transaction((c)=>{validateExternalAlphaAuthority(e,p,installation,AT);parseCloudPrepare(p,grantFor(installation),AT);return store.consume(c,e,p,AT);});
 return {query,store,installation,admit,count:async()=>Number((await query('SELECT count(*) FROM factory.external_alpha_work_authority')).rows[0].count)};
}

test('the real MyEve authority is consumed once; identical redelivery (also concurrent) is an idempotent replay',{skip},async t=>{
 const {admit,count,query}=await setup(t),{envelope:e,prepare:p}=v;
 const first=await admit(e,p);assert.equal(first.replayed,false);
 assert.equal(first.row.authority_id,v.identifiers.authorityId);assert.equal(first.row.request_id,v.identifiers.requestId);assert.equal(first.row.writer_id,v.identifiers.writerId);
 const again=await Promise.all(Array.from({length:10},()=>admit(structuredClone(e),structuredClone(p))));
 assert.ok(again.every(r=>r.replayed&&r.row.authority_id===first.row.authority_id));
 assert.equal(await count(),1);
 assert.equal((await query('SELECT state FROM factory.external_alpha_work_authority')).rows[0].state,'CONSUMED');
});

test('a competing real authority for the same Work generation is refused and consumes nothing',{skip},async t=>{
 const {admit,count}=await setup(t),c=v.variants.competing;
 await admit(v.envelope,v.prepare);
 assert.equal(await code(admit(c.envelope,c.prepare)),'AUTHORITY_CONSUMED');
 assert.equal(await count(),1);
 // and in the other order / concurrently exactly one wins
 const second=await setup(t);
 const outcomes=await Promise.all([code(second.admit(v.envelope,v.prepare)),code(second.admit(c.envelope,c.prepare))]);
 assert.deepEqual(outcomes.slice().sort(),['ACCEPTED','AUTHORITY_CONSUMED']);
 assert.equal(await second.count(),1);
});

test('slot 2 is a separate installation: its authority is refused by the slot-1 installation and vice versa',{skip},async t=>{
 const one=await setup(t),two=await setup(t,v.variants.slot2.installation),s2=v.variants.slot2;
 assert.equal(await code(one.admit(s2.envelope,s2.prepare)),'AUTHORITY_OWNER');
 assert.equal(await code(two.admit(v.envelope,v.prepare)),'AUTHORITY_OWNER');
 assert.equal(await one.count()+await two.count(),0);
 assert.equal((await two.admit(s2.envelope,s2.prepare)).replayed,false);
});

test('every one-field mutation of the MyEve vectors is refused before any state is written (only the two signed-window rows pass)',{skip},async t=>{
 const {admit,count}=await setup(t);
 const accepted=[];
 for(const m of v.mutations){
  const {envelope,prepare}=applyMutation(v,m);
  const got=await code(admit(envelope,prepare));
  if(got==='ACCEPTED'){accepted.push(m.name);break;} // first acceptance consumes the Work; handled below
 }
 const before=await count();
 // Everything refused so far consumed nothing; at most the first legitimately admissible variant exists.
 assert.ok(before<=1);
 assert.ok(accepted.every(n=>['document:expiresAt','prepare:deadline'].includes(n)),accepted.join());
 // a fresh database: all rows except those two are refused outright
 const fresh=await setup(t);let ok=0;
 for(const m of v.mutations){
  if(['document:expiresAt','prepare:deadline'].includes(m.name))continue;
  const {envelope,prepare}=applyMutation(v,m);
  if(await code(fresh.admit(envelope,prepare))==='ACCEPTED')ok++;
 }
 assert.equal(ok,0);assert.equal(await fresh.count(),0);
 // the untouched original is still admissible afterwards: refusals consumed nothing
 assert.equal((await fresh.admit(v.envelope,v.prepare)).replayed,false);
});
