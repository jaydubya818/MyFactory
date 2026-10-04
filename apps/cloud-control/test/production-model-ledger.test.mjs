import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {SpendLedger} from '../../../packages/storage/src/spend.ts';
import {SpendGateway} from '../../supervisor/src/spend-gateway.ts';
import {productionModelProvider,productionModelPrice} from '../src/production-model-provider.mjs';
import {productionSpendPlan} from '../src/production-execution-plan.mjs';
const installation={version:1,factoryId:'myfactory-cloud-production',environment:'production',projectId:'prj_4hfceCN8l6wN1gUyYOzZLQ7aJapK',callerProjectId:'prj_L6faw25wnFGUZtrLKBIccg8gIDLR',teamId:'team_p8z8exJRTGfOPk1GC9vUOpv3',ownerScope:'disposable-owner',custodyStoreId:'store_qBuivS8MmRxnBNnU',databaseResourceId:'dry-morning-22844424'};
const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:installation.projectId,VERCEL_ORG_ID:installation.teamId,FACTORY_PRODUCTION_INSTALLATION:JSON.stringify(installation)};
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'production-ledger-local-')),path=join(dir,'ledger.sqlite'),storage=openStorage(path);
 const order=storage.createWorkOrder({title:'Local contract qualification',description:'No network model',kind:'feature',repositoryPath:dir,baseRef:'a'.repeat(40),acceptanceCriteria:['bounded'],reproductionCommand:null,expectedFailureText:null,checkCommands:[],allowedPaths:['normalize.mjs'],workerProfile:'container'});
 const run=storage.createRun({workOrderId:order.id,workerProfile:'container',inputCommit:'a'.repeat(40),workspacePath:dir});
 const ledger=new SpendLedger(path),binding={workId:'local-work',workGeneration:1,dispatchIdentity:'dispatch',requestId:'request',workOrderId:order.id,factoryVersion:'version',runId:run.id};
 t.after(()=>{ledger.close();storage.close();rmSync(dir,{recursive:true,force:true});});
 ledger.createBudget(binding,1000000,new Date(Date.now()+60000).toISOString(),productionSpendPlan);ledger.bindAuthority(binding);
 let authorized=true,acquired=0,calls=0;
 const provider=productionModelProvider({env,assertWorkAuthorized:async()=>{if(!authorized)throw Error('REVOKED');}},
  {getToken:async()=>`local.synthetic.${++acquired}`,verifyToken:async()=>({payload:{project_id:installation.projectId,owner_id:installation.teamId,environment:'production',iss:'https://oidc.vercel.com/jaydubya818',aud:'https://vercel.com/jaydubya818',exp:Math.floor(Date.now()/1000)+600}})});
 const childToken='b'.repeat(64),request=()=>new Request('https://factory.internal/v1/responses',{method:'POST',headers:{authorization:'Bearer '+childToken},body:JSON.stringify({model:productionModelPrice.model,input:'Local deterministic composition'})});
 const gateway=(phase,unknown=false)=>new SpendGateway({...provider,ledger,binding,phase,childToken,upstreamFetch:async(url,init)=>{
  calls++;assert.equal(String(url),'https://ai-gateway.vercel.sh/v1/responses');assert.equal(init.redirect,'error');
  assert.match(init.headers.authorization,/local.synthetic/);const payload=JSON.parse(init.body);assert.equal(payload.store,false);assert.deepEqual(payload.providerOptions,{gateway:{only:['openai']}});
  if(unknown)return new Response('deliberately lost local response',{status:503});
  return Response.json({id:'local-response-'+calls,status:'completed',usage:{input_tokens:10,output_tokens:10},output:[]},{headers:{'x-request-id':'local-request-'+calls}});
 }});
 return{ledger,binding,request,gateway,revoke:()=>{authorized=false;},counts:()=>({calls,acquired})};
}
test('LOCAL production adapter + canonical V2 gateway settles productive and completion with exact rates, fresh identity and no fallback',async t=>{
 const f=fixture(t);assert.equal((await f.gateway('productive').fetch(f.request())).status,200);
 f.ledger.assertCompletionEligible(f.binding);f.ledger.beginCompletion(f.binding);
 assert.equal((await f.gateway('completion').fetch(f.request())).status,200);f.ledger.assertCompleted(f.binding);
 const spend=f.ledger.read(f.binding.workId);assert.equal(spend.operations.length,2);assert(spend.operations.every(op=>op.state==='settled'&&op.reservedMicrousd===84864&&op.actualMicrousd===53));
 assert.deepEqual(f.counts(),{calls:2,acquired:2});
 assert.notEqual((await f.gateway('productive').fetch(f.request())).status,200);assert.equal(f.counts().calls,2);
});
test('LOCAL production UNKNOWN retains full exposure and never retries; revocation prevents identity acquisition',async t=>{
 const f=fixture(t);assert.notEqual((await f.gateway('productive',true).fetch(f.request())).status,200);
 assert.equal(f.ledger.read(f.binding.workId).unknownExposureMicrousd,84864);
 assert.notEqual((await f.gateway('productive').fetch(f.request())).status,200);assert.equal(f.counts().calls,1);
 f.revoke();const before=f.counts().acquired;assert.notEqual((await f.gateway('completion').fetch(f.request())).status,200);assert.equal(f.counts().acquired,before);
});
