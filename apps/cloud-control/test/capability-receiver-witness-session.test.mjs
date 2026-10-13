import test from 'node:test';
import assert from 'node:assert/strict';
import {FactoryReceiverWitness} from '../src/capability-receiver-witness.mjs';

const visible={pid:42,backend_pid:42,started:'2026-10-12 12:00:00+00',usename:'restricted',role:'restricted',datname:'witness',database:'witness',state:'active',statement_timeout:'1s',idle_timeout:'1s'};
const head={ownerId:'owner',organizationId:'org',installationId:'install',revision:1,digest:'a'.repeat(64)};
function fixture(t,own={rowCount:1,rows:[visible]},pending={rowCount:0,rows:[]}){
 const witness=new FactoryReceiverWitness({databaseUrl:'postgres://restricted@localhost/witness?sslmode=verify-full',epoch:'epoch',enrollmentId:'original',qualificationDigest:'b'.repeat(64),installationDigest:'c'.repeat(64),
  resources:{directEndpointVerified:true,factoryMarker:'native',witnessMarker:'witness',factoryResourceId:'native',witnessResourceId:'witness',myeveResourceId:'myeve'}});
 t.after(()=>witness.close());
 const queries=[];
 const client={processID:42,query:async(sql)=>{queries.push(sql);if(sql.startsWith('SELECT pid,')){if(own instanceof Error)throw own;return own;}return pending;}};
 witness.operation=async action=>action(client);
 return {witness,queries,client};
}
for(const [name,own] of [
 ['absent own session',{rowCount:0,rows:[]}],
 ['multiple own sessions',{rowCount:2,rows:[visible,visible]}],
 ['invalid backend start',{rowCount:1,rows:[{...visible,started:'not-a-timestamp'}]}],
 ['masked backend start',{rowCount:1,rows:[{...visible,started:null}]}],
 ['foreign PID',{rowCount:1,rows:[{...visible,pid:43,backend_pid:43}]}],
 ['foreign role',{rowCount:1,rows:[{...visible,usename:'other'}]}],
 ['foreign database',{rowCount:1,rows:[{...visible,datname:'other'}]}],
 ['masked activity state',{rowCount:1,rows:[{...visible,state:null}]}],
 ['unbounded statement timeout',{rowCount:1,rows:[{...visible,statement_timeout:'0'}]}],
 ['unbounded idle transaction timeout',{rowCount:1,rows:[{...visible,idle_timeout:'0'}]}],
 ['activity permission denied',Error('permission denied for view pg_stat_activity')],
])test(name+' cannot read authority or start a witness CAS',async t=>{
 const {witness,queries}=fixture(t,own);witness.uncertainSessions=[{pid:7,started:visible.started}];
 await assert.rejects(witness.read(head),/SESSION_UNAVAILABLE|permission denied/);
 await assert.rejects(witness.advance(head,{...head,revision:2}),/SESSION_UNAVAILABLE|permission denied/);
 assert.equal(witness.uncertainSessions.length,1);
 assert(queries.every(sql=>sql.startsWith('SELECT pid,')));
});
test('unavailable termination result preserves uncertainty and cannot begin a CAS',async t=>{
 const {witness,queries}=fixture(t,undefined,{rowCount:null,rows:[]});witness.uncertainSessions=[{pid:7,started:visible.started}];
 await assert.rejects(witness.advance(head,{...head,revision:2}),/SESSION_UNAVAILABLE/);
 assert.equal(witness.uncertainSessions.length,1);assert(!queries.includes('BEGIN'));
});
test('prior session proof must be complete even after the role activity scan succeeds',async t=>{
 const {witness,client,queries}=fixture(t);witness.uncertainSessions=[{pid:7,started:visible.started}];
 const query=client.query;client.query=async(sql,p)=>sql.includes('backend_start=$2')?{rowCount:null,rows:[]}:query(sql,p);
 await assert.rejects(witness.advance(head,{...head,revision:2}),/SESSION_UNAVAILABLE/);
 assert.equal(witness.uncertainSessions.length,1);assert(!queries.includes('BEGIN'));
});
test('complete restricted own-session and prior termination proof returns the immutable uncertainty identity',async t=>{
 const {witness,client}=fixture(t);witness.uncertainSessions=[{pid:7,started:visible.started}];
 assert.deepEqual(await witness.assertPriorTermination(client),{pid:42,started:visible.started});assert.equal(witness.uncertainSessions.length,0);
});
