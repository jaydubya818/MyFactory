import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {alphaOwnerRoster,alphaOwnerBinding,alphaOwnerCredentials,authenticateAlphaOwner,assertAlphaApprovalBinding} from '../src/alpha-owner-roster.mjs';
import {handleProductionControl} from '../src/production-control.mjs';
import {productionRuntimeComponents} from '../src/production-runtime-components.mjs';
import {fixture} from './fixtures/alpha-owner.mjs';
const request=(env,slot,kind='APPLICATION',path='production-canary/actions',method='GET')=>new Request('https://factory.invalid/api/connect/v2/'+path,{method,headers:{authorization:'Bearer '+env[`FACTORY_ALPHA_${slot}_${kind}_TOKEN`],'x-myfactory-source-oidc':'signed.source.assertion'}});
const verifier=project=>async(token,options)=>{assert.equal(token,'signed.source.assertion');assert.equal(options.projectId,project);assert.equal(options.environment,'production');assert.deepEqual(options.algorithms,['RS256']);return {payload:{project_id:project,owner_id:'team_p8z8exJRTGfOPk1GC9vUOpv3',environment:'production',iss:'https://oidc.vercel.com/jaydubya818',aud:'https://vercel.com/jaydubya818',exp:Math.floor(Date.now()/1000)+60}}};
test('fixed roster is inactive without approval, cannot reuse personal or duplicate identities',()=>{
 const {env,roster}=fixture();assert.equal(alphaOwnerRoster(env).roster.owners.length,3);
 const runtime={env,pool:{},queue:{},sourceDigest:'a'.repeat(64),signing:{factoryId:'myfactory-cloud-production',key:{factoryId:'myfactory-cloud-production',keyId:'production-cloud-v1'}}};
 for(const o of roster.owners)assert.throws(()=>productionRuntimeComponents({...runtime,alphaClientId:o.clientId}),/NOT_AUTHORIZED/);
 for(const mutate of [r=>r.owners.pop(),r=>r.owners[1].ownerScope=r.owners[0].ownerScope,r=>r.owners[1].sourceProjectId=r.owners[0].sourceProjectId,r=>r.owners[0].sourceProjectId='prj_L6faw25wnFGUZtrLKBIccg8gIDLR',r=>r.owners[0].ownerScope='personal-retained-owner',r=>r.owners[0].clientId='sofie-production',r=>r.extra=true]){
  const changed=structuredClone(roster);mutate(changed);assert.throws(()=>alphaOwnerRoster({...env,FACTORY_ALPHA_OWNER_ROSTER:JSON.stringify(changed),FACTORY_ALPHA_OWNER_ROSTER_SHA256:digest(changed)}));
 }
});
test('each credential requires its own verified production workload and cannot cross the six owner pairs',async()=>{
 const {env,roster}=fixture();for(const o of roster.owners){const session=await authenticateAlphaOwner(request(env,o.slot),env,verifier(o.sourceProjectId));assert.equal(session.binding.ownerScope,o.ownerScope);assert.equal(session.kind,'execution');
  for(const other of roster.owners.filter(x=>x!==o))await assert.rejects(authenticateAlphaOwner(request(env,o.slot),env,verifier(other.sourceProjectId)));
  for(const key of ['environment','project_id','owner_id','iss','aud','exp'])await assert.rejects(authenticateAlphaOwner(request(env,o.slot),env,async()=>{const {payload}=await verifier(o.sourceProjectId)('signed.source.assertion',{projectId:o.sourceProjectId,environment:'production',algorithms:['RS256']});return {payload:{...payload,[key]:key==='exp'?0:'wrong'}}}));
 }
 assert.equal(await authenticateAlphaOwner(new Request('https://factory.invalid'),env),null);
 for(const token of [env.FACTORY_PRODUCTION_APPLICATION_TOKEN,env.FACTORY_ALPHA_B_APPLICATION_TOKEN])assert.throws(()=>alphaOwnerCredentials({...env,FACTORY_ALPHA_A_APPLICATION_TOKEN:token},alphaOwnerBinding(env,'sofie-alpha-a')));
});
test('approval binds exact owner, client, roster and source project without circular approval digest',()=>{
 const {env,roster}=fixture();for(const o of roster.owners){const b=alphaOwnerBinding(env,o.clientId),e={approval:{ownerBinding:b,manifestTemplate:{ownerScope:b.ownerScope,clientId:b.clientId}}};assertAlphaApprovalBinding(e,b);
  for(const other of roster.owners.filter(x=>x!==o))assert.throws(()=>assertAlphaApprovalBinding(e,alphaOwnerBinding(env,other.clientId)));
  assert.throws(()=>assertAlphaApprovalBinding({...e,approval:{...e.approval,ownerBinding:{...b,rosterSha256:'f'.repeat(64)}}},b));
 }
});
test('expired Proof cannot read; application identity retains stop/observation but cannot start',async()=>{
 const {env}=fixture();env.FACTORY_ALPHA_A_PROOF_EXPIRES_AT=new Date(0).toISOString();const b=alphaOwnerBinding(env,'sofie-alpha-a');
 assert.throws(()=>alphaOwnerCredentials(env,b));assert.doesNotThrow(()=>alphaOwnerCredentials(env,b,Date.now(),true));
 await assert.rejects(authenticateAlphaOwner(request(env,'A','PROOF'),env,verifier(b.sourceProjectId)));
 assert.equal((await authenticateAlphaOwner(request(env,'A'),env,verifier(b.sourceProjectId))).kind,'execution');
});
test('HTTP routing carries authenticated owner namespace; proof cannot execute or use legacy routes',async()=>{
 const {env}=fixture(),b=alphaOwnerBinding(env,'sofie-alpha-a');let calls=0;
 const auth=async req=>authenticateAlphaOwner(req,env,verifier(b.sourceProjectId));
 const runtime=async(_env,action,options)=>{calls++;assert.equal(options.alphaClientId,b.clientId);return Response.json({tested:true})};
 assert.equal((await handleProductionControl(request(env,'A'),env,runtime,auth)).status,200);assert.equal(calls,1);
 for(const [kind,path]of [['PROOF','production-canary/dispatches'],['APPLICATION','release-validation/actions'],['APPLICATION','dispatches']])assert.notEqual((await handleProductionControl(request(env,'A',kind,path,'POST'),env,runtime,auth)).status,200);
 assert.equal(calls,1);
});
