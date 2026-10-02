import {cloudSessionSurface} from './session-surface-policy.ts';
const safeCode=error=>/^[A-Z_]{3,80}$/.test(error?.message??'')?error.message:'PROVIDER_OR_STORAGE_ERROR';

/** One callback may claim the canonical Run. Redelivery never starts a second
 * resource or command. The delayed recovery delivery must be accepted first. */
export async function executeCloudWork(store,provider,clientId,identity,scheduleRecovery) {
 const resource=await store.claim(clientId,identity);
 if(!resource)return store.read(clientId,identity.requestId);
 const row=await store.read(clientId,identity.requestId),args=[row.run_id,resource.lease_owner,resource.lease_generation];
 let sandbox,sessionId,heartbeatFailure,heartbeatTask=Promise.resolve(),heartbeatStopped=false;
 const pulse=()=>{heartbeatTask=heartbeatTask.then(async()=>{if(heartbeatStopped||heartbeatFailure)return;try{await store.heartbeat(...args);}catch(error){heartbeatFailure=error;}});};
 const timer=setInterval(pulse,10000);
 const active=async()=>{await heartbeatTask;if(heartbeatFailure)throw Error('LEASE_FENCED');await store.heartbeat(...args);};
 let status='FAILED';
 try{
  // Recovery is independent of the request, browser and producer callback.
  // If its acceptance is ambiguous, no sandbox is allocated.
  await scheduleRecovery(row,resource);
  await active();sandbox=await provider.allocate(resource);
  sessionId=sandbox.currentSession().sessionId;await store.recordAllocation(...args,sessionId);
  await active();await store.advanceResource(...args,'PREPARING');
  const source=await provider.materialize(sandbox);
  await active();await store.advanceResource(...args,'READY',{source});
  await store.advanceResource(...args,'RUNNING');
  const manifest=await provider.execute(sandbox,commandId=>store.noteResource(...args,{commandId}),row,evidence=>store.noteResource(...args,evidence));
  await active();await store.advanceResource(...args,'QUIESCING');
  const quiescence=await provider.quiesce(sandbox);
  await active();await store.advanceResource(...args,'COLLECTING',{quiescence});
  const collected=await provider.collect(sandbox,row,manifest);
  await store.retainCustody(...args,collected.receipt);
  const visibleChecksPassed=collected.bundle.checks.every(c=>c.exitCode===0);
  await store.noteResource(...args,{visibleChecksPassed,sessionSurface:cloudSessionSurface,protectedVerification:'NOT_RUN'});
  status=visibleChecksPassed?'COMPLETED':'FAILED';
 }catch(error){
  await store.noteResource(...args,{failure:safeCode(error)});
 }finally{
  heartbeatStopped=true;clearInterval(timer);await heartbeatTask;
  if(sandbox){
   try{await provider.destroy(resource,sandbox);await store.confirmCleanup(...args,sessionId);}
   catch{await store.noteResource(...args,{cleanup:'UNKNOWN'});}
  }
 }
 const observed=await store.read(clientId,identity.requestId);
 if(observed.resource?.cleanup_confirmed)await store.finalize(clientId,identity.requestId,status);
 return store.read(clientId,identity.requestId);
}

export async function reconcileCloudWork(store,provider,clientId,requestId,now=Date.now) {
 const row=await store.read(clientId,requestId),r=row.resource;
 if(!r){if(row.events.some(e=>e.type==='factory.stop_requested'))await store.finalize(clientId,requestId,'CANCELLED');return store.read(clientId,requestId);}
 if(r.cleanup_confirmed){
  if(!row.events.some(e=>e.type==='factory.terminal'))await store.finalize(clientId,requestId,row.custody&&r.evidence.visibleChecksPassed?'COMPLETED':'FAILED');
  return store.read(clientId,requestId);
 }
 await store.reconcileExpired(clientId,requestId);
 if(!r.provider_session_id&&now()<new Date(r.deadline).getTime()+30000)throw Error('RECONCILIATION_TOO_EARLY');
 await provider.destroy(r);
 await store.confirmCleanup(r.run_id,r.lease_owner,r.lease_generation,r.provider_session_id);
 // Expired producer authority is never recovered by starting a new worker.
 await store.noteResource(r.run_id,r.lease_owner,r.lease_generation,{failure:'EXECUTION_INTERRUPTED',reconciled:true});
 await store.finalize(clientId,requestId,'FAILED');return store.read(clientId,requestId);
}
