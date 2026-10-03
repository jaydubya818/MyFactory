import {readFile,mkdir,writeFile,rename,lstat} from 'node:fs/promises';
import {createCodexAdapter} from '../../../packages/agents/src/index.ts';
import {harnessMailbox} from './cloud-harness-mailbox.mjs';
import {cloudHarnessIdentity} from './cloud-harness-plan.mjs';

// Executed only from the root-owned pinned harness installation. This reports
// observations; the host ledger and independent checks decide authority.
export async function runCloudHarnessPhase(configPath){
 if(process.getuid()===0||!/^\/home\/factoryproducer\/phase-[1-3]\.json$/.test(configPath))throw Error('HARNESS_PHASE_PATH');
 const stat=await lstat(configPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>140000)throw Error('HARNESS_PHASE_BOUND');
 const config=JSON.parse(await readFile(configPath,'utf8'));
 if(Object.keys(config).sort().join(',')!=='childToken,deadline,phase,prompt,sequence'||![1,2,3].includes(config.sequence)||configPath!==`/home/factoryproducer/phase-${config.sequence}.json`||!['productive','completion'].includes(config.phase)||!Number.isSafeInteger(config.deadline)||config.deadline<=Date.now())throw Error('HARNESS_PHASE_CONFIG');
 if(Object.keys(process.env).some(key=>/TOKEN|SECRET|PASSWORD|DATABASE_URL|PRIVATE_KEY/.test(key)))throw Error('HARNESS_ENVIRONMENT_BOUNDARY');
 const root=`/home/factoryproducer/phase-${config.sequence}`,artifacts=root+'/artifacts';
 await mkdir(root,{mode:0o700});await mkdir(artifacts,{mode:0o700});
 const productiveEnd=new AbortController();
 const mailbox=await harnessMailbox({directory:root+'/mailbox',childToken:config.childToken,deadline:config.deadline,onYield:()=>productiveEnd.abort()});
 try{
  const adapter=createCodexAdapter('/opt/factory-harness/bin/codex','container');
  const result=await adapter.runCodex({workspacePath:'/home/factoryproducer/workspace',artifactsDir:artifacts,prompt:config.prompt,model:cloudHarnessIdentity.model,timeoutMs:Math.min(45000,config.deadline-Date.now()),sandbox:config.phase==='completion'?'read-only':'workspace-write',gateway:{baseUrl:mailbox.baseUrl,childToken:config.childToken},productiveEndSignal:productiveEnd.signal,
   onEvent:event=>{const item=event.item;if(config.phase==='completion'&&item&&!['agent_message','reasoning'].includes(item.type))throw Error('COMPLETION_TOOL_DENIED');},
   onProcessStart:async process=>{await writeFile(root+'/process.json',JSON.stringify(process),{flag:'wx',mode:0o600});},
  });
  // No raw logs, messages, child token or prompt in transport/result evidence.
  const stderr=await readFile(result.stderrPath,'utf8');
  const diagnostics=['bwrap','Operation not permitted','Permission denied','sandbox','Connection refused','Unauthorized','model not found'].filter(code=>stderr.includes(code));
  if(stderr.includes(config.childToken))throw Error('HARNESS_CREDENTIAL_LOG_EXPOSURE');
  const observation={diagnostics,workerProfile:result.workerProfile,status:result.status,success:result.success,exitCode:result.exitCode,startedAt:result.startedAt,finishedAt:result.finishedAt,completionEventSeen:result.completionEventSeen};
  await writeFile(root+'/result.tmp',JSON.stringify(observation),{flag:'wx',mode:0o600});await rename(root+'/result.tmp',root+'/result.json');
  return observation;
 }finally{await mailbox.close();}
}
if(process.argv[1]?.endsWith('/cloud-harness-worker.mjs')){
 runCloudHarnessPhase(process.argv[2]).catch(()=>{process.stderr.write('HARNESS_PHASE_FAILED');process.exitCode=1;});
}
