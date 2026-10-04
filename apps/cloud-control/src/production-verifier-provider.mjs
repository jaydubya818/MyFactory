import {cloudVerifierProvider} from './cloud-verifier-provider.mjs';
import {productionInstallation} from './production-installation.mjs';
import {productionWorkloadIdentity} from './production-identity.mjs';
import {productionVerifierPolicy,productionVerifierPolicySha256,productionVerifierProbe} from './production-verifier-policy.mjs';

/** Reuse the existing independent verifier with explicit production bindings.
 * The caller must still enforce canonical verifier admission after custody and
 * producer teardown. This constructor does not grant execution authority. */
export function productionVerifierProvider(env){
 const installation=productionInstallation(env);
 return cloudVerifierProvider({policy:productionVerifierPolicy,policySha256:productionVerifierPolicySha256,
  probe:productionVerifierProbe,projectId:installation.projectId,
  providerOptions:async()=>({token:await productionWorkloadIdentity(installation),projectId:installation.projectId,teamId:installation.teamId})});
}
