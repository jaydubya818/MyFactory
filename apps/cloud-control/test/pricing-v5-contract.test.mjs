import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import current from '../../../docs/capability-control/pricing-20261102/20261102-v5.json' with {type:'json'};
import predecessorPrice from '../../../docs/capability-control/pricing-20261022/20261022-v4.json' with {type:'json'};
import successor from '../../../docs/capability-control/source-identity-20261102/pricing-v5-proposal-successor.json' with {type:'json'};
import {validatePrice} from '../../supervisor/src/spend-gateway.ts';
import {validateBudget,assertReservation,spendSummary} from '../../../packages/storage/src/spend-policy.ts';
import {productionModelPrice} from '../src/production-model-provider.mjs';
import {cloudHarnessPrice,cloudHarnessSpendPlan} from '../src/cloud-harness-plan.mjs';
import {productionExecutionContract,productionSpendPlan} from '../src/production-execution-plan.mjs';
import {pricedAdmission} from '../src/external-alpha-runtime.mjs';
import {handleExternalAlpha} from '../src/external-alpha-control.mjs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {parseExternalAlphaInstallation} from '../src/external-alpha-authority.mjs';
import {makeKeys,makeInstallation,build} from './fixtures/external-alpha-authority.mjs';

const V4_UNTIL=Date.parse('2026-10-29T00:00:00.000Z');
const V5_FROM=Date.parse('2026-11-02T00:00:00.000Z');
const V5_UNTIL=Date.parse('2026-11-09T00:00:00.000Z');
const sha=v=>createHash('sha256').update(v).digest('hex');
const CRED='fixture-bearer-credential-slot-one';
const tokens=new Map();
const verifyToken=async(token,expect)=>{const p=tokens.get(token);if(!p)throw Error('bad');assert.equal(expect.environment,'production');return {payload:p};};
const oidcToken=claims=>{const t='aaa.'+sha(JSON.stringify(claims)).slice(0,16)+'.sig';tokens.set(t,claims);return t;};
function world(){
 const keys=makeKeys(),a=makeInstallation(keys,{slot:'1'});
 const cfg={...a.config,caller:{...a.config.caller,credentialSha256:sha(CRED),oidc:{...a.config.caller.oidc,subject:'owner:fixture-team:project:tester-1:environment:production'}}};
 const parsed=parseExternalAlphaInstallation(cfg);
 const pin=digest([parsed.sha256]);
 return {ctx:{...a,config:cfg,installation:parsed},env:{FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify([cfg]),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:pin}};
}
function runtime(){
 const calls={prepare:[],dispatch:[],dbNow:undefined};
 const fake=installation=>({clientId:installation.application.clientId,
  authority:{withClient:fn=>fn({}),priorDeadline:async()=>calls.prior},
  control:{prepare:async p=>{calls.prepare.push(p);},dispatch:async i=>{calls.dispatch.push(i);}},
  store:{transaction:fn=>fn({},calls.dbNow??Date.now()),read:async()=>({request:{requestId:'x',input:{allowedPaths:[]},source:{commit:'c'},deadline:'d',repository:'r',workGeneration:1,workId:'w'},snapshot:{factoryId:'f',factoryVersion:'v'},run_id:'r',work_order_id:'o'})},
  provider:{},readbackWithReceipt:async id=>({requestId:id,authorityReceipt:{},authorityReceiptSignature:'s'})});
 return {calls,withRuntime:async(env,installation,action)=>action(fake(installation))};
}
const configuredCapability=()=>({bindings:{},role:'factory_capability_runtime'});
const dispatch=(w,rt,overrides={},issuedAt=V5_UNTIL-60_000)=>{
 const b=build(w.ctx,{issuedAt,ttl:290000,deadlineMs:170000}),oidc=oidcToken({project_id:w.ctx.config.application.projectId,owner_id:w.ctx.config.caller.oidc.teamId,environment:'production',iss:w.ctx.config.caller.oidc.issuer,aud:w.ctx.config.caller.oidc.audience,sub:w.ctx.config.caller.oidc.subject,exp:Math.floor(V5_UNTIL/1000)+600});
 return handleExternalAlpha(new Request('https://factory.invalid/api/connect/v2/external-alpha/dispatches',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+CRED,'x-vercel-trusted-oidc-idp-token':oidc},body:JSON.stringify({authority:b.envelope,prepare:b.prepare})}),w.env,{withRuntime:rt.withRuntime,verifyToken,spendPlan:productionSpendPlan,slotCapability:configuredCapability,...overrides});
};
function myeveTerminal(status,body){
 let code='';
 if(status===403&&body?.admission==='DISABLED'&&/^[A-Z_]+$/.test(body.code??''))code=body.code;
 if(status===409&&body?.code==='AUTHORITY_CONSUMED')code='AUTHORITY_CONSUMED';
 if(!code)return 'UNKNOWN';
 if(code==='AUTHORITY_CONSUMED')return 'CONSUMED_CONFLICT';
 return 'CANCELLED';
}
function v5Budget(over={}){
 return {work_generation:1,request_id:'request',work_order_id:'order',ceiling_microusd:1000000,deadline:'2026-11-08T12:00:00.000Z',cancelled_at:null,contract_version:'WORK_LEDGER_V2',pricing_revision:productionSpendPlan.pricingRevision,model:productionSpendPlan.model,pricing_valid_until:productionSpendPlan.validUntil,per_operation_reserve_microusd:84864,planned_productive_operations:2,planned_completion_operations:1,max_paid_operations:3,completion_reserve_microusd:84864,authority_dispatch_identity:'dispatch',authority_factory_version:'version',authority_run_id:'run',authority_state:'active',phase:'productive',...over};
}
function reservation(over={}){
 return {workId:'work',workGeneration:1,dispatchIdentity:'dispatch',requestId:'request',workOrderId:'order',factoryVersion:'version',runId:'run',operationId:'op',model:productionSpendPlan.model,pricingRevision:productionSpendPlan.pricingRevision,reservedMicrousd:84864,phase:'productive',...over};
}

