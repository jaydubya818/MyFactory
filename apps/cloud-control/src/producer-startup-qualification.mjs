import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {boundedBytes} from './infrastructure-provider.mjs';
import {productionCheckpointPlan,productionConfiguration} from './production-execution-plan.mjs';
import {productionModelPrice} from './production-model-provider.mjs';

/** Operator-only qualification, never an admission/HTTP/queue path. The real
 * pinned worker reaches its loopback mailbox; no SpendGateway, ledger, Work,
 * candidate, credential acquisition or upstream transport exists here.
 * The mailbox request is inspected and then the sole sandbox is destroyed.
 * This qualifies startup, not permission to execute a production Work. */
export async function qualifyProducerStartup({provider,resource,record=async()=>{},now=Date.now,wait=delay}){
 let sandbox,stage='ALLOCATION',allocationStarted=false;
 if(!Number.isFinite(Date.parse(resource.deadline))||Date.parse(resource.deadline)<=now()||Date.parse(resource.deadline)>now()+180000)throw Error('QUALIFICATION_DEADLINE');
 const stages=[];
 const note=async evidence=>{if(evidence.startupStage)stage=evidence.startupStage;stages.push(evidence);await record(evidence);};
 try{
  allocationStarted=true;sandbox=await provider.allocate(resource);
  await note({startupStage:'SANDBOX_READINESS',image:sandbox.image});
  if(sandbox.image!==productionConfiguration.cloud.workerImage)throw Error('IMAGE_MISMATCH');
  const source=await provider.materialize(sandbox,note);
  if(source.commit!==productionCheckpointPlan.source.commit||source.tree!==productionCheckpointPlan.source.tree)throw Error('SOURCE_MISMATCH');
  await note({startupStage:'TOOL_AVAILABILITY',source});
  const user=sandbox.asUser('factoryproducer'),cwd='/home/factoryproducer/workspace';
  const tools=await user.runCommand({cmd:'node',args:['-e',`const c=require('node:child_process');for(const [bin,args] of [['git',['--version']],['/opt/factory-harness/bin/codex',['--version']]])c.execFileSync(bin,args,{stdio:'ignore',timeout:5000});if(process.getuid()===0)process.exit(1);process.stdout.write(JSON.stringify({cwd:process.cwd()}));`],cwd,timeoutMs:12000,signal:AbortSignal.timeout(15000)});
  if(tools.exitCode!==0)throw Error('PRODUCER_TOOLS_UNAVAILABLE');
  if(JSON.parse(await tools.stdout({signal:AbortSignal.timeout(10000)})).cwd!==cwd)throw Error('SOURCE_WORKING_DIRECTORY');
  await note({startupStage:'HARNESS_STARTUP'});
  const childToken=randomBytes(32).toString('hex'),deadline=Math.min(Date.parse(resource.deadline),Date.now()+45000);
  await user.writeFiles([{path:'/home/factoryproducer/phase-1.json',content:JSON.stringify({childToken,deadline,phase:'productive',sequence:1,prompt:'Inspect fixtures/production-canary/line-endings/normalize.mjs for the bounded line-ending task. The host will stop before the first provider dispatch.'}),mode:0o600}],{signal:AbortSignal.timeout(10000)});
  const command=await user.runCommand({cmd:'node',args:['/opt/factory-harness/apps/cloud-control/src/cloud-harness-worker.mjs','/home/factoryproducer/phase-1.json'],cwd,timeoutMs:Math.max(1,deadline-Date.now()),detached:true,signal:AbortSignal.timeout(15000)});
  await record({commandId:command.cmdId});
  while(Date.now()<deadline){
   const stream=await user.readFile({path:'/home/factoryproducer/phase-1/mailbox/request-1.json'},{signal:AbortSignal.timeout(10000)});
   if(stream){
    const packet=JSON.parse((await boundedBytes(stream,210000)).toString('utf8'));
    if(packet.id!==1||Object.keys(packet).sort().join(',')!=='body,id'||typeof packet.body!=='string')throw Error('MODEL_TRANSPORT_BINDING');
    const payload=JSON.parse(packet.body);
    if(payload.model!==productionModelPrice.model||['providerOptions','provider_options','models','routing','byok'].some(k=>k in payload)||payload.previous_response_id||payload.conversation||payload.background===true)throw Error('MODEL_TRANSPORT_CONFIGURATION');
    if(Buffer.byteLength(packet.body)>productionModelPrice.contextLimitTokens||packet.body.includes(childToken))throw Error('MODEL_TRANSPORT_BOUND');
    await note({startupStage:'READY_TO_DISPATCH',model:payload.model,upstreamDispatches:0,paidOperations:0});
    return {status:'PASS',stages,upstreamDispatches:0,paidOperations:0,candidates:0,workAuthority:'NOT_GRANTED'};
   }
   const result=await user.readFile({path:'/home/factoryproducer/phase-1/result.json'},{signal:AbortSignal.timeout(10000)});
   if(result){const observation=JSON.parse((await boundedBytes(result,2000)).toString('utf8'));await record({harnessResult:observation});throw Error('HARNESS_STARTUP_FAILED');}
   await delay(100);
  }
  throw Error('HARNESS_STARTUP_DEADLINE');
 }catch(error){
  await record({failureStage:stage,failure:/^[A-Z_]{3,80}$/.test(error?.message??'')?error.message:'STARTUP_QUALIFICATION_FAILED',paidOperations:0});throw error;
 }finally{
  // Even an uncertain allocation is reconciled by its single predetermined
  // provider name. No replacement allocation, worker or dispatch is permitted.
  let cleanupAuditError;
  if(allocationStarted&&!sandbox){
   try{await record({allocation:'UNRESOLVED',cleanup:'WAITING_ORIGINAL_DEADLINE_PLUS_GRACE',paidOperations:0});}catch(error){cleanupAuditError=error;}
   const remaining=Date.parse(resource.deadline)+30000-now();if(remaining>0)await wait(remaining);
  }
  await provider.destroy(resource,sandbox);
  try{await record({teardown:'PASS',paidOperations:0});}catch(error){cleanupAuditError=error;}
  if(cleanupAuditError)throw cleanupAuditError;
 }
}
