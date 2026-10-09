import {digest} from '../../../packages/hosted-routing/src/result.ts';

export function assertVerificationPolicy(policy,policySha256){
 if(!policy||!/^[a-f0-9]{64}$/.test(policySha256??'')||digest(policy)!==policySha256)throw Error('VERIFIER_POLICY_CONFIGURATION');
}
// Historical non-Cloud snapshots have no Cloud policy. A Cloud snapshot cannot
// silently downgrade to that legacy behavior when its policy is missing/unknown.
export function requiresProtectedVerification(snapshot,expectedPolicySha256){
 const cloud=snapshot?.version===3?snapshot.configuration.local:snapshot?.configuration?.cloud;
 if(!cloud)return false;
 if(!/^[a-f0-9]{64}$/.test(cloud.verificationPolicySha256??'')||cloud.verificationPolicySha256!==expectedPolicySha256)throw Error('VERIFIER_POLICY_MISMATCH');
 return true;
}
