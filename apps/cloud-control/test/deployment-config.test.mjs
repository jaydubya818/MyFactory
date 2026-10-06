import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
test('every hosted queue callback retains a specific private trigger before the generic function pattern',()=>{
 const c=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8')),entries=Object.entries(c.functions);
 for(const [file,topic] of [
  ['api/cloud-work.mjs','factory-staging-work'],
  ['api/cloud-recovery.mjs','factory-staging-recovery'],
  ['api/queue-delivery.mjs','factory-staging-delivery-check'],
  ['api/production-validation-work.mjs','factory-production-validation-work-v1'],
  ['api/production-validation-recovery.mjs','factory-production-validation-recovery-v1'],
  ['api/production-work.mjs','factory-production-work-v1'],
  ['api/production-recovery.mjs','factory-production-recovery-v1'],
  ['api/alpha-work.mjs','factory-alpha-work-v1'],
  ['api/alpha-recovery.mjs','factory-alpha-recovery-v1'],
 ]){
  const first=entries.find(([pattern])=>pattern===file||pattern==='api/*.mjs');
  assert.equal(first?.[0],file,'Generic function pattern must not consume a private queue callback');
  assert.deepEqual(first[1].experimentalTriggers,[{type:'queue/v2beta',topic}]);assert.ok(existsSync(new URL('../'+file,import.meta.url)));
 }
});
