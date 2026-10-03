import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresDispatchStore} from '../src/postgres-dispatch.mjs';
import {PostgresVerificationStore} from '../src/postgres-verification.mjs';
import {cloudVerifierProvider} from '../src/cloud-verifier-provider.mjs';
import {cloudResult} from '../src/cloud-work-result.mjs';
import {productionVerifierPolicy,productionVerifierPolicySha256} from '../src/production-verifier-policy.mjs';
import {cloudVerifierPolicySha256} from '../src/cloud-verifier-policy.mjs';
import {requiresProtectedVerification} from '../src/verification-policy-binding.mjs';

test('invalid configured Work limits cannot disable the database admission ceiling',()=>{
 const pool={connect:()=>{throw Error('Database must not be accessed');}};
 for(const maxWorks of [NaN,Infinity,-Infinity,'1','no-limit',null,0,-1,1.5,9,Number.MAX_SAFE_INTEGER])
  assert.throws(()=>new PostgresDispatchStore(pool,{maxWorks}),/DISPATCH_CONFIGURATION_INVALID/);
 assert.equal(new PostgresDispatchStore(pool,{maxWorks:1}).maxWorks,1);
 assert.equal(new PostgresDispatchStore(pool).maxWorks,8);
});
test('mismatched/missing Cloud policies cannot become legacy unprotected Results or terminals',async()=>{
 for(const cloud of [{verificationPolicySha256:productionVerifierPolicySha256},{verificationPolicySha256:'unknown'},{}]){
  const row={snapshot:{configuration:{cloud}},events:[]};
  const store=new PostgresDispatchStore({});let queries=0;
  store.record=async()=>row;store.transaction=async callback=>callback({query:async()=>{queries++;throw Error('No queries after mismatched policy');}},Date.now());
  await assert.rejects(store.finalize('client','request','COMPLETED'),/VERIFIER_POLICY_MISMATCH/);
  await assert.rejects(store.read('client','request'),/VERIFIER_POLICY_MISMATCH/);
  assert.throws(()=>cloudResult(row,null,null),/VERIFIER_POLICY_MISMATCH/);assert.equal(queries,0);
 }
 assert.equal(requiresProtectedVerification({configuration:{cloud:{verificationPolicySha256:productionVerifierPolicySha256}}},productionVerifierPolicySha256),true);
 assert.equal(requiresProtectedVerification({configuration:{}},cloudVerifierPolicySha256),false);
});
test('provider/store/result construction rejects a policy whose content differs from its claimed digest',()=>{
 const wrong={policy:productionVerifierPolicy,policySha256:cloudVerifierPolicySha256};
 assert.throws(()=>new PostgresVerificationStore({},wrong),/VERIFIER_POLICY_CONFIGURATION/);
 assert.throws(()=>cloudVerifierProvider(wrong),/VERIFIER_POLICY_CONFIGURATION/);
 assert.throws(()=>cloudResult({},null,null,wrong),/VERIFIER_POLICY_CONFIGURATION/);
 const correct={policy:productionVerifierPolicy,policySha256:productionVerifierPolicySha256};
 assert.doesNotThrow(()=>new PostgresVerificationStore({},correct));
 assert.doesNotThrow(()=>cloudVerifierProvider(correct));
});
