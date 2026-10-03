import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {ReviewRepair,repairLink,repairPrompt,claimRepairPreparation} from '../src/review-repair.ts';
import {performAction,parseCreateInput,actionRegistry} from '../src/actions.ts';
import {JobManager} from '../src/jobs.ts';
const corpus=JSON.parse(readFileSync(new URL('../../../packages/verification/test/corpus/quantity-safe-integer.json',import.meta.url)));
const H=x=>createHash('sha256').update(x).digest('hex');
const escapeCase=JSON.parse(readFileSync(new URL('../../../packages/verification/test/corpus/quantity-review-repair.json',import.meta.url)));
const A=escapeCase.candidateA,B='b'.repeat(40),C='c'.repeat(40),T='d'.repeat(40),U='e'.repeat(40);
const policy=()=>({mode:'OWNER_APPROVAL',publicContract:JSON.stringify(corpus.publicContract),allowedPaths:['quantity.mjs'],maxRounds:2,maxOperations:6,maxBudgetMicrousd:2100000,maxDurationSeconds:600,round:{productiveOperations:2,completionOperations:1,budgetMicrousd:1050000,durationSeconds:300}});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'review-repair-'));let now=Date.now();let storage=openStorage(join(dir,'factory.sqlite'));
 t.after(()=>{storage.close();rmSync(dir,{recursive:true,force:true});});
 const input={title:'Quantity',description:'Implement positive-integer validation and independently verify it.',kind:'feature',repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['Match the public quantity contract'],reproductionCommand:null,expectedFailureText:null,checkCommands:['node --test'],allowedPaths:['quantity.mjs'],workerProfile:'mac'};
 const root=storage.createWorkOrder(input,'ready_for_review');
 let service=new ReviewRepair(storage,{reviewers:['independent-reviewer'],verifiers:['protected-host']},()=>now);
 function ready(order,commit,tree){
  let run=storage.createRun({workOrderId:order.id,workerProfile:'mac',inputCommit:order.baseRef,workspacePath:dir});
  run=storage.saveRun({...run,state:'ready_for_review',candidateCommit:commit,finishedAt:new Date().toISOString()});storage.saveWorkOrder({...order,state:'ready_for_review'});
  for(const [type,payload] of [['run.implementation_checkpoint',{tree,passed:true}],['run.productive_closed',{tree}],['run.completion_result',{status:'completed'}],['run.candidate_committed',{candidateCommit:commit,candidateTree:tree}],['run.signed_result',{manifestDigest:H(commit)}]])storage.appendEvent({workOrderId:order.id,runId:run.id,type,payload});
  storage.insertCheck({runId:run.id,candidateCommit:commit,command:'node --test',status:'passed',exitCode:0,startedAt:run.startedAt,finishedAt:run.finishedAt,logPath:join(dir,'synthetic-check.log'),logSha256:H(commit)});
  return {workOrderId:order.id,runId:run.id,commit,tree};
 }
 const candidate=ready(root,A,T);
 const observe=(c,stage,status='PASS',published=false,artifactHash=H(c.commit+stage))=>service.observe({candidate:c,stage,status,published,artifactHash,source:'host:'+stage},'protected-host');
 const verify=(c,published=false)=>{observe(c,'custody','PASS',published);observe(c,'protected','PASS',published);if(published)observe(c,'ci','PASS',true);};
 const finding=(visibility='PUBLIC')=>({id:'numeric-range',category:'contract',severity:'high',path:'quantity.mjs',evidence:{visibility,reference:H('public independent review'),summary:visibility==='PUBLIC'?'Public large-integer input is rounded by Number conversion; enforce the approved safe-integer range.':''}});
 const review=(c,status='FAIL',findings=status==='FAIL'?[finding()]:[])=>service.recordReview({id:randomUUID(),reviewer:'independent-reviewer',candidate:c,status,findings,reportHash:H(c.commit+status)},'independent-reviewer');
 const context={storage,reviewRepair:service,confirmHumanPresence:async()=>true,notify:()=>{},startRun:()=>{throw Error('No execution authorized');},cancelRun:()=>{throw Error('No execution authorized');}};
 const propose=(p=policy())=>service.propose(root.id,service.review(root.id).id,p);
 const approve=p=>service.approve(root.id,p.id,p.hash,'owner');
 return {dir,storage,root,candidate,ready,observe,verify,finding,review,context,propose,approve,get service(){return service;},clock:ms=>now+=ms,reopen:()=>{storage.close();storage=openStorage(join(dir,'factory.sqlite'));service=new ReviewRepair(storage,{reviewers:['independent-reviewer'],verifiers:['protected-host']},()=>now);return {storage,service};}};
}
test('Attempt-8 escape → owner-bounded repair Work → new candidate → full fresh verification → independent review',t=>{
 assert.equal(escapeCase.history.independentReview,'FAIL');assert.equal(escapeCase.history.protectedVerification,'11/11 PASS');
 const f=fixture(t);f.verify(f.candidate,true);const old=f.review(f.candidate,'FAIL',[escapeCase.finding]);const before=JSON.stringify({order:f.storage.getWorkOrder(f.root.id),run:f.storage.getRun(f.candidate.runId),checks:f.storage.listChecks(f.candidate.runId),review:old});
 const p=f.propose(),child=f.approve(p);assert.notEqual(child.id,f.root.id);assert.equal(child.baseRef,A);assert.equal(child.description,f.root.description);assert.equal(child.state,'awaiting_approval');
 assert.equal(f.service.view(child.id).status,'AWAITING_EXECUTION_APPROVAL');assert.equal(f.storage.listRuns(child.id).length,0);assert.equal(f.service.review(child.id),null);
 const b=f.ready(child,B,U);assert.throws(()=>f.review(b,'PASS'),/Complete fresh verification/);
 f.observe(b,'custody');assert.throws(()=>f.review(b,'PASS'),/Complete fresh verification/);f.observe(b,'protected','PASS',true);
 assert.throws(()=>f.review(b,'PASS'),/published CI/);f.observe(b,'ci','PASS',true);f.review(b,'PASS');
 const v=f.service.view(child.id);assert.equal(v.status,'REVIEW_PASSED');assert.equal(v.ownerAcceptance,'NOT_RUN');assert.equal(v.merge,'NOT_RUN');assert.equal(v.deployment,'NOT_RUN');assert.equal(v.allocatedOperations,3);
 assert.equal(JSON.stringify({order:f.storage.getWorkOrder(f.root.id),run:f.storage.getRun(f.candidate.runId),checks:f.storage.listChecks(f.candidate.runId),review:f.service.review(f.root.id)}),before);
 assert.equal(repairLink(f.storage,child.id).reviewId,old.id);assert.equal(repairLink(f.storage,child.id).parent.commit,A);
});
test('reviews and verification ingestion are host-only; agent can propose but cannot approve',async t=>{
 const f=fixture(t);assert(!actionRegistry['review.record']);assert(!actionRegistry['review.observe']);
 assert.throws(()=>new ReviewRepair(f.storage).observe({candidate:f.candidate},'protected-host'),/Trusted verification/);
 f.verify(f.candidate);f.review(f.candidate);
 const p=await performAction(f.context,'repair.propose',{workOrderId:f.root.id,reviewId:f.service.review(f.root.id).id,policy:policy()},{kind:'agent',id:'producer'});
 const input={workOrderId:f.root.id,proposalId:p.id,proposalHash:p.hash};
 await assert.rejects(()=>performAction(f.context,'repair.approve',input,{kind:'agent',id:'producer'}),/cannot perform/);
 await assert.rejects(()=>performAction({...f.context,confirmHumanPresence:async()=>false},'repair.approve',input,{kind:'human',id:'owner'}),/did not confirm/);
 const child=await performAction(f.context,'repair.approve',input,{kind:'human',id:'owner'});assert.equal(child.state,'awaiting_approval');
 await assert.rejects(()=>performAction(f.context,'run.start',{workOrderId:child.id},{kind:'human',id:'owner'}),/bounded canonical dispatch/);
 await assert.rejects(()=>new JobManager(f.storage,f.dir,()=>{}).startRun(child),/new repair Work/);
});
test('proposal/approval replay survives restart and never creates a duplicate Work',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate);const p=f.propose();assert.deepEqual(f.propose(),p);const child=f.approve(p);
 const {storage,service}=f.reopen();assert.equal(service.approve(f.root.id,p.id,p.hash,'owner').id,child.id);assert.equal(storage.listWorkOrders().length,2);assert.equal(service.view(child.id).rounds,1);
 assert.throws(()=>service.approve(f.root.id,p.id,'0'.repeat(64),'owner'),/Exact repair proposal/);
});
test('independent-review and exact-candidate records cannot be relabeled',t=>{
 const f=fixture(t);f.verify(f.candidate);const review=f.review(f.candidate);assert.deepEqual(f.service.recordReview(review,'independent-reviewer'),review);
 assert.throws(()=>f.service.recordReview({...review,status:'PASS',findings:[]},'independent-reviewer'),/immutable/);
 assert.throws(()=>f.service.recordReview({...review,reviewer:'producer'},'producer'),/Authenticated independent/);
 assert.throws(()=>f.observe({...f.candidate,tree:U},'protected'),/differs/);
});
test('Candidate A verdicts and unchanged tree cannot pass Candidate B',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate);const child=f.approve(f.propose()),b=f.ready(child,B,U);
 assert.throws(()=>f.observe(b,'custody','PASS',false,H(A+'custody')),/Parent candidate evidence/);
 assert.throws(()=>f.observe({...b,tree:T},'custody'),/differs/);assert.throws(()=>f.service.publicationEligible(child.id),/Fresh custody/);
 assert.throws(()=>f.observe(b,'protected'),/cannot be skipped/);f.verify(b);f.service.publicationEligible(child.id);
});
test('restricted findings never enter producer context; absence of public reproduction needs an owner',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate,'FAIL',[f.finding(),{...f.finding('RESTRICTED'),id:'protected-metadata',evidence:{visibility:'RESTRICTED',reference:H('opaque holdout digest'),summary:''}}]);
 const child=f.approve(f.propose()),prompt=repairPrompt(f.storage,child.id).join('\n');assert(prompt.includes('numeric-range'));assert(!prompt.includes('protected-metadata'));assert(!prompt.includes(H('opaque holdout digest')));assert(prompt.includes('not authority'));
 assert.equal(repairLink(f.storage,child.id).permittedFindings.length,1);
});
test('protected payload, malformed findings, unsupported policy and scope expansion fail closed',t=>{
 const f=fixture(t);f.verify(f.candidate);
 assert.throws(()=>f.review(f.candidate,'FAIL',[{...f.finding('RESTRICTED'),evidence:{visibility:'RESTRICTED',reference:H('secret'),summary:'holdout input'}}]),/opaque digest/);
 f.review(f.candidate);assert.throws(()=>f.propose({...policy(),mode:'AUTOMATIC'}),/not enabled/);assert.throws(()=>f.propose({...policy(),allowedPaths:['outside.mjs']}),/scope exceeds/);
 assert.throws(()=>f.propose({...policy(),maxRounds:0}),/Invalid repair limit/);
});
for(const cap of ['maxRounds','maxOperations','maxBudgetMicrousd'])test(cap+' is a chain limit, not a renewable allowance',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate);const p=policy();p[cap]=cap==='maxRounds'?1:cap==='maxOperations'?3:1050000;
 const child=f.approve(f.propose(p)),b=f.ready(child,B,U);f.verify(b);const failed=f.review(b);
 assert.throws(()=>f.service.propose(child.id,failed.id,p),/exhausted/);assert.equal(f.service.view(child.id).status,'NEEDS_YOU');
 assert.throws(()=>f.service.propose(child.id,failed.id,{...p,maxRounds:8,maxOperations:24,maxBudgetMicrousd:10000000}),/cannot expand/);
});
test('a second round links B to C without rewriting A; objective and contract stay fixed',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate);const child=f.approve(f.propose()),b=f.ready(child,B,U);f.verify(b);const failed=f.review(b);
 const p=f.service.propose(child.id,failed.id,policy()),next=f.service.approve(f.root.id,p.id,p.hash,'owner');assert.equal(next.baseRef,B);assert.equal(next.description,f.root.description);assert.equal(repairLink(f.storage,next.id).round,2);
 assert.equal(f.service.view(next.id).allocatedOperations,6);assert.equal(f.service.view(next.id).allocatedMicrousd,2100000);
 assert.throws(()=>f.propose(),/current failed-review candidate/);
});
test('expired chain and UNKNOWN evidence cannot trigger another repair',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate);const child=f.approve(f.propose()),b=f.ready(child,B,U);f.observe(b,'custody');f.observe(b,'protected','UNKNOWN');assert.equal(f.service.view(child.id).status,'NEEDS_YOU');
 assert.throws(()=>f.observe(b,'protected','PASS'),/reconciliation/);assert.throws(()=>f.review(b),/Complete fresh verification/);f.clock(601000);assert.equal(f.service.view(child.id).status,'NEEDS_YOU');
});
test('canonical preparation enforces exact objective, base, scope, operations, budget, duration and one binding',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate);const child=f.approve(f.propose()),work=parseCreateInput(child);
 const input={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/quantity',deadline:new Date(Date.now()+200000).toISOString(),maxSpendUsd:1.05,repairWorkOrderId:child.id,input:work,spendContract:{version:'WORK_LEDGER_V2',pricingRevision:'fixture',plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:336864}};
 for(const changed of [{...work,description:'different objective'},{...work,baseRef:C},{...work,allowedPaths:['outside.mjs']}])assert.throws(()=>claimRepairPreparation(f.storage,child.id,input,changed),/differs/);
 for(const changed of [{...input,maxSpendUsd:1.06},{...input,deadline:new Date(Date.now()+400000).toISOString()},{...input,spendContract:{...input.spendContract,maxPaidOperations:4}}])assert.throws(()=>claimRepairPreparation(f.storage,child.id,changed,work),/differs/);
 assert.equal(claimRepairPreparation(f.storage,child.id,input,work).id,child.id);
 f.storage.appendEvent({workOrderId:child.id,runId:null,type:'factory.prepare_requested',payload:input});assert.throws(()=>claimRepairPreparation(f.storage,child.id,input,work),/already bound/);
});
test('failed-review publication is denied; publication approval never follows review PASS automatically',async t=>{
 const f=fixture(t);f.verify(f.candidate,true);f.review(f.candidate);
 await assert.rejects(()=>performAction(f.context,'publication.request',{workOrderId:f.root.id,destination:'fixture/quantity'},{kind:'agent',id:'producer'}),/review failure/);
 assert.equal(f.storage.listPublicationRequests(f.root.id).length,0);assert.equal(f.storage.listExternalActions(f.root.id).length,0);
});

