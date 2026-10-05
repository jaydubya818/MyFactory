import { nonempty, positive, map, sameAttempt, assertSpendBinding, assertReservation, assertCompletionOperations, validateBudget, assertBindAuthority, matchesCurrent, spendSummary } from '../../../packages/storage/src/spend-policy.ts';

// Same WORK_LEDGER_V2 policy as the qualified SQLite ledger. PostgreSQL owns all
// durable state; neither the worker nor an in-memory cache can admit operations.
// This small staging deployment serializes writes with one transaction lock,
// matching the existing BEGIN IMMEDIATE semantics. No provider effects occur here.
export class PostgresSpendLedger {
  constructor(pool, { requireExecutionLease = true, assertPaidAuthority } = {}) { this.assertPaidAuthority=assertPaidAuthority;this.pool = pool; this.requireExecutionLease=requireExecutionLease; }
  async assertExecutionLease(client,binding) {
    if(this.assertPaidAuthority)await this.assertPaidAuthority(client,binding);
    if(!this.requireExecutionLease)return; // Explicit standalone policy-parity tests only.
    const result=await client.query(`SELECT 1 FROM factory.execution_resources WHERE run_id=$1 AND provider_session_id IS NOT NULL AND state='RUNNING' AND lease_expires_at>clock_timestamp() AND deadline>clock_timestamp() AND cancelled_at IS NULL AND NOT cleanup_confirmed`,[binding.runId]);
    if(result.rowCount!==1)throw Error('Cloud execution lease fenced or not running');
  }
  async transaction(action) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(81427603)');
      const now = Number((await client.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now')).rows[0].now);
      const normalize = row => {
        if (!row) return undefined;
        for (const key of ['ceiling_microusd','per_operation_reserve_microusd','completion_reserve_microusd','reserved_microusd','actual_microusd']) {
          if (row[key] != null) { row[key] = Number(row[key]); if (!Number.isSafeInteger(row[key])) throw Error('UNSAFE_LEDGER_INTEGER'); }
        }
        return row;
      };
      const budget = async id => normalize((await client.query('SELECT * FROM factory.work_spend_budgets WHERE work_id=$1',[id])).rows[0]);
      const operations = async id => (await client.query('SELECT * FROM factory.work_spend_operations WHERE work_id=$1 ORDER BY created_at,operation_id',[id])).rows.map(row=>map(normalize(row)));
      const operation = async id => { const row=normalize((await client.query('SELECT * FROM factory.work_spend_operations WHERE operation_id=$1',[id])).rows[0]);return row?map(row):null; };
      const result = await action({ client, now, timestamp: new Date(now).toISOString(), budget, operations, operation });
      await client.query('COMMIT');
      return result;
    } catch(error) { await client.query('ROLLBACK').catch(()=>{});throw error; }
    finally { client.release(); }
  }
  async createBudget(binding, ceiling, deadline, plan) {
    return this.transaction(async ({client,now,timestamp,budget,operations})=>{
      validateBudget(binding,ceiling,deadline,plan,now);
      const {workId,workGeneration,requestId,workOrderId}=binding;
      const previous=await budget(workId);
      if(previous) {
        if(previous.ceiling_microusd!==ceiling||previous.cancelled_at||workGeneration<previous.work_generation)throw Error('Work ceiling or cancellation cannot reset');
        if(previous.contract_version!==(plan?.version??'WORK_LEDGER_V1')||(plan&&(previous.pricing_revision!==plan.pricingRevision||previous.model!==plan.model||previous.per_operation_reserve_microusd!==plan.perOperationReserveMicrousd||previous.planned_productive_operations!==plan.plannedProductiveOperations||previous.planned_completion_operations!==plan.plannedCompletionOperations||previous.max_paid_operations!==plan.maxPaidOperations||previous.completion_reserve_microusd!==plan.completionReserveMicrousd||previous.pricing_valid_until!==plan.validUntil)))throw Error('Work spend plan cannot reset');
        if(workGeneration===previous.work_generation){if(previous.deadline!==deadline||previous.request_id!==requestId||previous.work_order_id!==workOrderId)throw Error('Work generation binding conflict');return;}
        if((await operations(workId)).some(op=>['reserved','dispatched','unknown'].includes(op.state)))throw Error('Prior Work generation has active spend operations');
        await client.query("UPDATE factory.work_spend_budgets SET work_generation=$2,request_id=$3,work_order_id=$4,deadline=$5,authority_state='prepared',authority_dispatch_identity=NULL,authority_factory_version=NULL,authority_run_id=NULL,phase='productive' WHERE work_id=$1",[workId,workGeneration,requestId,workOrderId,deadline]);return;
      }
      await client.query(`INSERT INTO factory.work_spend_budgets (work_id,work_generation,request_id,work_order_id,ceiling_microusd,deadline,created_at,contract_version,pricing_revision,model,pricing_valid_until,per_operation_reserve_microusd,planned_productive_operations,planned_completion_operations,max_paid_operations,completion_reserve_microusd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[workId,workGeneration,requestId,workOrderId,ceiling,deadline,timestamp,plan?.version??'WORK_LEDGER_V1',plan?.pricingRevision??null,plan?.model??null,plan?.validUntil??null,plan?.perOperationReserveMicrousd??0,plan?.plannedProductiveOperations??0,plan?.plannedCompletionOperations??0,plan?.maxPaidOperations??0,plan?.completionReserveMicrousd??0]);
    });
  }
  async bindAuthority(binding) {
    for(const [key,value] of Object.entries(binding))key==='workGeneration'?positive(value,key):nonempty(value,key);
    return this.transaction(async({client,now,budget})=>{
      assertBindAuthority(await budget(binding.workId),binding,now);
      await client.query("UPDATE factory.work_spend_budgets SET authority_dispatch_identity=$2,authority_factory_version=$3,authority_run_id=$4,authority_state='active' WHERE work_id=$1",[binding.workId,binding.dispatchIdentity,binding.factoryVersion,binding.runId]);
    });
  }
  async reserve(input) {
    for(const [key,value] of Object.entries(input))['workGeneration','reservedMicrousd'].includes(key)?positive(value,key):nonempty(value,key);
    if(!['productive','completion'].includes(input.phase))throw Error('Invalid paid phase');
    return this.transaction(async({client,now,timestamp,budget,operations,operation})=>{
      if(await operation(input.operationId))throw Error('Spend operation already exists; replay cannot redispatch');
      const b=await budget(input.workId);assertSpendBinding(b,input,input.phase,now);assertReservation(b,await operations(input.workId),input);
      await this.assertExecutionLease(client,input);
      await client.query(`INSERT INTO factory.work_spend_operations (operation_id,work_id,work_generation,dispatch_identity,request_id,work_order_id,factory_version,run_id,model,pricing_revision,reserved_microusd,state,created_at,updated_at,phase) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reserved',$12,$12,$13)`,[input.operationId,input.workId,input.workGeneration,input.dispatchIdentity,input.requestId,input.workOrderId,input.factoryVersion,input.runId,input.model,input.pricingRevision,input.reservedMicrousd,timestamp,input.phase]);
      return operation(input.operationId);
    });
  }
  async markDispatched(id) {
    return this.transaction(async({client,now,timestamp,budget,operation,operations})=>{
      const op=await operation(id);if(!op||op.state!=='reserved')throw Error('Only a fresh reservation can cross the paid boundary');
      const b=await budget(op.workId);assertSpendBinding(b,op,op.phase,now);
      await this.assertExecutionLease(client,op);
      if(b.model!==op.model||b.pricing_revision!==op.pricingRevision||b.per_operation_reserve_microusd!==op.reservedMicrousd)throw Error('Pricing changed before dispatch');
      if((await operations(op.workId)).some(other=>other.operationId!==id&&['reserved','dispatched','unknown'].includes(other.state)))throw Error('UNKNOWN exposure blocks paid dispatch');
      await client.query("UPDATE factory.work_spend_operations SET state='dispatched',updated_at=$2 WHERE operation_id=$1",[id,timestamp]);
    });
  }
  async settle(id,actual,requestId,usage) {
    if(!Number.isSafeInteger(actual)||actual<0)throw Error('Invalid actual spend');nonempty(requestId,'providerRequestId');
    if(!usage||!Number.isSafeInteger(usage.input_tokens)||!Number.isSafeInteger(usage.output_tokens)||usage.input_tokens<0||usage.output_tokens<0)throw Error('Authoritative usage is required');
    return this.transaction(async({client,timestamp,operation})=>{
      const op=await operation(id);if(!op||!['dispatched','unknown'].includes(op.state))throw Error('Only dispatched or unknown operation can settle');
      if(actual>op.reservedMicrousd)throw Error('Actual cost exceeded reservation; retain UNKNOWN exposure');
      await client.query("UPDATE factory.work_spend_operations SET actual_microusd=$2,provider_request_id=$3,usage_json=$4,state='settled',updated_at=$5 WHERE operation_id=$1",[id,actual,requestId,JSON.stringify(usage),timestamp]);
    });
  }
  async releaseUndispatched(id) {
    return this.transaction(async({client,timestamp,operation})=>{
      const op=await operation(id);
      if(!op||op.state!=='reserved')throw Error('Dispatch absence is not proven');
      await client.query("UPDATE factory.work_spend_operations SET state='released',updated_at=$2 WHERE operation_id=$1",[id,timestamp]);
    });
  }
  async markUnknown(id) { return this.transaction(async({client,timestamp})=>{await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced' WHERE work_id IN (SELECT work_id FROM factory.work_spend_operations WHERE operation_id=$1 AND state IN ('reserved','dispatched','unknown'))",[id]);await client.query("UPDATE factory.work_spend_operations SET state='unknown',updated_at=$2 WHERE operation_id=$1 AND state IN ('reserved','dispatched','unknown')",[id,timestamp]);}); }
  async recoverUnknown() { return this.transaction(async({client,timestamp})=>{await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced' WHERE work_id IN (SELECT work_id FROM factory.work_spend_operations WHERE state IN ('reserved','dispatched','unknown'))");return (await client.query("UPDATE factory.work_spend_operations SET state='unknown',updated_at=$1 WHERE state IN ('reserved','dispatched')",[timestamp])).rowCount;}); }
  async completion(binding,transition=false,completed=false) {
    return this.transaction(async({client,now,budget,operations})=>{
      assertSpendBinding(await budget(binding.workId),binding,completed?'completion':'productive',now);
      await this.assertExecutionLease(client,binding);
      const ops=await operations(binding.workId);
      if(completed){if(!ops.some(op=>sameAttempt(op,binding)&&op.phase==='completion'&&op.state==='settled')||ops.some(op=>!['settled','released'].includes(op.state)))throw Error('Mandatory completion spend and accounting are not settled');}
      else assertCompletionOperations(ops,binding);
      if(transition)await client.query("UPDATE factory.work_spend_budgets SET phase='completion' WHERE work_id=$1",[binding.workId]);
    });
  }
  assertCompletionEligible(binding){return this.completion(binding);}
  beginCompletion(binding){return this.completion(binding,true);}
  assertCompleted(binding){return this.completion(binding,false,true);}
  async fenceAuthority(binding){return this.transaction(async({client,budget})=>{const b=await budget(binding.workId);if(!b)throw Error('Work budget missing');if(!matchesCurrent(b,binding))return false;await client.query("UPDATE factory.work_spend_budgets SET authority_state='fenced' WHERE work_id=$1",[binding.workId]);return true;});}
  async cancelBound(binding){return this.transaction(async({client,timestamp,budget})=>{const b=await budget(binding.workId);if(!b||!matchesCurrent(b,binding))throw Error('Stale Work authority cannot cancel current budget');await client.query("UPDATE factory.work_spend_budgets SET cancelled_at=COALESCE(cancelled_at,$2),authority_state='fenced' WHERE work_id=$1",[binding.workId,timestamp]);});}
  async cancel(workId){return this.transaction(async({client,timestamp})=>{const result=await client.query("UPDATE factory.work_spend_budgets SET cancelled_at=COALESCE(cancelled_at,$2),authority_state='fenced' WHERE work_id=$1",[workId,timestamp]);if(result.rowCount!==1)throw Error('Work budget missing');});}
  async getOperation(id){return this.transaction(({operation})=>operation(id));}
  async read(id){return this.transaction(async({now,budget,operations})=>{const b=await budget(id);return b?spendSummary(id,b,await operations(id),now):null;});}
}
