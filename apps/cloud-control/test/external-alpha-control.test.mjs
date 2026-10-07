import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleExternalAlpha,authenticateExternalAlphaCaller,externalAlphaIdentity} from '../src/external-alpha-control.mjs';
import {handleProductionControl} from '../src/production-control.mjs';
import {makeKeys,makeInstallation,build} from './fixtures/external-alpha-authority.mjs';
import {readFileSync} from 'node:fs';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {parseExternalAlphaInstallation} from '../src/external-alpha-authority.mjs';

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
  store:{read:async()=>({request:{requestId:'x',input:{allowedPaths:[]},source:{commit:'c'},deadline:'d',repository:'r',workGeneration:1,workId:'w'},snapshot:{factoryId:'f',factoryVersion:'v'},run_id:'r',work_order_id:'o'}),stop:async()=>{calls.stop.push(1);}},
  provider:{},readResult:async(id,challenge)=>{calls.result.push({id,challenge});return calls.resultPayload??{pending:true,state:'PENDING'};},readbackWithReceipt:async id=>({requestId:id,authorityReceipt:{},authorityReceiptSignature:'s'})});
 return {calls,withRuntime:async(env,installation,action)=>{calls.installation=installation;return action(fake(installation));}};
}
const good=(w,i=0)=>{const b=build(w.ctx[i]);return {b,oidc:oidcToken(claimsFor(w.configs[i]))};};
const send=(w,r,rt)=>handleExternalAlpha(r,w.env,{withRuntime:rt.withRuntime,verifyToken});
const code=async res=>(await res.json());

test('authorized caller dispatches on its own slot and receives a receipt-bearing readback',async()=>{
 const w=world(),rt=runtime(),{b,oidc}=good(w);
 const res=await send(w,req('dispatches',{cred:CRED[0],oidc,body:{authority:b.envelope,prepare:b.prepare}}),rt);
 assert.equal(res.status,200);assert.equal(rt.calls.prepare.length,1);
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
