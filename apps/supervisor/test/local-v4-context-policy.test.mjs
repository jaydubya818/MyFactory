// Tiny public pure data only. No native object manipulation, workload, hidden
// criteria, source execution, provider, paid operation or financial authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as contextPolicy from '../src/local-v4-context-policy.ts';
import {createLocalV4Preparation,bindLocalV4PreparationCapture} from '../src/local-v4-preparation.ts';
import {selectContextPhase,sourceContext,liveProgressPaths} from '../src/local-v4-context-policy.ts';
import {validateLocalV4TextTree,validateLocalV4RootTextTree} from '../src/local-v4-text-tree.ts';
const tree='1'.repeat(40),other='2'.repeat(40),command='synthetic-check';
const event=(id,type,payload={})=>({id,type,payload,runId:'public-pure-run',workOrderId:'public-pure-work',createdAt:'2026-10-28T00:00:00Z'});
const checkpoint=(id,step,passed,root=tree)=>event(id,'run.implementation_checkpoint',{contextVersion:1,productiveStep:step,tree:root,exportStatus:'ready',passed,checks:[{command,status:passed?'passed':'failed'}]});
function phaseFixture(repair=false){
 const events=[event(1,'run.implementing')];let id=2;
 if(repair){events.push(checkpoint(id++,1,false,other));events.push(event(id++,'run.productive_repair_admitted',{contextVersion:1,productiveStep:2,checkpointEventId:2,checkedTree:other}))}
 const step=repair?2:1,cp=checkpoint(id++,step,true);events.push(cp);
 const closed=event(id++,'run.productive_closed',{contextVersion:1,checkpointEventId:cp.id,productiveStep:step,tree});events.push(closed);
 const started=event(id++,'run.completion_started',{contextVersion:1,checkpointEventId:cp.id,productiveClosedEventId:closed.id,productiveStep:step,phase:'completion'});events.push(started);
 return {events,phase:{kind:'COMPLETION',checkpointEventId:cp.id,productiveClosedEventId:closed.id,completionStartedEventId:started.id,productiveStep:step,tree}};
}
test('context phase data: initial is the actual input with no checkpoint or completion history',()=>{
 const value=selectContextPhase([event(1,'run.implementing')],{kind:'INITIAL'},[command]);assert.equal(value.tree,null);assert.equal(value.checkpointEventId,null);
 assert.throws(()=>selectContextPhase([event(1,'run.implementing'),checkpoint(2,1,false)],{kind:'INITIAL'},[command]),{code:'local_context_hold'});
});
test('context phase data: repair reads the failed available checkpoint before future repair admission',()=>{
 const events=[event(1,'run.implementing'),checkpoint(2,1,false)],phase={kind:'REPAIR',checkpointEventId:2,productiveStep:1,tree};
 assert.equal(selectContextPhase(events,phase,[command]).checkpointEventId,2);
 events.push(event(3,'run.productive_repair_admitted',{contextVersion:1,productiveStep:2,checkpointEventId:2,checkedTree:tree}));
 assert.throws(()=>selectContextPhase(events,phase,[command]),{code:'local_context_hold'});
});
for(const repair of [false,true])test('context phase data: exact '+(repair?'second':'first')+' productive completion joins all actual numeric rows',()=>{
 const f=phaseFixture(repair),result=selectContextPhase(f.events,f.phase,[command]);assert.equal(result.tree,tree);assert.equal(result.productiveStep,repair?2:1);assert.equal(result.checkpointEventId,f.phase.checkpointEventId);
});
for(const [name,change] of [
 ['duplicate checkpoint',f=>f.events.splice(2,0,{...f.events[1]})],
 ['stale closed join',f=>f.events.find(e=>e.type==='run.productive_closed').payload.checkpointEventId=999],
 ['stale phase join',f=>f.phase.checkpointEventId=999],
 ['completion before closed',f=>f.events.find(e=>e.type==='run.completion_started').id=1],
 ['unavailable checkpoint',f=>f.events.find(e=>e.type==='run.implementation_checkpoint').payload.exportStatus='unavailable'],
 ['unavailable check',f=>f.events.find(e=>e.type==='run.implementation_checkpoint').payload.checks[0].status='unavailable'],
 ['wrong configured command',f=>f.events.find(e=>e.type==='run.implementation_checkpoint').payload.checks[0].command='different'],
 ['wrong tree',f=>f.phase.tree=other],
 ['missing source version',f=>delete f.events.find(e=>e.type==='run.implementation_checkpoint').payload.contextVersion],
 ['completion result already exists',f=>f.events.push(event(7,'run.completion_result'))],
 ['candidate already committed',f=>f.events.push(event(7,'run.candidate_committed'))],
 ['current cancellation',f=>f.events.push(event(7,'run.cancel_requested'))],
 ['current stop',f=>f.events.push(event(7,'factory.stop_requested'))],
 ['recovery hold',f=>f.events.push(event(7,'run.recovery_hold'))],
 ['string id is not actual rowid',f=>f.phase.checkpointEventId='2'],
 ['fabricated extra phase field',f=>f.phase.root='arbitrary'],
])test('context phase data: '+name+' cannot select a current tree',()=>{
 const f=phaseFixture();change(f);assert.throws(()=>selectContextPhase(f.events,f.phase,[command]),{code:'local_context_hold'});
});
test('context phase data: second completion refuses an unjoined repair record',()=>{
 const f=phaseFixture(true);f.events.find(e=>e.type==='run.productive_repair_admitted').payload.checkedTree=tree;
 assert.throws(()=>selectContextPhase(f.events,f.phase,[command]),{code:'local_context_hold'});
});
test('context phase data: live progress permits initial or the single admitted repair, never a completed or unjoined checkpoint',()=>{
 const f=phaseFixture(true),progress={kind:'PROGRESS'};
 selectContextPhase(f.events.slice(0,1),progress,[command]);selectContextPhase(f.events.slice(0,3),progress,[command]);
 for(const events of [f.events.slice(0,2),f.events.slice(0,4),f.events])assert.throws(()=>selectContextPhase(events,progress,[command]),{code:'local_context_hold'});
});