test('private review PASS does not replace published CI or post-CI review',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate,'PASS');
 f.storage.createExternalAction({workOrderId:f.root.id,runId:f.candidate.runId,kind:'draft_pr',candidateCommit:A});
 const action=f.storage.listExternalActions(f.root.id)[0];f.storage.saveExternalAction({...action,state:'succeeded'});
 assert.equal(f.service.view(f.root.id).status,'AWAITING_CI');f.observe(f.candidate,'ci','PASS',true);
 assert.equal(f.service.view(f.root.id).status,'AWAITING_REVIEW');assert.throws(()=>f.review(f.candidate,'PASS'),/immutable/);f.service.recordReview({id:randomUUID(),reviewer:'independent-reviewer',candidate:f.candidate,status:'PASS',findings:[],reportHash:H('fresh post-CI review')},'independent-reviewer');assert.equal(f.service.view(f.root.id).status,'REVIEW_PASSED');
 assert.equal(f.storage.listEvents(f.root.id).filter(e=>e.type==='review.recorded').length,2);
});
test('restricted-only finding cannot authorize a repair prompt',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate,'FAIL',[f.finding('RESTRICTED')]);assert.throws(()=>f.propose(),/public reproduction/);
});

test('ancestor verdicts cannot be recycled into later repair rounds',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate);const bWork=f.approve(f.propose()),b=f.ready(bWork,B,U);f.verify(b);const bReview=f.review(b);
 const p=f.service.propose(bWork.id,bReview.id,policy()),cWork=f.service.approve(f.root.id,p.id,p.hash,'owner'),c=f.ready(cWork,C,'f'.repeat(40));
 assert.throws(()=>f.observe(c,'custody','PASS',false,H(A+'custody')),/Parent candidate evidence/);
 f.verify(c);assert.throws(()=>f.service.recordReview({id:randomUUID(),reviewer:'independent-reviewer',candidate:c,status:'PASS',findings:[],reportHash:H(A+'FAIL')},'independent-reviewer'),/own independent-review report/);
});
test('failed preparation is Needs You and cannot create an unmetered retry',t=>{
 const f=fixture(t);f.verify(f.candidate);f.review(f.candidate);const child=f.approve(f.propose());f.storage.appendEvent({workOrderId:child.id,runId:null,type:'factory.prepare_failed',payload:{reason:'fixture preflight denied'}});
 assert.equal(f.service.view(child.id).status,'NEEDS_YOU');assert.equal(f.storage.listRuns(child.id).length,0);
});
