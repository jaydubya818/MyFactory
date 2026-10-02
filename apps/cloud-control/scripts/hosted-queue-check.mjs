// Only submit/read operator requests. No local scheduler, consumer or worker.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const [mode,deployment,existingId]=process.argv.slice(2);
if(!['submit','read'].includes(mode)||!/^https:\/\/myfactory-cloud-staging-[a-z0-9]+-jaydubya818\.vercel\.app$/.test(deployment??''))throw Error('STAGING_REQUEST_REQUIRED');
const id=mode==='submit'?randomUUID():existingId;
if(!/^[a-f0-9-]{36}$/.test(id??'')||!process.env.FACTORY_INFRASTRUCTURE_TOKEN)throw Error('QUALIFICATION_INPUT_REQUIRED');
const output=new URL(`../../../docs/cloud-execution/phase-3/queue-${id}.json`,import.meta.url);
const evidence=mode==='submit'?{id,deployment,evidenceClass:'CONNECTED',purpose:'hosted-queue-delivery',startedAt:new Date().toISOString(),status:'REQUEST_PENDING',modelOperations:0}:JSON.parse(await readFile(output,'utf8'));
if(evidence.deployment!==deployment)throw Error('DEPLOYMENT_MISMATCH');
const save=()=>writeFile(output,JSON.stringify(evidence,null,2)+'\n');
await save();
function request(method,path=`/api/queue-check?id=${id}`){
 const result=spawnSync('vercel',['curl',path,'--deployment',deployment,'--scope','team_p8z8exJRTGfOPk1GC9vUOpv3','--','--silent','--show-error','--max-time','40','--request',method,'--header','@-'],{input:`Authorization: Bearer ${process.env.FACTORY_INFRASTRUCTURE_TOKEN}\n`,encoding:'utf8',timeout:45000,maxBuffer:128000});
 if(result.status!==0)throw Error('OPERATOR_TRANSPORT_UNKNOWN');
 try{return JSON.parse(result.stdout);}catch{throw Error('OPERATOR_RESPONSE_INVALID');}
}
try {
 if(mode==='submit'){
  evidence.submission=request('POST');evidence.submitReturnedAt=new Date().toISOString();
  evidence.status=evidence.submission.check?.state??'NOT_PASS';
 }else{
  evidence.readback=request('GET');
  const row=evidence.readback.check;
  evidence.status=row?.state==='DELIVERED'&&new Date(row.delivered_at)>new Date(evidence.submitReturnedAt)?'PASS':'NOT_PASS';
  evidence.replay=request('POST');
  if(JSON.stringify(evidence.replay)!==JSON.stringify(evidence.readback))throw Error('REPLAY_MISMATCH');
  evidence.readAt=new Date().toISOString();
 }
}catch(error){evidence.status='UNKNOWN';evidence.code=error.message;process.exitCode=1;}
await save();console.log(JSON.stringify(evidence));
