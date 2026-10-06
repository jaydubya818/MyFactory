import {setTimeout as delay} from 'node:timers/promises';

/** Host transport around the qualified SpendGateway, never a second model
 * admission path. Untrusted worker files cannot choose identity, phase, model
 * provider, authority or a destination. IO must be bound to one sandbox/phase. */
export async function relayHarnessRequests({readRequest,writeResponse,gateway,childToken,deadline,signal,finished,onBoundary=()=>false,beforeGateway=async()=>{}}){
 if(!/^[a-f0-9]{64}$/.test(childToken)||!Number.isSafeInteger(deadline)||deadline<=Date.now())throw Error('RELAY_CONFIGURATION');
 let id=1;
 while(Date.now()<deadline&&!signal?.aborted){
  // Finish is observed only after any request already admitted has settled.
  if(finished())return;
  const bytes=await readRequest(id);
  if(bytes===null){await delay(75,undefined,{signal});continue;}
  if(id>4||!Buffer.isBuffer(bytes)||bytes.length>210000)throw Error('RELAY_REQUEST_BOUND');
  const request=JSON.parse(bytes.toString('utf8'));
  if(!request||Object.keys(request).sort().join(',')!=='body,id'||request.id!==id||typeof request.body!=='string'||Buffer.byteLength(request.body)>200000)throw Error('RELAY_REQUEST_BINDING');
  // A failed or ambiguous gateway call is never retried with a new reservation.
  await beforeGateway();
  const result=await gateway.fetch(new Request('https://factory.internal/v1/responses',{method:'POST',headers:{authorization:'Bearer '+childToken,'content-type':'application/json'},body:request.body}));
  const body=Buffer.from(await result.arrayBuffer());if(body.length>2000000)throw Error('RELAY_RESPONSE_BOUND');
  const contentType=result.headers.get('content-type')?.split(';')[0];
  if(!['application/json','text/event-stream'].includes(contentType))throw Error('RELAY_RESPONSE_TYPE');
  const reply=onBoundary()?{id,kind:'yield'}:{id,kind:'response',status:result.status,contentType,bodyBase64:body.toString('base64')};
  await writeResponse(id,Buffer.from(JSON.stringify(reply)));
  id++;
 }
 throw Error(signal?.aborted?'RELAY_CANCELLED':'RELAY_DEADLINE');
}
