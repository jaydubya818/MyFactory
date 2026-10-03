import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {consumeCloudDelivery,retryCloudDelivery} from '../src/cloud-queue-consumer.mjs';
import {cloudGrant} from '../src/cloud-work-plan.mjs';
import {workTopic} from '../src/cloud-work-control.mjs';
test('queue cannot select another client, deployment, model, image or arbitrary worker program',async()=>{
 const payload={version:1,runId:randomUUID(),nonce:'a'.repeat(64)},metadata={topicName:workTopic,region:'iad1',messageId:'message'};let accesses=0;
 const runtime={store:{acceptDelivery:async()=>{accesses++;return{client_id:'wrong',identity:{}};}}};
 await assert.rejects(consumeCloudDelivery(runtime,{...payload,command:'arbitrary'},metadata,'dpl_test'),/INVALID_DELIVERY/);
 await assert.rejects(consumeCloudDelivery(runtime,payload,{...metadata,region:'sfo1'},'dpl_test'),/INVALID_DELIVERY/);assert.equal(accesses,0);
 await assert.rejects(consumeCloudDelivery(runtime,payload,metadata,'dpl_test'),/BINDING/);
 assert.deepEqual(retryCloudDelivery(Error('DELIVERY_BINDING_MISMATCH')),{acknowledge:true});
 assert.deepEqual(retryCloudDelivery(Error('WORK_UNRESOLVED')),{afterSeconds:15});
});
test('redelivery observes existing terminal Run and signed Result without an allocation or execution',async()=>{
 const payload={version:1,runId:randomUUID(),nonce:'a'.repeat(64)},metadata={topicName:workTopic,region:'iad1',messageId:'message'};let reads=0;
 const runtime={store:{acceptDelivery:async()=>({client_id:cloudGrant.clientId,request_id:'request',identity:{}}),read:async()=>({resource:{cleanup_confirmed:true},events:[{type:'factory.terminal'}]})},control:{result:async()=>{reads++;}}};
 await consumeCloudDelivery(runtime,payload,metadata,'dpl_test');assert.equal(reads,1);
});