test('every v5 field matches the current qualified pricing and WORK_LEDGER_V2 contracts',()=>{
 assert.equal(current.schema,'factory-pricing-qualification/v1');
 assert.equal(current.status,'PROPOSED_AWAITING_OWNER_APPROVAL');
 assert.equal(current.approval.approvedBy,null);
 assert.equal(current.approval.approvedAt,null);
 assert.equal(current.version,'openai-mini-20261102-v5');
 assert.equal(current.ownerRepository,predecessorPrice.ownerRepository);
 assert.equal(current.supersedes,'../pricing-20261022/20261022-v4.json');
 assert.equal(current.effectiveFrom,'2026-11-02T00:00:00.000Z');
 assert.equal(current.reviewBy,'2026-11-09T00:00:00.000Z');
 assert.equal(current.reviewPolicy,predecessorPrice.reviewPolicy);
 assert.equal(current.authority,'PRICING_ONLY_NO_EXECUTION_GRANT');
 assert.match(current.gapNote,/2026-10-29\.\.2026-11-02/);
 assert.deepEqual(current.route,predecessorPrice.route);
 assert.equal(current.sources[0].sha256,'83625d2f3548c29379b3b2a44b183a26d266d2f5c3ffda7161dd19c9213a9058');
 assert.equal(current.sources[0].sha256,predecessorPrice.sources[0].sha256);
 assert.deepEqual(productionModelPrice,current.prices.production);
 assert.deepEqual(cloudHarnessPrice,current.prices.deterministic);
 for(const kind of ['production','deterministic']){
  const card=current.prices[kind],prior=predecessorPrice.prices[kind];
  for(const key of ['model','contextLimitTokens','outputLimitTokens','inputMicrousdPerMillion','outputMicrousdPerMillion'])assert.equal(card[key],prior[key],key);
  assert.equal(card.validUntil,'2026-11-09T00:00:00.000Z');
 }
 assert.deepEqual(current.unchangedAccounting,predecessorPrice.unchangedAccounting);
 assert.equal(productionSpendPlan.version,'WORK_LEDGER_V2');
 assert.equal(productionSpendPlan.pricingRevision,'production-openai-mini-20261102-v5');
 assert.equal(productionSpendPlan.model,'openai/gpt-5.4-mini');
 assert.equal(productionSpendPlan.validUntil,'2026-11-09T00:00:00.000Z');
 assert.equal(productionSpendPlan.perOperationReserveMicrousd,84864);
 assert.equal(productionSpendPlan.plannedProductiveOperations,2);
 assert.equal(productionSpendPlan.plannedCompletionOperations,1);
 assert.equal(productionSpendPlan.maxPaidOperations,3);
 assert.equal(productionSpendPlan.completionReserveMicrousd,84864);
 assert.deepEqual(cloudHarnessSpendPlan,{version:'WORK_LEDGER_V2',pricingRevision:'cloud-codex-deterministic-20261102-v5',model:'openai/gpt-5.4-mini',validUntil:'2026-11-09T00:00:00.000Z',perOperationReserveMicrousd:186864,plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:186864});
 assert.equal(productionExecutionContract.maxSpendMicrousd,1000000);
 assert.equal(productionExecutionContract.status,'AWAITING_COMPOSED_QUALIFICATION');
 assert.equal(productionExecutionContract.publication,false);
 assert.equal(productionExecutionContract.merge,false);
 assert.equal(productionExecutionContract.deployGeneratedCandidate,false);
 assert.equal(successor.paidExecution,'NOT_AUTHORIZED');
 assert.equal(successor.pricingStatus,'PROPOSED_AWAITING_OWNER_APPROVAL');
 assert.equal(successor.executionContractSha256,'54c57208b4cfcfa8c297123ef0e852967486cbe53f7fd45e21508fee1af7e522');
});

