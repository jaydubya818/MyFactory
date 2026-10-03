import test from 'node:test';
import assert from 'node:assert/strict';
import {productionWorkloadIdentity} from '../src/production-identity.mjs';
import {productionProjectId} from '../src/production-installation.mjs';
const installation={projectId:productionProjectId,teamId:'team_p8z8exJRTGfOPk1GC9vUOpv3'};
const claims={project_id:installation.projectId,owner_id:installation.teamId,environment:'production',exp:Math.floor(Date.now()/1000)+300};
const token=patch=>'e30.'+Buffer.from(JSON.stringify({...claims,...patch})).toString('base64url')+'.synthetic';
test('production provider identity is fresh per request and exact installation scoped',async()=>{
 let reads=0;const read=async()=>token({jti:++reads});
 assert.notEqual(await productionWorkloadIdentity(installation,read),await productionWorkloadIdentity(installation,read));assert.equal(reads,2);
});
test('missing, expired, foreign and preview identities fail without static token fallback',async()=>{
 for(const patch of [{project_id:'prj_IRXTY6HOzS2q9wRPdabsJnmddzl4'},{owner_id:'team_other'},{environment:'preview'},{exp:0},{exp:'9999999999'}])await assert.rejects(productionWorkloadIdentity(installation,async()=>token(patch)),/^Error: PRODUCTION_WORKLOAD_IDENTITY_REQUIRED$/);
 for(const value of [undefined,'static-provider-token','x'.repeat(16385)])await assert.rejects(productionWorkloadIdentity(installation,async()=>value),/PRODUCTION_WORKLOAD_IDENTITY_REQUIRED/);
 await assert.rejects(productionWorkloadIdentity(installation,async()=>{throw Error('private-token-data');}),/^Error: PRODUCTION_WORKLOAD_IDENTITY_REQUIRED$/);
});
