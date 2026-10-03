import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createSupervisor} from '../src/server.ts';
import {verifyCandidate,verifyWorkspaceTree} from '../../../packages/verification/src/index.ts';
import {runCodex} from '../../../packages/agents/src/index.ts';
import {parseCreateInput} from '../src/actions.ts';
const corpus=JSON.parse(readFileSync(new URL('../../../packages/verification/test/corpus/quantity-safe-integer.json',import.meta.url)));
const noEdit=JSON.parse(readFileSync(new URL('./fixtures/no-edit-productive.json',import.meta.url)));
const captured={files:Object.fromEntries(Object.entries(noEdit.publicContext.files).filter(([,text])=>text!==null)),capturedImplementation:corpus.source};
const correct=corpus.positiveControl;
const installed=process.env.FACTORY_INSTALLED_CLI==='1';
process.env.FACTORY_CODEX_MODEL='openai/gpt-5.4-mini';
for(const scenario of ['context-contract','targeted-inspection','captured-no-edit','correct-first','repairable','still-bad','outside-scope','linked-repair']){
 test('Bounded productive semantics: '+scenario,{skip:!installed,timeout:90000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'factory-checkpoint-')),repo=join(dir,'repo'),data=join(dir,'data');mkdirSync(repo);mkdirSync(data);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Controlled fixture');git('config','user.email','fixture@example.invalid');
  for(const [p,s] of Object.entries(captured.files)){mkdirSync(join(repo,p,'..'),{recursive:true});writeFileSync(join(repo,p),s);}
  if(scenario==='targeted-inspection'){mkdirSync(join(repo,'config'));writeFileSync(join(repo,'config/quantity-schema.json'),JSON.stringify({field:'quantity'}));}
  if(scenario==='linked-repair')writeFileSync(join(repo,'quantity.mjs'),captured.capturedImplementation);
  git('add','.');git('commit','-qm','Implementation-visible base');
  let active=null,providerCalls=0,productive=0,completion=0,feedbackSeen=false;
  const provider=createServer((req,res)=>{void(async()=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks).toString());
   assert.equal(request.model,'openai/gpt-5.4-mini');providerCalls++;
   let output;
   if(active.completion){assert(!JSON.stringify(request.input.filter(item=>item.role==='developer')).includes('FACTORY_BOUNDED_PRODUCTIVE_V1'));completion++;output=[{type:'message',id:'m'+providerCalls,role:'assistant',status:'completed',content:[{type:'output_text',text:'Read-only controlled completion.',annotations:[]}]}];}
   else{
    productive++;assert.equal(active.calls++,0,'One response per productive process');
    const developer=request.input.filter(item=>item.role==='developer').map(item=>JSON.stringify(item.content)).join(' ');
    const qualified=developer.includes('FACTORY_BOUNDED_PRODUCTIVE_V1')&&developer.includes('Repository context has already been collected')&&developer.includes('Targeted read-only inspection remains allowed');
    if(scenario==='captured-no-edit'||(scenario==='context-contract'&&!qualified)){
     output=noEdit.response.map((item,i)=>({...item,id:'captured-'+providerCalls+'-'+i,status:'completed',...(item.type==='function_call'?{call_id:'captured-call-'+providerCalls+'-'+i}:{})}));
    }else if(scenario==='targeted-inspection'){
     assert(qualified,'Executor must receive the host productive contract as developer instructions');
     assert(!active.prompt.includes('"field":"quantity"'),'The target fact must actually be absent from supplied context');
     const script="const fs=require('fs');const field=JSON.parse(fs.readFileSync('config/quantity-schema.json','utf8')).field;fs.writeFileSync('quantity.mjs',"+JSON.stringify(correct)+".replace('quantity:',JSON.stringify(field)+':'));";
     output=[{type:'function_call',id:'targeted-'+providerCalls,call_id:'targeted-call-'+providerCalls,name:'exec_command',arguments:JSON.stringify({cmd:'node -e '+"'"+script.replaceAll("'","'\\''")+"'",max_output_tokens:1000,yield_time_ms:1000}),status:'completed'}];
    }else{

    const file=scenario==='outside-scope'?'outside.txt':'quantity.mjs';
    const old=readFileSyncSafe(join(active.workspace,file));
    const next=['correct-first','context-contract','linked-repair'].includes(scenario)||(scenario==='repairable'&&productive===2)?correct:captured.capturedImplementation;
    const patch='*** Begin Patch\n'+(old===null?'*** Add File: '+file+'\n':'*** Update File: '+file+'\n@@\n'+old.trimEnd().split('\n').map(x=>'-'+x).join('\n')+'\n')+next.trimEnd().split('\n').map(x=>'+'+x).join('\n')+'\n*** End Patch';
    const tool=request.tools.find(t=>t.name==='apply_patch');assert(tool);
    output=[tool.type==='custom'?{type:'custom_tool_call',id:'t'+providerCalls,call_id:'c'+providerCalls,name:'apply_patch',input:patch,status:'completed'}:{type:'function_call',id:'t'+providerCalls,call_id:'c'+providerCalls,name:'apply_patch',arguments:JSON.stringify({patch}),status:'completed'}];
    }
   }
   const response={id:'fixture-'+providerCalls,object:'response',status:'completed',model:request.model,output,usage:{input_tokens:10,output_tokens:10,total_tokens:20}};
   res.writeHead(200,{'content-type':'text/event-stream','x-request-id':'fixture-'+providerCalls});let sequence_number=0;
   const event=x=>res.write('event: '+x.type+'\ndata: '+JSON.stringify({...x,sequence_number:sequence_number++})+'\n\n');
   event({type:'response.created',response:{...response,status:'in_progress',output:[]}});
   for(const [output_index,item] of output.entries()){event({type:'response.output_item.added',output_index,item});event({type:'response.output_item.done',output_index,item});}
   event({type:'response.completed',response});res.end();
  })().catch(e=>{res.writeHead(500);res.end('Fixture failed');console.error(e.message);});});
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>provider.close(r)));
  const pair=generateKeyPairSync('ed25519'),token='a'.repeat(64),key={factoryId:'checkpoint-fixture',keyId:'fixture',publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),activeFrom:'2020-01-01T00:00:00Z',notAfter:'2099-01-01T00:00:00Z'};
  writeFileSync(join(data,'connections.json'),JSON.stringify({clients:[{id:'test',name:'Test',tokenSha256:createHash('sha256').update(token).digest('hex'),repositoryPaths:[repo],actions:['factory.prepare','factory.dispatch','factory.observe','factory.stop']}]}));
  const version=execFileSync('codex',['--version'],{encoding:'utf8'}).trim();
  const price={revision:'synthetic-only',model:'openai/gpt-5.4-mini',validUntil:new Date(Date.now()+600000).toISOString(),contextLimitTokens:400000,outputLimitTokens:8192,inputMicrousdPerMillion:750000,outputMicrousdPerMillion:4500000};
  const supervisor=createSupervisor({reviewObservers:{reviewers:['fixture-independent-reviewer'],verifiers:['fixture-consumer']},dataDir:data,resultSigning:{factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]},localSpendFixture:{upstreamOrigin:'http://127.0.0.1:'+provider.address().port,upstreamApiKey:'loopback-fixture-only',price},jobDependencies:{
   verifyCandidate:input=>verifyCandidate(input),verifyWorkspaceTree:input=>verifyWorkspaceTree(input),
   preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version,error:null}),
   runCodex:async input=>{
    active={workspace:input.workspacePath,completion:input.sandbox==='read-only',calls:0,prompt:input.prompt};
    if(!active.completion){
     if(scenario==='linked-repair')assert(input.prompt.includes('REVIEW_REPAIR_CONTEXT'));
     assert(input.prompt.includes('test/quantity.test.mjs'));assert(input.prompt.includes('node:test'));
     if(productive===1){assert(input.prompt.includes('HOST_IMPLEMENTATION_FEEDBACK'));assert(input.prompt.includes('maximum-plus-one'));assert(input.prompt.includes(captured.capturedImplementation.split('\n')[0]));feedbackSeen=true;}
    }
    return runCodex(input);
   }
  }});
  t.after(async()=>{await supervisor.close();rmSync(dir,{recursive:true,force:true});});
  await new Promise(r=>supervisor.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+supervisor.server.address().port;
  const request=async(path,body)=>{const r=await fetch(origin+'/api/connect/v1/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200,await r.clone().text());return r.json();};
  const input={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/quantity',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1.05,spendContract:{version:'WORK_LEDGER_V2',pricingRevision:price.revision,plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:336864},input:{title:'Quantity',description:'Implement positive-integer stdin JSON validation.',kind:'feature',repositoryPath:repo,baseRef:git('rev-parse','HEAD'),acceptanceCriteria:['Match visible tests'],reproductionCommand:null,expectedFailureText:null,checkCommands:['node --test'],allowedPaths:['quantity.mjs'],workerProfile:'mac'}};
  let parentCandidate=null,repairOrder=null;
  if(scenario==='linked-repair'){
   const store=supervisor.storage;
   const parent=store.createWorkOrder({...input.input},'ready_for_review');
   const initial=store.createRun({workOrderId:parent.id,workerProfile:'mac',inputCommit:'a'.repeat(40),workspacePath:repo});
   const run=store.saveRun({...initial,state:'ready_for_review',candidateCommit:git('rev-parse','HEAD'),finishedAt:new Date().toISOString()});
   const tree=git('rev-parse','HEAD^{tree}');parentCandidate={workOrderId:parent.id,runId:run.id,commit:run.candidateCommit,tree};
   // Synthetic retained history: the old narrow checks missed numeric precision.
   for(const [type,payload] of [['run.implementation_checkpoint',{tree,passed:true}],['run.productive_closed',{tree}],['run.completion_result',{status:'completed'}],['run.candidate_committed',{candidateCommit:run.candidateCommit,candidateTree:tree}],['run.signed_result',{}]])store.appendEvent({workOrderId:parent.id,runId:run.id,type,payload});
   store.insertCheck({runId:run.id,candidateCommit:run.candidateCommit,command:'historical narrow public checks',status:'passed',exitCode:0,startedAt:run.startedAt,finishedAt:run.finishedAt,logPath:join(data,'historical-fixture.log')});
   for(const stage of ['custody','protected'])supervisor.reviewRepair.observe({candidate:parentCandidate,stage,status:'PASS',artifactHash:createHash('sha256').update('historical-fixture-'+stage).digest('hex'),source:'captured-history-fixture',published:false},'fixture-consumer');
   const review=supervisor.reviewRepair.recordReview({id:randomUUID(),reviewer:'fixture-independent-reviewer',candidate:parentCandidate,status:'FAIL',reportHash:'a'.repeat(64),findings:[{id:'numeric-range',category:'contract',severity:'high',path:'quantity.mjs',evidence:{visibility:'PUBLIC',reference:'b'.repeat(64),summary:'Public safe-integer input must be rejected when unsafe; Number conversion rounds it.'}}]},'fixture-independent-reviewer');
   const proposal=supervisor.reviewRepair.propose(parent.id,review.id,{mode:'OWNER_APPROVAL',publicContract:JSON.stringify(corpus.publicContract),allowedPaths:['quantity.mjs'],maxRounds:1,maxOperations:3,maxBudgetMicrousd:1050000,maxDurationSeconds:600,round:{productiveOperations:2,completionOperations:1,budgetMicrousd:1050000,durationSeconds:600}});
   repairOrder=supervisor.reviewRepair.approve(parent.id,proposal.id,proposal.hash,'fixture-owner');
   input.input=parseCreateInput(repairOrder);input.repairWorkOrderId=repairOrder.id;
  }
  const prepared=await request('dispatches',input),s=prepared.snapshot;
  const identity={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:input.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:input.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:input.deadline};
  await request('dispatches/'+input.requestId+'/dispatch',identity);let done;
  for(let i=0;i<1200;i++){done=await request('dispatches/'+input.requestId);if(done.quiescent)break;await new Promise(r=>setTimeout(r,50));}
  const success=['correct-first','context-contract','targeted-inspection','repairable','linked-repair'].includes(scenario);
  assert.equal(done.state,success?'COMPLETED':'FAILED',JSON.stringify(supervisor.storage.listEvents(s.workOrderId).filter(e=>e.type==='run.failed')));
  assert.equal(productive,['correct-first','context-contract','targeted-inspection','captured-no-edit','outside-scope','linked-repair'].includes(scenario)?1:2);assert.equal(completion,success?1:0);
  assert.equal(feedbackSeen,['repairable','still-bad'].includes(scenario));
  assert.equal(done.spend.operations.length,productive+completion);assert.equal(done.spend.unknownExposureMicrousd,0);
  const events=supervisor.storage.listEvents(s.workOrderId),checkpoints=events.filter(e=>e.type==='run.implementation_checkpoint');
  assert.deepEqual(checkpoints.map(e=>e.payload.passed),['correct-first','context-contract','targeted-inspection','linked-repair'].includes(scenario)?[true]:scenario==='repairable'?[false,true]:scenario==='still-bad'?[false,false]:[]);
  assert.equal(events.filter(e=>e.type==='factory.dispatch_claimed').length,1);
  if(success){assert.equal(events.find(e=>e.type==='run.candidate_committed').payload.candidateTree,checkpoints.at(-1).payload.tree);assert(events.some(e=>e.type==='run.signed_result'));}
  else{if(scenario==='captured-no-edit')assert(events.some(e=>e.type==='run.failed'&&e.payload.reason==='Agent produced no source changes'));assert.equal(supervisor.storage.getRun(s.runId).candidateCommit,null);assert.equal(done.spend.authorityState,'fenced');}
  if(scenario==='linked-repair'){
   const run=supervisor.storage.getRun(s.runId),commit=events.find(e=>e.type==='run.candidate_committed').payload;
   const candidate={workOrderId:repairOrder.id,runId:run.id,commit:commit.candidateCommit,tree:commit.candidateTree};
   assert.notEqual(candidate.commit,parentCandidate.commit);assert.notEqual(candidate.tree,parentCandidate.tree);
   const receipt=events.find(e=>e.type==='run.signed_result');assert(receipt);
   supervisor.reviewRepair.observe({candidate,stage:'custody',status:'PASS',artifactHash:createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),source:'fixture exact signed custody',published:false},'fixture-consumer');
   assert.throws(()=>supervisor.reviewRepair.recordReview({id:randomUUID(),reviewer:'fixture-independent-reviewer',candidate,status:'PASS',reportHash:'c'.repeat(64),findings:[]},'fixture-independent-reviewer'),/fresh verification/);
   // Independently pinned checks run after custody, outside producer context.
   const script="const{spawnSync}=require('node:child_process');for(const input of ['9007199254740993','0','-1']){const r=spawnSync('node',['quantity.mjs'],{input,encoding:'utf8'});if(r.status!==0||r.stderr!==''||r.stdout!==JSON.stringify({error:'invalid_quantity'})+String.fromCharCode(10))process.exit(1)}";
   const protectedResult=await verifyCandidate({repositoryPath:run.workspacePath,candidateSha:candidate.commit,commands:['node -e '+"'"+script.replaceAll("'","'\\''")+"'"],artifactDir:join(data,'independent-boundaries'),resourceKey:run.id+'-protected'});
   assert(protectedResult.checks.length>0&&protectedResult.checks.every(c=>c.status==='passed'));
   supervisor.reviewRepair.observe({candidate,stage:'protected',status:'PASS',artifactHash:createHash('sha256').update(JSON.stringify(protectedResult)).digest('hex'),source:'independent offline Docker',published:false},'fixture-consumer');
   supervisor.reviewRepair.recordReview({id:randomUUID(),reviewer:'fixture-independent-reviewer',candidate,status:'PASS',reportHash:'c'.repeat(64),findings:[]},'fixture-independent-reviewer');
   assert.equal(supervisor.reviewRepair.view(repairOrder.id).status,'REVIEW_PASSED');
   assert.equal(supervisor.reviewRepair.review(parentCandidate.workOrderId).status,'FAIL');
   assert.equal(supervisor.storage.listExternalActions(repairOrder.id).length,0);
  }
  const before=providerCalls;await request('dispatches/'+input.requestId+'/dispatch',identity);assert.equal(providerCalls,before);
 });
}
function readFileSyncSafe(path){try{return readFileSync(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}


test('captured productive context contained all implementation facts and explicit first-response edit instructions', () => {
  const context = noEdit.publicContext;
  assert.equal(context.files['quantity.mjs'], null, 'Target was absent, not omitted');
  assert(context.files['README.md'].includes('Number.MAX_SAFE_INTEGER'));
  assert.equal(JSON.parse(context.files['test/quantity-contract.json']).maximum, '9007199254740991');
  assert(context.files['test/quantity.test.mjs'].includes('assert.equal(r.stdout,c.stdout)'));
  assert.equal(JSON.parse(context.files['package.json']).type, 'module');
  assert(JSON.parse(context.files['package.json']).engines.node);
  assert(noEdit.capturedPrompt.includes('The host already performed bounded repository inspection'));
  assert(noEdit.capturedPrompt.includes('Each productive process has one model response'));
  assert(noEdit.capturedPrompt.includes('Implement using the exposed local edit tool in that response'));
  assert.deepEqual(noEdit.observedCommands, ['pwd', 'rg --files']);
  assert.equal(noEdit.providerOperations, 1);
});