function basis(){return {execution:{inputCommit:'3'.repeat(40),inputTree:tree,configuration:{allowedPaths:['src/**','assets/','missing.txt']}},tree,checkpointEventId:null,productiveStep:null}}
test('context output data: exact selection, absent nulls and complete inventory remain bounded and truthful',()=>{
 const files={'src/main.ts':'code\n','assets/icon.txt':'icon','README.md':'guide','nested/README.txt':'nested guide','nested/package.json':'{}','test/check.mjs':'public check','tests/check.mjs':'public check2','other.txt':'not selected'};
 const result=JSON.parse(sourceContext(basis(),files));
 assert.deepEqual(result.inventory,Object.keys(files).sort());assert.equal(result.files['other.txt'],undefined);assert.equal(result.files['missing.txt'],null);
 for(const name of Object.keys(files).filter(name=>name!=='other.txt'))assert.equal(result.files[name],files[name]);
 assert.equal(result.base,'3'.repeat(40));assert.equal(result.tree,tree);assert.equal(result.basis.kind,'ADMITTED_INPUT');assert.equal(Buffer.byteLength(JSON.stringify(result))<65536,true);
});
test('context output data: actual safe numeric checkpoint ID is represented losslessly as decimal data',()=>{
 const b={...basis(),tree:other,checkpointEventId:Number.MAX_SAFE_INTEGER,productiveStep:2};
 const result=JSON.parse(sourceContext(b,{'src/main.ts':'data'}));assert.equal(result.basis.checkpointEventId,String(Number.MAX_SAFE_INTEGER));assert.equal(Number(result.basis.checkpointEventId),b.checkpointEventId);assert.equal(result.base,b.execution.inputCommit);assert.equal(result.tree,other);
});
test('context output data: unsafe keys, nontext and invented initial root refuse',()=>{
 for(const [b,files] of [[basis(),{'../escape':'x'}],[basis(),{'src/main.ts':'x\0'}],[basis(),{'src/main.ts':1}],[{...basis(),tree:other},{'src/main.ts':'x'}]])assert.throws(()=>sourceContext(b,files),{code:'local_context_hold'});
});
test('live progress data: current nonempty scope is required rather than a checkpoint claim',()=>{
 assert.deepEqual(liveProgressPaths(Buffer.from(' M src/main.ts\0?? test/new.mjs\0'),['src/**','test/']),['src/main.ts','test/new.mjs']);
 for(const raw of ['', ' M outside.txt\0',' M ../escape\0',' M src/.Git/config\0'])assert.throws(()=>liveProgressPaths(Buffer.from(raw),['src/**']),{code:'local_context_hold'});
});
test('live progress data: both renamed path fields require current allowed scope',()=>{
 assert.deepEqual(liveProgressPaths(Buffer.from('R  src/new.ts\0src/old.ts\0'),['src/**']),['src/new.ts','src/old.ts']);
 assert.throws(()=>liveProgressPaths(Buffer.from('R  src/new.ts\0outside.ts\0'),['src/**']),{code:'local_context_hold'});
});
test('pure shared root graph: direct root and actual-commit entry validate the same complete data without inventing an ID',async()=>{
 const hash=(kind,bytes)=>createHash('sha1').update(kind+' '+bytes.length+'\0').update(bytes).digest('hex'),objects=new Map();
 const put=(kind,bytes)=>{const b=Buffer.from(bytes),id=hash(kind,b);objects.set(id,{kind,bytes:b});return id};
 const blob=put('blob','ordinary\n'),raw=Buffer.concat([Buffer.from('100644 sample.txt\0'),Buffer.from(blob,'hex')]),root=put('tree',raw);
 const commit=put('commit','tree '+root+'\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nPure data\n');
 const read=async(kind,id,limit)=>{const value=objects.get(id);assert.equal(value.kind,kind);assert(value.bytes.length<=limit);return value.bytes};
 const deadline=performance.now()+30000,direct=await validateLocalV4RootTextTree(root,read,deadline),full=await validateLocalV4TextTree(commit,read,deadline);
 assert.deepEqual(direct.files,full.files);assert.equal(direct.inputTree,full.inputTree);assert.equal(Object.hasOwn(direct,'inputCommit'),false);assert.equal(full.inputCommit,commit);
 await assert.rejects(validateLocalV4RootTextTree(root,read,performance.now()-1),/TEXT_INPUT_REFUSED/);
});

