import {randomUUID} from 'node:crypto';
import {cloudHarnessIdentity} from './cloud-harness-plan.mjs';
import {allowedPaths,deterministicSolution} from './cloud-work-plan.mjs';

/** Trusted deterministic upstream at the existing SpendGateway injection seam.
 * It has no fetch fallback and cannot dispatch paid traffic. */
export function deterministicHarnessResponse({phase,currentSource}){
 if(!['productive','completion'].includes(phase)||typeof currentSource!=='string'||Buffer.byteLength(currentSource)>10000)throw Error('FIXTURE_CONFIGURATION');
 let calls=0;
 return async(url,init)=>{
  if(String(url)!=='https://deterministic.factory.invalid/v1/responses'||init?.method!=='POST'||++calls!==1)throw Error('FIXTURE_REPLAY_OR_ROUTE');
  const body=JSON.parse(init.body);if(body.model!==cloudHarnessIdentity.model)throw Error('FIXTURE_MODEL');
  let output;
  const id='deterministic-'+randomUUID();
  if(phase==='completion')output=[{type:'message',id:'m-'+id,role:'assistant',status:'completed',content:[{type:'output_text',text:'The bounded project-slug implementation is ready for independent verification.',annotations:[]}]}];
  else{
   const tool=body.tools?.find(t=>t.name==='apply_patch');if(!tool||!['custom','function'].includes(tool.type))throw Error('FIXTURE_CLIENT_TOOL_MISSING');
   const patch='*** Begin Patch\n*** Update File: '+allowedPaths[0]+'\n@@\n'+currentSource.trimEnd().split('\n').map(line=>'-'+line).join('\n')+'\n'+deterministicSolution.trimEnd().split('\n').map(line=>'+'+line).join('\n')+'\n*** End Patch';
   output=[tool.type==='custom'?{type:'custom_tool_call',id:'t-'+id,call_id:'c-'+id,name:'apply_patch',input:patch,status:'completed'}:{type:'function_call',id:'t-'+id,call_id:'c-'+id,name:'apply_patch',arguments:JSON.stringify({patch}),status:'completed'}];
  }
  const response={id,object:'response',status:'completed',model:body.model,output,usage:{input_tokens:0,output_tokens:0,total_tokens:0}};
  if(!body.stream)return Response.json(response,{headers:{'x-request-id':id}});
  const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}}];
  for(const [output_index,item] of output.entries())events.push({type:'response.output_item.added',output_index,item},{type:'response.output_item.done',output_index,item});
  events.push({type:'response.completed',response});
  return new Response(events.map((event,sequence_number)=>'event: '+event.type+'\ndata: '+JSON.stringify({...event,sequence_number})+'\n\n').join(''),{headers:{'content-type':'text/event-stream','x-request-id':id}});
 };
}
