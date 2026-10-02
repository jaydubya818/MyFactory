import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCloudCandidate,reconcileCloudVerification} from '../src/cloud-verification.mjs';

function fixture(fault){
 const effects=[];let created=false;
 const record={run_id:'run',lease_owner:'lease',provider_name:'factory-verify-run',provider_session_id:null,deadline:new Date(Date.now()+45000).toISOString(),candidate_commit:'commit',candidate_tree:'tree',cleanup_confirmed:false,outcome:'UNKNOWN'};
 const sandbox={currentSession:()=>({sessionId:'sbx_verifier'})};
 let receiptAttempts=0;
 const store={
  claim:async()=>{const fresh=!created;created=true;return {created:fresh,record:structuredClone(record)};},
  read:async()=>created?structuredClone(record):null,
  assertActive:async()=>{if(fault==='cancel')throw Error('VERIFIER_LEASE_FENCED');},
  allocated:async(_r,_l,id)=>{if(fault==='receipt'&&receiptAttempts++===0)throw Error('database error containing sensitive material');record.provider_session_id=id;effects.push('RECEIPT');},
  finish:async(_r,_l,checks)=>{record.outcome=checks.every(c=>c.result==='PASS')?'PASS':'FAIL';effects.push('FINISH');},
  failed:async(_r,_l,code)=>{record.failure=code;record.outcome='UNKNOWN';effects.push('UNKNOWN');},
  cleanup:async()=>{record.cleanup_confirmed=true;effects.push('CLEANUP');},
 };
 const provider={
  allocate:async()=>{effects.push('ALLOCATE');if(fault==='allocation')throw Error('provider response with secrets');return sandbox;},
  verify:async(_s,_b,active)=>{await active();effects.push('VERIFY');if(fault==='verify')throw Error('candidate output must not enter evidence');return[{id:'check',result:fault==='check'?'FAIL':'PASS'}];},
  destroy:async()=>{effects.push('DESTROY');if(fault==='cleanup')throw Error('VERIFIER_CLEANUP_UNKNOWN');},
 };
 return{effects,record,store,provider,clientId:'client',requestId:'request',readCustody:async()=>({commit:fault==='custody'?'other':'commit',tree:'tree'})};
}

test('verification is deduplicated, binds immutable custody and returns only after cleanup',async()=>{
 const f=fixture();const first=await verifyCloudCandidate(f),second=await verifyCloudCandidate(f);
 assert.equal(first.outcome,'PASS');assert.deepEqual(first,second);
 assert.deepEqual(f.effects,['ALLOCATE','RECEIPT','VERIFY','FINISH','DESTROY','RECEIPT','CLEANUP']);
});
test('failed protected check remains FAIL after successful teardown',async()=>{
 const f=fixture('check'),r=await verifyCloudCandidate(f);assert.equal(r.outcome,'FAIL');assert.equal(r.cleanup_confirmed,true);
});
test('custody mismatch and candidate exceptions never become success or uncontrolled evidence',async()=>{
 for(const fault of ['custody','verify']){
  const f=fixture(fault),r=await verifyCloudCandidate(f);assert.equal(r.outcome,'UNKNOWN');assert.equal(r.cleanup_confirmed,true);
  assert.match(r.failure,/^VERIFIER_[A-Z_]+$/);assert.equal(JSON.stringify(r).includes('candidate output'),false);
  if(fault==='custody')assert.equal(f.effects.includes('VERIFY'),false);
 }
});
test('cancelled authority prevents allocation; missing allocation receipt stays unresolved',async()=>{
 for(const fault of ['cancel','allocation']){
  const f=fixture(fault);await assert.rejects(verifyCloudCandidate(f),/CLEANUP_UNPROVEN/);
  assert.equal(f.record.cleanup_confirmed,false);assert.equal(f.record.outcome,'UNKNOWN');
  await assert.rejects(verifyCloudCandidate(f),/RECONCILIATION_PENDING/);
  assert.equal(f.effects.filter(e=>e==='ALLOCATE').length,fault==='cancel'?0:1);
 }
});
test('lost database allocation receipt is recovered only for the same destroyed resource',async()=>{
 const f=fixture('receipt'),r=await verifyCloudCandidate(f);
 assert.equal(r.outcome,'UNKNOWN');assert.equal(r.provider_session_id,'sbx_verifier');assert.equal(r.cleanup_confirmed,true);
 assert.equal(f.effects.includes('VERIFY'),false);assert.equal(f.effects.filter(e=>e==='ALLOCATE').length,1);
});
test('cleanup failure withholds PASS and reconciliation never allocates a replacement',async()=>{
 const f=fixture('cleanup');await assert.rejects(verifyCloudCandidate(f),/CLEANUP_UNKNOWN/);assert.equal(f.record.cleanup_confirmed,false);
 await assert.rejects(reconcileCloudVerification(f),/RECONCILIATION_PENDING/);
 f.provider.destroy=async()=>{f.effects.push('RECOVERY_DESTROY');};
 const recovered=await reconcileCloudVerification({...f,now:()=>Date.now()+90000});
 assert.equal(recovered.cleanup_confirmed,true);assert.equal(f.effects.filter(e=>e==='ALLOCATE').length,1);
});
test('recovery with no verifier intent does not create one',async()=>{
 const f=fixture();assert.equal(await reconcileCloudVerification(f),null);assert.deepEqual(f.effects,[]);
});
