import {capabilityRegistry} from '../../../packages/capability-control/src/registry.ts';
import {signLifecycleReceipt} from '../../../packages/capability-enforcement/src/lifecycle-wire.ts';
import {receiverInventory,fenceInventory,aggregateLifecycle,inventoryMaterial} from './receiver-lifecycle.mjs';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '../../../packages/hosted-routing/src/result.ts';
import {parseCloudPrepare} from '../../../packages/contracts/src/cloud-execution.ts';
import {admissionActionDigest,verifyPolicyMessage,signPolicyMessage,policyMessageHash} from '../../../packages/capability-enforcement/src/ordering-wire.ts';
import {signFactoryPreparationTerminal} from '../../../packages/capability-enforcement/src/factory-preparation-terminal.ts';
import {assertReceiverScope,receiverScopeKeys} from './postgres-capability-receiver.mjs';

const same=(a,b)=>canonical(a)===canonical(b);
const headMatches=(actual,expected)=>actual&&Object.entries(expected).every(([k,v])=>actual[k]===v);
function assertMessageScope(message,enrollment){
  if(receiverScopeKeys.some(k=>message[k]!==enrollment.scope[k]))throw Error('FACTORY_POLICY_SCOPE');
}
export class OrderedFactoryAdmission {
  constructor({receiver,witness,directPool,enrollment,control,signer,assertRetainedAuthority,clientStores,clientControls,invalidateRetainedAuthority,isRetainedAuthorityFenced}){
    assertReceiverScope(enrollment?.scope);
    if(!receiver||!witness||!directPool||!control||!signer||typeof assertRetainedAuthority!=='function'||!enrollment.directEndpointVerified
      ||enrollment.environment!=='qualification'||!enrollment.agentId||!enrollment.registryVersion
      ||!enrollment.sourceKeys?.myeve||!enrollment.sourceKeys?.relay||!Array.isArray(enrollment.clientBindings)
      ||!enrollment.clientBindings.length||enrollment.clientBindings.length>128
      ||!same(enrollment.scope,receiver.scope))throw Error('FACTORY_RECEIVER_ENROLLMENT');
    const client=enrollment.clientBindings.find(x=>x.clientId===control.grant.clientId);
    if(!client||client.ownerId!==enrollment.scope.ownerId||client.agentId!==enrollment.agentId
      ||client.installationId!==enrollment.scope.installationId||client.organizationId!==enrollment.scope.organizationId
      ||control.ownerScope!==enrollment.scope.ownerId)throw Error('FACTORY_RECEIVER_ENROLLMENT');
    this.receiver=receiver;this.witness=witness;this.directPool=directPool;this.enrollment=Object.freeze(structuredClone(enrollment));
    this.control=control;this.signer=signer;this.assertRetainedAuthority=assertRetainedAuthority;
    this.clientControls=new Map(clientControls??[[control.grant.clientId,control]]);
    this.clientStores=new Map(clientStores??[...this.clientControls].map(([id,c])=>[id,c.store]));this.invalidateRetainedAuthority=invalidateRetainedAuthority;this.isRetainedAuthorityFenced=isRetainedAuthorityFenced;
    // The ordinary endpoint cannot fall back to co-located or unenrolled admission.
    control.store.orderedAdmissionRequired=true;
  }
  async locked(action){
    const client=await this.directPool.connect();let locked=false;
    const key=digest(this.enrollment.scope);
    try{
      locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0]?.locked===true;
      if(!locked)throw Error('FACTORY_RECEIVER_BUSY');return await action();
    }finally{
      if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>{});
      client.release(true);
    }
  }
  async snapshot(){return this.receiver.transaction(client=>this.receiver.state(client));}
  async assertCurrent(state,deadline){await this.witness.assert(state.head,deadline);}
  async recover(state,retry,deadline){
    if(!state.pending.length){await this.assertCurrent(state,deadline);return state;}
    const row=state.pending[0],next=this.receiver.plannedHead(state,row),actual=await this.witness.read(state.head,deadline);
    if(row.payload.identity.kind==='RELAY_REVOCATION'){
      if(!this.relayPolicyReceiver)throw Error('RELAY_POLICY_ENROLLMENT_UNAVAILABLE');
      this.relayPolicyReceiver.validateStoredPlan(row.payload);
    }
    let definiteDecline=false;
    if(headMatches(actual,state.head)){
      // read proves prior CAS termination before returning the old head. The
      // immutable, digest-bound plan is sufficient for recovery: rebuilding it
      // would require expired permits or a caller which can never reach prepare.
      // Consume its original references, but never replay native admission.
      await this.witness.advance(state.head,next,deadline);
      definiteDecline=true;
    }else
    if(!headMatches(actual,next))throw Error('FACTORY_RECEIVER_RESTORED');
    await this.receiver.transaction(async client=>{
      await this.receiver.apply(client,row.payload,next);
      if(row.payload.identity.kind==='ADMISSION')await this.outcome(client,row.payload,next,definiteDecline?'DEFINITELY_NOT_ADMITTED':'ADMISSION_UNCERTAIN',definiteDecline?'NATIVE_REVALIDATION_FAILED':'RESTORE_OR_COMMIT_AMBIGUITY');
      if(row.payload.identity.kind==='FENCE')await this.fenceRestrictions(client);
      if(row.payload.identity.kind==='RELAY_REVOCATION')await this.relayPolicyReceiver.fenceStoredPlan(client,row.payload);
    });
    const restored=await this.snapshot();await this.assertCurrent(restored);return restored;
  }
  async outcome(client,plan,next,outcome,reasonCode,native=null){
    await this.receiver.append(client,'capability_receiver_plans',plan.id,next.revision,
      {planId:plan.id,planDigest:digest(plan),receiverHeadDigest:next.digest,outcome,reasonCode,native},'OUTCOME');
  }
  async transition(identity,build,effect){
    return this.locked(async()=>{
      const deadline=performance.now()+2000;
      const initial=await this.snapshot();
      let state=await this.recover(initial,{identity,build},deadline);
      if(identity.kind==='ADMISSION'&&initial.pending.some(row=>same(row.payload.identity,identity)))return {replayed:true};
      const prepared=await this.receiver.transaction(async(client,now)=>{
        const current=await this.receiver.state(client);
        if(!same(current.head,state.head))throw Error('FACTORY_RECEIVER_HEAD_CHANGED');
        const rows=await build(client,current,now);
        if(!rows.length)return null;
        return this.receiver.makePlan(client,current,identity,rows,now);
      });
      if(!prepared)return {replayed:true};
      // Independent CAS is outside every native execution/accounting transaction.
      await this.witness.advance(state.head,prepared.next,deadline);
      let result;
      try{
        result=await this.receiver.transaction(async(client,now)=>{
          await this.receiver.apply(client,prepared.plan,prepared.next);
          if(!effect)return null;
          await client.query('SAVEPOINT native_admission');
          try{
            const native=await effect(client,now);
            await client.query('RELEASE SAVEPOINT native_admission');
            if(identity.kind==='ADMISSION')await this.outcome(client,prepared.plan,prepared.next,'ADMITTED','ADMITTED',native);
            return {admitted:true,native};
          }catch(error){
            // Only server-reported SQL failures or explicit native validation
            // declines can be rolled back as definite; transport failures escape.
            if(identity.kind!=='ADMISSION'||!error.nativeValidation&&!(typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code)))throw error;
            await client.query('ROLLBACK TO SAVEPOINT native_admission');
            await this.outcome(client,prepared.plan,prepared.next,'DEFINITELY_NOT_ADMITTED',error.reasonCode??'NATIVE_REVALIDATION_FAILED');
            return {admitted:false};
          }
        });
      }catch(error){
        if(error.definitelyRolledBack&&identity.kind==='ADMISSION'){
          // C1: the second transaction must succeed before a decline is claimed.
          await this.receiver.transaction(async client=>{
            await this.receiver.apply(client,prepared.plan,prepared.next);
            await this.outcome(client,prepared.plan,prepared.next,'DEFINITELY_NOT_ADMITTED','LOCK_TIMEOUT');
          });result={admitted:false};
        }else throw error;
      }
      state=await this.snapshot();await this.assertCurrent(state);
      return {...result,plan:prepared.plan,next:prepared.next};
    });
  }
  latestFence(state,authority){return state.data.capability_fences.filter(x=>x.payload.message.authority===authority)
    .sort((a,b)=>a.payload.message.version-b.payload.message.version).at(-1)?.payload;}
  async fenceRestrictions(client){
    const state=await this.receiver.state(client);
    for(const restriction of this.restrictions(state).filter(r=>!r.unqualified)){
      const inventory=await receiverInventory(this,client,state,id=>id.policyRevision<=restriction.version);
      await fenceInventory(this,client,inventory,restriction);
    }
  }
  async receiveFence(envelope){
    const parsed=JSON.parse(envelope?.message??'null');
    const key=this.enrollment.sourceKeys[parsed?.authority];
    if(!key)throw Error('FACTORY_POLICY_SCOPE');
    const message=await verifyPolicyMessage(envelope,key);
    if(message.kind!=='FENCE')throw Error('FACTORY_POLICY_KIND');assertMessageScope(message,this.enrollment);
    const hash=await policyMessageHash(message);
    const ack=await signPolicyMessage({...Object.fromEntries(receiverScopeKeys.map(k=>[k,message[k]])),
      authority:message.authority,version:message.version,policyId:message.policyId,kind:'FENCE_ACK',fenceHash:hash},this.signer);
    await this.transition({kind:'FENCE',hash},async(_client,state)=>{
      const latest=this.latestFence(state,message.authority);
      if(latest&&message.version<latest.message.version)throw Error('FACTORY_POLICY_STALE');
      if(latest&&message.version===latest.message.version){if(latest.hash!==hash)throw Error('FACTORY_POLICY_CONFLICT');return [];}
      return [{table:'capability_fences',key:`${message.authority}:${message.version}`,payload:{message,envelope,hash,ack}}];
    },async client=>{
      if(message.authority!=='myeve')return null; // Relay epochs are not owner-wide revoke intent.
      await this.fenceRestrictions(client);return null;
    });
    const state=await this.snapshot();await this.assertCurrent(state);
    return this.latestFence(state,message.authority).ack;
  }
  restrictions(state){
    const result=new Map(),known=new Set(capabilityRegistry.capabilities.map(c=>c.id));
    for(const row of state.data.capability_fences){
      const m=row.payload.message;if(m.authority!=='myeve')continue;
      const controls=[...(m.controls??[]),...(['pause','revoke'].includes(m.operation)?[{capabilityId:m.capabilityId,operation:m.operation,version:m.version,policyId:m.policyId}]:[])];
      for(const control of controls){
        if(!known.has(control.capabilityId))result.set('unknown:'+digest(control),{...control,unqualified:true});
        else if(['work','myfactory'].includes(control.capabilityId))result.set(digest(control),control);
      }
    }return [...result.values()].sort((a,b)=>canonical(a).localeCompare(canonical(b)));
  }
  async observeControl(envelope){
    const message=await verifyPolicyMessage(envelope,this.enrollment.sourceKeys.myeve);
    if(message.kind!=='FENCE'||message.authority!=='myeve'||!['pause','revoke'].includes(message.operation))throw Error('FACTORY_CONTROL_SCOPE');
    assertMessageScope(message,this.enrollment);const hash=await policyMessageHash(message);
    const restriction={capabilityId:message.capabilityId,operation:message.operation,version:message.version,policyId:message.policyId};
    let observation;
    const materialFor=async(client,state)=>{
      if(!state.data.capability_fences.some(r=>r.payload.hash===hash))throw Error('FACTORY_CONTROL_FENCE_UNAVAILABLE');
      const restrictions=this.restrictions(state);
      const inventory=await receiverInventory(this,client,state,id=>restrictions.some(r=>!r.unqualified&&id.policyRevision<=r.version));
      if(restrictions.some(r=>r.unqualified)){inventory.inventoryComplete=false;inventory.unqualified.push({reason:'CAPABILITY_SEMANTICS_UNKNOWN'});}
      const base=inventoryMaterial(this,restriction,inventory);base.accumulatedRestrictions=restrictions;
      let aggregateState='PENDING_BACKEND';
      if(inventory.runs.some(r=>r.unknown))aggregateState='STOP_UNKNOWN';
      else if(inventory.runs.some(r=>r.failed))aggregateState='STOP_FAILED';
      else if(inventory.inventoryComplete){
        const applicable=run=>restrictions.filter(r=>!r.unqualified&&run.identity.policyRevision<=r.version);
        const revoked=inventory.runs.filter(run=>applicable(run).some(r=>r.operation==='revoke'));
        const paused=inventory.runs.filter(run=>!applicable(run).some(r=>r.operation==='revoke'));
        const revokedFenced=revoked.every(r=>r.fenced),revokedClean=revoked.every(r=>r.positiveCleanup||r.neverAllocated);
        if(restriction.operation==='pause')aggregateState=revokedFenced&&revokedClean&&paused.every(r=>r.paused)?'PAUSE_CONFIRMED':'PENDING_BACKEND';
        else aggregateState=revokedFenced&&paused.every(r=>r.paused)?revokedClean?'CLEANUP_CONFIRMED':'AUTHORITY_FENCED':'PENDING_BACKEND';
      }
      const inventoryDigest=digest(base),evidence={domain:'factory-capability-lifecycle-evidence/v1',inventoryDigest,observations:inventory.runs,aggregateState};
      return {material:base,evidence,inventoryDigest,evidenceDigest:digest(evidence),aggregateState};
    };
    await this.transition({kind:'CONTROL_OBSERVATION',hash},async(client,state,now)=>{
      const current=await materialFor(client,state),key='control:'+hash+':'+current.evidenceDigest;
      const prior=state.data.capability_control_observations.find(r=>r.record_key===key);
      if(prior){observation=prior.payload;return [];}
      if(state.data.capability_control_observations.filter(r=>r.payload.controlHash===hash).length>=20)throw Error('FACTORY_CONTROL_OBSERVATION_BOUND');
      const observedAt=Math.max(Math.floor(now),...state.data.capability_control_observations.filter(r=>r.payload.controlHash===hash).map(r=>r.payload.receipt.observedAt));
      if(observedAt>Date.now()+5000)throw Error('FACTORY_CONTROL_CLOCK');
      const receipt={schema:'capability-control.lifecycle.v1',kind:'CONTROL_ACK',authority:'myeve',...this.enrollment.scope,
       ...restriction,sequence:state.head.revision+1,state:current.aggregateState,observedAt,evidenceDigest:current.evidenceDigest,
       inventoryDigest:current.inventoryDigest,inventoryComplete:current.material.inventoryComplete};
      observation={controlHash:hash,...current,receipt,envelope:await signLifecycleReceipt(receipt,this.signer)};
      return [{table:'capability_control_observations',key,payload:observation}];
    },async client=>{
      const current=await materialFor(client,await this.receiver.state(client));
      if(current.evidenceDigest!==observation.evidenceDigest)throw Error('FACTORY_CONTROL_OBSERVATION_CHANGED');return null;
    });
    // Revalidate again after any witness-ahead roll-forward: no replay of native
    // effects and no release of a receipt whose supporting facts changed.
    const current=await this.receiver.transaction(async client=>materialFor(client,await this.receiver.state(client)));
    if(current.evidenceDigest!==observation.evidenceDigest)throw Error('FACTORY_CONTROL_OBSERVATION_CHANGED');
    return observation.envelope;
  }
  snapshotForClient(clientId){const c=this.clientControls.get(clientId);if(!c||c.grant.clientId!==clientId||c.ownerScope!==this.enrollment.scope.ownerId)throw Error('FACTORY_ORIGINAL_CLIENT_UNAVAILABLE');return {factoryId:c.signing.factoryId,factoryVersion:digest({sourceDigest:c.sourceDigest,configurationDigest:digest(c.configuration)}),
    sourceDigest:c.sourceDigest,configurationDigest:digest(c.configuration),backendId:this.enrollment.scope.backendId,
    incarnation:this.enrollment.scope.incarnation,enrollmentVersion:this.enrollment.scope.enrollmentVersion};}
  nativeSnapshot(){return this.snapshotForClient(this.control.grant.clientId);}
  async action(request,missionId){return admissionActionDigest({workId:request.workId,missionId,generation:request.workGeneration,nativeSnapshot:this.nativeSnapshot(),args:request});}
  async challenge(input,missionId){
    const request=parseCloudPrepare(input,this.control.grant,Date.now());
    if(typeof missionId!=='string'||!missionId.length||missionId.length>255)throw Error('FACTORY_MISSION_BINDING');
    return this.locked(async()=>{
      const state=await this.recover(await this.snapshot()),fence=this.latestFence(state,'myeve');
      if(!fence)throw Error('FACTORY_POLICY_UNAVAILABLE');
      const now=Date.now();const policyIdentity=Object.fromEntries([...receiverScopeKeys,'authority','version','policyId'].map(k=>[k,fence.message[k]]));
      return signPolicyMessage({...policyIdentity,kind:'CHALLENGE',referenceId:randomUUID(),
        capabilityId:'myfactory',registryVersion:this.enrollment.registryVersion,agentId:this.enrollment.agentId,
        workId:request.workId,missionId,workGeneration:request.workGeneration,actionDigest:await this.action(request,missionId),
        budgetMicros:Math.ceil(request.maxSpendUsd*1_000_000),issuedAt:now,expiresAt:now+30_000},this.signer);
    });
  }
  async permits(input,missionId,envelopes,state,now){
    const request=parseCloudPrepare(input,this.control.grant,now),action=await this.action(request,missionId),pair={};
    if(!envelopes||Object.keys(envelopes).sort().join(',')!=='myeve,relay')throw Error('FACTORY_POLICY_PAIR');
    for(const authority of ['myeve','relay']){
      const message=await verifyPolicyMessage(envelopes[authority],this.enrollment.sourceKeys[authority]);
      assertMessageScope(message,this.enrollment);
      const fence=this.latestFence(state,authority);
      if(!fence||message.kind!=='PERMIT'||message.authority!==authority||message.version!==fence.message.version
        ||message.policyId!==fence.message.policyId||message.agentId!==this.enrollment.agentId||message.capabilityId!=='myfactory'
        ||!message.requiredCapabilities.includes('work')||message.registryVersion!==this.enrollment.registryVersion
        ||message.workId!==request.workId||message.workGeneration!==request.workGeneration||message.missionId!==missionId
        ||message.actionDigest!==action||message.budgetMicros!==Math.ceil(request.maxSpendUsd*1_000_000)
        ||message.issuedAt>now||message.expiresAt<=now)throw Error('FACTORY_POLICY_STALE_OR_FOREIGN');
      if(state.data.capability_admission_references.some(row=>row.payload.workId===request.workId&&row.payload.workGeneration===request.workGeneration))throw Error('FACTORY_PROOF_CONSUMED');
      const revoked=state.data.relay_policy_receipts.some(row=>row.payload.agentId===message.agentId&&row.payload.revocationEpoch>message.agentRevision);
      if(authority==='relay'&&revoked)throw Error('FACTORY_AGENT_REVOKED');pair[authority]=message;
    }
    if(pair.relay.sourcePermitHash!==await policyMessageHash(pair.myeve))throw Error('FACTORY_POLICY_PAIR');
    return {request,pair};
  }
  async prepare(input,missionId,envelopes){
    try{return await this.terminal(input,missionId);}catch(error){if(!['FACTORY_TERMINAL_UNAVAILABLE','FACTORY_RECEIVER_PENDING'].includes(error.message))throw error;}
    const pending=(await this.snapshot()).pending.find(row=>row.payload.identity.kind==='ADMISSION'&&row.payload.identity.requestId===input.requestId);
    const identity=pending?.payload.identity??{kind:'ADMISSION',invocationNonce:randomUUID(),nativeRequest:structuredClone(input),nativeIds:{workOrderId:randomUUID(),runId:randomUUID()},clientId:this.control.grant.clientId,requestId:input.requestId,workId:input.workId,
      workGeneration:input.workGeneration,missionId,nativeRequestDigest:digest(input),snapshot:this.nativeSnapshot()};
    if(identity.nativeRequestDigest!==digest(input)||identity.missionId!==missionId||!same(identity.snapshot,this.nativeSnapshot()))throw Error('FACTORY_TERMINAL_BINDING');
    const result=await this.transition(identity,async(_client,state,now)=>{
      const {pair}=await this.permits(input,missionId,envelopes,state,now);
      return ['myeve','relay'].map(authority=>({table:'capability_admission_references',key:`${authority}:${pair[authority].referenceId}`,
        payload:{...pair[authority],nativeAdmission:'NOT_ASSERTED',clientId:identity.clientId,requestId:identity.requestId,
          nativeRequestDigest:identity.nativeRequestDigest,envelope:envelopes[authority]}}));
    },async(client,now)=>{
      try{
        const state=await this.receiver.state(client);
        // Exclude only this exact consumed pair while independently revalidating
        // all current fences immediately before the native transaction commits.
        state.data.capability_admission_references=state.data.capability_admission_references.filter(r=>r.payload.requestId!==identity.requestId);
        const {pair}=await this.permits(input,missionId,envelopes,state,now);
        const check=async()=>({capabilityId:'myfactory',policyRevision:pair.myeve.version,policyId:pair.myeve.policyId,
          workId:input.workId,workGeneration:input.workGeneration,referenceId:pair.myeve.referenceId,missionId});
        const row=await this.control.store.prepareInTransaction(client,now,{...this.control.grant,ownerScope:this.control.ownerScope},input,
          (...args)=>this.control.snapshot(...args),check,identity.nativeIds);
        await this.control.spend.createBudgetInTransaction(client,now,{workId:row.work_id,workGeneration:row.work_generation,
          requestId:row.request_id,workOrderId:row.work_order_id},Math.floor(row.request.maxSpendUsd*1_000_000),row.request.deadline,this.control.executionSpendPlan);
        return {clientId:row.client_id,requestId:row.request_id,workId:row.work_id,workGeneration:row.work_generation,
          workOrderId:row.work_order_id,runId:row.run_id,factoryVersion:row.snapshot.factoryVersion};
      }catch(error){if(!error.code&&/^(FACTORY_POLICY_|FACTORY_PROOF_|FACTORY_AGENT_|CAPABILITY_|WORK_|CLOUD_SOURCE_|CLOUD_CAPABILITIES_|SNAPSHOT_BINDING_|STAGING_WORK_|EXTERNAL_ALPHA_WORK_)/.test(error.message)){error.nativeValidation=true;error.reasonCode='NATIVE_REVALIDATION_FAILED';}throw error;}
    });
    return this.terminal(input,missionId);
  }
  planOutcome(state,input,missionId,clientId=this.control.grant.clientId){
    const plans=state.data.capability_receiver_plans.filter(r=>r.record_kind==='PLAN'&&r.payload.identity.kind==='ADMISSION'
      &&r.payload.identity.clientId===clientId&&r.payload.identity.requestId===input.requestId);
    if(plans.length!==1)throw Error('FACTORY_TERMINAL_UNAVAILABLE');
    const plan=plans[0],identity=plan.payload.identity;
    if(identity.workId!==input.workId||identity.workGeneration!==input.workGeneration||identity.missionId!==missionId
      ||identity.nativeRequestDigest!==digest(input)||!same(identity.snapshot,this.snapshotForClient(clientId))||digest(identity.nativeRequest)!==identity.nativeRequestDigest)throw Error('FACTORY_TERMINAL_BINDING');
    const outcome=state.data.capability_receiver_plans.find(r=>r.record_kind==='OUTCOME'&&r.record_key===plan.record_key);
    // A persisted admission plan is not "never seen". Missing outcome lineage
    // after recovery is corruption/restore uncertainty, never permission to
    // acquire another pair or another Relay reservation.
    if(!outcome)throw Error('FACTORY_NATIVE_LINEAGE_MISSING');
    const head=state.data.capability_receiver_heads.find(row=>row.receiver_sequence===plan.receiver_sequence)?.payload.head;
    if(outcome.receiver_sequence!==plan.receiver_sequence||outcome.payload.planId!==plan.record_key
      ||outcome.payload.planDigest!==plan.payload_digest||outcome.payload.receiverHeadDigest!==head?.digest
      ||!['ADMITTED','DEFINITELY_NOT_ADMITTED','ADMISSION_UNCERTAIN'].includes(outcome.payload.outcome))throw Error('FACTORY_NATIVE_LINEAGE_MISSING');
    return {plan,identity,outcome};
  }
  async validateNativeOutcome(client,state,input,missionId,clientId=this.control.grant.clientId){
    const result=this.planOutcome(state,input,missionId,clientId),{identity,outcome}=result;
    const control=this.clientControls.get(clientId),binding=this.enrollment.clientBindings.find(b=>b.clientId===clientId);
    if(!control||!binding)throw Error('FACTORY_ORIGINAL_CLIENT_UNAVAILABLE');
    await this.assertRetainedAuthority(client,identity,outcome.payload.outcome);
    const row=(await client.query('SELECT * FROM factory.intake_receipts WHERE client_id=$1 AND request_id=$2',[identity.clientId,identity.requestId])).rows[0];
    if(outcome.payload.outcome==='DEFINITELY_NOT_ADMITTED'&&row)throw Error('FACTORY_NATIVE_LINEAGE_MISSING');
    if(outcome.payload.outcome==='ADMITTED'){
      if(!row||row.work_id!==identity.workId||row.work_generation!==identity.workGeneration||row.snapshot.factoryVersion!==identity.snapshot.factoryVersion
        ||row.input_digest!==identity.nativeRequestDigest||row.run_id!==outcome.payload.native?.runId
        ||row.work_order_id!==identity.nativeIds?.workOrderId||row.run_id!==identity.nativeIds?.runId
        ||!same(row.snapshot.sourceDigest,identity.snapshot.sourceDigest)||!same(row.snapshot.configurationDigest,identity.snapshot.configurationDigest))throw Error('FACTORY_NATIVE_LINEAGE_MISSING');
      if(control.store.assertRecordScope)await control.store.assertRecordScope(client,row);
      const events=(await client.query('SELECT type,payload FROM factory.events WHERE run_id=$1',[row.run_id])).rows;
      const owners=events.filter(x=>x.type==='factory.owner_scope_bound'),admissions=events.filter(x=>x.type==='factory.capability_admitted');
      const scope=this.enrollment.scope;
      if(owners.length!==1||admissions.length!==1||owners[0].payload.ownerScope!==scope.ownerId
        ||owners[0].payload.organizationId!==scope.organizationId||owners[0].payload.installationId!==scope.installationId
        ||owners[0].payload.agentId!==binding.agentId||owners[0].payload.environment!=='qualification'||owners[0].payload.repository!==row.request.repository||owners[0].payload.workId!==identity.workId
        ||owners[0].payload.workGeneration!==identity.workGeneration||owners[0].payload.requestId!==identity.requestId
        ||admissions[0].payload.missionId!==missionId||admissions[0].payload.workId!==identity.workId
        ||admissions[0].payload.workGeneration!==identity.workGeneration||!Number.isSafeInteger(admissions[0].payload.policyRevision)||admissions[0].payload.policyRevision<1||admissions[0].payload.capabilityId!=='myfactory')throw Error('FACTORY_NATIVE_LINEAGE_MISSING');
      const order=(await client.query('SELECT * FROM factory.work_orders WHERE id=$1',[row.work_order_id])).rows[0];
      const run=(await client.query('SELECT * FROM factory.runs WHERE id=$1',[row.run_id])).rows[0];
      const budget=(await client.query('SELECT * FROM factory.work_spend_budgets WHERE work_id=$1',[row.work_id])).rows[0];
      if(!order||order.record.id!==row.work_order_id||!run||run.work_order_id!==row.work_order_id||run.record.id!==row.run_id
       ||run.record.workOrderId!==row.work_order_id||run.record.attemptNumber!==1||row.snapshot.attemptNumber!==1
       ||row.snapshot.requestDigest!==row.input_digest||row.snapshot.inputCommit!==row.request.source.commit
       ||!budget||budget.work_generation!==row.work_generation||budget.request_id!==row.request_id||budget.work_order_id!==row.work_order_id
       ||Number(budget.ceiling_microusd)!==Math.floor(row.request.maxSpendUsd*1e6)||budget.deadline!==row.request.deadline
       ||budget.contract_version!==control.executionSpendPlan.version||budget.model!==control.executionSpendPlan.model
       ||budget.pricing_revision!==control.executionSpendPlan.pricingRevision
       ||budget.authority_factory_version!==null&&budget.authority_factory_version!==row.snapshot.factoryVersion
       ||budget.authority_run_id!==null&&budget.authority_run_id!==row.run_id)throw Error('FACTORY_NATIVE_LINEAGE_MISSING');
      const references=state.data.capability_admission_references.filter(r=>r.payload.requestId===identity.requestId);
      if(references.length!==2||references.some(r=>r.payload.clientId!==identity.clientId||r.payload.workId!==identity.workId||r.payload.workGeneration!==identity.workGeneration
        ||r.payload.missionId!==missionId||r.payload.nativeRequestDigest!==identity.nativeRequestDigest||r.payload.nativeAdmission!=='NOT_ASSERTED'))throw Error('FACTORY_NATIVE_LINEAGE_MISSING');
      const original=references.filter(r=>r.payload.authority==='myeve');
      if(original.length!==1||admissions[0].payload.referenceId!==original[0].payload.referenceId
        ||admissions[0].payload.policyRevision!==original[0].payload.version||admissions[0].payload.policyId!==original[0].payload.policyId)throw Error('FACTORY_NATIVE_LINEAGE_MISSING');
    }
    return result;
  }
  async certifyOutcome(input,missionId){
    // Native outcome is only an observation, never an execution grant. A second
    // receiver transition commits its exact digest to the independent witness.
    await this.transition({kind:'NATIVE_OUTCOME',requestId:input.requestId,nativeRequestDigest:digest(input),missionId},async(client,state)=>{
      const {plan,outcome}=await this.validateNativeOutcome(client,state,input,missionId);
      const key='native-outcome:'+plan.record_key;
      const prior=state.data.capability_control_observations.find(row=>row.record_key===key);
      const payload={domain:'factory-native-outcome/v1',planId:plan.record_key,nativeOutcomeDigest:outcome.payload_digest};
      if(prior){if(!same(prior.payload,payload))throw Error('FACTORY_NATIVE_LINEAGE_MISSING');return [];}
      return [{table:'capability_control_observations',key,payload}];
    },async(client)=>{await this.validateNativeOutcome(client,await this.receiver.state(client),input,missionId);return null;});
  }
  async terminal(input,missionId){
    await this.certifyOutcome(input,missionId);
    return this.locked(async()=>{
      const state=await this.recover(await this.snapshot());
      const {plan,identity,outcome}=await this.receiver.transaction(client=>this.validateNativeOutcome(client,state,input,missionId));
      const seal=state.data.capability_control_observations.find(r=>r.record_key==='native-outcome:'+plan.record_key);
      if(seal?.payload.nativeOutcomeDigest!==outcome.payload_digest)throw Error('FACTORY_NATIVE_LINEAGE_MISSING');
      if(outcome.payload.outcome==='ADMITTED')return this.control.read(identity.requestId);
      const now=Date.now();return signFactoryPreparationTerminal({schema:'factory-capability-preparation-terminal/v1',...this.enrollment.scope,
        agentId:this.enrollment.agentId,clientId:identity.clientId,requestId:identity.requestId,workId:identity.workId,generation:identity.workGeneration,
        missionId,...identity.snapshot,nativeRequestDigest:identity.nativeRequestDigest,planId:plan.record_key,planDigest:plan.payload_digest,
        receiverSequence:seal.receiver_sequence,receiverHeadDigest:state.head.digest,outcome:outcome.payload.outcome,
        reasonCode:outcome.payload.reasonCode,nativeOutcomeDigest:outcome.payload_digest,issuedAt:now,expiresAt:now+30_000},this.signer);
    });
  }
}
