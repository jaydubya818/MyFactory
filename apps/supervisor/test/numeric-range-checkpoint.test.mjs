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
const corpus=JSON.parse(readFileSync(new URL('../../../packages/verification/test/corpus/quantity-safe-integer.json',import.meta.url)));
const captured={files:{'package.json':JSON.stringify({type:'module',scripts:{test:'node --test test/quantity.test.mjs'}}),'test/quantity.test.mjs':corpus.visibleTest,'test/output-contract.json':JSON.stringify(corpus.outputContract),'test/quantity-contract.json':JSON.stringify(corpus.publicContract)},capturedImplementation:corpus.source};
const correct=corpus.positiveControl;
const installed=process.env.FACTORY_INSTALLED_CLI==='1';
process.env.FACTORY_CODEX_MODEL='openai/gpt-5.4-mini';
for(const scenario of ['correct-first','repairable','still-bad','outside-scope']){
 test('Safe-integer corpus checkpoint: '+scenario,{skip:!installed,timeout:90000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'factory-checkpoint-')),repo=join(dir,'repo'),data=join(dir,'data');mkdirSync(repo);mkdirSync(data);
  const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  git('init','-q');git('config','user.name','Controlled fixture');git('config','user.email','fixture@example.invalid');
  for(const [p,s] of Object.entries(captured.files)){mkdirSync(join(repo,p,'..'),{recursive:true});writeFileSync(join(repo,p),s);}
  git('add','.');git('commit','-qm','Implementation-visible base');
  let active=null,providerCalls=0,productive=0,completion=0,feedbackSeen=false;
  const provider=createServer((req,res)=>{void(async()=>{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks).toString());
   assert.equal(request.model,'openai/gpt-5.4-mini');providerCalls++;
   let output;
   if(active.completion){completion++;output=[{type:'message',id:'m'+providerCalls,role:'assistant',status:'completed',content:[{type:'output_text',text:'Read-only controlled completion.',annotations:[]}]}];}
   else{
    productive++;assert.equal(active.calls++,0,'One response per productive process');
    const file=scenario==='outside-scope'?'outside.txt':'quantity.mjs';
    const old=readFileSyncSafe(join(active.workspace,file));
    const next=scenario==='correct-first'||(scenario==='repairable'&&productive===2)?correct:captured.capturedImplementation;
    const patch='*** Begin Patch\n'+(old===null?'*** Add File: '+file+'\n':'*** Update File: '+file+'\n@@\n'+old.trimEnd().split('\n').map(x=>'-'+x).join('\n')+'\n')+next.trimEnd().split('\n').map(x=>'+'+x).join('\n')+'\n*** End Patch';
    const tool=request.tools.find(t=>t.name==='apply_patch');assert(tool);
    output=[tool.type==='custom'?{type:'custom_tool_call',id:'t'+providerCalls,call_id:'c'+providerCalls,name:'apply_patch',input:patch,status:'completed'}:{type:'function_call',id:'t'+providerCalls,call_id:'c'+providerCalls,name:'apply_patch',arguments:JSON.stringify({patch}),status:'completed'}];
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
  const supervisor=createSupervisor({dataDir:data,resultSigning:{factoryId:key.factoryId,currentKeyId:key.keyId,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keys:[key]},localSpendFixture:{upstreamOrigin:'http://127.0.0.1:'+provider.address().port,upstreamApiKey:'loopback-fixture-only',price},jobDependencies:{
   verifyCandidate:input=>verifyCandidate(input),verifyWorkspaceTree:input=>verifyWorkspaceTree(input),
   preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version,error:null}),
   runCodex:async input=>{
    active={workspace:input.workspacePath,completion:input.sandbox==='read-only',calls:0};
    if(!active.completion){
     assert(input.prompt.includes('test/quantity.test.mjs'));assert(input.prompt.includes('node:test'));
     if(productive===1){assert(input.prompt.includes('HOST_IMPLEMENTATION_FEEDBACK'));assert(input.prompt.includes('maximum-plus-one'));assert(input.prompt.includes(captured.capturedImplementation.split('\n')[0]));feedbackSeen=true;}
    }
    return runCodex(input);
   }
  }});
  t.after(async()=>{await supervisor.close();rmSync(dir,{recursive:true,force:true});});
  await new Promise(r=>supervisor.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+supervisor.server.address().port;
  const request=async(path,body)=>{const r=await fetch(origin+'/api/connect/v1/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json();};
  const input={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:'fixture/quantity',deadline:new Date(Date.now()+600000).toISOString(),maxSpendUsd:1.05,spendContract:{version:'WORK_LEDGER_V2',pricingRevision:price.revision,plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:336864},input:{title:'Quantity',description:'Implement positive-integer stdin JSON validation.',kind:'feature',repositoryPath:repo,baseRef:git('rev-parse','HEAD'),acceptanceCriteria:['Match visible tests'],reproductionCommand:null,expectedFailureText:null,checkCommands:['node --test'],allowedPaths:['quantity.mjs'],workerProfile:'mac'}};
  const prepared=await request('dispatches',input),s=prepared.snapshot;
  const identity={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId:input.workId,workGeneration:1,factoryId:s.factoryId,factoryVersion:s.factoryVersion,requestId:s.requestId,workOrderId:s.workOrderId,remoteRunId:s.runId,repository:input.repository,baseSha:s.inputCommit,allowedPaths:s.configuration.allowedPaths,deadline:input.deadline};
  await request('dispatches/'+input.requestId+'/dispatch',identity);let done;
  for(let i=0;i<1200;i++){done=await request('dispatches/'+input.requestId);if(done.quiescent)break;await new Promise(r=>setTimeout(r,50));}
  const success=['correct-first','repairable'].includes(scenario);
  assert.equal(done.state,success?'COMPLETED':'FAILED',JSON.stringify(supervisor.storage.listEvents(s.workOrderId).filter(e=>e.type==='run.failed')));
  assert.equal(productive,['correct-first','outside-scope'].includes(scenario)?1:2);assert.equal(completion,success?1:0);
  assert.equal(feedbackSeen,['repairable','still-bad'].includes(scenario));
  assert.equal(done.spend.operations.length,productive+completion);assert.equal(done.spend.unknownExposureMicrousd,0);
  const events=supervisor.storage.listEvents(s.workOrderId),checkpoints=events.filter(e=>e.type==='run.implementation_checkpoint');
  assert.deepEqual(checkpoints.map(e=>e.payload.passed),scenario==='correct-first'?[true]:scenario==='repairable'?[false,true]:scenario==='still-bad'?[false,false]:[]);
  assert.equal(events.filter(e=>e.type==='factory.dispatch_claimed').length,1);
  if(success){assert.equal(events.find(e=>e.type==='run.candidate_committed').payload.candidateTree,checkpoints.at(-1).payload.tree);assert(events.some(e=>e.type==='run.signed_result'));}
  else{assert.equal(supervisor.storage.getRun(s.runId).candidateCommit,null);assert.equal(done.spend.authorityState,'fenced');}
  const before=providerCalls;await request('dispatches/'+input.requestId+'/dispatch',identity);assert.equal(providerCalls,before);
 });
}
function readFileSyncSafe(path){try{return readFileSync(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
