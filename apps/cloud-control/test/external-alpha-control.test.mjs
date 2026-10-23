import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleExternalAlpha,authenticateExternalAlphaCaller,externalAlphaIdentity} from '../src/external-alpha-control.mjs';
import {handleProductionControl} from '../src/production-control.mjs';
import {makeKeys,makeInstallation,build} from './fixtures/external-alpha-authority.mjs';
import {readFileSync} from 'node:fs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {parseExternalAlphaInstallation,ExternalAlphaError} from '../src/external-alpha-authority.mjs';

// Handler tests use a stubbed runtime (no network, no database); atomic consumption is covered by the PostgreSQL suites.
const sha=v=>createHash('sha256').update(v).digest('hex');
const P='https://factory.invalid/api/connect/v2/external-alpha/';
const CRED=['fixture-bearer-credential-slot-one','fixture-bearer-credential-slot-two'];
function world(){
 const keys=makeKeys(),a=makeInstallation(keys,{slot:'1'});
 const b=makeInstallation(keys,{slot:'2',cohortId:a.config.cohortId,factoryVersion:a.config.factoryVersion,source:{...a.config.source,repository:'fixture-org/fixture-workspace-two'},application:{clientId:'external-alpha-'+sha('two').slice(0,32),projectId:'prj_fixture2'},ownerId:'owner-opaque-2'});
 const cfg=(x,i)=>({...x.config,caller:{...x.config.caller,credentialSha256:sha(CRED[i]),oidc:{...x.config.caller.oidc,subject:`owner:fixture-team:project:tester-${i+1}:environment:production`}}});
 const configs=[cfg(a,0),cfg(b,1)],parsed=configs.map(parseExternalAlphaInstallation);
 const pin=digest(parsed.map(i=>i.sha256));
 // authorities are built against the final (credential-bearing) configs
 const ctx=[{...a,config:configs[0],installation:parsed[0]},{...b,config:configs[1],installation:parsed[1]}];
 return {keys,ctx,configs,env:{FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify(configs),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:pin}};
}
const claimsFor=(config)=>({project_id:config.application.projectId,owner_id:config.caller.oidc.teamId,environment:'production',iss:config.caller.oidc.issuer,aud:config.caller.oidc.audience,sub:config.caller.oidc.subject,exp:Math.floor(Date.now()/1000)+600});
// The fake OIDC verifier trusts a token only by lookup; it receives the same expectations the real one would.
const tokens=new Map();
const verifyToken=async(token,expect)=>{const p=tokens.get(token);if(!p)throw Error('bad');assert.equal(expect.environment,'production');return {payload:p};};
const oidcToken=(claims)=>{const t='aaa.'+sha(JSON.stringify(claims)).slice(0,16)+'.sig';tokens.set(t,claims);return t;};
const req=(path,{method='POST',cred,oidc,body,headers={}}={})=>new Request(P+path,{method,headers:{'content-type':'application/json',...(cred?{authorization:'Bearer '+cred}:{}),...(oidc?{'x-vercel-trusted-oidc-idp-token':oidc}:{}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
function runtime(){
 const calls={prepare:[],dispatch:[],stop:[],owned:[],result:[]};
 const fake=installation=>({clientId:installation.application.clientId,
  authority:{withClient:fn=>fn({}),priorDeadline:async()=>calls.prior,ownedRow:async(_c,id)=>calls.ownedIds?.has(id)?{request_id:id}:null},
  control:{prepare:async p=>{calls.prepare.push(p);},dispatch:async i=>{calls.dispatch.push(i);}},
  store:{transaction:fn=>fn({},calls.dbNow??Date.now()),read:async()=>({request:{requestId:'x',input:{allowedPaths:[]},source:{commit:'c'},deadline:'d',repository:'r',workGeneration:1,workId:'w'},snapshot:{factoryId:'f',factoryVersion:'v'},run_id:'r',work_order_id:'o'}),stop:async()=>{calls.stop.push(1);}},
  provider:{},readResult:async(id,challenge)=>{calls.result.push({id,challenge});return calls.resultPayload??{pending:true,state:'PENDING'};},readbackWithReceipt:async id=>({requestId:id,authorityReceipt:{},authorityReceiptSignature:'s'})});
 return {calls,withRuntime:async(env,installation,action)=>{calls.installation=installation;return action(fake(installation));}};
}
const good=(w,i=0)=>{const b=build(w.ctx[i]);return {b,oidc:oidcToken(claimsFor(w.configs[i]))};};
const qualifiedPlan=Object.freeze({validUntil:new Date(Date.now()+86400000).toISOString()});
const configuredCapability=()=>({bindings:{},role:'factory_capability_runtime'});
const send=(w,r,rt,spendPlan=qualifiedPlan,slotCapability=configuredCapability)=>handleExternalAlpha(r,w.env,{withRuntime:rt.withRuntime,verifyToken,spendPlan,slotCapability});
const code=async res=>(await res.json());

test('authorized caller dispatches on its own slot and receives a receipt-bearing readback',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w);
 const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),rt);
 assert.equal(res.status,200);assert.equal(rt.calls.prepare.length,1);assert.equal(rt.calls.dispatch.length,1);
 assert.equal(rt.calls.installation.slot,'1');
 assert.ok((await code(res)).authorityReceiptSignature);
});

