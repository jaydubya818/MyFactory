import test from 'node:test';
import assert from 'node:assert/strict';
import {oidcPreflight} from '../src/oidc-preflight.ts';
import {GATEWAY_MODEL} from '../src/oidc-provider.ts';
const token='synthetic-private-identity';
const config={price:{contextLimitTokens:400000,outputLimitTokens:8192,inputMicrousdPerMillion:750000,outputMicrousdPerMillion:4500000}};
const provider={upstreamOrigin:'https://ai-gateway.vercel.sh',authorize:async()=>token};
function response(phase,change={}){
 return phase===1?{data:[{id:GATEWAY_MODEL,model_eligibility:{status:'eligible',evaluated_runtime:'http'}}],
  request_context_availability:{http:{status:'available'}},evaluation_context:{credential_mode:'runtime_default',request_constraints:'default_only'},...change}:
  {data:{id:GATEWAY_MODEL,endpoints:[{provider_name:'openai',status:0,context_length:400000,max_completion_tokens:128000,
   supported_parameters:['tools','tool_choice'],pricing:{prompt:'0.00000075',completion:'0.0000045'},...change}]}};
}
test('preflight uses authenticated read-only endpoints and returns only bounded safe metadata',async()=>{
 let calls=0;
 const result=await oidcPreflight(config,provider,async(url,options)=>{
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer '+token);
  assert.equal(new URL(url).pathname,calls===0?'/v1/models':'/v1/models/openai/gpt-5.4-mini/endpoints');
  const body=response(++calls);body.extra=token;return Response.json(body);
 });
 assert.equal(calls,2);assert.equal(result.status,'PASS');assert.equal(result.modelOperations,0);assert(!JSON.stringify(result).includes(token));
});
test('denial, absent or unknown eligibility, wrong provider, missing tools and rate changes fail closed',async()=>{
 for(const [phase,change] of [[1,{data:[]}],[1,{request_context_availability:{http:{status:'unknown'}}}],
  [2,{provider_name:'azure'}],[2,{supported_parameters:[]}],[2,{pricing:{prompt:'0.0000015',completion:'0.0000045'}}]]){
  let calls=0;
  await assert.rejects(oidcPreflight(config,provider,async()=>Response.json(response(++calls,calls===phase?change:{}))),/preflight failed/);
 }
 for(const request of [async()=>new Response(token,{status:403}),async()=>{throw Error(token)}])
  await assert.rejects(oidcPreflight(config,provider,request),error=>String(error).includes('preflight failed')&&!String(error).includes(token));
});
