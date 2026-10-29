// Tiny public data/control-flow only; no native worker, private suite or guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {selectFinalizationPhase,planFinalizationCommit,finalizationPolicyFailure} from '../src/local-v4-finalization-policy.ts';
import {checkpointIdentity} from '../src/local-v4-checkpoint-policy.ts';
import {requireStrictSourceOperations,contextPolicyKind,contextPolicyFailure} from '../src/local-v4-context-policy.ts';
import {createLocalV4Preparation,bindLocalV4PreparationCapture} from '../src/local-v4-preparation.ts';
const tree='1'.repeat(40),input='2'.repeat(40),command='public-check';
const run={id:'public-run',workOrderId:'public-work',inputCommit:input,workspacePath:'/public-unused',attemptNumber:1};
const execution={version:4,inputTree:'3'.repeat(40),sourceDigest:'public-source',configurationDigest:'public-config',configuration:{commands:[command]}};
const identity=checkpointIdentity(run,execution);
const row=(id,type,payload={})=>({id,type,payload,runId:run.id,workOrderId:run.workOrderId,createdAt:'2026-10-28T00:00:00Z'});
function fixture(step=1){
 const events=[row(1,'run.implementing')];let next=2,last;
 for(let n=1;n<=step;n++){
  const result=row(next++,'run.agent_result',{checkpointVersion:1,productiveStep:n,implementationEligible:true});events.push(result);
  const settled=row(next++,'run.implementation_settled',{checkpointVersion:1,productiveStep:n,agentResultEventId:result.id,...identity,provenance:'TRUSTED_IN_PROCESS_CALLBACK_RETURNED'});events.push(settled);
  last=row(next++,'run.implementation_checkpoint',{checkpointVersion:1,contextVersion:1,productiveStep:n,agentResultEventId:result.id,settlementEventId:settled.id,
   tree,passed:n===step,exportStatus:'ready',checks:[{command,status:n===step?'passed':'failed'}]});events.push(last);
  if(n<step)events.push(row(next++,'run.productive_repair_admitted',{contextVersion:1,productiveStep:2,checkpointEventId:last.id,checkedTree:tree}));
 }
 const closed=row(next++,'run.productive_closed',{contextVersion:1,checkpointEventId:last.id,productiveStep:step,tree});events.push(closed);
 const started=row(next++,'run.completion_started',{phase:'completion',contextVersion:1,checkpointEventId:last.id,productiveClosedEventId:closed.id,productiveStep:step});events.push(started);
 const links={productiveStep:step,checkpointEventId:last.id,productiveClosedEventId:closed.id,completionStartedEventId:started.id};
 const result=row(next++,'run.completion_result',{finalizationVersion:1,completionEligible:true,status:'completed',...links});events.push(result);
 const settled=row(next++,'run.finalization_settled',{finalizationVersion:1,...links,completionResultEventId:result.id,expectedTree:tree,...identity,
  provenance:'TRUSTED_IN_PROCESS_COMPLETION_RETURNED',completionProcessEventId:null});events.push(settled);
 return {events,phase:{kind:'FINALIZE',...links,completionResultEventId:result.id,settlementEventId:settled.id,expectedTree:tree}};
}
const select=f=>selectFinalizationPhase(f.events,f.phase,run,execution);
for(const step of [1,2])test('final phase data: exact first/repair composition step'+step,()=>{const f=fixture(step);assert.equal(select(f).context.tree,tree);assert.equal(select(f).productive.at(-1).id,f.phase.checkpointEventId)});
for(const type of ['run.agent_result','run.implementation_settled','run.implementation_checkpoint','run.productive_repair_admitted',
 'agent.process_started','agent.turn.completed','run.completion_result','run.finalization_settled','run.candidate_committed','factory.stop_requested'])test('full stream: later '+type+' cannot hide behind projections',()=>{
 const f=fixture(2);f.events.push(row(40,type,{...f.events.at(-1).payload}));assert.throws(()=>select(f),{code:'local_finalization_hold'});
});
for(const variant of ['missing final row','foreign envelope','wrong root','wrong link','ineligible','pre-result settlement','missing result','wrong synthetic identity','extra frame field'])test('final phase data refuses '+variant,()=>{
 const f=fixture(),settled=f.events.at(-1),result=f.events.at(-2);
 if(variant==='missing final row')f.events.pop();if(variant==='foreign envelope')settled.runId='other';if(variant==='wrong root')settled.payload.expectedTree=input;
 if(variant==='wrong link')result.payload.checkpointEventId=99;if(variant==='ineligible')result.payload.completionEligible=false;
 if(variant==='pre-result settlement'){settled.id=result.id-1;f.events.sort((a,b)=>a.id-b.id)}
 if(variant==='missing result')f.events=f.events.filter(e=>e!==result);if(variant==='wrong synthetic identity')settled.payload.completionProcessEventId=99;
 if(variant==='extra frame field')f.phase.nativeReady=true;assert.throws(()=>select(f),{code:'local_finalization_hold'});
});
test('commit plan data: one original parent, exact tree and fixed actor produce canonical typed bytes',()=>{
 const p=planFinalizationCommit(input,tree,'2026-10-28T00:00:00Z');assert.equal(p.commit,createHash('sha1').update('commit '+p.bytes.length+'\0').update(p.bytes).digest('hex'));
 assert.match(p.bytes.toString(),new RegExp('^tree '+tree+'\\nparent '+input+'\\nauthor Local Factory <factory@localhost\\.invalid> [0-9]+ \\+0000\\ncommitter Local Factory'));
 assert.equal((p.bytes.toString().match(/^parent /mg)??[]).length,1);assert(p.bytes.length<65536);
});
for(const at of ['bad','',null])test('commit plan data: invalid host time refuses '+at,()=>assert.throws(()=>planFinalizationCommit(input,tree,at),{code:'local_finalization_hold'}));
for(const version of [null,1,2,3,4])for(const marker of ['candidateBasis','commitCandidate'])test('strict final seam: '+marker+' with '+version+' cannot downgrade',()=>{
 assert.throws(()=>requireStrictSourceOperations(version===null?null:{version},{[marker](){}}),{code:'local_context_hold'});
});
test('actual final binder: raw basis private, missing original snapshot refuses before basis/native',()=>{
 let calls=0;const bound=bindLocalV4PreparationCapture(createLocalV4Preparation('/public-no-native-finalizer'),{
  snapshot(){return null},capture(){throw Error('No capture')},read(){throw Error('No read')},finalize(){throw Error('No sign')},candidateBasis(){calls++;throw finalizationPolicyFailure(null)},
 });assert.equal(Object.hasOwn(bound,'candidateBasis'),false);assert.equal(typeof bound.commitCandidate,'function');assert.throws(()=>requireStrictSourceOperations(null,bound),{code:'local_context_hold'});assert.equal(calls,0);
});
const source=readFileSync(new URL('../src/jobs.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('jobs.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='JobManager'),member=name=>cls.members.find(n=>n.name?.getText(ast)===name).getText(ast);
function finalWrapper(){
 let resolve,calls=0;const pending=new Promise(done=>resolve=done),controller=new AbortController(),active={controller};
 const phase=fixture().phase,producer={assertVerificationInputReady(){throw Error('Unused input readiness in source fixture')},prepareVerificationInput(){throw Error('Unused input preparation in source fixture')},closeVerificationInput(){throw Error('Unused input close in source fixture')},snapshot:()=>({version:4}),context(){},assertProgress(){},checkpoint(){},commitCandidate:async(_run,_phase,fence)=>{calls++;fence();await pending;fence();return {commit:input,tree,diffPath:'/public-unused.patch',diffSha256:'a'.repeat(64),changedPaths:['sample.txt']}}};
 const code='class Probe {#active=new Map();constructor(){this.producer=producer;this.#active.set(run.workOrderId,active)} assertActive(){}\n'+member('#checkpointActive')+'\n'+member('#finalizationActive')+'\n'+member('#finalCandidate')+'\ninvoke(){return this.#finalCandidate(run,active,controller,phase,()=>{})}}';
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const Type=new Function('producer','active','controller','phase','run','finalizationPolicyFailure','checkpointPolicyFailure','requireStrictSourceOperations',js+'\nreturn Probe;')(producer,active,controller,phase,run,finalizationPolicyFailure,finalizationPolicyFailure,requireStrictSourceOperations);
 return {instance:new Type(),producer,active,controller,resolve:()=>resolve(),get calls(){return calls}};
}
for(const variant of ['unchanged','abort','replace controller'])test('actual fixed final wrapper: pending '+variant+' cannot return stale candidate',async()=>{
 const f=finalWrapper(),p=f.instance.invoke();assert.equal(f.calls,1);if(variant==='abort')f.controller.abort();if(variant==='replace controller')f.active.controller=new AbortController();f.resolve();
 if(variant==='unchanged')assert.equal((await p).commit,input);else await assert.rejects(p,{code:'local_finalization_hold'});
});
test('actual fixed final wrapper: null returned data is HOLD, never ambient fallback',async()=>{
 const f=finalWrapper();f.producer.commitCandidate=async()=>null;await assert.rejects(f.instance.invoke(),{code:'local_finalization_hold'});
});
// Exact strict assertion/control-flow fragment; inert guard and event counters only.
let fragment;
function findAssertion(node){if(ts.isIfStatement(node)&&node.expression.getText(ast)==='strictCheckpoint'&&node.thenStatement.getText(ast).includes('typeof active.gateway.assertCompleted'))fragment='if (strictCheckpoint) '+node.thenStatement.getText(ast);ts.forEachChild(node,findAssertion)}
findAssertion(cls);assert(fragment);
for(const variant of ['void','missing','throw','promise','nonvoid'])test('exact strict completion assertion: '+variant,async()=>{
 let events=0,guards=0;const snapshot={version:4,...execution},gateway=variant==='missing'?{}:{assertCompleted(){if(variant==='throw')throw Error('Unsettled');if(variant==='promise')return Promise.resolve();if(variant==='nonvoid')return true;}};
 const deps={strictCheckpoint:true,currentConnection:()=>{},connectedCompletion:()=>{},run,active:{gateway},controller:new AbortController(),completionLinks:{productiveStep:1,checkpointEventId:4,productiveClosedEventId:5,completionStartedEventId:6},completionResult:{id:7},completionStarted:{id:6},checkedTree:tree,
  workOrder:{id:run.workOrderId},runCodex:()=>{},processGroupAbsent:()=>{guards++;throw Error('No native guard permitted')},checkpointIdentity,finalizationPolicyFailure};
 const code='class Probe {#finalizationActive(){} #event(){event();return {id:8}} constructor(){this.dependencies={runCodex:()=>{}};this.producer={snapshot:()=>snapshot};this.storage={listEvents:()=>[]}} async invoke(){let finalizationPhase;'+fragment+' return finalizationPhase;}}';
 const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const Actual=new Function(...Object.keys(deps),'snapshot','event',js+'\nreturn Probe;')(...Object.values(deps),snapshot,()=>{events++});
 if(variant==='void'){assert.equal((await new Actual().invoke()).kind,'FINALIZE');assert.equal(events,1)}else{await assert.rejects(new Actual().invoke(),{code:'local_finalization_hold'});assert.equal(events,0)}assert.equal(guards,0);
});

// Actual strict connected identity + actual source/selector boundaries. Every
// target throws; no returned candidate data or native execution is possible.
function connectedProbe(version,gateway,{hold=false}={}){
 let sources=0,fixed=0,legacy=0,sourceLegacy=0,release,entered;
 const sourceEntered=new Promise(done=>entered=done),paused=new Promise(done=>release=done);
 const producer={assertVerificationInputReady(){throw Error('Unused input readiness in source fixture')},prepareVerificationInput(){throw Error('Unused input preparation in source fixture')},closeVerificationInput(){throw Error('Unused input close in source fixture')},snapshot:()=>version===null?null:{version},context:async()=>{sources++;entered();if(hold)await paused;return 'public-data'},assertProgress(){},checkpoint(){},commitCandidate(){}};
 const active={gateway},members={};function collect(n){if(ts.isVariableDeclaration(n)&&['connectedCompletion','strictFinalization','context','fixedCandidate','candidate'].includes(n.name.getText(ast)))members[n.name.getText(ast)]=n.initializer.getText(ast);ts.forEachChild(n,collect)}collect(cls);
 for(const name of ['connectedCompletion','strictFinalization','context','fixedCandidate','candidate'])assert(members[name]);
 const code='class Probe {constructor(){this.producer=producer;this.dependencies={commitCandidate(){count.legacy++;throw Error("inert legacy boundary")}}} assertActive(){}\n'+member('#strictConnectedCompletion')+'\n'+member('#sourceContext')+'\nasync #finalCandidate(){count.fixed++;throw Error("inert fixed boundary")}\nasync invoke(){let finalizationPhase={};const connectedCompletion='+members.connectedCompletion+';const strictFinalization='+members.strictFinalization+';const currentConnection=()=>connectedCompletion?.();connectedCompletion?.();const context='+members.context+';connectedCompletion?.();const fixedCandidate='+members.fixedCandidate+';connectedCompletion?.();const candidate='+members.candidate+';return candidate;}}';
 const count={fixed:0,legacy:0};const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const Type=new Function('producer','active','run','controller','workOrder','artifactDir','checkedTree','count','requireStrictSourceOperations','contextPolicyFailure','finalizationPolicyFailure','contextPolicyKind','executionContext',js+'\nreturn Probe;')(
  producer,active,run,new AbortController(),{allowedPaths:['sample.txt']},'/unused',tree,count,requireStrictSourceOperations,contextPolicyFailure,finalizationPolicyFailure,contextPolicyKind,()=>{sourceLegacy++;throw Error('No ambient source allowed')});
 return {active,instance:new Type(),sourceEntered,release:()=>release(),get sources(){return sources},get fixed(){return count.fixed},get legacy(){return count.legacy},get sourceLegacy(){return sourceLegacy}};
}
const completeGateway=()=>({beginCompletion(){},assertCompleted(){}});
test('connected composition: original complete V4 selects fixed boundary',async()=>{
 const f=connectedProbe(4,completeGateway());await assert.rejects(f.instance.invoke(),/inert fixed boundary/);assert.equal(f.sources,1);assert.equal(f.fixed,1);assert.equal(f.legacy,0);
});
for(const hook of ['beginCompletion','assertCompleted'])for(const value of [undefined,null,true])test('connected composition: present gateway '+hook+'='+String(value)+' refuses before source/model/finalizer',async()=>{
 const gateway=completeGateway();gateway[hook]=value;const f=connectedProbe(4,gateway);await assert.rejects(f.instance.invoke(),{code:'local_finalization_hold'});assert.equal(f.sources,0);assert.equal(f.fixed,0);assert.equal(f.legacy,0);assert.equal(f.sourceLegacy,0);
});
test('connected composition: null gateway is not original absence',async()=>{
 const f=connectedProbe(4,null);await assert.rejects(f.instance.invoke(),{code:'local_finalization_hold'});assert.equal(f.sources,0);assert.equal(f.legacy,0);
});
for(const variant of ['remove gateway','replace gateway','remove hook','replace hook','remove assertion','replace assertion'])test('connected composition: original identity survives deferred '+variant,async()=>{
 const gateway=completeGateway(),f=connectedProbe(4,gateway,{hold:true}),pending=f.instance.invoke();await f.sourceEntered;
 if(variant==='remove gateway')f.active.gateway=undefined;if(variant==='replace gateway')f.active.gateway=completeGateway();
 if(variant==='remove hook')delete gateway.beginCompletion;if(variant==='replace hook')gateway.beginCompletion=()=>{};
 if(variant==='remove assertion')delete gateway.assertCompleted;if(variant==='replace assertion')gateway.assertCompleted=()=>{};
 f.release();await assert.rejects(pending,{code:'local_finalization_hold'});assert.equal(f.sources,1);assert.equal(f.fixed,0);assert.equal(f.legacy,0);assert.equal(f.sourceLegacy,0);
});
test('connected composition: genuinely absent original gateway preserves separate Cfixture path',async()=>{
 const f=connectedProbe(4,undefined);await assert.rejects(f.instance.invoke(),/inert legacy boundary/);assert.equal(f.sources,0);assert.equal(f.fixed,0);assert.equal(f.legacy,1);
});