test('missing installation denies everything',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w);
 for(const env of [{},{FACTORY_EXTERNAL_ALPHA_INSTALLATION:'not json'},{FACTORY_EXTERNAL_ALPHA_INSTALLATION:'[]'}]){
  const res=await handleExternalAlpha(req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),env,{withRuntime:rt.withRuntime,verifyToken});
  assert.equal(res.status,403);assert.equal((await code(res)).code,'AUTHORITY_DISABLED');
 }
 assert.equal(rt.calls.prepare.length,0);
});

test('unauthorized callers get 401 before any state is touched',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w),body={authority:b.envelope,prepare:b.prepare};
 const cases=[req('dispatches',{body}),req('dispatches',{cred:'wrong-credential-wrong-credential',oidc,body}),req('dispatches',{cred:CRED[0],body}),req('dispatches',{cred:CRED[0],oidc:'a.b.c',body}),
  req('dispatches',{cred:'short',oidc,body})];
 for(const r of cases)assert.equal((await send(w,r,rt)).status,401);
 assert.equal(rt.calls.prepare.length,0);
});

test('a caller cannot act for the other slot: slot-1 credential with slot-2 OIDC, and slot-2 credential on a slot-1 authority',async()=>{
 const w=world(),rt=runtime(),one=good(w,0),two=good(w,1);
 // credential of slot 1, identity of slot 2
 assert.equal((await send(w,req('dispatches',{cred:CRED[0],oidc:two.oidc,body:{authority:one.b.envelope,prepare:one.b.prepare}}),rt)).status,401);
 // slot 2 caller presenting slot 1's signed authority: the pre-flight against slot 2's installation rejects it
 const res=await send(w,req('dispatches',{cred:CRED[1],oidc:two.oidc,body:{authority:one.b.envelope,prepare:one.b.prepare}}),rt);
 assert.equal(res.status,403);assert.equal(rt.calls.prepare.length,0);
});

test('wrong audience, issuer, subject, team, project, environment or an expired token are rejected',async()=>{
 const w=world(),rt=runtime(),{b}=good(w),body={authority:b.envelope,prepare:b.prepare};
 const base=claimsFor(w.configs[0]);
 for(const patch of [{aud:'https://vercel.com/other'},{iss:'https://oidc.vercel.com/other'},{sub:'owner:fixture-team:project:tester-2:environment:production'},{owner_id:'team_Other'},{project_id:'prj_other'},{environment:'preview'},{exp:Math.floor(Date.now()/1000)-5}]){
  const oidc=oidcToken({...base,...patch,nonce:Math.random()});
  assert.equal((await send(w,req('dispatches',{cred:CRED[0],oidc,body}),rt)).status,401,JSON.stringify(patch));
 }
 assert.equal(rt.calls.prepare.length,0);
});