test('v5 window has no overlap with v4; the 2026-10-29..2026-11-02 gap stays uncovered',()=>{
 assert.equal(predecessorPrice.prices.production.validUntil,'2026-10-29T00:00:00.000Z');
 assert.equal(predecessorPrice.reviewBy,'2026-10-29T00:00:00.000Z');
 assert.ok(V4_UNTIL<V5_FROM);
 assert.equal(V5_FROM-V4_UNTIL,4*86400000);
 assert.equal(current.reviewBy,current.prices.production.validUntil);
 assert.equal(current.prices.production.validUntil,current.prices.deterministic.validUntil);
 assert.ok(Date.parse(current.effectiveFrom)<Date.parse(current.reviewBy));
});

test('validatePrice and validateBudget fail closed at and after validUntil; they accept the open window',t=>{
 t.mock.timers.enable({apis:['Date'],now:V5_FROM});
 const binding={workId:'work',workGeneration:1,requestId:'request',workOrderId:'order'};
 const deadline='2026-11-10T00:00:00.000Z';
 validatePrice(productionModelPrice);
 validatePrice(cloudHarnessPrice);
 validateBudget(binding,1000000,deadline,productionSpendPlan);
 t.mock.timers.setTime(V5_UNTIL-1);
 validateBudget(binding,1000000,deadline,productionSpendPlan);
 validateBudget(binding,1000000,deadline,cloudHarnessSpendPlan);
 t.mock.timers.setTime(V5_UNTIL);
 assert.throws(()=>validateBudget(binding,1000000,deadline,productionSpendPlan),/Qualified pricing has expired/);
 assert.throws(()=>validatePrice(current.prices.production),/Current pinned model pricing/);
 t.mock.timers.setTime(V5_UNTIL+1);
 assert.throws(()=>validateBudget(binding,1000000,deadline,cloudHarnessSpendPlan),/Qualified pricing has expired/);
 assert.throws(()=>validatePrice(current.prices.deterministic),/Current pinned model pricing/);
});

test('pricedAdmission uses the transaction clock: expired first prepare is PRICING_EXPIRED; replay is unaffected',async()=>{
 let queried=0,rowCount=0;
 const client={query:async()=>{queried++;return {rowCount};}};
 const pass=pricedAdmission(async()=>'passed',productionSpendPlan);
 assert.equal(await pass(client,{requestId:'r'},V5_UNTIL-1,'prepare'),'passed');
 assert.equal(queried,0);
 await assert.rejects(pass(client,{requestId:'r'},V5_UNTIL,'prepare'),/PRICING_EXPIRED/);
 assert.equal(queried,1);
 rowCount=1;
 assert.equal(await pass(client,{requestId:'r'},V5_UNTIL+60_000,'prepare'),'passed');
 assert.equal(await pass(client,{requestId:'r'},V5_UNTIL,'dispatch'),'passed');
});

test('v5 reservations, UNKNOWN exposure and ceiling match WORK_LEDGER_V2',()=>{
 const budget=v5Budget();
 assert.doesNotThrow(()=>assertReservation(budget,[],reservation()));
 assert.throws(()=>assertReservation(budget,[],reservation({reservedMicrousd:84863})),/Pinned pricing or conservative reservation mismatch/);
 assert.throws(()=>assertReservation(budget,[],reservation({pricingRevision:'production-openai-mini-20261022-v4'})),/Pinned pricing or conservative reservation mismatch/);
 const reserved={state:'reserved',reservedMicrousd:84864,actualMicrousd:null,phase:'productive'};
 const unknown={state:'unknown',reservedMicrousd:84864,actualMicrousd:null,phase:'productive'};
 const settled={state:'settled',reservedMicrousd:84864,actualMicrousd:53,phase:'productive'};
 assert.throws(()=>assertReservation(budget,[reserved],reservation({operationId:'op-2'})),/Unresolved reservation or UNKNOWN exposure/);
 assert.throws(()=>assertReservation(budget,[unknown],reservation({operationId:'op-2'})),/Unresolved reservation or UNKNOWN exposure/);
 const known=spendSummary('work',budget,[settled],V5_FROM);
 assert.equal(known.status,'KNOWN');
 assert.equal(known.settledMicrousd,53);
 assert.equal(known.retainedMicrousd,0);
 assert.equal(known.unknownExposureMicrousd,0);
 assert.equal(known.pricingRevision,'production-openai-mini-20261102-v5');
 assert.equal(known.pricingQualified,true);
 assert.equal(known.perOperationReserveMicrousd,84864);
 const held=spendSummary('work',budget,[unknown],V5_FROM);
 assert.equal(held.status,'UNKNOWN');
 assert.equal(held.unknownExposureMicrousd,84864);
 assert.equal(held.retainedMicrousd,84864);
 assert.equal(held.availableMicrousd,1000000-84864);
 assert.equal(spendSummary('work',budget,[unknown],V5_UNTIL).pricingQualified,false);
 const cancelled=spendSummary('work',v5Budget({cancelled_at:'2026-11-03T00:00:00.000Z'}),[],V5_FROM);
 assert.equal(cancelled.cancelled,true);
 assert.equal(cancelled.unknownExposureMicrousd,0);
});

