import { createHash, randomUUID } from 'node:crypto';
import { canonical, digest } from '../../../packages/hosted-routing/src/result.ts';
import { assertSpendBinding } from '../../../packages/storage/src/spend-policy.ts';
import { parseCloudPrepare } from '../../../packages/contracts/src/cloud-execution.ts';

/** Canonical Factory admission history and resource leases. Queue delivery grants
 * no authority. All mutable checks serialize with the canonical spend ledger. */
export class PostgresDispatchStore {
  constructor(pool) { this.pool=pool; }
  async transaction(action) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(81427603)');
      const now=Number((await client.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now')).rows[0].now);
      const result=await action(client,now);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }
  async record(client,clientId,requestId) {
    const row=(await client.query('SELECT * FROM factory.intake_receipts WHERE client_id=$1 AND request_id=$2',[clientId,requestId])).rows[0];
    if(!row)throw Error('FACTORY_REQUEST_NOT_FOUND');return row;
  }
  async event(client,row,type,payload) {
    await client.query('INSERT INTO factory.events(work_order_id,run_id,type,payload) VALUES($1,$2,$3,$4)',[row.work_order_id,row.run_id,type,payload]);
  }
  async prepare(grant,input,snapshotFactory) {
    return this.transaction(async(client,now)=>{
      // Replay remains readable after expiry, but cannot change any admission input.
      const prior=(await client.query('SELECT * FROM factory.intake_receipts WHERE client_id=$1 AND request_id=$2',[grant.clientId,input?.requestId])).rows[0];
      if(prior){if(prior.input_digest!==digest(input))throw Error('PREPARATION_REPLAY_CONFLICT');return prior;}
      const request=parseCloudPrepare(input,grant,now);
      if(Number((await client.query('SELECT count(*) FROM factory.intake_receipts WHERE client_id=$1',[grant.clientId])).rows[0].count)>=8)throw Error('STAGING_WORK_LIMIT');
      const other=(await client.query('SELECT client_id,work_generation FROM factory.intake_receipts WHERE work_id=$1',[request.workId])).rows;
      if(other.some(r=>r.client_id!==grant.clientId||r.work_generation>=request.workGeneration))throw Error('WORK_SCOPE_OR_GENERATION_CONFLICT');
      // No new generation while an earlier resource can still execute.
      if((await client.query('SELECT 1 FROM factory.intake_receipts i JOIN factory.execution_resources r ON r.run_id=i.run_id WHERE i.work_id=$1 AND NOT r.cleanup_confirmed',[request.workId])).rowCount)throw Error('WORK_RESOURCE_UNRESOLVED');
      const workOrderId=randomUUID(),runId=randomUUID(),at=new Date(now).toISOString();
      const order={...request.input,id:workOrderId,source:request.source,baseRef:request.source.commit,reproductionCommand:null,expectedFailureText:null,workerProfile:'container',state:'queued',createdAt:at,updatedAt:at};
      const run={id:runId,workOrderId,attemptNumber:1,state:'planning',workerProfile:'container',inputCommit:request.source.commit,candidateCommit:null,workspaceRef:`factory-run:${runId}`,startedAt:at,finishedAt:null,failure:null};
      // Trusted server callback computes the pinned execution snapshot; never caller supplied.
      const snapshot=snapshotFactory(request,order,run);
      if(snapshot?.requestId!==request.requestId||snapshot?.workOrderId!==workOrderId||snapshot?.runId!==runId||snapshot?.inputCommit!==request.source.commit)throw Error('SNAPSHOT_BINDING_MISMATCH');
      await client.query("INSERT INTO factory.work_orders(id,record,state) VALUES($1,$2,'queued')",[workOrderId,order]);
      await client.query("INSERT INTO factory.runs(id,work_order_id,record,state) VALUES($1,$2,$3,'planning')",[runId,workOrderId,run]);
      await client.query('INSERT INTO factory.intake_receipts(client_id,request_id,work_id,work_generation,input_digest,work_order_id,run_id,request,snapshot,deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[grant.clientId,request.requestId,request.workId,request.workGeneration,digest(request),workOrderId,runId,request,snapshot,request.deadline]);
      const row=await this.record(client,grant.clientId,request.requestId);
      await this.event(client,row,'factory.prepare_requested',request);
      await this.event(client,row,'run.execution_snapshot',snapshot);
      return row;
    });
  }
  assertIdentity(row,identity) {
    const expectedKeys='allowedPaths,baseSha,deadline,dispatchIdentity,factoryId,factoryVersion,remoteRunId,repository,requestId,runId,workGeneration,workId,workOrderId,writerGeneration';
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    if(!identity||Object.keys(identity).sort().join(',')!==expectedKeys||!uuid.test(identity.runId)||!uuid.test(identity.dispatchIdentity)||!Number.isSafeInteger(identity.writerGeneration)||identity.writerGeneration<1)throw Error('INVALID_WRITER_IDENTITY');
    const q=row.request,s=row.snapshot;
    if(identity.workId!==q.workId||identity.workGeneration!==q.workGeneration||identity.requestId!==q.requestId||identity.repository!==q.repository||identity.deadline!==q.deadline||identity.factoryId!==s.factoryId||identity.factoryVersion!==s.factoryVersion||identity.workOrderId!==row.work_order_id||identity.remoteRunId!==row.run_id||identity.baseSha!==q.source.commit||canonical(identity.allowedPaths)!==canonical(q.input.allowedPaths))throw Error('WRITER_BINDING_MISMATCH');
    if(row.identity&&canonical(row.identity)!==canonical(identity))throw Error('WRITER_BINDING_CONFLICT');
  }
  async claim(clientId,identity) {
    return this.transaction(async(client,now)=>{
      const row=await this.record(client,clientId,identity.requestId);this.assertIdentity(row,identity);
      const prior=await client.query("SELECT 1 FROM factory.events WHERE run_id=$1 AND type IN ('factory.dispatch_claimed','factory.stop_requested','factory.terminal')",[row.run_id]);
      if(prior.rowCount)return null;
      if(new Date(row.deadline).getTime()<=now)throw Error('WORK_DEADLINE_EXPIRED');
      const b=(await client.query('SELECT * FROM factory.work_spend_budgets WHERE work_id=$1',[row.work_id])).rows[0];
      assertSpendBinding(b,{workId:identity.workId,workGeneration:identity.workGeneration,dispatchIdentity:identity.dispatchIdentity,requestId:identity.requestId,workOrderId:identity.workOrderId,factoryVersion:identity.factoryVersion,runId:identity.remoteRunId},'productive',now);
      if((await client.query("SELECT 1 FROM factory.work_spend_operations WHERE work_id=$1 AND state='unknown' LIMIT 1",[row.work_id])).rowCount)throw Error('UNKNOWN_SPEND_BLOCKS_DISPATCH');
      const leaseOwner=randomUUID();
      await client.query('UPDATE factory.intake_receipts SET identity=$3 WHERE client_id=$1 AND request_id=$2',[clientId,identity.requestId,identity]);
      await client.query(`INSERT INTO factory.execution_resources(run_id,provider_name,state,lease_owner,lease_expires_at,deadline) VALUES($1,$2,'ALLOCATING',$3,least(clock_timestamp()+interval '60 seconds',$4::timestamptz),$4)`,[row.run_id,`factory-run-${row.run_id}`,leaseOwner,row.deadline]);
      await this.event(client,row,'factory.writer_bound',identity);
      await this.event(client,row,'factory.dispatch_claimed',{identity});
      return (await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1',[row.run_id])).rows[0];
    });
  }
  async stop(clientId,identity) {
    return this.transaction(async(client,now)=>{
      const row=await this.record(client,clientId,identity.requestId);this.assertIdentity(row,identity);
      await client.query('UPDATE factory.intake_receipts SET identity=$3 WHERE client_id=$1 AND request_id=$2',[clientId,identity.requestId,identity]);
      const prior=await client.query("SELECT 1 FROM factory.events WHERE run_id=$1 AND type IN ('factory.stop_requested','factory.terminal')",[row.run_id]);
      if(prior.rowCount)return;
      await this.event(client,row,'factory.stop_requested',identity);
      // Same transaction/lock as reserve and dispatch: cancellation wins all later operations.
      await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced',cancelled_at=$3 WHERE work_id=$1 AND work_generation=$2",[row.work_id,row.work_generation,new Date(now).toISOString()]);
      await client.query("UPDATE factory.execution_resources SET cancelled_at=clock_timestamp(),lease_expires_at=clock_timestamp(),updated_at=clock_timestamp() WHERE run_id=$1",[row.run_id]);
    });
  }
  async recordAllocation(runId,leaseOwner,generation,providerSessionId) {
    // Observation only: a delayed create receipt must remain collectible after cancellation.
    if(typeof providerSessionId!=='string'||!/^sbx_[A-Za-z0-9_-]+$/.test(providerSessionId))throw Error('INVALID_PROVIDER_ID');
    return this.transaction(async client=>{
      const result=await client.query(`UPDATE factory.execution_resources SET provider_session_id=$4,allocation_unknown=false,updated_at=clock_timestamp() WHERE run_id=$1 AND lease_owner=$2 AND lease_generation=$3 AND NOT cleanup_confirmed AND (provider_session_id IS NULL OR provider_session_id=$4) RETURNING *`,[runId,leaseOwner,generation,providerSessionId]);
      if(!result.rowCount)throw Error('RESOURCE_RECEIPT_CONFLICT');return result.rows[0];
    });
  }
  async reconcileExpired(clientId,requestId) {
    return this.transaction(async(client,now)=>{
      const row=await this.record(client,clientId,requestId);
      const resource=(await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1',[row.run_id])).rows[0];
      if(!resource||resource.cleanup_confirmed)return resource??null;
      if(new Date(resource.lease_expires_at).getTime()>now&&!resource.cancelled_at)throw Error('LEASE_STILL_ACTIVE');
      await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced' WHERE work_id=$1 AND work_generation=$2",[row.work_id,row.work_generation]);
      // Retain intent/identity/slot. Never issue a replacement lease or new allocation.
      return resource;
    });
  }
  async heartbeat(runId,leaseOwner,generation) {
    return this.transaction(async(client)=>{
      const r=await client.query(`UPDATE factory.execution_resources SET lease_expires_at=least(clock_timestamp()+interval '60 seconds',deadline),updated_at=clock_timestamp() WHERE run_id=$1 AND lease_owner=$2 AND lease_generation=$3 AND lease_expires_at>clock_timestamp() AND deadline>clock_timestamp() AND cancelled_at IS NULL AND NOT cleanup_confirmed RETURNING *`,[runId,leaseOwner,generation]);
      if(!r.rowCount)throw Error('LEASE_FENCED');return r.rows[0];
    });
  }
  async reserveDelivery(clientId,identity,deploymentId,nonce) {
    if(!/^dpl_[A-Za-z0-9]+$/.test(deploymentId)||!/^[a-f0-9]{64}$/.test(nonce))throw Error('INVALID_DELIVERY_INTENT');
    return this.transaction(async(client,now)=>{
      const row=await this.record(client,clientId,identity.requestId);this.assertIdentity(row,identity);
      const previous=(await client.query('SELECT * FROM factory.delivery_intents WHERE run_id=$1',[row.run_id])).rows[0];
      if(previous)return{created:false,intent:previous};
      if(new Date(row.deadline).getTime()<=now)throw Error('WORK_DEADLINE_EXPIRED');
      if((await client.query("SELECT 1 FROM factory.events WHERE run_id=$1 AND type IN ('factory.stop_requested','factory.terminal')",[row.run_id])).rowCount)throw Error('WORK_FENCED');
      const budget=(await client.query('SELECT * FROM factory.work_spend_budgets WHERE work_id=$1',[row.work_id])).rows[0];
      assertSpendBinding(budget,{workId:identity.workId,workGeneration:identity.workGeneration,dispatchIdentity:identity.dispatchIdentity,requestId:identity.requestId,workOrderId:identity.workOrderId,factoryVersion:identity.factoryVersion,runId:identity.remoteRunId},'productive',now);
      await client.query('UPDATE factory.intake_receipts SET identity=$3 WHERE client_id=$1 AND request_id=$2',[clientId,identity.requestId,identity]);
      const intent=(await client.query("INSERT INTO factory.delivery_intents(run_id,deployment_id,nonce_sha256,state) VALUES($1,$2,$3,'SENDING') RETURNING *",[row.run_id,deploymentId,createHash('sha256').update(nonce).digest('hex')])).rows[0];
      return{created:true,intent};
    });
  }
  async recordDeliverySend(runId,messageId=null) {
    if(messageId!==null&&(typeof messageId!=='string'||!messageId.length||messageId.length>256))throw Error('INVALID_MESSAGE_ID');
    return this.transaction(async client=>{
      await client.query("UPDATE factory.delivery_intents SET state=$2,message_id=$3 WHERE run_id=$1 AND state='SENDING'",[runId,messageId?'ACCEPTED':'UNKNOWN',messageId]);
    });
  }
  async acceptDelivery(runId,deploymentId,nonce,messageId) {
    if(typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce)||typeof messageId!=='string'||!messageId.length||messageId.length>256)throw Error('INVALID_DELIVERY');
    return this.transaction(async client=>{
      const result=await client.query("UPDATE factory.delivery_intents SET state='DELIVERED',message_id=$4,delivered_at=COALESCE(delivered_at,clock_timestamp()) WHERE run_id=$1 AND deployment_id=$2 AND nonce_sha256=$3 AND (message_id IS NULL OR message_id=$4) RETURNING run_id",[runId,deploymentId,createHash('sha256').update(nonce).digest('hex'),messageId]);
      if(!result.rowCount)throw Error('DELIVERY_BINDING_MISMATCH');
      // A delivery authenticates the wake-up only. claim() still checks deadline,
      // cancellation, spend binding and the sole durable execution resource.
      return(await client.query('SELECT * FROM factory.intake_receipts WHERE run_id=$1',[runId])).rows[0];
    });
  }
  async recoveryBinding(runId,deploymentId,nonce) {
    if(typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce))throw Error('INVALID_DELIVERY');
    return this.transaction(async client=>{
      const row=(await client.query('SELECT i.* FROM factory.intake_receipts i JOIN factory.delivery_intents d ON d.run_id=i.run_id WHERE i.run_id=$1 AND d.deployment_id=$2 AND d.nonce_sha256=$3',[runId,deploymentId,createHash('sha256').update(nonce).digest('hex')])).rows[0];
      if(!row)throw Error('DELIVERY_BINDING_MISMATCH');return row;
    });
  }
  async advanceResource(runId,leaseOwner,generation,state,evidence={}) {
    const previous={PREPARING:'ALLOCATING',READY:'PREPARING',RUNNING:'READY',QUIESCING:'RUNNING',COLLECTING:'QUIESCING'}[state];
    if(!previous||Buffer.byteLength(canonical(evidence))>16000)throw Error('INVALID_RESOURCE_TRANSITION');
    return this.transaction(async client=>{
      const result=await client.query(`UPDATE factory.execution_resources SET state=$4,evidence=evidence||$5::jsonb,updated_at=clock_timestamp() WHERE run_id=$1 AND lease_owner=$2 AND lease_generation=$3 AND state=$6 AND provider_session_id IS NOT NULL AND lease_expires_at>clock_timestamp() AND deadline>clock_timestamp() AND cancelled_at IS NULL AND NOT cleanup_confirmed RETURNING *`,[runId,leaseOwner,generation,state,evidence,previous]);
      if(!result.rowCount)throw Error('RESOURCE_TRANSITION_FENCED');
      const row=(await client.query('SELECT * FROM factory.intake_receipts WHERE run_id=$1',[runId])).rows[0];
      await this.event(client,row,'factory.resource_advanced',{state});return result.rows[0];
    });
  }
  async retainCustody(runId,leaseOwner,generation,receipt) {
    if(!receipt||Object.keys(receipt).sort().join(',')!=='bytes,commit,pathname,sha256,tree'||!Number.isSafeInteger(receipt.bytes)||receipt.bytes<1||receipt.bytes>256000||!/^[a-f0-9]{40}$/.test(receipt.commit)||!/^[a-f0-9]{40}$/.test(receipt.tree)||!/^[a-f0-9]{64}$/.test(receipt.sha256)||receipt.pathname!==`factory/staging/runs/${runId}/${receipt.sha256}.json`)throw Error('INVALID_CUSTODY_RECEIPT');
    return this.transaction(async client=>{
      const resource=(await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1',[runId])).rows[0];
      if(!resource||resource.lease_owner!==leaseOwner||resource.lease_generation!==generation||!resource.provider_session_id)throw Error('CUSTODY_RESOURCE_MISMATCH');
      // Collection is observation, not execution authority: retain authenticated
      // bytes even if cancellation raced with storage readback.
      if(!['COLLECTING','DESTROYED'].includes(resource.state)||(await client.query("SELECT 1 FROM factory.events WHERE run_id=$1 AND type='factory.resource_advanced' AND payload->>'state'='COLLECTING'",[runId])).rowCount!==1)throw Error('CUSTODY_BEFORE_QUIESCENCE');
      const prior=(await client.query('SELECT * FROM factory.candidate_custody WHERE run_id=$1',[runId])).rows[0];
      if(prior){if(prior.candidate_commit!==receipt.commit||prior.candidate_tree!==receipt.tree||prior.artifact_sha256!==receipt.sha256||prior.artifact_path!==receipt.pathname||prior.artifact_bytes!==receipt.bytes)throw Error('CUSTODY_CONFLICT');return prior;}
      return(await client.query('INSERT INTO factory.candidate_custody(run_id,candidate_commit,candidate_tree,artifact_sha256,artifact_path,artifact_bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[runId,receipt.commit,receipt.tree,receipt.sha256,receipt.pathname,receipt.bytes])).rows[0];
    });
  }
  async confirmCleanup(runId,leaseOwner,generation,providerSessionId) {
    return this.transaction(async(client,now)=>{
      const resource=(await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1',[runId])).rows[0];
      if(!resource||resource.lease_owner!==leaseOwner||resource.lease_generation!==generation||resource.provider_session_id!==providerSessionId)throw Error('CLEANUP_RESOURCE_MISMATCH');
      // With no allocation receipt, an early 404 cannot prove absence. Only a
      // delayed provider lookup after the original deadline + grace can resolve it.
      if(!providerSessionId&&now<new Date(resource.deadline).getTime()+30000)throw Error('CLEANUP_TOO_EARLY');
      await client.query("UPDATE factory.execution_resources SET state='DESTROYED',cleanup_confirmed=true,allocation_unknown=false,updated_at=clock_timestamp() WHERE run_id=$1",[runId]);
      const row=(await client.query('SELECT * FROM factory.intake_receipts WHERE run_id=$1',[runId])).rows[0];
      await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced' WHERE work_id=$1 AND work_generation=$2",[row.work_id,row.work_generation]);
      if(!resource.cleanup_confirmed)await this.event(client,row,'factory.resource_destroyed',{providerName:resource.provider_name,providerSessionId});
    });
  }
  async noteResource(runId,leaseOwner,generation,evidence) {
    if(Buffer.byteLength(canonical(evidence))>16000)throw Error('EVIDENCE_BOUND');
    return this.transaction(async client=>{
      const r=await client.query('UPDATE factory.execution_resources SET evidence=evidence||$4::jsonb,updated_at=clock_timestamp() WHERE run_id=$1 AND lease_owner=$2 AND lease_generation=$3 RETURNING run_id',[runId,leaseOwner,generation,evidence]);
      if(!r.rowCount)throw Error('RESOURCE_EVIDENCE_MISMATCH');
    });
  }
  async finalize(clientId,requestId,requestedStatus) {
    if(!['COMPLETED','FAILED','CANCELLED'].includes(requestedStatus))throw Error('INVALID_TERMINAL_STATE');
    return this.transaction(async(client,now)=>{
      const row=await this.record(client,clientId,requestId);
      const prior=(await client.query("SELECT payload FROM factory.events WHERE run_id=$1 AND type='factory.terminal'",[row.run_id])).rows[0];
      if(prior)return prior.payload;
      const resource=(await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1',[row.run_id])).rows[0];
      const stopped=(await client.query("SELECT 1 FROM factory.events WHERE run_id=$1 AND type='factory.stop_requested'",[row.run_id])).rowCount>0;
      if((resource&&!resource.cleanup_confirmed)||(!resource&&!stopped))throw Error('RESOURCE_NOT_QUIESCENT');
      const custody=(await client.query('SELECT * FROM factory.candidate_custody WHERE run_id=$1',[row.run_id])).rows[0];
      const expired=new Date(row.deadline).getTime()<=now;
      const status=stopped?'CANCELLED':expired||resource?.evidence.failure?'FAILED':requestedStatus;
      if(status==='CANCELLED'&&!stopped)throw Error('CANCELLATION_NOT_REQUESTED');
      if(status==='COMPLETED'&&(!custody||resource.evidence.visibleChecksPassed!==true))throw Error('CANDIDATE_NOT_CHECKED');
      const finishedAt=new Date(now).toISOString(),state=status==='COMPLETED'?'ready_for_review':status.toLowerCase();
      const terminal={status,finishedAt,candidateCommit:custody?.candidate_commit??null,evidenceRef:`factory:run:${row.run_id}:cleanup`,protectedVerification:'NOT_RUN'};
      await client.query("UPDATE factory.runs SET state=$2,record=record||$3::jsonb WHERE id=$1",[row.run_id,state,{state,finishedAt,candidateCommit:terminal.candidateCommit,failure:status==='FAILED'?(resource?.evidence.failure??(expired?'WORK_DEADLINE_EXPIRED':resource?.evidence.visibleChecksPassed===false?'VISIBLE_CHECKS_FAILED':'EXECUTION_INTERRUPTED')):null}]);
      await client.query("UPDATE factory.work_orders SET state=$2,record=record||$3::jsonb,updated_at=clock_timestamp() WHERE id=$1",[row.work_order_id,state,{state,updatedAt:finishedAt}]);
      await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced' WHERE work_id=$1 AND work_generation=$2",[row.work_id,row.work_generation]);
      await this.event(client,row,'factory.terminal',terminal);return terminal;
    });
  }
  async saveResult(clientId,requestId,result) {
    return this.transaction(async client=>{
      const row=await this.record(client,clientId,requestId);
      const terminal=(await client.query("SELECT payload FROM factory.events WHERE run_id=$1 AND type='factory.terminal'",[row.run_id])).rows[0]?.payload;
      if(!terminal)throw Error('RESULT_BEFORE_QUIESCENCE');
      const manifest=JSON.parse(Buffer.from(result.encoded,'base64url').toString('utf8'));
      if(canonical(manifest.execution)!==canonical(row.snapshot)||manifest.status!==terminal.status||manifest.completedAt!==terminal.finishedAt||(manifest.candidate?.commit??null)!==terminal.candidateCommit)throw Error('RESULT_TERMINAL_MISMATCH');
      const prior=(await client.query("SELECT payload FROM factory.events WHERE run_id=$1 AND type='run.signed_result'",[row.run_id])).rows[0]?.payload;
      if(prior){if(canonical(prior)!==canonical(result))throw Error('RESULT_CONFLICT');return prior;}
      await this.event(client,row,'run.signed_result',result);return result;
    });
  }
  async findRun(clientId,workOrderId,runId) {
    return this.transaction(async client=>{
      const row=(await client.query('SELECT request_id FROM factory.intake_receipts WHERE client_id=$1 AND work_order_id=$2 AND run_id=$3',[clientId,workOrderId,runId])).rows[0];
      if(!row)throw Error('FACTORY_REQUEST_NOT_FOUND');return row;
    });
  }
  async read(clientId,requestId) {
    return this.transaction(async client=>{
      const row=await this.record(client,clientId,requestId);
      const resource=(await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1',[row.run_id])).rows[0]??null;
      const events=(await client.query('SELECT type,payload,created_at FROM factory.events WHERE run_id=$1 ORDER BY id',[row.run_id])).rows;
      const custody=(await client.query('SELECT * FROM factory.candidate_custody WHERE run_id=$1',[row.run_id])).rows[0]??null;
      const delivery=(await client.query('SELECT state FROM factory.delivery_intents WHERE run_id=$1',[row.run_id])).rows[0]??null;
      return{...row,resource,events,custody,delivery};
    });
  }
}