test('canary / production / staging credentials and client ids can never authenticate',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w),body={authority:b.envelope,prepare:b.prepare};
 const canary='canary-credential-0123456789abcdef';
 const env={...w.env,FACTORY_SOFIE_STAGING_TOKEN:canary,FACTORY_PRODUCTION_TOKEN:canary};
 assert.equal((await handleExternalAlpha(req('dispatches',{cred:canary,oidc,body}),env,{withRuntime:rt.withRuntime,verifyToken})).status,401);
 // even if an operator mistakenly pins a canary secret's hash as the external-alpha credential, it is refused
 const mis={...w.configs[0],caller:{...w.configs[0].caller,credentialSha256:sha(canary)}};
 const env2={...env,FACTORY_EXTERNAL_ALPHA_INSTALLATION:JSON.stringify([mis]),FACTORY_EXTERNAL_ALPHA_INSTALLATION_SHA256:digest([parseExternalAlphaInstallation(mis).sha256])};
 assert.equal((await handleExternalAlpha(req('dispatches',{cred:canary,oidc,body}),env2,{withRuntime:rt.withRuntime,verifyToken})).status,401);
 // external-alpha credentials do not open canary routes
 const canaryEnv={VERCEL_ENV:'production',FACTORY_PRODUCTION_INSTALLATION:'{}'};
 const res=await handleProductionControl(new Request('https://factory.invalid/api/connect/v2/external-alpha/dispatches',{method:'POST',headers:{authorization:'Bearer '+CRED[0],'content-type':'application/json'},body:'{}'}),canaryEnv).catch(()=>new Response(null,{status:503}));
 assert.notEqual(res.status,200);
 assert.equal(rt.calls.prepare.length,0);
});

test('malformed, oversize and wrongly shaped bodies are bounded fixed errors',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w),h={cred:CRED[0],oidc};
 assert.equal((await send(w,req('dispatches',{...h,body:'{not json'}),rt)).status,400);
 assert.equal((await send(w,req('dispatches',{...h,body:'[]'}),rt)).status,400);
 assert.equal((await send(w,req('dispatches',{...h,body:{authority:b.envelope}}),rt)).status,400);
 assert.equal((await send(w,req('dispatches',{...h,body:{authority:b.envelope,prepare:b.prepare,extra:1}}),rt)).status,400);
 const big='{"authority":"'+'x'.repeat(50000)+'"}';
 const r=await send(w,req('dispatches',{...h,body:big}),rt);assert.equal(r.status,413);
 const declared=await send(w,req('dispatches',{...h,body:'{}',headers:{'content-length':'99999999'}}),rt);assert.equal(declared.status,413);
 assert.equal((await send(w,new Request(P+'dispatches',{method:'POST',headers:{authorization:'Bearer '+CRED[0],'x-vercel-trusted-oidc-idp-token':oidc,'content-type':'text/plain'},body:'{}'}),rt)).status,400);
 const text=JSON.stringify(await code(await send(w,req('dispatches',{...h,body:'{not json'}),rt)));
 assert.doesNotMatch(text,/SyntaxError|Unexpected|at .*\.mjs/);
 assert.equal(rt.calls.prepare.length,0);
});

test('replay: a redelivery is normalized to the admitted deadline and presented to the engine unchanged otherwise',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w);
 rt.calls.prior=b.prepare.deadline;
 const body={authority:b.envelope,prepare:{...b.prepare,deadline:new Date(Date.parse(b.prepare.deadline)+5000).toISOString()}};
 // the deadline is an unsigned field; it is only normalized, so the signed bindings still hold
 const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body}),rt);
 assert.equal(res.status,200);assert.equal(rt.calls.prepare[0].deadline,rt.calls.prior);
 assert.equal(rt.calls.prepare[0].requestId,b.prepare.requestId);
});

