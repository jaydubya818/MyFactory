import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocationPlan, source } from '../src/infrastructure-plan.mjs';
const id = 'ee6250bd-d97b-4ddc-953b-ae713d01045f';
const image = 'factory-worker@sha256:' + 'a'.repeat(64);
test('allocation refuses mutable images, wrong registry scope and unbounded time', () => {
  for (const value of ['factory-worker:latest','other-project/worker@sha256:'+'a'.repeat(64),'']) assert.throws(() => allocationPlan(id,value,120000));
  for (const value of [0,-1,120001,Infinity,NaN]) assert.throws(() => allocationPlan(id,image,value));
  assert.throws(() => allocationPlan('../another-work',image,120000));
});
test('allocation pins exact source and grants no worker credentials, ports, persistence or failover', () => {
  const plan=allocationPlan(id,image,119000);
  assert.deepEqual(plan.env,{});assert.deepEqual(plan.ports,[]);assert.deepEqual(plan.failoverRegions,[]);
  assert.equal(plan.persistent,false);assert.equal(plan.source.revision,source.commit);
  assert.equal(plan.source.url,'https://github.com/jaydubya818/MyFactory.git');
  assert.deepEqual(plan.networkPolicy,{allow:['github.com']});assert.equal(plan.resources.vcpus,1);
});
