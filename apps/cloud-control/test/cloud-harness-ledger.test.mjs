import test from 'node:test';
// Historical qualified rate-card fixture. Runtime expiry remains enforced.
test.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T23:00:00.000Z')});
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {SpendLedger} from '../../../packages/storage/src/spend.ts';
import {SpendGateway} from '../../supervisor/src/spend-gateway.ts';
import {cloudHarnessIdentity,cloudHarnessPrice,cloudHarnessSpendPlan} from '../src/cloud-harness-plan.mjs';
import {deterministicHarnessResponse} from '../src/cloud-harness-fixture.mjs';
import {relayHarnessRequests} from '../src/cloud-harness-relay.mjs';

test('deterministic cloud transport retains canonical reservations, checkpoint and completion accounting',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'cloud-harness-ledger-')),path=join(dir,'test.sqlite'),storage=openStorage(path);
 const order=storage.createWorkOrder({title:'Harness boundary',description:'Deterministic transport',kind:'feature',repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['Safe'],reproductionCommand:null,expectedFailureText:null,checkCommands:[],allowedPaths:['slug.mjs'],workerProfile:'container'});
 const run=storage.createRun({workOrderId:order.id,workerProfile:'container',inputCommit:'a'.repeat(40),workspacePath:dir});
 const ledger=new SpendLedger(path),binding={workId:'work',workGeneration:1,dispatchIdentity:'dispatch',requestId:'request',workOrderId:order.id,factoryVersion:'version',runId:run.id};
 t.after(()=>{ledger.close();storage.close();rmSync(dir,{recursive:true,force:true});});
 ledger.createBudget(binding,1000000,new Date(Date.now()+60000).toISOString(),cloudHarnessSpendPlan);ledger.bindAuthority(binding);
 const childToken='b'.repeat(64);let boundary=false;
 const gateway=new SpendGateway({ledger,binding,price:cloudHarnessPrice,childToken,phase:'productive',upstreamOrigin:'https://deterministic.factory.invalid',upstreamApiKey:'deterministic-only',upstreamFetch:deterministicHarnessResponse({phase:'productive',currentSource:'export function projectSlug(value) { return value; }\n'}),productiveCheckpointAfter:1,onProductiveBoundary:()=>{boundary=true;}});
 const body=JSON.stringify({model:cloudHarnessIdentity.model,stream:true,input:'Bounded task',tools:[{name:'apply_patch',type:'custom'}]});
 let replies=[];
 await relayHarnessRequests({readRequest:async id=>Buffer.from(JSON.stringify({id,body})),writeResponse:async(id,bytes)=>{replies.push(JSON.parse(bytes));test.mock.timers.tick(1);},gateway,childToken,deadline:Date.now()+10000,finished:()=>replies.length===2,onBoundary:()=>boundary});
 assert.deepEqual(replies.map(x=>x.kind),['response','yield']);
 assert.match(Buffer.from(replies[0].bodyBase64,'base64').toString(),/custom_tool_call/);
 let spend=ledger.read(binding.workId);assert.equal(spend.operations.length,1);assert.equal(spend.operations[0].state,'settled');assert.equal(spend.operations[0].actualMicrousd,0);assert.equal(spend.operations[0].reservedMicrousd,186864);
 ledger.assertCompletionEligible(binding);ledger.beginCompletion(binding);
 const completion=new SpendGateway({ledger,binding,price:cloudHarnessPrice,childToken,phase:'completion',upstreamOrigin:'https://deterministic.factory.invalid',upstreamApiKey:'deterministic-only',upstreamFetch:deterministicHarnessResponse({phase:'completion',currentSource:''})});
 const response=await completion.fetch(new Request('https://factory.internal/v1/responses',{method:'POST',headers:{authorization:'Bearer '+childToken},body:JSON.stringify({model:cloudHarnessIdentity.model,input:'Read-only summary'})}));
 assert.equal(response.status,200);assert.equal((await response.json()).output[0].type,'message');ledger.assertCompleted(binding);
 spend=ledger.read(binding.workId);assert.deepEqual(spend.operations.map(x=>x.phase),['productive','completion']);assert.equal(spend.unknownExposureMicrousd,0);assert(spend.operations.every(x=>x.state==='settled'&&x.actualMicrousd===0));
 // Re-entering productive after completion cannot reserve or call another model.
 const denied=await gateway.fetch(new Request('https://factory.internal/v1/responses',{method:'POST',headers:{authorization:'Bearer '+childToken},body}));assert.equal(denied.status,409);assert.equal(ledger.read(binding.workId).operations.length,2);
});
test('fixture has no route/model/tool fallback and no second response',async()=>{
 const init={method:'POST',body:JSON.stringify({model:cloudHarnessIdentity.model,tools:[{name:'apply_patch',type:'function'}]})};
 const fixture=deterministicHarnessResponse({phase:'productive',currentSource:'stub'});
 assert.equal((await fixture('https://deterministic.factory.invalid/v1/responses',init)).status,200);
 await assert.rejects(fixture('https://deterministic.factory.invalid/v1/responses',init),/REPLAY/);
 for(const [url,body] of [['https://paid.example/v1/responses',init.body],['https://deterministic.factory.invalid/v1/responses','{"model":"other"}'],['https://deterministic.factory.invalid/v1/responses',JSON.stringify({model:cloudHarnessIdentity.model,tools:[]})]])await assert.rejects(deterministicHarnessResponse({phase:'productive',currentSource:'stub'})(url,{method:'POST',body}));
});