test('cancel, dispatch and status serve only the owner Work; others are indistinguishable from unknown',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w),id=b.prepare.requestId,h={cred:CRED[0],oidc};
 rt.calls.ownedIds=new Set([id]);
 assert.equal((await send(w,req('dispatches/'+id,{...h,method:'GET'}),rt)).status,200);
 assert.equal((await send(w,req(`dispatches/${id}/stop`,{...h,body:{}}),rt)).status,200);
 assert.equal(rt.calls.stop.length,1);
 const other=build(w.ctx[0]).prepare.requestId;
 for(const [p,m,bd] of [[`dispatches/${other}`,'GET'],[`dispatches/${other}/stop`,'POST',{}],[`dispatches/${other}/dispatch`,'POST',{}]]){
  const r=await send(w,req(p,{...h,method:m,body:bd}),rt);assert.equal(r.status,404);
 }
 assert.equal(rt.calls.stop.length,1);assert.equal(rt.calls.dispatch.length,0);
 assert.equal((await send(w,req('dispatches/not-a-uuid',{...h,method:'GET'}),rt)).status,404);
 assert.equal((await send(w,req(`dispatches/${id}`,{...h,method:'DELETE'}),rt)).status,405);
 assert.equal((await send(w,req(`dispatches/${id}/stop`,{...h,body:{x:1}}),rt)).status,400);
});

test('identity is deterministic and uses only the stored admission',()=>{
 const row={request:{requestId:'r',input:{allowedPaths:['a']},source:{commit:'c'},deadline:'d',repository:'o/r',workGeneration:1,workId:'w'},snapshot:{factoryId:'f',factoryVersion:'v'},run_id:'run',work_order_id:'wo'};
 const x=externalAlphaIdentity(row);
 assert.deepEqual(x,externalAlphaIdentity(row));
 assert.match(x.dispatchIdentity,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('deployment: dedicated function and rewrite precede the generic canary route',()=>{
 const c=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 const fns=Object.keys(c.functions);
 assert.ok(fns.indexOf('api/external-alpha.mjs')>=0&&fns.indexOf('api/external-alpha.mjs')<fns.indexOf('api/*.mjs'));
 assert.equal(c.rewrites[0].source,'/api/connect/v2/external-alpha/:path*');
 assert.equal(c.rewrites[0].destination,'/api/external-alpha');
 assert.equal(c.rewrites[1].destination,'/api/cloud');
});

test('authenticate returns null for a bearer whose hash is not pinned, without consulting OIDC',async()=>{
 const w=world();let called=0;
 const r=await authenticateExternalAlphaCaller(req('dispatches',{cred:'unpinned-credential-unpinned',oidc:'a.b.c'}),w.ctx.map(x=>x.installation),{}, async()=>{called++;return {};});
 assert.equal(r,null);assert.equal(called,0);
});

test('dedicated Result boundary requires exact caller ownership, GET and a bounded challenge; pending never means verified',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w),id=b.prepare.requestId,h={cred:CRED[0],oidc};
 const path=`dispatches/${id}/result`,challenge='b'.repeat(32);
 const unknown=await send(w,req(path,{...h,method:'GET'}),rt);
 assert.equal(unknown.status,404);assert.deepEqual(await code(unknown),{error:'NOT_FOUND'});assert.equal(rt.calls.result.length,0);
 rt.calls.ownedIds=new Set([id]);
 const pending=await send(w,req(path,{...h,method:'GET',headers:{'x-external-alpha-challenge':challenge}}),rt);
 assert.equal(pending.status,202);assert.equal((await code(pending)).pending,true);assert.deepEqual(rt.calls.result,[{id,challenge}]);
 rt.calls.resultPayload={state:'FAILED',result:{encoded:'signed-fixture'}};
 const terminal=await send(w,req(path,{...h,method:'GET'}),rt);
 assert.equal(terminal.status,200);assert.equal((await code(terminal)).state,'FAILED');
 assert.equal((await send(w,req(path,{...h,body:{}}),rt)).status,405);
 assert.equal((await send(w,req(path,{...h,method:'GET',headers:{'x-external-alpha-challenge':'invalid'}}),rt)).status,400);
 const other=good(w,1);
 assert.equal((await send(w,req(path,{cred:CRED[0],oidc:other.oidc,method:'GET'}),rt)).status,401);
 assert.equal((await send(w,req(path+'?candidate=other',{...h,method:'GET'}),rt)).status,404);
});

// Admission and queue reservation are one authorized HTTP action; the engine
// derives the identity from its own retained record, never a caller envelope.
test('admission dispatches only after persisted prepare and fails closed when prepare is unavailable',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w);
 const original=rt.withRuntime;rt.withRuntime=(e,i,action)=>original(e,i,c=>{c.control.prepare=async()=>{throw Error('AUTHORITY_UNKNOWN_FENCE');};return action(c);});
 const response=await send(w,req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),rt);
 assert.equal(response.status,503);assert.equal(rt.calls.dispatch.length,0);
});

