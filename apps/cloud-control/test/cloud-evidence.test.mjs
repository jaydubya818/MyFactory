import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cloudEvidence,cloudEvidenceRead,proofCredential} from '../src/cloud-evidence.mjs';
import {handleCloud} from '../api/cloud.mjs';
const owner='fixture-owner',run=randomUUID(),order=randomUUID(),requestId=randomUUID(),work=randomUUID(),version='b'.repeat(64),candidate='a'.repeat(40);
const bundle={commit:candidate,checks:[{command:'node --test',exitCode:0}],patchBase64:Buffer.from('fixture patch').toString('base64')};
function row(){return{work_id:work,work_generation:1,request_id:requestId,work_order_id:order,run_id:run,request:{repository:'fixture/source'},snapshot:{factoryVersion:version},events:[
 {type:'factory.owner_scope_bound',payload:{ownerScope:owner,workId:work,workGeneration:1,requestId,repository:'fixture/source'}},
 {type:'factory.terminal',payload:{finishedAt:'2026-10-03T00:00:00.000Z'}},
 {type:'run.signed_result',payload:{encoded:Buffer.from(JSON.stringify({status:'COMPLETED',candidate:{commit:candidate},execution:{runId:run,workOrderId:order,factoryVersion:version,requestId}})).toString('base64url')}}]};}
const provider={readCustody:async()=>bundle};
test('Cloud projects retained custody into accepted Test/Diff transport references',async()=>{
 const r=row(),e=await cloudEvidence(r,provider,owner);assert.deepEqual(e.map(x=>x.ref.kind),['TestEvidence','DiffEvidence']);
 for(const a of e){
  assert(!JSON.stringify(a).includes('relativePath'));
  const input={...a.scope,workOrderId:order,runId:run,candidateCommit:candidate,factoryVersion:version,evidenceKind:a.ref.kind,expectedDigest:a.ref.sha256,evidenceReference:a.proofReference};
  const runtime={store:{findRun:async()=>({request_id:r.request_id}),read:async()=>r},provider};assert.deepEqual(await cloudEvidenceRead(input,runtime,owner),a);
  for(const key of ['ownerScope','repository','workId','workGeneration','requestId','workOrderId','runId','candidateCommit','factoryVersion','evidenceKind','expectedDigest','evidenceReference'])
   await assert.rejects(cloudEvidenceRead({...input,[key]:key==='workGeneration'?2:'wrong'},runtime,owner));
 }
});
test('historical unbound owner, cross-owner, wrong signed candidate and absent receipt deny reads',async()=>{
 await assert.rejects(cloudEvidence(row(),provider,'another-owner'));
 const unbound=row();unbound.events.shift();await assert.rejects(cloudEvidence(unbound,provider,owner));
 const missing=row();missing.events.pop();await assert.rejects(cloudEvidence(missing,provider,owner),e=>e.code==='waiting_for_evidence');
 await assert.rejects(cloudEvidence(row(),{readCustody:async()=>({...bundle,commit:'c'.repeat(40)})},owner));
});
test('Proof credential is expiring, separate and incapable of execution API access',async()=>{
 const env={VERCEL_PROJECT_ID:'prj_IRXTY6HOzS2q9wRPdabsJnmddzl4',VERCEL_ENV:'preview',FACTORY_SOFIE_STAGING_TOKEN:'a'.repeat(64),FACTORY_PROOF_TOKEN:'b'.repeat(64),FACTORY_PROOF_OWNER_SCOPE:owner,FACTORY_PROOF_EXPIRES_AT:new Date(Date.now()+60000).toISOString()};
 const req=new Request('https://factory.invalid/api/connect/v2/dispatches',{method:'POST',headers:{authorization:'Bearer '+env.FACTORY_PROOF_TOKEN},body:'{}'});
 assert.equal(proofCredential(req,env),true);assert.equal(proofCredential(req,{...env,FACTORY_PROOF_EXPIRES_AT:'2020-01-01T00:00:00Z'}),false);
 assert.equal(proofCredential(req,{...env,FACTORY_SOFIE_STAGING_TOKEN:env.FACTORY_PROOF_TOKEN}),false);
 let executed=false;const response=await handleCloud(req,env,async(_env,action)=>action({store:{},provider,control:{prepare:async()=>{executed=true;}}}));
 assert.equal(response.status,401);assert.equal(executed,false);
});
