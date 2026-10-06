import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudWorkControl} from '../src/cloud-work-control.mjs';

// Sanitized production regression: admission/claim precedes the allocation
// receipt. The original resource has a live lease, no failure and no model op.
function fixture(clientId){
 const now=Date.now(),future=new Date(now+60000).toISOString();
 const row={work_id:'work',request_id:'request',run_id:'run',deadline:new Date(now+180000).toISOString(),identity:{},events:[],
  resource:{state:'ALLOCATING',allocation_unknown:true,cleanup_confirmed:false,lease_expires_at:future,deadline:future,evidence:{}},custody:null};
 const spend={status:'KNOWN',operations:[],paidOperationsUsed:0};
 const control=new CloudWorkControl({grant:{clientId},store:{read:async()=>structuredClone(row)},spend:{read:async()=>structuredClone(spend)}});
 return{row,spend,control};
}
for(const clientId of ['sofie-production','sofie-alpha-a','sofie-alpha-b','sofie-alpha-c','sofie-production-validation']){
 test(`${clientId}: a live first allocation is pending, not execution UNKNOWN`,async()=>{
  const {control,row}=fixture(clientId);
  assert.equal((await control.read('request')).state,'RUNNING');
  assert.equal((await control.result('request')).state,'RUNNING');
  row.resource.allocation_unknown=false;row.resource.state='PREPARING';
  assert.equal((await control.read('request')).state,'RUNNING');
 });
 test(`${clientId}: expired, cancelled, failed and ambiguous cleanup stay fenced`,async()=>{
  for(const patch of [{lease_expires_at:new Date(0).toISOString()},{cancelled_at:new Date().toISOString()},{evidence:{failure:'ALLOCATION_FAILED'}},{evidence:{cleanup:'UNKNOWN'}}]){
   const {control,row}=fixture(clientId);Object.assign(row.resource,patch);
   assert.equal((await control.read('request')).state,'UNKNOWN');
   assert.equal((await control.result('request')).state,'UNKNOWN');
  }
 });
 test(`${clientId}: producer teardown and live verifier handoff do not imply UNKNOWN`,async()=>{
  const {control,row}=fixture(clientId);Object.assign(row.resource,{cleanup_confirmed:true,allocation_unknown:false,evidence:{visibleChecksPassed:true}});
  row.custody={candidate_commit:'commit',candidate_tree:'tree',artifact_sha256:'digest'};
  assert.equal((await control.read('request')).state,'RUNNING');
  row.verification={state:'RUNNING',deadline:row.deadline,lease_expires_at:row.resource.lease_expires_at,candidate_commit:'commit',candidate_tree:'tree',custody_sha256:'digest'};
  assert.equal((await control.read('request')).state,'RUNNING');
  row.verification.candidate_tree='other';assert.equal((await control.read('request')).state,'UNKNOWN');
 });
}
test('paid UNKNOWN remains UNKNOWN even during a live producer lease; no status read causes dispatch',async()=>{
 const {control,spend}=fixture('sofie-alpha-a');spend.operations=[{state:'unknown'}];
 assert.equal((await control.read('request')).state,'UNKNOWN');assert.equal((await control.result('request')).state,'UNKNOWN');
});
test('ambiguous delivery without a resource remains UNKNOWN',async()=>{
 const {control,row}=fixture('sofie-alpha-a');row.resource=null;row.delivery={state:'UNKNOWN'};
 assert.equal((await control.read('request')).state,'UNKNOWN');
});