test('expired qualified pricing is a definitive pre-flight refusal: 403 PRICING_EXPIRED, nothing prepared or dispatched',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w);
 const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),rt,{validUntil:new Date(Date.now()-1000).toISOString()});
 assert.equal(res.status,403);
 const body=await code(res);
 assert.equal(body.code,'PRICING_EXPIRED');assert.equal(body.admission,'DISABLED');
 // Only the read-only prior-admission lookup ran: nothing prepared or dispatched.
 assert.equal(rt.calls.prepare.length,0);assert.equal(rt.calls.dispatch.length,0);
 for(const plan of [{},{validUntil:'not-a-date'},null]){
  const r2=await send(w,req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),rt,plan);
  assert.equal(r2.status,403);assert.equal((await code(r2)).code,'PRICING_EXPIRED');
 }
 assert.equal(rt.calls.prepare.length,0);
});

test('injected store capabilityBindings without env pins remain a definitive AUTHORITY_CAPABILITY refusal',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w);
 const clientId=w.configs[0].application.clientId;
 const withBindings=async(env,installation,action)=>rt.withRuntime(env,installation,c=>action({
  ...c,
  store:{...c.store,capabilityBindings:{[clientId]:{ownerId:w.configs[0].ownerId,organizationId:'org',installationId:'install',agentId:'agent',environment:'qualification'}}},
 }));
 const res=await handleExternalAlpha(req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),w.env,{withRuntime:withBindings,verifyToken,spendPlan:qualifiedPlan});
 assert.equal(res.status,403);
 const body=await code(res);
 assert.equal(body.code,'AUTHORITY_CAPABILITY');assert.equal(body.admission,'DISABLED');
 assert.equal(rt.calls.prepare.length,0);assert.equal(rt.calls.dispatch.length,0);
});

test('missing owner capability binding or runtime role is a definitive pre-flight refusal: 403 AUTHORITY_CAPABILITY, nothing prepared',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w);
 let asked;
 const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),rt,undefined,(env,installations,installation)=>{asked={installations:installations.length,slot:installation.slot};return null;});
 assert.equal(res.status,403);
 const body=await code(res);
 assert.equal(body.code,'AUTHORITY_CAPABILITY');assert.equal(body.admission,'DISABLED');
 assert.deepEqual(asked,{installations:2,slot:'1'});
 assert.equal(rt.calls.prepare.length,0);assert.equal(rt.calls.dispatch.length,0);
 // The real loader with no capability configuration in the environment also refuses.
 const real=await handleExternalAlpha(req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),w.env,{withRuntime:rt.withRuntime,verifyToken,spendPlan:qualifiedPlan});
 assert.equal(real.status,403);assert.equal((await code(real)).code,'AUTHORITY_CAPABILITY');
 assert.equal(rt.calls.prepare.length,0);
});

