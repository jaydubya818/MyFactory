// Operator client only: execution, custody and teardown occur in the hosted service.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const deployment=process.argv[2];
if(!/^https:\/\/myfactory-cloud-staging-[a-z0-9]+-jaydubya818\.vercel\.app$/.test(deployment??''))throw Error('STAGING_URL_REQUIRED');
if(!process.env.FACTORY_INFRASTRUCTURE_TOKEN)throw Error('OPERATOR_TOKEN_REQUIRED');
const id=randomUUID();
const output=new URL(`../../../docs/cloud-execution/phase-2/provider-diagnosis/infrastructure-${id}.json`,import.meta.url);
const evidence={id,deployment,evidenceClass:'CONNECTED',purpose:'hosted-infrastructure',startedAt:new Date().toISOString(),status:'REQUEST_PENDING'};
const save=()=>writeFile(output,JSON.stringify(evidence,null,2)+'\n');
await save();
function request(method){
 const result=spawnSync('vercel',['curl',`/api/infrastructure?id=${id}`,'--deployment',deployment,'--scope','team_p8z8exJRTGfOPk1GC9vUOpv3','--','--silent','--show-error','--max-time','185','--request',method,'--header','@-'],{input:`Authorization: Bearer ${process.env.FACTORY_INFRASTRUCTURE_TOKEN}\n`,encoding:'utf8',timeout:200000,maxBuffer:1000000});
 if(result.status!==0)throw Error('OPERATOR_TRANSPORT_UNKNOWN');
 try{return JSON.parse(result.stdout);}catch{throw Error('OPERATOR_RESPONSE_INVALID');}
}
try{
 evidence.response=request('POST');await save();
 evidence.readback=request('GET');
 const row=evidence.readback.attempt;
 evidence.status=row?.state==='DESTROYED'&&row.cleanup_confirmed&&row.evidence.outcome==='PASS'&&row.artifact_sha256?'PASS':'NOT_PASS';
 // Duplicate submission must return the same receipt without a second allocation.
 if(evidence.status==='PASS'){
  evidence.replay=request('POST');
  if(JSON.stringify(evidence.replay)!==JSON.stringify(evidence.readback))throw Error('REPLAY_MISMATCH');
 }
 if(evidence.status!=='PASS')process.exitCode=1;
}catch(error){evidence.status='UNKNOWN';evidence.code=error.message;process.exitCode=1;}
finally{evidence.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify(evidence));}