// Exercise the actual private call sites with type annotations erased only.
// Ambient helpers are inert counters, so refusals cannot accidentally touch Git.
function classSource(name,file){
 const text=readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const declaration=ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name.text===name);
 return {ast,declaration,member:key=>declaration.members.find(node=>node.name?.getText(ast)===key)?.getText(ast)};
}
const jobsSource=classSource('JobManager','jobs.ts'),localSource=classSource('LocalExecutionProvider','local-execution-provider.ts'),dispatchSource=classSource('FactoryDispatchControl','dispatch-control.ts');
const progressCallbacks=[];
function findCallbacks(node){if(ts.isPropertyAssignment(node)&&node.name.getText(dispatchSource.ast)==='assertImplementationProgress')progressCallbacks.push(node.initializer.getText(dispatchSource.ast));ts.forEachChild(node,findCallbacks)}
findCallbacks(dispatchSource.declaration);assert.equal(progressCallbacks.length,2);
function probe(source,deps){const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;return new Function(...Object.keys(deps),js+'\nreturn Probe;')(...Object.values(deps))}
function seamCase(site,version,{missing=null,capability=false,providerMissing=false,snapshotThrows=false,bound=false}={}){
 const count={legacy:0,active:0,context:0,progress:0,provider:0},run={id:'public-run',workOrderId:'public-work',workspacePath:'/unused',inputCommit:'a'.repeat(40)},paths=['sample.txt'];
 let producer={snapshot:()=>{if(snapshotThrows)throw Error('Original admission unavailable');return version===null?null:{version,configuration:{allowedPaths:paths}}},
  ...(version===4?{assertVerificationInputReady(){throw Error('Unused input readiness in source fixture')},prepareVerificationInput(){throw Error('Unused input preparation in source fixture')},closeVerificationInput(){throw Error('Unused input close in source fixture')},context:async()=>{count.context++;return 'strict source'},assertProgress:async()=>{count.progress++},checkpoint:async()=>{throw Error('No checkpoint in source seam fixture')},commitCandidate:async()=>{throw Error('No commit in source seam fixture')}}:{}),...(capability?{contextBasis(){}}:{})};
 if(missing==='both'){delete producer.context;delete producer.assertProgress}else if(missing)delete producer[missing];
 if(bound){
  count.basis=0;
  producer=bindLocalV4PreparationCapture(createLocalV4Preparation('/synthetic/no-native-seam'),{
   snapshot:producer.snapshot,capture(){throw Error('No capture permitted')},read(){throw Error('No Result read permitted')},finalize(){throw Error('No signing permitted')},
   contextBasis(){count.basis++;throw contextPolicy.contextPolicyFailure(null)},
  });
  assert(Object.isFrozen(producer));assert.equal(Object.hasOwn(producer,'contextBasis'),false);assert.equal(typeof producer.context,'function');assert.equal(typeof producer.assertProgress,'function');
 }
 const deps={count,executionContext:async()=>{count.legacy++;return 'legacy source'},assertImplementationProgress:async()=>{count.legacy++},contextPolicyFailure:contextPolicy.contextPolicyFailure,requireStrictSourceOperations:contextPolicy.requireStrictSourceOperations};
 let call;
 if(site==='jobs'){
  const Type=probe('class Probe {constructor(producer){this.producer=producer;} assertActive(){count.active++;}\n'+jobsSource.member('#sourceContext')+'\ninvoke(...args){return this.#sourceContext(...args)}}',deps);
  call=()=>new Type(producer).invoke(run,paths,{kind:'INITIAL'});
 }else if(site==='local'){
  const Type=probe('class Probe {constructor(producer){this.producer=producer;this.jobs={assertActive(){count.active++}};} current(run){return run;}\n'+localSource.member('assertImplementationProgress')+'\n}',deps);
  call=()=>new Type(producer).assertImplementationProgress(run,run.inputCommit,paths);
 }else{
  const callback=progressCallbacks[site==='dispatch-first'?0:1];
  const Type=probe('class Probe {constructor(producer,execution){this.producer=producer;this.execution=execution;}\n'+(dispatchSource.member('implementationProgress')??'')+'\ninvoke(){const data={run},identity={baseSha:run.inputCommit,allowedPaths:paths};return ('+callback+')();}}',{...deps,run,paths});
  const execution=providerMissing?{}:{assertImplementationProgress:async()=>{count.provider++}};
  call=()=>new Type(producer,execution).invoke();
 }
 return {count,call:async()=>call()};
}
for(const site of ['jobs','local','dispatch-first','dispatch-repair']){
 for(const version of [1,2,3])test('source seam: '+site+' retains V'+version+' legacy fallback',async()=>{
  const f=seamCase(site,version,{providerMissing:true});await f.call();assert.equal(f.count.legacy,1);assert.equal(f.count.active,0);
 });
 test('source seam: '+site+' invokes complete V4 composition without ambient calls',async()=>{
  const f=seamCase(site,4);await f.call();assert.equal(f.count.legacy,0);
  assert.equal(site==='jobs'?f.count.context:site==='local'?f.count.progress:f.count.provider,1);
 });
 for(const missing of ['context','assertProgress','both'])test('source seam: '+site+' refuses V4 missing '+missing+' before ambient access',async()=>{
  const f=seamCase(site,4,{missing,capability:true});await assert.rejects(f.call(),{code:'local_context_hold',status:503});assert.deepEqual(f.count,{legacy:0,active:0,context:0,progress:0,provider:0});
 });
 test('source seam: '+site+' refuses strict capability with a missing original snapshot',async()=>{
  const f=seamCase(site,null,{missing:'both',capability:true,providerMissing:true});await assert.rejects(f.call(),{code:'local_context_hold',status:503});assert.equal(f.count.legacy,0);
 });
 test('source seam: '+site+' retains HOLD when original snapshot validation throws',async()=>{
  const f=seamCase(site,4,{capability:true,snapshotThrows:true});await assert.rejects(f.call(),{code:'local_context_hold',status:503});assert.equal(f.count.legacy,0);assert.equal(f.count.provider,0);
 });
}
for(const site of ['dispatch-first','dispatch-repair'])test('source seam: '+site+' refuses complete V4 producer with missing execution-provider hook',async()=>{
 const f=seamCase(site,4,{providerMissing:true});await assert.rejects(f.call(),{code:'local_context_hold',status:503});assert.equal(f.count.legacy,0);assert.equal(f.count.provider,0);
});
for(const site of ['jobs','local'])test('bound seam: '+site+' refuses unavailable original snapshot before invoking bound context or progress',async()=>{
 const f=seamCase(site,null,{bound:true});await assert.rejects(f.call(),{code:'local_context_hold',status:503});assert.deepEqual(f.count,{legacy:0,active:0,context:0,progress:0,provider:0,basis:0});
});
for(const site of ['dispatch-first','dispatch-repair'])for(const version of [null,1,2,3])for(const providerMissing of [false,true])test('bound seam: '+site+' refuses '+String(version)+' snapshot with '+(providerMissing?'absent':'present')+' provider before either effect',async()=>{
 const f=seamCase(site,version,{bound:true,providerMissing});await assert.rejects(f.call(),{code:'local_context_hold',status:503});assert.deepEqual(f.count,{legacy:0,active:0,context:0,progress:0,provider:0,basis:0});
});
