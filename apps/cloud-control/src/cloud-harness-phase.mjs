import {readFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {SpendGateway} from '../../supervisor/src/spend-gateway.ts';
import {boundedBytes} from './infrastructure-provider.mjs';
import {cloudHarnessPrice,cloudHarnessIdentity} from './cloud-harness-plan.mjs';
import {cloudHarnessInstallScript} from './cloud-harness-install.mjs';
import {deterministicHarnessResponse} from './cloud-harness-fixture.mjs';
import {relayHarnessRequests} from './cloud-harness-relay.mjs';

export const harnessSourceFiles=['packages/agents/src/index.ts','packages/contracts/src/model-reference.ts','apps/cloud-control/src/cloud-harness-worker.mjs','apps/cloud-control/src/cloud-harness-mailbox.mjs','apps/cloud-control/src/cloud-harness-plan.mjs'];
export async function installCloudHarness(sandbox){
 const root=sandbox.asUser('root');
 const files=await Promise.all(harnessSourceFiles.map(async path=>({path:'/opt/factory-harness/'+path,content:await readFile(new URL('../../../'+path,import.meta.url)),mode:0o644})));
 await root.writeFiles(files,{signal:AbortSignal.timeout(15000)});
 const installed=await root.runCommand({cmd:'node',args:['-e',cloudHarnessInstallScript],timeoutMs:60000,signal:AbortSignal.timeout(65000)});
 if(installed.exitCode!==0){
  const code=(await installed.stderr({signal:AbortSignal.timeout(10000)})).trim();
  const allowed=['HARNESS_INSTALL_IDENTITY','HARNESS_PACKAGE_UNAVAILABLE','HARNESS_PACKAGE_BOUND','HARNESS_PACKAGE_INTEGRITY','HARNESS_PACKAGE_LAYOUT','HARNESS_BINARY_TYPE','HARNESS_VERSION_MISMATCH'];
  throw Error(allowed.includes(code)?code:'HARNESS_INSTALL_FAILED');
 }
 const text=await installed.stdout({signal:AbortSignal.timeout(10000)});if(text.length>1000)throw Error('HARNESS_INSTALL_REPORT_BOUND');
 const observed=JSON.parse(text);if(observed.version!=='codex-cli '+cloudHarnessIdentity.version||observed.uid!==0)throw Error('HARNESS_INSTALL_REPORT');return observed;
}

/** A single admitted productive or read-only completion process. Lifecycle,
 * checkpoints, custody and protected verification remain host responsibilities. */
export async function runCloudHarnessPhase({sandbox,ledger,binding,phase,sequence,prompt,currentSource,deadline,recordCommand,recordEvidence,modelProvider}){
 if(!['productive','completion'].includes(phase)||![1,2,3].includes(sequence)||!Number.isSafeInteger(deadline)||deadline<=Date.now()||deadline>Date.now()+180000)throw Error('HARNESS_PHASE_AUTHORITY');
 const childToken=randomBytes(32).toString('hex'),user=sandbox.asUser('factoryproducer'),root=`/home/factoryproducer/phase-${sequence}`;
 let boundary=false,finished=false;
 const gateway=new SpendGateway({ledger,binding,operationId:createHash('sha256').update(JSON.stringify([binding,phase,sequence])).digest('hex'),...(modelProvider??{price:cloudHarnessPrice,upstreamOrigin:'https://deterministic.factory.invalid',upstreamApiKey:'deterministic-only',upstreamFetch:deterministicHarnessResponse({phase,currentSource})}),childToken,phase,...(phase==='productive'?{productiveCheckpointAfter:sequence,onProductiveBoundary:()=>{boundary=true;}}:{})});
 await recordEvidence({startupStage:'HARNESS_STARTUP'});
 await user.writeFiles([{path:root+'.json',content:JSON.stringify({childToken,deadline,phase,prompt,sequence}),mode:0o600}],{signal:AbortSignal.timeout(10000)});
 const command=await user.runCommand({cmd:'node',args:['/opt/factory-harness/apps/cloud-control/src/cloud-harness-worker.mjs',root+'.json'],cwd:'/home/factoryproducer/workspace',timeoutMs:Math.min(50000,deadline-Date.now()),detached:true,signal:AbortSignal.timeout(15000)});
 await recordCommand(command.cmdId);
 let commandError;
 const waiting=command.wait({signal:AbortSignal.timeout(Math.max(1,Math.min(55000,deadline-Date.now())))}).then(value=>{finished=true;return value;},error=>{finished=true;commandError=error;});
 try{
  await relayHarnessRequests({childToken,deadline,finished:()=>finished,gateway,onBoundary:()=>boundary,
   beforeGateway:()=>recordEvidence({startupStage:'MODEL_GATEWAY'}),
   readRequest:async id=>{const stream=await user.readFile({path:root+`/mailbox/request-${id}.json`},{signal:AbortSignal.timeout(10000)});return stream?boundedBytes(stream,210000):null;},
   writeResponse:async(id,content)=>{
    // Producer identity prevents writing through a malicious link as root.
    // Atomic rename prevents the worker reading a partially uploaded response.
    const path=root+`/mailbox/response-${id}.json`;
    await user.writeFiles([{path:path+'.tmp',content,mode:0o600}],{signal:AbortSignal.timeout(10000)});
    const moved=await user.runCommand({cmd:'mv',args:['--',path+'.tmp',path],timeoutMs:5000,signal:AbortSignal.timeout(10000)});if(moved.exitCode!==0)throw Error('HARNESS_RESPONSE_DELIVERY');
   },
  });
  const done=await waiting;if(commandError||done?.exitCode!==0)throw Error('HARNESS_PROCESS_FAILED');
  const bytes=await boundedBytes(await user.readFile({path:root+'/result.json'},{signal:AbortSignal.timeout(10000)}),2000),result=JSON.parse(bytes);
  await recordEvidence({harnessObservation:{phase,sequence,status:['completed','yielded','failed','cancelled','timed_out'].includes(result.status)?result.status:'UNKNOWN',diagnostics:Array.isArray(result.diagnostics)?result.diagnostics.filter(code=>['bwrap','Operation not permitted','Permission denied','sandbox','Connection refused','Unauthorized','model not found'].includes(code)):[]}});
  if(result.workerProfile!=='container'||!['completed','yielded'].includes(result.status)||(result.status==='yielded'&&!boundary)||(phase==='completion'&&(!result.success||!result.completionEventSeen)))throw Error('HARNESS_PHASE_FAILED');
  return {phase,sequence,status:result.status,startedAt:result.startedAt,finishedAt:result.finishedAt};
 }catch(error){
  // Accounting may already be settled while delivery to the worker is unknown.
  // Neither this phase nor a successor may resume paid execution automatically.
  await ledger.fenceAuthority(binding);
  throw error;
 }finally{
  // Waiting rejection is observed; caller always quiesces/destroys the sandbox
  // when transport or command outcome is ambiguous. Never restart this phase.
  await waiting;
 }
}
