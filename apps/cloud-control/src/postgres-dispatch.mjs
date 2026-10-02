import { randomUUID } from 'node:crypto';
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
  async read(clientId,requestId) {
    return this.transaction(async client=>{
      const row=await this.record(client,clientId,requestId);
      const resource=(await client.query('SELECT * FROM factory.execution_resources WHERE run_id=$1',[row.run_id])).rows[0]??null;
      const events=(await client.query('SELECT type,payload,created_at FROM factory.events WHERE run_id=$1 ORDER BY id',[row.run_id])).rows;
      return{...row,resource,events};
    });
  }
}