test('a redelivery of an admitted request never receives a definitive refusal, even after pricing expiry or capability removal',async()=>{
 const w=world(),{b,oidc}=good(w);
 const expired={validUntil:new Date(Date.now()-1000).toISOString()};
 const body={authority:b.envelope,prepare:b.prepare};
 for(const [plan,capability] of [[expired,configuredCapability],[qualifiedPlan,()=>null],[expired,()=>null],[qualifiedPlan,()=>{throw new ExternalAlphaError('AUTHORITY_CAPABILITY');}]]){
  const rt=runtime();rt.calls.prior=b.prepare.deadline;
  const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body}),rt,plan,capability);
  assert.equal(res.status,200);assert.equal(rt.calls.prepare.length,1);
 }
 // A failure while replaying, including a capability denial, is ambiguous (the Work exists), never 403.
 for(const error of [Object.assign(Error('Capability admission denied: POLICY_BLOCKED:myfactory'),{code:'CAPABILITY_ADMISSION_DENIED'}),Error('CAPABILITY_INSTALLATION_UNQUALIFIED'),Error('PRICING_EXPIRED'),Error('AUTHORITY_CONSUMED')]){
  const rt=runtime();rt.calls.prior=b.prepare.deadline;
  const failing={...rt,withRuntime:async(env,installation,action)=>rt.withRuntime(env,installation,c=>action({...c,control:{...c.control,prepare:async()=>{throw error;}}}))};
  const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body}),failing,expired,()=>null);
  assert.equal(res.status,503);assert.deepEqual(await code(res),{error:'EXTERNAL_ALPHA_UNAVAILABLE'});
 }
});

