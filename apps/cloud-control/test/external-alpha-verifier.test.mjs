import test from 'node:test';
import assert from 'node:assert/strict';
import {alphaTasksVerifierProvider,alphaTasksVerificationPolicy,alphaTasksVerificationPolicySha256,alphaTasksCheckId,hostGrantedEffects,alphaTasksCriterionIds} from '../src/external-alpha-verifier.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {makeInstallation} from './fixtures/external-alpha-authority.mjs';

const {installation}=makeInstallation();
const bundle={commit:'c'.repeat(40),tree:'d'.repeat(40),base:installation.source.baseSha,files:{'src/a.js':'x'},sourceFiles:{}};
const report=(verdict,over={})=>({verdict,criteria:alphaTasksCriterionIds.map((_,i)=>({id:i+1,status:verdict==='PASS'?'PASS':verdict==='FAIL'?'FAIL':'NOT_VERIFIED'})),hiddenSuiteSha256:alphaTasksVerificationPolicy.hiddenSuiteSha256,policySha256:alphaTasksVerificationPolicy.acceptancePolicySha256,...over});
const attestation={runnerId:'vercel-sandbox-verifier-v1',kind:'SANDBOX_DENY_ALL_V1',networkPolicy:'deny-all',filesystem:'UNPRIVILEGED_UID_WORKSPACE_READ_SCRATCH_WRITE',environment:'SCRUBBED',hiddenMaterialVisibleToCandidate:false,disposable:true,image:alphaTasksVerificationPolicy.image,sessionId:'sbx_fixture',attestedBy:'factory-host'};
const deps=(verdict,over={},seen=[])=>({installation,runnerFor:()=>({id:'vercel-sandbox-verifier-v1'}),attestationFor:async()=>({...attestation}),loadHidden:async()=>({}),verify:async i=>{seen.push(i);return report(verdict,over);}});
const host={projectId:'prj_fixture1'};
/** Primes the run id through the real allocate guard, which refuses a mis-bound resource BEFORE creating any sandbox. */
async function primed(d){
 const p=alphaTasksVerifierProvider({hostInstallation:host,...d});
 await assert.rejects(p.allocate({run_id:'run-1',provider_name:'wrong'}),/VERIFIER_RESOURCE_BINDING/);
 return p;
}
const verify=p=>p.verify({},bundle,async()=>{});

test('policy binds the acceptance policy, the hidden suite digest and the allow-listed production runner',()=>{
 assert.match(alphaTasksVerificationPolicySha256,/^[a-f0-9]{64}$/);
 assert.equal(alphaTasksVerificationPolicy.runnerId,'vercel-sandbox-verifier-v1');
 assert.equal(alphaTasksVerificationPolicy.network,'deny-all');
 assert.deepEqual(alphaTasksVerificationPolicy.checks.map(c=>c.id),[...alphaTasksCriterionIds,alphaTasksCheckId]);
 assert.deepEqual([...hostGrantedEffects],['PRIVATE_SOURCE_READ','PRIVATE_SNAPSHOT_CUSTODY_WRITE','CANDIDATE_CUSTODY_WRITE']);
});

test('with no host composition, allocate and verify are PARTIAL (nothing can pass by default)',async()=>{
 const p=alphaTasksVerifierProvider({installation});
 await assert.rejects(p.allocate({run_id:'r'}),/VERIFIER_PARTIAL/);
 await assert.rejects(p.verify({},bundle,async()=>{}),/VERIFIER_PARTIAL/);
 assert.throws(()=>p.destroy({},{}),/VERIFIER_PARTIAL/);
});

test('PASS is the only way to produce a PASS check, and the host (not the producer) supplies identities and effects',async()=>{
 const seen=[],p=await primed(deps('PASS',{},seen));
 assert.deepEqual(await verify(p),[...alphaTasksCriterionIds,alphaTasksCheckId].map(id=>({id,result:'PASS',reportSha256:digest(report('PASS'))})));
 const i=seen[0];
 assert.equal(i.mode,'production');assert.deepEqual(i.observedEffects,[...hostGrantedEffects]);
 assert.equal(i.source.commit,installation.source.baseSha);assert.equal(i.source.tree,installation.source.treeSha);
 assert.equal(i.expected.candidateTree,bundle.tree);assert.equal(i.verifier.environmentId,'factory-verify-run-1');
});

test('FAIL maps to FAIL; PARTIAL and every inconsistent report throws VERIFIER_PARTIAL',async()=>{
 assert.deepEqual(await verify(await primed(deps('FAIL'))),[...alphaTasksCriterionIds,alphaTasksCheckId].map(id=>({id,result:'FAIL',reportSha256:digest(report('FAIL'))})));
 await assert.rejects(verify(await primed(deps('PARTIAL'))),/VERIFIER_PARTIAL/);
 await assert.rejects(verify(await primed(deps('PASS',{hiddenSuiteSha256:'0'.repeat(64)}))),/VERIFIER_PARTIAL/);
 await assert.rejects(verify(await primed(deps('PASS',{policySha256:'0'.repeat(64)}))),/VERIFIER_PARTIAL/);
});

test('missing runner, attestation host, hidden suite, or a throwing dependency is PARTIAL, never PASS',async()=>{
 for(const patch of [{runnerFor:undefined},{attestationFor:undefined},{runnerFor:()=>undefined},{loadHidden:async()=>{throw Error('custody down');}}])
  await assert.rejects(verify(await primed({...deps('PASS'),...patch})),/VERIFIER_PARTIAL/);
 // A missing host attestation stops before any acceptance dependency can promote it.
 const seen=[];
 const p=await primed({...deps('PARTIAL',{},seen),attestationFor:async()=>{throw Error('no attestation');}});
 await assert.rejects(verify(p),/VERIFIER_PARTIAL/);assert.equal(seen.length,0);
});

test('the deadline guard runs before and after verification',async()=>{
 const p=await primed(deps('PASS'));let n=0;
 await assert.rejects(p.verify({},bundle,async()=>{if(++n===2)throw Error('LEASE_LOST');}),/LEASE_LOST/);
});

test('missing, repeated or contradictory criterion outcomes cannot pass',async()=>{
 for(const criteria of [[],report('PASS').criteria.slice(1),report('PASS').criteria.map(()=>({id:1,status:'PASS'})),report('FAIL').criteria])
  await assert.rejects(verify(await primed(deps('PASS',{criteria}))),/VERIFIER_PARTIAL/);
});