test('v5 productionSpendPlan admits before validUntil without OWNER_APPROVED; exact validUntil is refundable CANCELLED',async()=>{
 assert.equal(current.status,'PROPOSED_AWAITING_OWNER_APPROVAL');
 const live=runtime();live.calls.dbNow=V5_UNTIL-1;
 const liveRes=await dispatch(world(),live,{now:()=>V5_UNTIL-1});
 assert.equal(liveRes.status,200);
 assert.equal(live.calls.prepare.length,1);
 assert.equal(live.calls.dispatch.length,1);
 const expired=runtime();expired.calls.dbNow=V5_UNTIL;
 const expiredRes=await dispatch(world(),expired,{now:()=>V5_UNTIL});
 const expiredBody=await expiredRes.json();
 assert.equal(expiredRes.status,403);
 assert.equal(expiredBody.code,'PRICING_EXPIRED');
 assert.equal(expiredBody.admission,'DISABLED');
 assert.equal(myeveTerminal(expiredRes.status,expiredBody),'CANCELLED');
 assert.equal(expired.calls.prepare.length,0);
 const after=runtime();after.calls.dbNow=V5_UNTIL+1;
 const afterRes=await dispatch(world(),after,{now:()=>V5_UNTIL+1});
 assert.equal(afterRes.status,403);
 assert.equal((await afterRes.json()).code,'PRICING_EXPIRED');
 assert.equal(after.calls.prepare.length,0);
});

test('v5 PRICING_EXPIRED is judged on the admission-transaction clock; capability stays UNKNOWN',async()=>{
 const dbExpired=runtime();dbExpired.calls.dbNow=V5_UNTIL;
 const r1=await dispatch(world(),dbExpired,{now:()=>V5_UNTIL});
 const b1=await r1.json();
 assert.equal(r1.status,403);assert.equal(b1.code,'PRICING_EXPIRED');assert.equal(myeveTerminal(r1.status,b1),'CANCELLED');
 assert.equal(dbExpired.calls.prepare.length,0);
 const dbOpen=runtime();dbOpen.calls.dbNow=V5_UNTIL-1;
 const r2=await dispatch(world(),dbOpen,{now:()=>V5_UNTIL});
 assert.equal(r2.status,200);assert.equal(dbOpen.calls.prepare.length,1);
 const w=world(),b=build(w.ctx,{issuedAt:V5_UNTIL-60_000,ttl:290000,deadlineMs:170000}),oidc=oidcToken({project_id:w.ctx.config.application.projectId,owner_id:w.ctx.config.caller.oidc.teamId,environment:'production',iss:w.ctx.config.caller.oidc.issuer,aud:w.ctx.config.caller.oidc.audience,sub:w.ctx.config.caller.oidc.subject,exp:Math.floor(V5_UNTIL/1000)+600});
 const req=new Request('https://factory.invalid/api/connect/v2/external-alpha/dispatches',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+CRED,'x-vercel-trusted-oidc-idp-token':oidc},body:JSON.stringify({authority:b.envelope,prepare:b.prepare})});
 const capRt=runtime();
 const capRes=await handleExternalAlpha(req,w.env,{withRuntime:capRt.withRuntime,verifyToken,now:()=>V5_UNTIL-1,spendPlan:productionSpendPlan,slotCapability:()=>{throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');}});
 const capBody=await capRes.json();
 assert.equal(capRes.status,503);
 assert.deepEqual(capBody,{error:'EXTERNAL_ALPHA_UNAVAILABLE'});
 assert.equal(myeveTerminal(capRes.status,capBody),'UNKNOWN');
 assert.equal(capRt.calls.prepare.length,0);
});