test('definitive refusals require proof of non-admission; every interleaving without that proof stays ambiguous',async()=>{
 const w=world(),{b,oidc}=good(w),body={authority:b.envelope,prepare:b.prepare};
 const expired={validUntil:new Date(Date.now()-1000).toISOString()};
 const denial=()=>Object.assign(Error('Capability admission denied: POLICY_BLOCKED:myfactory'),{code:'CAPABILITY_ADMISSION_DENIED'});
 // lookups: answers returned by successive prior-admission lookups (undefined = none, string = admitted deadline).
 const scripted=(lookups,{prepare,dispatch,unavailable=[]}={})=>{
  const rt=runtime();let n=0,runtimes=0;
  return {rt,withRuntime:async(env,installation,action)=>{
   if(unavailable.includes(runtimes++))throw new ExternalAlphaError('AUTHORITY_SOURCE');
   return rt.withRuntime(env,installation,c=>action({...c,
    authority:{...c.authority,priorDeadline:async()=>lookups[n++]},
    control:{...c.control,...(prepare?{prepare:async p=>{rt.calls.prepare.push(p);throw prepare();}}:{}),...(dispatch?{dispatch:async()=>{throw dispatch();}}:{})}}));
  }};
 };
 const run=async(s,plan=qualifiedPlan,capability=configuredCapability)=>{const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body}),s,plan,capability);return {status:res.status,body:await code(res)};};
 const unavailable={error:'EXTERNAL_ALPHA_UNAVAILABLE'};

 // (1) Proof saw no admission, a concurrent admission then appears at the inner lookup, and the replay fails: ambiguous.
 // App clock says expired but the database clock (the one admission uses) is still current: no refusal, admission proceeds.
 const s1=scripted([undefined,b.prepare.deadline],{prepare:denial});s1.rt.calls.dbNow=Date.now()-5000;
 const r1=await run(s1,expired);
 assert.deepEqual(r1,{status:503,body:unavailable});
 // (2) Proof cannot be obtained (runtime/source/database unavailable): ambiguous, never CANCELLED.
 assert.deepEqual(await run(scripted([],{unavailable:[0]}),expired),{status:503,body:unavailable});
 assert.deepEqual(await run(scripted([],{unavailable:[0]}),qualifiedPlan,()=>{throw new ExternalAlphaError('AUTHORITY_CAPABILITY');}),{status:503,body:unavailable});
 assert.deepEqual(await run(scripted([undefined],{prepare:denial,unavailable:[1]})),{status:503,body:unavailable});
 // (3) A successful prepare establishes admission: a later dispatch failure is ambiguous.
 const s3=scripted([undefined],{dispatch:()=>new ExternalAlphaError('AUTHORITY_REVOKED')});
 assert.deepEqual(await run(s3),{status:503,body:unavailable});assert.equal(s3.rt.calls.prepare.length,1);
 // (4) An admission committed between the failed transaction and the proof: ambiguous.
 assert.deepEqual(await run(scripted([undefined,b.prepare.deadline],{prepare:denial})),{status:503,body:unavailable});
 // (5) With proof of non-admission the rolled-back in-transaction refusal is definitive.
 const r5=await run(scripted([undefined,undefined],{prepare:denial}));
 assert.equal(r5.status,403);assert.equal(r5.body.code,'AUTHORITY_CAPABILITY');assert.equal(r5.body.admission,'DISABLED');
 const r5b=await run(scripted([undefined,undefined],{prepare:()=>Error('PRICING_EXPIRED')}));
 assert.equal(r5b.status,403);assert.equal(r5b.body.code,'PRICING_EXPIRED');
 // (6) A malformed capability loader throw is absent configuration: definitive only with proof, replay when admitted.
 const r6=await run(scripted([undefined]),qualifiedPlan,()=>{throw new ExternalAlphaError('AUTHORITY_CAPABILITY');});
 assert.equal(r6.status,403);assert.equal(r6.body.code,'AUTHORITY_CAPABILITY');
 const s6=scripted([b.prepare.deadline,b.prepare.deadline]);
 assert.equal((await run(s6,qualifiedPlan,()=>{throw new ExternalAlphaError('AUTHORITY_CAPABILITY');})).status,200);assert.equal(s6.rt.calls.prepare.length,1);
 // (7) PRICING_EXPIRED is judged on the database clock under the admission lock: expired there is definitive; an app
 // clock that runs ahead of it is not, and admission proceeds to its own in-transaction check.
 const s7=scripted([undefined]);s7.rt.calls.dbNow=Date.now();
 const r7=await run(s7,expired);
 assert.equal(r7.status,403);assert.equal(r7.body.code,'PRICING_EXPIRED');assert.equal(s7.rt.calls.prepare.length,0);
 const s7b=scripted([undefined,undefined]);s7b.rt.calls.dbNow=Date.now()-5000;
 assert.equal((await run(s7b,expired)).status,200);assert.equal(s7b.rt.calls.prepare.length,1);
});

test('capability denials raised inside the rolled-back admission transaction are definitive, never ambiguous 503',async()=>{
 const w=world(),{b,oidc}=good(w);
 for(const error of [Object.assign(Error('Capability admission denied: POLICY_BLOCKED:myfactory'),{code:'CAPABILITY_ADMISSION_DENIED'}),Error('CAPABILITY_INSTALLATION_UNQUALIFIED')]){
  const rt=runtime();
  const failing={...rt,withRuntime:async(env,installation,action)=>rt.withRuntime(env,installation,c=>action({...c,control:{...c.control,prepare:async()=>{throw error;}}}))};
  const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),failing);
  assert.equal(res.status,403);
  const body=await code(res);
  assert.equal(body.code,'AUTHORITY_CAPABILITY');assert.equal(body.admission,'DISABLED');
  assert.equal(JSON.stringify(body).includes('POLICY_BLOCKED'),false);
  assert.equal(rt.calls.dispatch.length,0);
 }
 // An unrelated failure stays ambiguous so the caller still records UNKNOWN.
 const rt=runtime();
 const odd={...rt,withRuntime:async(env,installation,action)=>rt.withRuntime(env,installation,c=>action({...c,control:{...c.control,prepare:async()=>{throw Error('SOMETHING_ELSE');}}}))};
 const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),odd);
 assert.equal(res.status,503);
});
