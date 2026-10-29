// Public tiny data and exact caller control flow only. Inert callbacks cannot
// issue native material, an accepted C guard, financial authority or Proof.
import test from 'node:test';import assert from 'node:assert/strict';
import{tmpdir}from'node:os';
import {readFileSync,realpathSync}from'node:fs';import{randomUUID}from'node:crypto';import ts from'typescript';
import {selectVerificationInputPhase,verificationCheckpointKey,verificationInputFence,verificationInputHold,verificationInputFailure,verificationInputKind}from'../src/local-v4-verification-input-policy.ts';
import {digest}from'../../../packages/hosted-routing/src/result.ts';
import {createHash}from'node:crypto';
import {dirname,join}from'node:path';
import {checkpointIdentity}from'../src/local-v4-checkpoint-policy.ts';
import {finalizationPolicyFailure}from'../src/local-v4-finalization-policy.ts';
import {contextPolicyKind}from'../src/local-v4-context-policy.ts';
import {requireStrictSourceOperations}from'../src/local-v4-context-policy.ts';
import {bindLocalV4PreparationCapture,createLocalV4Preparation}from'../src/local-v4-preparation.ts';
import {FactoryDispatchControl}from'../src/dispatch-control.ts';
const fixtureRepository=realpathSync(tmpdir());
const tree='1'.repeat(40),input='2'.repeat(40),candidate='3'.repeat(40),command='public-check';
const run={id:'public-run',workOrderId:'public-work',attemptNumber:1,inputCommit:input,workspacePath:'/unused',workerProfile:'mac',startedAt:'2026-10-28T00:00:00Z',state:'implementing'};
const work={id:run.workOrderId,state:'implementing',kind:'feature'};
const execution={version:4,inputCommit:input,inputTree:'4'.repeat(40),sourceDigest:'public-source',configurationDigest:'public-config',configuration:{commands:[command]}};
const identity=checkpointIdentity(run,execution),row=(id,type,payload={})=>({id,type,payload,runId:run.id,workOrderId:work.id,createdAt:'2026-10-28T00:00:00Z'});
function chain(step=1,final=false){
 const events=[row(1,'run.implementing')];let next=2,last,result,settled;
 for(let n=1;n<=step;n++){
  result=row(next++,'run.agent_result',{checkpointVersion:1,productiveStep:n,implementationEligible:true});events.push(result);
  settled=row(next++,'run.implementation_settled',{checkpointVersion:1,productiveStep:n,agentResultEventId:result.id,...identity,provenance:'TRUSTED_IN_PROCESS_CALLBACK_RETURNED'});events.push(settled);
  if(n<step||final){last=row(next++,'run.implementation_checkpoint',{checkpointVersion:1,contextVersion:1,productiveStep:n,agentResultEventId:result.id,settlementEventId:settled.id,tree,passed:n===step,exportStatus:'ready',checks:[{command,status:n===step?'passed':'failed'}]});events.push(last)}
  if(n<step)events.push(row(next++,'run.productive_repair_admitted',{contextVersion:1,productiveStep:2,checkpointEventId:last.id,checkedTree:tree}));
 }
 if(!final)return{events,phase:{kind:'IMPLEMENTATION',productiveStep:step,agentResultEventId:result.id,settlementEventId:settled.id},run:{...run},work:{...work}};
 const closed=row(next++,'run.productive_closed',{contextVersion:1,checkpointEventId:last.id,productiveStep:step,tree});events.push(closed);
 const start=row(next++,'run.completion_started',{phase:'completion',contextVersion:1,checkpointEventId:last.id,productiveClosedEventId:closed.id,productiveStep:step});events.push(start);
 const links={productiveStep:step,checkpointEventId:last.id,productiveClosedEventId:closed.id,completionStartedEventId:start.id};
 const completed=row(next++,'run.completion_result',{finalizationVersion:1,completionEligible:true,status:'completed',...links});events.push(completed);
 events.push(row(next++,'run.finalization_settled',{finalizationVersion:1,...links,completionResultEventId:completed.id,expectedTree:tree,...identity,provenance:'TRUSTED_IN_PROCESS_COMPLETION_RETURNED',completionProcessEventId:null}));
 const recorded=row(next++,'run.candidate_committed',{candidateCommit:candidate,candidateTree:tree});events.push(recorded);
 return{events,phase:{kind:'FINAL',candidateEventId:recorded.id},run:{...run,state:'verifying',candidateCommit:candidate},work:{...work,state:'verifying'}};
}
const select=f=>selectVerificationInputPhase(f.events,f.phase,f.run,f.work,execution);
for(const step of[1,2])for(const final of[false,true])test('input phase: exact '+(final?'final':'capture')+' step'+step,()=>{
 const f=chain(step,final),actual=select(f);assert.equal(actual.tree,final?tree:null);assert.equal(actual.commit,final?candidate:null);
});
test('input phase: original reproduction is not implementing context',()=>{
 const f={run:{...run,state:'planning'},work:{...work,state:'planning',kind:'defect',reproductionCommand:'public-reproduction'},events:[row(1,'run.started'),row(2,'run.reproduction_started',{command:'public-reproduction',inputCommit:input})],phase:{kind:'REPRODUCTION',reproductionStartedEventId:2}};
 assert.deepEqual(select(f),{tree:execution.inputTree,commit:input});f.events.push(row(3,'run.implementing'));assert.throws(()=>select(f),{code:'local_verification_input_hold'});
});
for(const final of[false,true])for(const type of['factory.stop_requested','run.recovery_hold','run.agent_result','run.candidate_committed','agent.process_started'])test('input full history: '+(final?'final ':'implementation ')+type+' cannot hide behind a projection',()=>{
 const f=chain(2,final);f.events.push(row(99,type));assert.throws(()=>select(f),{code:'local_verification_input_hold'});
});
for(const change of['foreign envelope','duplicate result','extra selector root','wrong selector ID','wrong candidate root','later check'])test('input final phase refuses '+change,()=>{
 const f=chain(1,true);if(change==='foreign envelope')f.events[1].runId='foreign';if(change==='duplicate result')f.events.splice(2,0,{...f.events[1]});if(change==='extra selector root')f.phase.tree=tree;
 if(change==='wrong selector ID')f.phase.candidateEventId=99;if(change==='wrong candidate root')f.events.at(-1).payload.candidateTree=input;if(change==='later check')f.events.push(row(99,'run.check_completed'));
 assert.throws(()=>select(f),{code:'local_verification_input_hold'});
});
test('input checkpoint key binds original source and actual host event IDs',()=>{const f=chain();const key=verificationCheckpointKey(run,execution,f.phase);assert.notEqual(key,verificationCheckpointKey(run,{...execution,sourceDigest:'changed'},f.phase));assert.notEqual(key,verificationCheckpointKey(run,execution,{...f.phase,settlementEventId:99}));});
for(const value of[undefined,null,true,{},()=>true,async()=>{},()=>{throw 'revoked'}])test('input mandatory synchronous void fence refuses '+String(value),()=>{assert.throws(()=>verificationInputFence(value));});
test('input actual thrown connection exception retains identity and denies recovery fallback',()=>{const denied=Error('Connection revoked');assert.throws(()=>verificationInputFence(()=>{throw denied}),error=>error===denied);assert.equal(verificationInputKind(denied),'uncertain');assert.equal(verificationInputFailure(denied),denied);});
for(const version of[null,1,2,3,4])for(const marker of['verificationBasis','assertVerificationInputReady','prepareVerificationInput','closeVerificationInput'])test('input strict marker: '+marker+' cannot downgrade '+version,()=>{
 assert.throws(()=>requireStrictSourceOperations(version===null?null:{version},{[marker](){}}),{code:'local_context_hold'});
});
test('input binder hides raw basis and exposes no new operations when raw seam is missing',()=>{
 const producer={capture(){throw Error('No capture')},snapshot(){return null},read(){throw Error('No read')},finalize(){throw Error('No sign')}};
 const bound=bindLocalV4PreparationCapture(createLocalV4Preparation('/public-no-native-input'),producer);assert.equal(Object.hasOwn(bound,'verificationBasis'),false);assert.equal(bound.prepareVerificationInput,undefined);
});
test('input binder denies an unregistered lease without native work',async()=>{
 const producer={capture(){throw Error('No capture')},snapshot(){return null},read(){throw Error('No read')},finalize(){throw Error('No sign')},verificationBasis(){throw Error('No admitted source')}};
 const bound=bindLocalV4PreparationCapture(createLocalV4Preparation('/public-no-native-input'),producer);assert.equal(Object.hasOwn(bound,'verificationBasis'),false);await assert.rejects(bound.closeVerificationInput(run,{source:{}},()=>{}),{code:'local_verification_input_hold'});
});
const jobsText=readFileSync(new URL('../src/jobs.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('jobs.ts',jobsText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='JobManager'),member=name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast);
const compile=(code,deps)=>new Function(...Object.keys(deps),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+'\nreturn Probe;')(...Object.values(deps));
function controlFixture({mode=true,defaultWorker=false,missing=null,readyResult=undefined}={}){
 const controller=new AbortController(),authority=()=>{},gateway={assertCurrentConnection:authority},active={controller,gateway,assertCurrentConnection:authority};let ready=0;
 const producer={snapshot:()=>execution,assertVerificationInputReady(){ready++;return readyResult},prepareVerificationInput(){throw Error('No native preparation in control case')},closeVerificationInput(){throw Error('No native close in control case')}};
 if(missing)producer[missing]=null;
 const defaultRun=()=>{throw Error('No native worker')},defaultCandidate=()=>{throw Error('No native verifier')},defaultTree=()=>{throw Error('No native verifier')};
 const dependencies={runCodex:defaultWorker?defaultRun:()=>{},verifyCandidate:()=>{},verifyWorkspaceTree:()=>{}};
 const code='class Probe {#active=new Map();constructor(){this.#active.set(run.workOrderId,active);this.storage={getRun:()=>({...run}),getWorkOrder:()=>({})};this.producer=producer;this.dependencies=dependencies;this.trustedFixtureVerification=mode;}\n'+member('#verificationControl')+'\ninvoke(){return this.#verificationControl(run,active,controller,()=>{})}}';
 const Type=compile(code,{run,active,controller,producer,dependencies,mode,verificationInputHold,verificationInputFence,runCodex:defaultRun,verifyCandidate:defaultCandidate,verifyWorkspaceTree:defaultTree});
 return{instance:new Type(),active,gateway,controller,producer,dependencies,get ready(){return ready}};
}
for(const variant of['mode','native worker','missing ready','missing prepare','missing close','async ready'])test('input consumer gate before any model/native call: '+variant,()=>{
 const f=controlFixture({mode:variant!=='mode',defaultWorker:variant==='native worker',missing:variant==='missing ready'?'assertVerificationInputReady':variant==='missing prepare'?'prepareVerificationInput':variant==='missing close'?'closeVerificationInput':null,readyResult:variant==='async ready'?Promise.resolve():undefined});assert.throws(()=>f.instance.invoke(),{code:'local_verification_input_hold'});
});
for(const change of['gateway callback','active callback','producer ready','consumer','abort'])test('input retained control: '+change+' denies after a deferred boundary',async()=>{
 const f=controlFixture(),current=f.instance.invoke();await Promise.resolve();if(change==='gateway callback')f.gateway.assertCurrentConnection=()=>{};if(change==='active callback')f.active.assertCurrentConnection=()=>{};if(change==='producer ready')f.producer.assertVerificationInputReady=()=>{};if(change==='consumer')f.dependencies.verifyCandidate=()=>{};if(change==='abort')f.controller.abort();assert.throws(current,{code:'local_verification_input_hold'});
});
function checkWrapper({callbackThrows=false,closeThrows=false}={}){
 let closes=0,calls=0,deny=false;const source={runId:run.id,workOrderId:run.workOrderId,commit:candidate,tree,files:{}};
 const producer={prepareVerificationInput:async()=>({source}),closeVerificationInput:async()=>{closes++;if(closeThrows)throw Error('inert close denied');return ()=>{}}};
 const current=()=>{if(deny)verificationInputFence(()=>{throw Error('current authority denied')})};
 const dependencies={verifyCandidate:async()=>{calls++;await Promise.resolve();if(callbackThrows)throw Error('inert callback failed');return{checks:[]}},verifyWorkspaceTree:async()=>{throw Error('No tree call')}};
 const code='class Probe {constructor(){this.producer=producer;this.dependencies=dependencies;}\n'+member('#verifySource')+'\ninvoke(){return this.#verifySource(run,current,{kind:"FINAL",candidateEventId:1},"candidate",{candidateSha:candidate,commands:["public-check"]},{assertCurrent:()=>{}})}}';
 const Type=compile(code,{producer,dependencies,run,current,candidate,verificationInputHold,verificationInputFailure,verificationInputFence});
 return{instance:new Type(),get calls(){return calls},get closes(){return closes},deny:()=>deny=true};
}
for(const variant of['stable','callback throws','close throws'])test('input exact check wrapper closes after all callback awaits: '+variant,async()=>{const f=checkWrapper({callbackThrows:variant==='callback throws',closeThrows:variant==='close throws'});if(variant==='stable')assert.deepEqual(await f.instance.invoke(),{checks:[]});else await assert.rejects(f.instance.invoke(),{code:'local_verification_input_hold'});assert.equal(f.calls,1);assert.equal(f.closes,1)});
// Actual constructed dispatch arrow, actual current/record/bind methods, and
// actual executePrepared handoff. Detached records/inert targets, no SQL/native.
function canonicalAuthority(){
 const owner='public-owner',client={id:'public-client',ownerScope:owner,actions:['factory.prepare','factory.dispatch'],repositoryPaths:[fixtureRepository],tokenSha256:'a'.repeat(64)},live=structuredClone(client);
 const workOrderId=randomUUID(),remoteRunId=randomUUID(),requestId=randomUUID(),workId=randomUUID(),deadline=new Date(Date.now()+600000).toISOString();
 const request={workId,workGeneration:1,requestId,repository:'public/source',deadline},order={id:workOrderId,repositoryPath:fixtureRepository},saved={id:remoteRunId,workOrderId};
 const snapshot={factoryId:'public-fixture',factoryVersion:'b'.repeat(64),workOrderId,runId:remoteRunId,inputCommit:input,configuration:{allowedPaths:['sample.txt']}};
 const identity={runId:randomUUID(),writerGeneration:1,dispatchIdentity:randomUUID(),workId,workGeneration:1,factoryId:snapshot.factoryId,factoryVersion:snapshot.factoryVersion,requestId,workOrderId,remoteRunId,repository:request.repository,baseSha:input,allowedPaths:['sample.txt'],deadline};
 const events=[{type:'factory.prepare_requested',payload:request},{type:'run.prepared',runId:remoteRunId}],storage={getIntake:()=>({work_order_id:workOrderId}),getWorkOrder:()=>order,getRun:()=>saved,listEvents:()=>events};
 const control=new FactoryDispatchControl(storage,{}, {snapshot:()=>snapshot},{},false,undefined,false,()=>live);
 const text=readFileSync(new URL('../src/dispatch-control.ts',import.meta.url),'utf8'),parse=ts.createSourceFile('dispatch.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let arrow;
 function find(n){if(ts.isPropertyAssignment(n)&&n.name.getText(parse)==='assertCurrentConnection')arrow=n.initializer.getText(parse);ts.forEachChild(n,find)}find(parse);assert(arrow);
 const begin=text.indexOf('const connectionClient='),end=text.indexOf('const childToken=',begin);assert(begin>=0&&end>begin);
 const callback=new Function('client','identity','ActionError',text.slice(begin,end)+'return ('+arrow+');').call(control,client,identity,Error);
 return{client,identity,live,callback,control};
}
test('input canonical authority: actual dispatch arrow is void and retains detached original identity',()=>{const f=canonicalAuthority();assert.equal(f.callback(),undefined);f.client.id='caller-mutated';f.identity.allowedPaths.push('caller-mutated');assert.equal(f.callback(),undefined)});
for(const change of['dispatch grant','owner','credential','repository'])test('input canonical authority denies '+change+' without financial/native effects',()=>{const f=canonicalAuthority();if(change==='dispatch grant')f.live.actions=['factory.prepare'];if(change==='owner')f.live.ownerScope='foreign';if(change==='credential')f.live.tokenSha256='c'.repeat(64);if(change==='repository')f.live.repositoryPaths=[];assert.throws(f.callback,{code:'forbidden',status:403})});
test('input actual execution ActiveJob retains the canonical gateway authority function',async()=>{
 const f=canonicalAuthority();let captured;const gateway={assertCurrentConnection:f.callback,close:async()=>{},fenceAuthority:()=>{}},storage={listEvents:()=>[{type:'factory.writer_bound',payload:{deadline:new Date(Date.now()+10000).toISOString()}}]},producer={snapshot:()=>({configuration:{model:'public-fixture'}})};
 const code='class Probe {#active=new Map();constructor(){this.storage=storage;this.producer=producer;}#assertSlot(){}#event(){}async #execute(_work,_run,active){capture(active)}\n'+member('executePrepared')+'}';
 const Type=compile(code,{storage,producer,capture:active=>captured=active,ActionError:Error,message:String});assert.equal(new Type().executePrepared(work,run,()=>true,gateway),true);assert.equal(captured.assertCurrentConnection,f.callback);assert.equal(captured.assertCurrentConnection(),undefined);f.live.actions=['factory.prepare'];assert.throws(captured.assertCurrentConnection,{code:'forbidden'});await new Promise(setImmediate);
});
for(const change of ['authority after callback','close operation replacement'])test('input exact wrapper retains original close and current authority: '+change,async()=>{
 let entered,release,closes=0,deny=false;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r),source={runId:run.id,workOrderId:run.workOrderId,commit:candidate,tree,files:{}};
 const authorityError=Error('Actual current authority denied');
 const producer={prepareVerificationInput:async()=>({source}),closeVerificationInput:async()=>{closes++;await Promise.resolve();return ()=>{}}};
 const originalClose=producer.closeVerificationInput;
 const dependencies={verifyCandidate:async()=>{entered();await held;return{checks:[]}},verifyWorkspaceTree:async()=>{throw Error('No tree call')}};
 const current=()=>{if(deny)verificationInputFence(()=>{throw authorityError});if(producer.closeVerificationInput!==originalClose)verificationInputHold()};
 const code='class Probe {constructor(){this.producer=producer;this.dependencies=dependencies;}\n'+member('#verifySource')+'\ninvoke(){return this.#verifySource(run,current,{kind:"FINAL",candidateEventId:1},"candidate",{candidateSha:candidate,commands:["public-check"]},{assertCurrent:()=>{}})}}';
 const Type=compile(code,{producer,dependencies,run,current,candidate,verificationInputHold,verificationInputFailure,verificationInputFence});const pending=new Type().invoke();await started;
 if(change==='authority after callback')deny=true;else producer.closeVerificationInput=async()=>{throw Error('Replacement must not run')};release();
 await assert.rejects(pending,error=>change==='authority after callback'?error===authorityError:error.code==='local_verification_input_hold');assert.equal(closes,1);
});

// R3: exact readiness/owner/prepare/close bodies against tiny in-memory metadata.
// No filesystem/native call, accepted guard, materialization or resource proof.
const prepText=readFileSync(new URL('../src/local-v4-preparation.ts',import.meta.url),'utf8'),prepAst=ts.createSourceFile('preparation.ts',prepText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function preparationNode(name,kind){let selected;function visit(n){if(kind==='variable'&&ts.isVariableDeclaration(n)&&n.name.getText(prepAst)===name)selected=n;
 if(kind==='method'&&ts.isMethodDeclaration(n)&&n.name.getText(prepAst)===name)selected=n;ts.forEachChild(n,visit)}visit(prepAst);assert(selected);return selected.getText(prepAst)}
function ownershipFixture(){
 const basis={run:{...run},work:{...work},execution:{...execution},phase:{kind:'ENTRY'},binding:'public'};
 const w={path:run.workspacePath,state:'finalizing',repository:{path:'/public-repository'},rootIdentity:'root',identity:'workspace',admin:'/public-admin/work',adminIdentity:'admin',adminRootIdentity:'admin-root',pointer:{digest:'public'}};
 const owner=Object.freeze({}),owned=new Map([[w.path,w]]),busy=new Set([w.repository.path]),finalizationOwners=new Map([[w.repository.path,owner]]),finalizingWriters=new WeakMap(),contextCaptures=new Map(),verificationLeases=new WeakMap(),verificationKeys=new WeakMap(),quarantined=new Set();
 const directories=new Map([[w.path,w.identity],[w.admin,w.adminIdentity],[dirname(w.admin),w.adminRootIdentity]]);let metadataReads=0,ownerReads=0,source=execution.sourceDigest;
 const contextCode='const '+preparationNode('contextIdentity','variable')+';';
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const contextIdentity=new Function('hash',ts.transpileModule(contextCode,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+'return contextIdentity;')(hash);
 contextCaptures.set(w.path,contextIdentity(basis.run,basis.execution));finalizingWriters.set(w,{owner,context:contextCaptures.get(w.path),tuple:digest({run:basis.run,work:basis.work,execution:basis.execution})});
 const deps={owned,busy,finalizationOwners,finalizingWriters,contextCaptures,verificationLeases,verificationKeys,quarantined,contextIdentity,digest,
  verificationInputHold,verificationInputFailure,verificationInputFence,readCurrentProducerSourceIdentity:()=>source,
  checkRepository:()=>{metadataReads++},root:()=>w.rootIdentity,directory:path=>{metadataReads++;return directories.get(path)},join,dirname,
  sameFile:path=>{assert.equal(path,join(w.path,'.git'));metadataReads++},
  file:path=>{metadataReads++;assert(!/(?:HEAD|index)$/.test(path),'No changing HEAD/index read during ENTRY');if(path.endsWith('/commondir'))return{bytes:'../..\n'};if(path.endsWith('/gitdir'))return{bytes:join(w.path,'.git')+'\n'};throw Error('Unexpected metadata read')},text:value=>value,
  inspect:()=>{ownerReads++;throw Error('No native owner inspection')},finalOutputs:new WeakMap(),lstatSync:()=>{throw Error('No native stat')},budget:()=>{},
  verificationSelection:()=>{throw Error('No root selection during finalizing')},command:()=>{throw Error('No native command')},hash};
 const code='const '+preparationNode('verificationOwner','variable')+';const controls={'+['verificationReady','verificationPrepare','verificationClose'].map(name=>preparationNode(name,'method')).join(',')+'};';
 const controls=new Function(...Object.keys(deps),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+'return controls;')(...Object.values(deps));
 return{basis,w,owner,busy,finalizationOwners,finalizingWriters,contextCaptures,directories,verificationLeases,verificationKeys,controls,setSource:value=>source=value,get metadataReads(){return metadataReads},get ownerReads(){return ownerReads}};
}
test('input own finalizer ENTRY permits exact token-owned metadata readiness without HEAD/index/source data',()=>{const f=ownershipFixture();assert.equal(f.controls.verificationReady(f.basis),undefined);assert(f.metadataReads>0);assert.equal(f.ownerReads,0)});
for(const change of ['no writer','foreign owner','no repository owner','no busy','foreign context','changed run','changed work','changed execution','changed source','foreign workspace','foreign admin','non ENTRY','wrong state'])test('input own finalizer ENTRY denies '+change+' before source data',()=>{
 const f=ownershipFixture();if(change==='no writer')f.finalizingWriters.delete(f.w);if(change==='foreign owner')f.finalizationOwners.set(f.w.repository.path,{});if(change==='no repository owner')f.finalizationOwners.delete(f.w.repository.path);if(change==='no busy')f.busy.clear();if(change==='foreign context')f.contextCaptures.set(f.w.path,'foreign');
 if(change==='changed run')f.basis.run.attemptNumber++;if(change==='changed work')f.basis.work.title='foreign';if(change==='changed execution')f.basis.execution.configurationDigest='foreign';if(change==='changed source')f.setSource('foreign');if(change==='foreign workspace')f.directories.set(f.w.path,'foreign');if(change==='foreign admin')f.directories.set(f.w.admin,'foreign');if(change==='non ENTRY')f.basis.phase={kind:'FINAL',candidateEventId:1};if(change==='wrong state')f.basis.run.state='verifying';
 assert.throws(()=>f.controls.verificationReady(f.basis),{code:'local_verification_input_hold'});assert.equal(f.ownerReads,0);
});
test('input own finalizer source prepare remains denied before native read',async()=>{const f=ownershipFixture();await assert.rejects(f.controls.verificationPrepare(f.basis,Infinity,()=>{}),{code:'local_verification_input_hold'});assert.equal(f.metadataReads,0);assert.equal(f.ownerReads,0)});
test('input own finalizer registered close remains denied without consuming or selecting source',()=>{const f=ownershipFixture(),lease={source:{}},record={w:f.w,key:'public',binding:'public'};f.verificationLeases.set(lease,record);f.verificationKeys.set(f.w,new Map([['public','open']]));assert.throws(()=>f.controls.verificationClose(f.basis,lease,Infinity,()=>{}),{code:'local_verification_input_hold'});assert.equal(f.verificationKeys.get(f.w).get('public'),'uncertain');assert.equal(f.metadataReads,0);assert.equal(f.ownerReads,0)});

// R4 exact outer callers + actual strict composition and actual bound close.
// Only tiny inert rows/registry metadata. No native/C guards, SQL or resources.
const compileBody=(code,deps,tail)=>new Function(...Object.keys(deps),ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+'\n'+tail)(...Object.values(deps));
function phaseWriteFixture(kind,race){
 const f=kind==='REPRODUCTION'?{run:{...run,state:'planning'},work:{...work,state:'planning',kind:'defect',reproductionCommand:'public-reproduction',expectedFailureText:'public baseline'},phase:{kind:'REPRODUCTION',reproductionStartedEventId:2},events:[row(1,'run.started'),row(2,'run.reproduction_started',{command:'public-reproduction',inputCommit:input})]}:chain(1,kind==='FINAL');
 const actualRun=f.run,actualWork={...f.work,checkCommands:[command]},events=structuredClone(f.events);let phaseReads=0,mutated=false,writes=0,reads=0;
 const mutate=()=>{events.push(row(events.at(-1).id+1,'run.agent_result',{checkpointVersion:1,productiveStep:1,implementationEligible:true}));mutated=true};
 const raw=(r,phase)=>{const selected=selectVerificationInputPhase(events,phase,actualRun,actualWork,execution);const basis=structuredClone({run:actualRun,work:actualWork,execution,phase,selectedTree:selected.tree,selectedCommit:selected.commit,binding:digest({run:actualRun,work:actualWork,execution,phase,events})});if(phase.kind!=='ENTRY'&&++phaseReads===5&&race==='close')queueMicrotask(mutate);return basis};
 const original=raw(actualRun,f.phase);phaseReads=0;
 const source=Object.freeze({schema:'local-v4-fixture-source/v1',runId:run.id,workOrderId:run.workOrderId,kind,commit:kind==='IMPLEMENTATION'?null:kind==='FINAL'?candidate:input,tree:kind==='REPRODUCTION'?execution.inputTree:tree,files:Object.freeze({'sample.txt':'tiny public fixture\n'})}),lease=Object.freeze({source}),w={},key='public-phase';
 const verificationKeys=new WeakMap([[w,new Map([[key,'open']])]]),verificationLeases=new WeakMap([[lease,{w,key,binding:original.binding,digest:createHash('sha256').update(JSON.stringify(source)).digest('hex'),phase:f.phase}]]),inputPhases=new WeakMap([[lease,original]]);
 const controls=compileBody('const controls={'+['verificationClose','verificationAccept','verificationReject'].map(name=>preparationNode(name,'method')).join(',')+'};',{
  verificationKeys,verificationLeases,verificationInputHold,verificationInputFence,verificationInputFailure,budget:deadline=>{if(performance.now()>=deadline)verificationInputHold()},verificationOwner:()=>w,verificationSelection:()=>({key,tree:source.tree,commit:source.commit}),hash:value=>createHash('sha256').update(value).digest('hex')},'return controls;');
 const unused=()=>{throw Error('No native/source operation in pure outer witness')};
 const producer={context:unused,assertProgress:unused,checkpoint:unused,commitCandidate:unused,verificationBasis:raw,snapshot:()=>execution,assertVerificationInputReady:()=>{raw(actualRun,{kind:'ENTRY'})},prepareVerificationInput:async()=>lease};
 producer.closeVerificationInput=compileBody('const '+preparationNode('verificationBasis','variable')+';const '+preparationNode('closeVerificationInput','variable')+';',{
  originalVerificationBasis:raw,producer,inputPhases,controls,verificationInputFence,verificationInputHold,verificationInputFailure,budget:deadline=>{if(performance.now()>=deadline)verificationInputHold()}},'return closeVerificationInput;');
 const controller=new AbortController(),authority=()=>{if(race==='callback'&&phaseReads===9&&!mutated)mutate()},gateway={assertCurrentConnection:authority,beginCompletion:unused,assertCompleted:unused},active={controller,gateway,assertCurrentConnection:authority};
 const check={command,status:kind==='REPRODUCTION'?'failed':'passed',candidateCommit:kind==='REPRODUCTION'?input:candidate,candidateTree:source.tree,exitCode:kind==='REPRODUCTION'?1:0,startedAt:'2026-10-28T00:00:00Z',finishedAt:'2026-10-28T00:00:01Z',logPath:'/unused-public',reason:null};
 const result={exportStatus:'ready',manifestPath:'/unused-public',reason:null,checks:kind==='FINAL'?[check,{...check,logPath:'/unused-public-2'}]:[check]};
 const dependencies={runCodex:()=>{},verifyCandidate:async()=>result,verifyWorkspaceTree:async()=>result},checks=[];
 const storage={getRun:()=>structuredClone(actualRun),getWorkOrder:()=>structuredClone(actualWork),listEvents:()=>structuredClone(events),listChecks:()=>structuredClone(checks),transaction:fn=>fn(),
  appendEvent:input=>{writes++;const e={...input,id:events.at(-1).id+1,createdAt:'2026-10-28T00:00:00Z'};events.push(e);return structuredClone(e)},insertCheck:input=>{writes++;const c={...input,id:'public-check-'+checks.length};checks.push(c);return structuredClone(c)}};
 const readFile=async()=>{reads++;if(race==='log'&&(kind!=='FINAL'||reads===2))queueMicrotask(mutate);return'public baseline\n'};
 let begin,end;if(kind==='IMPLEMENTATION'){begin=jobsText.indexOf('const implementationPhase=');end=jobsText.indexOf("if(signal.aborted)throw Error('Run interrupted during implementation checkpoint')",begin)}
 else if(kind==='REPRODUCTION'){begin=jobsText.indexOf('const reproductionPhase=');end=jobsText.indexOf('if (signal.aborted) throw new Error("Run interrupted during reproduction")',begin)}
 else{begin=jobsText.indexOf('const finalPhase=');end=jobsText.indexOf('const evidenceBinding:',begin)}assert(begin>0&&end>begin);
 const fragment=jobsText.slice(begin,end),code='class Probe{#active=new Map();constructor(){this.#active.set(run.workOrderId,active);this.storage=storage;this.producer=producer;this.dependencies=dependencies;this.trustedFixtureVerification=true;this.notify=()=>{};}#event(workOrderId,runId,type,payload){return this.storage.appendEvent({workOrderId,runId,type,payload})}\n'+['#strictConnectedCompletion','#verificationControl','#verificationWriteFence','#verifySource'].map(member).join('\n')+'\nasync invoke(){const connected=this.#strictConnectedCompletion(run,active),verificationControl=this.#verificationControl(run,active,controller,connected),currentConnection=()=>verificationControl();'+fragment+'return true;}}';
 const Type=compileBody(code,{run:actualRun,workOrder:actualWork,productiveStep:1,agentResult:{id:2},settlement:{id:3},strictCheckpoint:true,snapshot:execution,checkpointFrame:{productiveStep:1,agentResultEventId:2,settlementEventId:3},checkedTree:tree,artifactDir:'/unused-public',signal:controller.signal,active,controller,producer,dependencies,storage,verificationInputHold,verificationInputFence,verificationInputFailure,requireStrictSourceOperations,contextPolicyKind,finalizationPolicyFailure,runCodex:unused,verifyCandidate:unused,verifyWorkspaceTree:unused,digest,readFile,createHash,candidate:{commit:candidate},reproductionStarted:{id:2},candidateEvent:[{id:f.phase.candidateEventId}],verificationCommands:[command],join:(...a)=>a.join('/')},'return Probe;');
 return{instance:new Type(),get writes(){return writes},get mutated(){return mutated},get leaseState(){return verificationKeys.get(w).get(key)}};
}
for(const kind of ['REPRODUCTION','IMPLEMENTATION','FINAL'])for(const race of ['stable','close','callback',...(kind==='IMPLEMENTATION'?[]:['log'])])test('input outer original-phase fence '+kind+' after '+race+' last await',async()=>{const f=phaseWriteFixture(kind,race);if(race==='stable'){assert.equal(await f.instance.invoke(),true);assert(f.writes>0);assert.equal(f.leaseState,'consumed')}else{await assert.rejects(f.instance.invoke(),{code:'local_verification_input_hold'});assert.equal(f.writes,0);assert.equal(f.mutated,true);assert.equal(f.leaseState,'uncertain')}});
function writeChainFixture(){
 const rows=[row(1,'run.candidate_committed')],checks=[];let current=true,notifier=()=>{},transactionDepth=0,seedDepth=null;const saved={...run,state:'verifying'},order={...work,state:'verifying'},snapshot={...execution};
 const storage={getRun:()=>structuredClone(saved),getWorkOrder:()=>structuredClone(order),listEvents:()=>structuredClone(rows),listChecks:()=>structuredClone(checks),transaction:fn=>{transactionDepth++;try{return fn()}finally{transactionDepth--}},appendEvent:input=>{const e={...input,id:rows.at(-1).id+1,createdAt:'2026-10-28T00:00:00Z'};rows.push(e);return structuredClone(e)},insertCheck:input=>{const c={...input,id:'public-known-'+checks.length};checks.push(c);checks.sort((a,b)=>a.startedAt<b.startedAt?-1:a.startedAt>b.startedAt?1:0);return structuredClone(c)}};
 const producer={snapshot:()=>structuredClone(snapshot)},code='class Probe{constructor(){this.storage=storage;this.producer=producer;this.notify=notify;}#event(){throw Error("No legacy event")}\n'+member('#verificationWriteFence')+'\ninvoke(){return this.#verificationWriteFence(run,current,sourcePhase)}}';
 const Type=compileBody(code,{storage,producer,notify:e=>notifier(e),run:saved,current:()=>{if(!current)verificationInputFence(()=>{throw Error('Actual authority denied')})},sourcePhase:()=>{seedDepth=transactionDepth},digest,verificationInputHold,verificationInputFailure,verificationInputFence},'return Probe;');
 return{fence:new Type().invoke(),rows,checks,saved,order,snapshot,get seedDepth(){return seedDepth},revoke:()=>current=false,notify:fn=>notifier=fn};
}
test('input final write chain advances exact own checks/events without recapturing latest stream',async()=>{const f=writeChainFixture();f.fence.check({runId:run.id,candidateCommit:candidate,command,status:'passed',exitCode:0,startedAt:'2026-10-28T00:00:00Z',finishedAt:'2026-10-28T00:00:01Z',logPath:'/unused',logSha256:'a'.repeat(64)});f.fence.event('run.check_completed',{checkId:'public-known-0'});await Promise.resolve();assert.equal(f.fence.assertCurrent(),undefined);f.fence.event('run.evidence_collected',{public:true});await Promise.resolve();assert.equal(f.fence.assertCurrent(),undefined);assert.equal(f.rows.length,3);assert.equal(f.checks.length,1)});
for(const change of ['foreign event','changed event','missing event','foreign check','run','work','source','authority'])test('input final write chain denies '+change+' after deferred boundary without reseeding',async()=>{const f=writeChainFixture();f.fence.event('run.check_completed',{public:true});await Promise.resolve();if(change==='foreign event')f.rows.push(row(99,'run.agent_result'));if(change==='changed event')f.rows[0].payload.changed=true;if(change==='missing event')f.rows.pop();if(change==='foreign check')f.checks.push({id:'foreign'});if(change==='run')f.saved.attemptNumber++;if(change==='work')f.order.title='foreign';if(change==='source')f.snapshot.sourceDigest='foreign';if(change==='authority')f.revoke();assert.throws(f.fence.assertCurrent);const before=f.rows.length;assert.throws(()=>f.fence.event('run.evidence_evaluated',{status:'SATISFIED'}));assert.equal(f.rows.length,before)});
test('input final write chain cannot adopt a foreign row during notification',()=>{const f=writeChainFixture();f.notify(()=>f.rows.push(row(99,'run.agent_result')));assert.throws(()=>f.fence.event('run.check_completed',{public:true}),{code:'local_verification_input_hold'});assert.throws(f.fence.assertCurrent,{code:'local_verification_input_hold'})});
for(const variant of ['missing receipt','async receipt','nonvoid receipt','actual denial'])test('input outer phase requires synchronous-void original close receipt: '+variant,async()=>{
 const actualError=Error('Actual phase authority denied'),source={runId:run.id,workOrderId:run.workOrderId,commit:candidate,tree,files:{}},phaseFence={assertCurrent:()=>{throw Error('No installed phase receipt')}};
 const receipt=variant==='missing receipt'?undefined:variant==='async receipt'?async()=>{}:variant==='nonvoid receipt'?()=>true:()=>{throw actualError};
 const producer={prepareVerificationInput:async()=>({source}),closeVerificationInput:async()=>receipt},dependencies={verifyCandidate:async()=>({checks:[]}),verifyWorkspaceTree:async()=>{throw Error('Unused tree')}};
 const code='class Probe{constructor(){this.producer=producer;this.dependencies=dependencies;}\n'+member('#verifySource')+'\nasync invoke(){await this.#verifySource(run,()=>{},{kind:"FINAL",candidateEventId:1},"candidate",{candidateSha:candidate,commands:["public-check"]},phaseFence);phaseFence.assertCurrent()}}';
 const Type=compileBody(code,{run,candidate,producer,dependencies,phaseFence,verificationInputHold,verificationInputFence,verificationInputFailure},'return Probe;');
 if(variant==='actual denial')await assert.rejects(new Type().invoke(),error=>error===actualError);else await assert.rejects(new Type().invoke(),{code:'local_verification_input_hold'});
});

test('input first original phase/cut/known event share the same metadata transaction',()=>{const f=writeChainFixture();assert.equal(f.seedDepth,null);f.fence.event('run.check_completed',{public:true});assert.equal(f.seedDepth,1);assert.equal(f.rows.length,2)});
test('input first original phase/cut/known check share the same metadata transaction',()=>{const f=writeChainFixture();f.fence.check({runId:run.id,candidateCommit:candidate,command,status:'passed',exitCode:0,startedAt:'2026-10-28T00:00:00Z',finishedAt:'2026-10-28T00:00:01Z',logPath:'/unused',logSha256:'a'.repeat(64)});assert.equal(f.seedDepth,1);assert.equal(f.checks.length,1)});
for(const denied of[false,true])test('input verification-triggered transition checks current cut inside its existing transaction '+denied,()=>{
 let depth=0,writes=0;const storage={transaction:fn=>{depth++;try{return fn()}finally{depth--}},saveRun:()=>writes++,getWorkOrder:()=>work,saveWorkOrder:()=>writes++,appendEvent:()=>{writes++;return row(1,'run.verification_failed')}};
 const code='class Probe{constructor(){this.storage=storage;this.notify=()=>{}}\n'+member('#transition')+'\ninvoke(){return this.#transition(run,"failed","failed","run.verification_failed",{},{},fence)}}';
 const Type=compileBody(code,{storage,run,verificationInputFence,fence:()=>{assert.equal(depth,1);if(denied)verificationInputHold()}},'return Probe;');
 if(denied){assert.throws(()=>new Type().invoke(),{code:'local_verification_input_hold'});assert.equal(writes,0)}else{assert.equal(new Type().invoke().state,'failed');assert.equal(writes,3)}
});

test('input seed denies an unexpected preexisting check instead of adopting latest rows',()=>{const f=writeChainFixture();f.checks.push({id:'foreign-check'});assert.throws(()=>f.fence.event('run.check_completed',{public:true}),{code:'local_verification_input_hold'});assert.equal(f.rows.length,1)});
const producerText=readFileSync(new URL('../src/producer-results.ts',import.meta.url),'utf8'),producerAst=ts.createSourceFile('producer.ts',producerText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),producerClass=producerAst.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='LocalProducerResultsV4'),verificationBasisMethod=producerClass.members.find(n=>n.name?.getText(producerAst)==='verificationBasis').getText(producerAst);
function originalBasisFixture(){
 const f=chain(),events=structuredClone(f.events),checks=[],admission={public:'inert-admission'},storage={getWorkOrder:()=>f.work,listEvents:()=>structuredClone(events),listChecks:()=>structuredClone(checks)};
 const code='class Probe{constructor(){this.storage=storage;}admissionRun(){return run}retainedAdmission(){return {admission,execution}}snapshot(){return execution}\n'+verificationBasisMethod+'}';
 const Type=compileBody(code,{storage,run:f.run,admission,execution,localAdmissionJson:structuredClone,canonical:JSON.stringify,readCurrentProducerSourceIdentity:()=>execution.sourceDigest,selectVerificationInputPhase,verificationInputHold,verificationInputFailure,digest},'return Probe;');return{instance:new Type(),f,events,checks};
}
test('input actual raw basis binds the complete Work event stream including other Run rows',()=>{const f=originalBasisFixture(),before=f.instance.verificationBasis(f.f.run,f.f.phase);f.events.push({...row(99,'run.agent_result'),runId:'other-run'});const after=f.instance.verificationBasis(f.f.run,f.f.phase);assert.notEqual(before.binding,after.binding)});
test('input actual raw source phase rejects preexisting current-Run checks',()=>{const f=originalBasisFixture();f.checks.push({id:'foreign'});assert.throws(()=>f.instance.verificationBasis(f.f.run,f.f.phase),{code:'local_verification_input_hold'})});
test('input actual raw ENTRY can observe known check rows and binds their exact data',()=>{const f=originalBasisFixture(),before=f.instance.verificationBasis(f.f.run,{kind:'ENTRY'});f.checks.push({id:'public-known'});const after=f.instance.verificationBasis(f.f.run,{kind:'ENTRY'});assert.notEqual(before.binding,after.binding)});

test('input final write uncertainty remains denied even if inert metadata is restored',()=>{const f=writeChainFixture();f.fence.event('run.check_completed',{public:true});f.rows.push(row(99,'run.agent_result'));assert.throws(f.fence.assertCurrent,{code:'local_verification_input_hold'});f.rows.pop();assert.throws(f.fence.assertCurrent,{code:'local_verification_input_hold'});const before=f.rows.length;assert.throws(()=>f.fence.event('run.evidence_evaluated',{}),{code:'local_verification_input_hold'});assert.equal(f.rows.length,before)});
