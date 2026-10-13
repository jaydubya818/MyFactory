import {verify,createPublicKey} from 'node:crypto';
import {canonical,digest} from '../../../packages/hosted-routing/src/result.ts';
import {receiverInventory,fenceInventory,aggregateLifecycle,inventoryMaterial} from './receiver-lifecycle.mjs';
const hash=value=>'sha256:'+digest(value);
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===expected.split(',').sort().join(',');
const text=value=>typeof value==='string'&&value.length>0&&value.length<=255&&value===value.trim();
/** Native Relay AGENT_REVOKED transport; this is neither a new grant nor a MyEve control. */
export function verifyRelayRevocation(envelope,binding){
 if(!keys(envelope,'keyId,payload,payloadHash,signature')||envelope.keyId!==binding.sourceKeyId
  ||!text(envelope.signature)||!keys(envelope.payload,'accountId,aggregateId,accounting,eventId,issuedAt,kind,revision,schema,source'))throw Error('RELAY_POLICY_INVALID');
 const p=envelope.payload;
 if(p.schema!=='relay.policy-change.v1'||p.kind!=='AGENT_REVOKED'||p.accounting!=='PRESERVE_UNKNOWN'
  ||p.accountId!==binding.accountId||p.aggregateId!==binding.agentId||!text(p.eventId)||!Number.isSafeInteger(p.revision)||p.revision<1
  ||typeof p.issuedAt!=='string'||!Number.isFinite(Date.parse(p.issuedAt))||Date.parse(p.issuedAt)>Date.now()+5000
  ||!keys(p.source,'passportId,passportVersion,revokedLeaseIds')||!text(p.source.passportId)||!Number.isSafeInteger(p.source.passportVersion)||p.source.passportVersion<1
  ||!Array.isArray(p.source.revokedLeaseIds)||p.source.revokedLeaseIds.length>128||p.source.revokedLeaseIds.some(x=>!text(x))
  ||new Set(p.source.revokedLeaseIds).size!==p.source.revokedLeaseIds.length||envelope.payloadHash!==hash(p))throw Error('RELAY_POLICY_INVALID');
 const key=createPublicKey(binding.sourcePublicKeyPem);
 if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(envelope.payloadHash),key,Buffer.from(envelope.signature,'base64url')))throw Error('RELAY_POLICY_SIGNATURE');
 return p;
}
export class FactoryRelayPolicyReceiver{
 constructor({ordered,binding,ackSigner}){
  const scope=ordered.enrollment.scope;
  if(!ackSigner||typeof ackSigner.sign!=='function'||ackSigner.keyId!==binding.backendKeyId
   ||!['accountId','agentId','sourceKeyId','backendKeyId'].every(k=>text(binding[k]))
   ||typeof binding.sourcePublicKeyPem!=='string'||binding.sourcePublicKeyPem.length>4096
   ||binding.ownerId!==scope.ownerId||binding.organizationId!==scope.organizationId||binding.installationId!==scope.installationId
   ||binding.backendId!==scope.backendId||binding.agentId!==ordered.enrollment.agentId)throw Error('RELAY_POLICY_ENROLLMENT');
  this.ordered=ordered;this.binding=Object.freeze({...binding});this.signer=ackSigner;
  // Reuse this original authenticated receiver for restart recovery. One exact
  // host binding, not a key registry or a new execution authority path.
  if(ordered.relayPolicyReceiver&&canonical(ordered.relayPolicyReceiver.binding)!==canonical(this.binding))throw Error('RELAY_POLICY_ENROLLMENT');
  ordered.relayPolicyReceiver=this;
 }
 validateStoredPlan(plan){
  const row=plan.rows?.[0],stored=row?.payload;
  if(plan.identity.kind!=='RELAY_REVOCATION'||plan.rows.length!==1||row.table!=='relay_policy_receipts')throw Error('RELAY_POLICY_CONFLICT');
  const p=verifyRelayRevocation(stored?.envelope,this.binding);
  const expected={accountId:p.accountId,agentId:p.aggregateId,eventId:p.eventId,eventHash:stored.envelope.payloadHash,revocationEpoch:p.revision,envelope:stored.envelope};
  if(row.key!=='event:'+p.eventId||plan.identity.eventId!==p.eventId||plan.identity.eventHash!==stored.envelope.payloadHash||canonical(stored)!==canonical(expected))throw Error('RELAY_POLICY_CONFLICT');
  return p;
 }
 async fenceStoredPlan(client,plan){
  const p=this.validateStoredPlan(plan),o=this.ordered;
  const restriction={operation:'revoke',authority:'relay',accountId:p.accountId,agentId:p.aggregateId,eventId:p.eventId,revocationEpoch:p.revision};
  const inventory=await receiverInventory(o,client,await o.receiver.state(client),id=>id.agentId===p.aggregateId&&id.agentRevision<p.revision);
  await fenceInventory(o,client,inventory,restriction);
 }
 async receive(envelope){
  const p=verifyRelayRevocation(envelope,this.binding),o=this.ordered;
  const restriction={operation:'revoke',authority:'relay',accountId:p.accountId,agentId:p.aggregateId,eventId:p.eventId,revocationEpoch:p.revision};
  const selector=id=>id.agentId===p.aggregateId&&id.agentRevision<p.revision;
  await o.transition({kind:'RELAY_REVOCATION',eventId:p.eventId,eventHash:envelope.payloadHash},async(_client,state)=>{
   const prior=state.data.relay_policy_receipts.find(row=>row.payload.eventId===p.eventId);
   if(prior){if(prior.payload.eventHash!==envelope.payloadHash)throw Error('RELAY_POLICY_CONFLICT');return [];}
   return [{table:'relay_policy_receipts',key:'event:'+p.eventId,payload:{accountId:p.accountId,agentId:p.aggregateId,eventId:p.eventId,eventHash:envelope.payloadHash,
    revocationEpoch:p.revision,envelope}}];
  },async client=>{const inventory=await receiverInventory(o,client,await o.receiver.state(client),selector);await fenceInventory(o,client,inventory,restriction);return null;});
  // A recovered durable event does not replay its original native effect.
  // Repair monotonic restrictions under this original authenticated binding
  // before acknowledging a retry; never replay admission or release accounting.
  await o.receiver.transaction(async client=>{
   const state=await o.receiver.state(client),stored=state.data.relay_policy_receipts.find(row=>row.payload.eventId===p.eventId&&row.record_key==='event:'+p.eventId);
   if(!stored||stored.payload.eventHash!==envelope.payloadHash)throw Error('RELAY_POLICY_CONFLICT');
   const inventory=await receiverInventory(o,client,state,selector);await fenceInventory(o,client,inventory,restriction);
  });
  let observation;
  const material=async(client,state)=>{
   const inventory=await receiverInventory(o,client,state,selector),inventoryValue=inventoryMaterial(o,restriction,inventory),inventoryDigest=digest(inventoryValue),stateValue=aggregateLifecycle(inventory,'revoke');
   const evidence={domain:'factory-relay-policy-evidence/v1',inventoryDigest,state:stateValue,observations:inventory.runs};
   return {inventory:inventoryValue,inventoryDigest,evidence,evidenceDigest:digest(evidence),state:stateValue};
  };
  await o.transition({kind:'RELAY_OBSERVATION',eventId:p.eventId,eventHash:envelope.payloadHash},async(client,state)=>{
   const current=await material(client,state),key='ack:'+p.eventId+':'+current.evidenceDigest;
   const prior=state.data.relay_policy_receipts.find(row=>row.record_key===key);
   if(prior){observation=prior.payload;return [];}
   const fenced=current.inventory.inventoryComplete&&['AUTHORITY_FENCED','CLEANUP_CONFIRMED'].includes(current.state);
   const receipt={schema:'relay.policy-ack.v1',accountId:p.accountId,eventId:p.eventId,eventHash:envelope.payloadHash,
    backendId:this.binding.backendId,installationId:this.binding.installationId,keyId:this.signer.keyId,sequence:state.head.revision+1,
    admissionFence:'APPLIED',writers:fenced?'FENCED':'PENDING_BACKEND',executionAuthority:fenced?'INVALIDATED':'PENDING_BACKEND',
    cleanup:current.state==='CLEANUP_CONFIRMED'?'CONFIRMED':'PENDING_BACKEND',accounting:'PRESERVE_UNKNOWN',evidenceReferences:['factory:relay-policy:'+current.evidenceDigest]};
   observation={eventId:p.eventId,eventHash:envelope.payloadHash,agentId:p.aggregateId,revocationEpoch:p.revision,...current,receipt,signature:await this.signer.sign(hash(receipt))};
   return [{table:'relay_policy_receipts',key,payload:observation}];
  },async client=>{if((await material(client,await o.receiver.state(client))).evidenceDigest!==observation.evidenceDigest)throw Error('RELAY_POLICY_OBSERVATION_CHANGED');return null;});
  // Witness-ahead recovery may restore observation bytes, never native fencing.
  if((await o.receiver.transaction(async client=>material(client,await o.receiver.state(client)))).evidenceDigest!==observation.evidenceDigest)throw Error('RELAY_POLICY_OBSERVATION_CHANGED');
  return {receipt:observation.receipt,signature:observation.signature};
 }
}
