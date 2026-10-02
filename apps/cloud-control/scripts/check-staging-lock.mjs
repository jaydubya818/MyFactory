import assert from 'node:assert/strict';
import { withInfrastructureStore } from '../src/infrastructure-store.mjs';
await withInfrastructureStore(process.env,true,async()=>{
  await assert.rejects(withInfrastructureStore(process.env,true,async()=>{}),/INFRASTRUCTURE_BUSY/);
  await withInfrastructureStore(process.env,false,async store=>{assert.equal(await store.read('ee6250bd-d97b-4ddc-953b-ae713d01045f'),null);});
});
await withInfrastructureStore(process.env,true,async()=>{});
console.log(JSON.stringify({evidenceClass:'CONNECTED',test:'direct PostgreSQL session lock exclusion and release, concurrent read',status:'PASS',allocationEffects:0}));
