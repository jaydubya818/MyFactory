import {canonical,digest} from '../../../packages/hosted-routing/src/result.ts';

export const receiverScopeKeys=['ownerId','organizationId','installationId','backendId','incarnation','enrollmentVersion'];
const columns=['owner_id','organization_id','installation_id','backend_id','incarnation','enrollment_version'];
export const receiverTables=['capability_fences','capability_control_observations','capability_admission_references',
  'capability_receiver_heads','relay_policy_receipts','capability_receiver_plans'];
const where=columns.map((key,index)=>`${key}=$${index+1}`).join(' AND ');
export function assertReceiverScope(scope){
  if(!scope||Object.keys(scope).sort().join(',')!==[...receiverScopeKeys].sort().join(',')
    ||receiverScopeKeys.slice(0,-1).some(key=>typeof scope[key]!=='string'||!scope[key].length||scope[key].length>255||scope[key]!==scope[key].trim())
    ||!Number.isSafeInteger(scope.enrollmentVersion)||scope.enrollmentVersion<1)throw Error('FACTORY_RECEIVER_SCOPE');
}
export const scopeValues=scope=>receiverScopeKeys.map(key=>scope[key]);
export function receiverHead(scope,enrollmentDigest,sequence,collections,plans){
  return {schema:'capability-control.recovery-head.v1',ownerId:scope.ownerId,organizationId:scope.organizationId,
    installationId:scope.installationId,revision:sequence,
    digest:digest({domain:'factory-capability-receiver-state/v1',enrollmentDigest,receiverSequence:sequence,
      collections,appliedPlans:plans})};
}
const equal=(a,b)=>canonical(a)===canonical(b);
export class PostgresCapabilityReceiver {
  constructor(pool,scope,enrollmentDigest){
    assertReceiverScope(scope);
    if(!/^[a-f0-9]{64}$/.test(enrollmentDigest))throw Error('FACTORY_RECEIVER_ENROLLMENT');
    this.pool=pool;this.scope=Object.freeze({...scope});this.enrollmentDigest=enrollmentDigest;
  }
  async context(client){
    const names=['owner','organization','installation','backend','incarnation','enrollment'];
    for(let i=0;i<names.length;i++)await client.query('SELECT set_config($1,$2,true)',[`factory.capability_${names[i]}`,String(scopeValues(this.scope)[i])]);
  }
  async transaction(action){
    const client=await this.pool.connect();let commitSent=false;
    try{
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='1000ms'; SET LOCAL transaction_timeout='1000ms'");
      await client.query('SELECT pg_advisory_xact_lock(81427603)');await this.context(client);
      const now=Number((await client.query('SELECT extract(epoch FROM clock_timestamp())*1000 AS now')).rows[0].now);
      const value=await action(client,now);commitSent=true;await client.query('COMMIT');return value;
    }catch(error){
      let rollbackAcknowledged=false;
      try{await client.query('ROLLBACK');rollbackAcknowledged=true;}catch{}
      // C1: a client timer/connection loss cannot prove a server rollback.
      error.definitelyRolledBack=!commitSent&&rollbackAcknowledged&&typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code);
      throw error;
    }finally{client.release(true);}
  }
  async rows(client,table){
    if(!receiverTables.includes(table))throw Error('FACTORY_RECEIVER_TABLE');
    const rows=(await client.query(`SELECT * FROM factory.${table} WHERE ${where} ORDER BY receiver_sequence,record_key${table==='capability_receiver_plans'?',record_kind':''} LIMIT 4097`,scopeValues(this.scope))).rows;
    if(rows.length>4096)throw Error('FACTORY_RECEIVER_BOUND');
    for(const row of rows){if(digest(row.payload)!==row.payload_digest)throw Error('FACTORY_RECEIVER_CORRUPT');}
    return rows;
  }
  async append(client,table,key,sequence,payload,kind){
    if(!receiverTables.includes(table)||!Number.isSafeInteger(sequence)||sequence<1||sequence>4096
      ||Buffer.byteLength(canonical(payload))>65536)throw Error('FACTORY_RECEIVER_BOUND');
    const parameters=[...scopeValues(this.scope),sequence,key,payload,digest(payload),...(kind?[kind]:[])];
    await client.query(`INSERT INTO factory.${table}(${columns.join(',')},receiver_sequence,record_key,payload,payload_digest${kind?',record_kind':''})
      VALUES(${parameters.map((_,i)=>`$${i+1}`).join(',')}) ON CONFLICT DO NOTHING`,parameters);
    const row=(await client.query(`SELECT * FROM factory.${table} WHERE ${where} AND record_key=$7${kind?' AND record_kind=$8':''}`,
      [...scopeValues(this.scope),key,...(kind?[kind]:[])])).rows[0];
    if(!row||row.receiver_sequence!==sequence||row.payload_digest!==digest(payload)||!equal(row.payload,payload))throw Error('FACTORY_RECEIVER_REPLAY_CONFLICT');
  }
  async state(client){
    const data={};for(const table of receiverTables)data[table]=await this.rows(client,table);
    if(receiverTables.filter(t=>t!=='capability_receiver_heads').reduce((n,t)=>n+data[t].length,0)>4096)throw Error('FACTORY_RECEIVER_BOUND');
    const heads=data.capability_receiver_heads;
    if(!heads.length)throw Error('FACTORY_RECEIVER_ENROLLMENT_REQUIRED');
    const plans=data.capability_receiver_plans.filter(row=>row.record_kind==='PLAN');
    const collectionsAt=sequence=>Object.fromEntries(receiverTables.filter(t=>!['capability_receiver_heads','capability_receiver_plans'].includes(t))
      .map(table=>[table,data[table].filter(row=>row.receiver_sequence<=sequence).map(row=>({key:row.record_key,sequence:row.receiver_sequence,payload:row.payload}))]));
    const plansBySequence=new Map();
    for(const plan of plans){
      if(plansBySequence.has(plan.receiver_sequence))throw Error('FACTORY_RECEIVER_PLAN_MISSING');
      plansBySequence.set(plan.receiver_sequence,plan);
    }
    // Validate the chain once. Each applied plan hash binds its previous head;
    // the independently witnessed latest digest covers every applied plan and
    // immutable row. Rehashing every growing historical snapshot is unnecessary.
    for(let i=0;i<heads.length;i++){
      const row=heads[i],sequence=i+1,plan=plansBySequence.get(sequence);
      if(row.receiver_sequence!==sequence||row.payload.head?.revision!==sequence
        ||!receiverScopeKeys.slice(0,3).every(key=>row.payload.head[key]===this.scope[key])
        ||row.payload.head.schema!=='capability-control.recovery-head.v1'
        ||!/^[a-f0-9]{64}$/.test(row.payload.head.digest)
        ||row.payload.previousDigest!==(i?heads[i-1].payload.head.digest:null))throw Error('FACTORY_RECEIVER_RESTORED');
      if(sequence>1&&(!plan||!equal(plan.payload.previous,heads[i-1].payload.head)
        ||plan.payload.id!==plan.record_key||plan.record_key!==digest(Object.fromEntries(Object.entries(plan.payload).filter(([k])=>k!=='id')))))
        throw Error('FACTORY_RECEIVER_PLAN_MISSING');
    }
    const head=heads.at(-1).payload.head;
    const expected=receiverHead(this.scope,this.enrollmentDigest,head.revision,collectionsAt(head.revision),
      plans.filter(p=>p.receiver_sequence<=head.revision).map(p=>({id:p.record_key,digest:p.payload_digest})));
    if(!equal(head,expected))throw Error('FACTORY_RECEIVER_RESTORED');
    if(receiverTables.some(t=>t!=='capability_receiver_plans'&&data[t].some(row=>row.receiver_sequence>head.revision)))throw Error('FACTORY_RECEIVER_RESTORED');
    const pending=plans.filter(row=>row.receiver_sequence>head.revision);
    if(pending.length>1||pending.some(row=>row.receiver_sequence!==head.revision+1))throw Error('FACTORY_RECEIVER_RESTORED');
    return {head,data,pending,collections:collectionsAt(head.revision),appliedPlans:plans.filter(p=>p.receiver_sequence<=head.revision).map(p=>({id:p.record_key,digest:p.payload_digest}))};
  }
  async makePlan(client,state,identity,rows,now){
    if(receiverTables.filter(t=>t!=='capability_receiver_heads').reduce((n,t)=>n+state.data[t].length,0)+rows.length+2>4096)throw Error('FACTORY_RECEIVER_BOUND');
    if(state.pending.length||state.head.revision>=4096)throw Error('FACTORY_RECEIVER_PENDING');
    const sequence=state.head.revision+1;
    const material={domain:'factory-capability-receiver-plan/v1',scope:this.scope,identity,previous:state.head,rows,createdAt:now};
    const id=digest(material),collections=structuredClone(state.collections);
    for(const row of rows){
      if(!Object.hasOwn(collections,row.table))throw Error('FACTORY_RECEIVER_TABLE');
      if(collections[row.table].some(old=>old.key===row.key))throw Error('FACTORY_RECEIVER_REPLAY_CONFLICT');
      collections[row.table].push({key:row.key,sequence,payload:row.payload});
      collections[row.table].sort((a,b)=>a.sequence-b.sequence||a.key.localeCompare(b.key));
    }
    const plan={...material,id};
    const next=receiverHead(this.scope,this.enrollmentDigest,sequence,collections,[...state.appliedPlans,{id,digest:digest(plan)}]);
    await this.append(client,'capability_receiver_plans',id,sequence,plan,'PLAN');
    return {plan,next};
  }
  plannedHead(state,row){
    const plan=row.payload;
    if(plan.id!==row.record_key||plan.id!==digest(Object.fromEntries(Object.entries(plan).filter(([k])=>k!=='id')))
      ||!equal(plan.scope,this.scope)||!equal(plan.previous,state.head))throw Error('FACTORY_RECEIVER_PLAN_CORRUPT');
    const collections=structuredClone(state.collections);
    for(const change of plan.rows){
      if(!Object.hasOwn(collections,change.table))throw Error('FACTORY_RECEIVER_PLAN_CORRUPT');
      collections[change.table].push({key:change.key,sequence:row.receiver_sequence,payload:change.payload});
      collections[change.table].sort((a,b)=>a.sequence-b.sequence||a.key.localeCompare(b.key));
    }
    return receiverHead(this.scope,this.enrollmentDigest,row.receiver_sequence,collections,[...state.appliedPlans,{id:plan.id,digest:row.payload_digest}]);
  }
  async apply(client,plan,next){
    const state=await this.state(client);
    if(!equal(state.head,plan.previous))throw Error('FACTORY_RECEIVER_HEAD_CHANGED');
    for(const row of plan.rows)await this.append(client,row.table,row.key,next.revision,row.payload);
    await this.append(client,'capability_receiver_heads',String(next.revision),next.revision,{head:next,previousDigest:state.head.digest});
  }
}
