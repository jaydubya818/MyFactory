import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../../../packages/storage/src/index.ts';
import {JobManager} from '../src/jobs.ts';
import {freezeHostedResult,publishHostedArtifacts} from '../src/hosted-result.ts';
import {readResult,resultDescription,requestDescription,receiptDescription,requestId} from '../../../packages/hosted-routing/src/index.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
test('one hosted WorkOrder executes a bounded attempt and exports its exact signed result',async t=>{
 const root=mkdtempSync(join(tmpdir(),'q37-golden-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const repo=join(root,'repo');mkdirSync(repo);const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(repo,'app.txt'),'before\n');git('add','.');git('commit','-qm','base');
 const base=git('rev-parse','HEAD'),factoryVersion={sourceCommit:base,sourceTree:git('rev-parse','HEAD^{tree}'),configurationDigest:sha('golden-config')};
 const storage=openStorage(join(root,'factory.sqlite'));t.after(()=>storage.close());
 const order=storage.createWorkOrder({title:'Golden candidate',description:'Make one bounded change',kind:'feature',repositoryPath:repo,baseRef:base,acceptanceCriteria:['Change app.txt'],reproductionCommand:null,expectedFailureText:null,checkCommands:['git diff --check'],allowedPaths:['app.txt'],workerProfile:'mac'});
 const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):x;
 const submission={ownerId:'q37-golden-owner',agentId:'sofie',workId:randomUUID(),workVersion:1,workGeneration:1,criteriaVersion:1,objective:'Make one bounded change',criteria:['Change app.txt'],kind:'feature',repository:'owner/repo',baseCommit:base,allowedPaths:['app.txt'],sourcePin:{kind:'TRUSTED_FACTORY_EXPECTATION',factoryId:'golden-factory',factoryVersion:{myFactoryCommit:base,sourceTree:factoryVersion.sourceTree,configurationDigest:factoryVersion.configurationDigest}},clientId:'myeve',idempotencyKey:'q37-golden-'+randomUUID(),policyReference:null,budgetReference:null,submittedAt:new Date().toISOString()};
 const issueId=requestId('myeve',submission.idempotencyKey),factoryBinding={ownerId:submission.ownerId,agentId:submission.agentId,workId:submission.workId,workVersion:1,workGeneration:1,criteriaVersion:1,submissionDigest:sha(JSON.stringify(canonical(submission))),expectedFactoryId:'golden-factory',expectedFactoryVersion:factoryVersion};
 const bindingDigest=sha(JSON.stringify(factoryBinding));storage.recordHostedBinding(issueId,'myeve',order.id,factoryBinding,bindingDigest);
 const hostedInput={idempotencyKey:submission.idempotencyKey,title:'Golden candidate',description:submission.objective,kind:'feature',acceptanceCriteria:submission.criteria,allowedPaths:submission.allowedPaths,factoryBinding};
 const config={clientId:'myeve',repository:'owner/repo',teamId:'team',token:'a'.repeat(64)};
 const jobs=new JobManager(storage,root,()=>{}, {
  preflightCodex:async()=>({binaryAvailable:true,authenticated:true,version:'fixture-agent',error:null}),
  captureFactoryVersion:async()=>({factoryId:'golden-factory',factoryVersion,effectiveConfiguration:{model:process.env.FACTORY_CODEX_MODEL??'gpt-5.5',agentVersion:'fixture-agent'}}),
  runCodex:async input=>{writeFileSync(join(input.workspacePath,'app.txt'),'after\n');return{success:true,status:'completed',threadId:'golden-thread',usage:null,eventsPath:join(root,'events.jsonl')}},
  verifyCandidate:async input=>{mkdirSync(input.artifactDir,{recursive:true});const logPath=join(input.artifactDir,'check.log');writeFileSync(logPath,'passed\n'+'.'.repeat(20000));return{checks:input.commands.map(command=>({candidateCommit:input.candidateSha,candidateTree:'unused',command,status:'passed',exitCode:0,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),logPath,reason:null})),reason:null}}
 });t.after(()=>jobs.close());
 const run=await jobs.startRun(order);for(let i=0;i<100;i++){if(storage.getRun(run.id)?.state==='ready_for_review')break;await new Promise(r=>setTimeout(r,10))}
 assert.equal(storage.getRun(run.id).state,'ready_for_review');assert.equal(storage.getWorkOrder(order.id).state,'ready_for_review');
 assert(storage.listEvents(order.id).some(e=>e.type==='run.factory_version_attested'));
 const encoded=await freezeHostedResult(storage,root,issueId,order.id,run.id);
 const comments=new Map(),linear={async graphql(q,v){if(q.includes('query FactoryArtifactChunks'))return{issue:{id:issueId,comments:{nodes:[...comments].map(([id,body])=>({id,body})),pageInfo:{hasNextPage:false,endCursor:null}}}};if(q.includes('mutation FactoryArtifactChunk')){comments.set(v.input.id,v.input.body);return{commentCreate:{success:true,comment:{id:v.input.id,body:v.input.body}}}}throw Error('Unexpected query')}};
 await publishHostedArtifacts(linear,storage,root,issueId,order.id,run.id,encoded);
 const pair=generateKeyPairSync('ed25519');
 const receipt={version:1,issueId,workOrderId:order.id,state:'ready_for_review',updatedAt:new Date().toISOString(),workOrderUrl:`http://127.0.0.1:8788/?workOrder=${order.id}`};
 const signed=resultDescription(receiptDescription(requestDescription(config,hostedInput),receipt,pair.privateKey),encoded,pair.privateKey),result=readResult(signed,pair.publicKey,issueId);
 assert.equal(result.manifest.runId,run.id);assert.equal(result.manifest.workOrderId,order.id);assert.equal(result.manifest.candidateCommit,storage.getRun(run.id).candidateCommit);assert(result.manifest.artifacts.some(a=>a.byteLength>16000&&a.reference.transport==='linear-comments-v1'));
 assert(comments.size>2);assert.equal(result.factoryVersion.configurationDigest,factoryVersion.configurationDigest);
 assert.equal(await freezeHostedResult(storage,root,issueId,order.id,run.id),encoded);
 if(process.env.Q37_GOLDEN_OUT)writeFileSync(process.env.Q37_GOLDEN_OUT,JSON.stringify({submission,hostedInput,issue:{id:issueId,identifier:'Q37-GOLDEN',url:'https://linear.app/fixture/issue/Q37-GOLDEN',title:'Golden candidate',team:{id:'team'},description:signed},comments:[...comments].map(([id,body])=>({id,body})),publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString(),config,workOrderId:order.id,runId:run.id,attemptNumber:run.attemptNumber}));
});
