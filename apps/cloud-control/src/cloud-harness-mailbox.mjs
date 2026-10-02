import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {join,normalize} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

/** Work-scoped loopback transport only. The host's existing SpendGateway owns
 * reservations, model pins and phase authority. This worker has no upstream,
 * OIDC, provider-control, deployment-bypass, DB or custody credential. */
export async function harnessMailbox({directory,childToken,deadline,onYield}){
 if(typeof directory!=='string'||directory==='/'||normalize(directory)!==directory||!/^\/[\w/.-]+$/.test(directory)||!/^([a-f0-9]{64})$/.test(childToken)||!Number.isSafeInteger(deadline)||deadline<=Date.now())throw Error('MAILBOX_CONFIGURATION');
 // A fresh directory prevents stale replies or preinstalled symlinks.
 await mkdir(directory,{mode:0o700});
 let active=false,sequence=0,closed=false;
 const server=createServer((request,response)=>{void(async()=>{
  const deny=code=>{response.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});response.end('{"error":"MAILBOX_DENIED"}');};
  const hash=s=>createHash('sha256').update(s).digest();
  if(request.method!=='POST'||request.url!=='/v1/responses'||!timingSafeEqual(hash(request.headers.authorization??''),hash('Bearer '+childToken)))return deny(401);
  if(active||closed||sequence>=4||Date.now()>=deadline)return deny(409);
  active=true;
  try{
   const chunks=[];let size=0;
   for await(const chunk of request){size+=chunk.length;if(size>200000)return deny(413);chunks.push(chunk);}
   const body=Buffer.concat(chunks).toString('utf8');const parsed=JSON.parse(body);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return deny(400);
   const id=++sequence,name=join(directory,`request-${id}.json`);
   await writeFile(name+'.tmp',JSON.stringify({id,body}),{flag:'wx',mode:0o600});await rename(name+'.tmp',name);
   const replyPath=join(directory,`response-${id}.json`);
   while(!closed&&Date.now()<deadline){
    try{
     const stat=await lstat(replyPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3000000)throw Error('MAILBOX_RESPONSE_BOUND');
     const reply=JSON.parse(await readFile(replyPath,'utf8'));
     if(reply.id!==id||!['response','yield'].includes(reply.kind))throw Error('MAILBOX_RESPONSE_BINDING');
     if(reply.kind==='yield'){onYield();return deny(409);}
     if(!Number.isInteger(reply.status)||reply.status<200||reply.status>599||!['application/json','text/event-stream'].includes(reply.contentType)||typeof reply.bodyBase64!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(reply.bodyBase64))throw Error('MAILBOX_RESPONSE_SHAPE');
     response.writeHead(reply.status,{'content-type':reply.contentType,'cache-control':'no-store'});response.end(Buffer.from(reply.bodyBase64,'base64'));return;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    await delay(25);
   }
   deny(504);
  }finally{active=false;}
 })().catch(()=>{if(!response.headersSent)response.writeHead(503);response.end('{"error":"MAILBOX_UNAVAILABLE"}');});});
 server.requestTimeout=Math.max(1,Math.min(30000,deadline-Date.now()));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {baseUrl:`http://127.0.0.1:${server.address().port}/v1`,close:async()=>{closed=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
