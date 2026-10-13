import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {digest} from '../../../packages/hosted-routing/src/result.ts';
import {productionAuthority} from '../src/production-authority.mjs';
import {productionConfiguration,productionExecutionContractSha256} from '../src/production-execution-plan.mjs';
import source from '../src/source-identity.json' with {type:'json'};
import historical from '../../../docs/capability-control/source-identity-20261010/historical-source-identity.json' with {type:'json'};
import predecessor from '../../../docs/capability-control/source-identity-20261010/successor.json' with {type:'json'};
import lifecycle from '../../../docs/capability-control/source-identity-20261010/lifecycle-successor.json' with {type:'json'};
import recovery from '../../../docs/capability-control/source-identity-20261010/recovery-successor.json' with {type:'json'};

import preparation from '../../../docs/myapps/current-main-source-qualification.json' with {type:'json'};

import composition from '../../../docs/myapps/current-main-composition-qualification.json' with {type:'json'};
import retained from '../../../docs/capability-control/retained-control-20261012/successor.json' with {type:'json'};
import receiver from '../../../docs/capability-control/receiver-extension-20261012/successor.json' with {type:'json'};
import witness from '../../../docs/capability-control/witness-session-20261012/successor.json' with {type:'json'};
import successor from '../../../docs/capability-control/receiver-recovery-20261012/successor.json' with {type:'json'};

test('inventoried source and configuration resolve to the exact qualified successor',()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const computed=JSON.parse(execFileSync(process.execPath,['apps/cloud-control/scripts/cloud-source-identity.mjs'],{cwd:root,encoding:'utf8'}));
 assert.deepEqual(computed,source);
 assert.equal(source.sourceDigest,successor.sourceDigest);
 assert.equal(digest(productionConfiguration),successor.configurationDigest);
 assert.equal(digest({sourceDigest:source.sourceDigest,configurationDigest:successor.configurationDigest}),successor.factoryVersion);
 assert.equal(productionExecutionContractSha256,successor.executionContractSha256);
 assert.equal(historical.sourceDigest,successor.historicalSourceDigest);
 assert.notEqual(historical.sourceDigest,source.sourceDigest);
 assert.equal(lifecycle.factoryVersion,recovery.predecessorFactoryVersion);
 assert.equal(recovery.factoryVersion,preparation.predecessorFactoryVersion);
 assert.equal(preparation.factoryVersion,composition.predecessorFactoryVersion);
 assert.equal(composition.factoryVersion,retained.predecessorFactoryVersion);
 assert.equal(lifecycle.sourceDigest,recovery.predecessorSourceDigest);
 assert.equal(recovery.sourceDigest,preparation.predecessorSourceDigest);
 assert.equal(preparation.sourceDigest,composition.predecessorSourceDigest);
 assert.equal(composition.sourceDigest,retained.predecessorSourceDigest);
 assert.equal(retained.factoryVersion,receiver.predecessorFactoryVersion);
 assert.equal(retained.sourceDigest,receiver.predecessorSourceDigest);
 assert.equal(receiver.sourceDigest,witness.predecessorSourceDigest);
 assert.equal(witness.sourceDigest,successor.predecessorSourceDigest);
 assert.equal(receiver.factoryVersion,witness.predecessorFactoryVersion);
 assert.equal(witness.factoryVersion,successor.predecessorFactoryVersion);
 assert.equal(successor.authority,'ISOLATED_SOURCE_QUALIFICATION_ONLY');
 assert.equal(predecessor.factoryVersion,'fed1724f60a7783a2dc5155928bd7f4df5a34970d9de3be53cdacc4dd0a9c30b');
});

test('coherent historical source or contract grants cannot consume successor authority',async()=>{
 const now=Date.now(),clientId='sofie-production',ownerScope='synthetic-identity-owner';
 const request={requestId:randomUUID(),workId:randomUUID(),workGeneration:1,deadline:new Date(now+60000).toISOString()};
 const combinations=[
  [witness.sourceDigest,witness.executionContractSha256,false],
  [receiver.sourceDigest,receiver.executionContractSha256,false],
  [retained.sourceDigest,retained.executionContractSha256,false],
  [composition.sourceDigest,composition.executionContractSha256,false],
  [successor.compatibilityBaseSourceDigest,successor.executionContractSha256,false],
  [preparation.sourceDigest,preparation.executionContractSha256,false],
  [recovery.sourceDigest,recovery.executionContractSha256,false],
  [lifecycle.sourceDigest,lifecycle.executionContractSha256,false],
  [predecessor.sourceDigest,predecessor.executionContractSha256,false],
  [historical.sourceDigest,successor.historicalExecutionContractSha256,false],
  [historical.sourceDigest,successor.executionContractSha256,false],
  [source.sourceDigest,successor.historicalExecutionContractSha256,false],
  [source.sourceDigest,successor.executionContractSha256,true],
 ];
 for(const [sourceDigest,contractSha256,allowed] of combinations){
  const configurationDigest=digest(productionConfiguration),factoryVersion=digest({sourceDigest,configurationDigest});
  const template={version:1,clientId,ownerScope,environment:'CLOUD_PRODUCTION',publication:false,sourceDigest,configurationDigest,factoryVersion,contractSha256,candidateSha256:null,request:{...request,requestId:null,deadline:null}};
  const envelope={version:1,approval:{workVersion:1,manifestTemplate:template},expiresAt:new Date(now+120000).toISOString()};
  const authorizationSha256=digest(envelope),manifest={...template,version:2,request,authorizationEnvelope:envelope,authorizationEnvelopeSha256:authorizationSha256};
  const row={state:'AUTHORIZED',client_id:clientId,work_id:request.workId,manifest,manifest_sha256:digest(manifest),consumed_at:null};
  const original=JSON.stringify(row);let writes=0;
  const client={query:async sql=>{if(sql.startsWith('UPDATE'))writes++;return {rows:[row]};}};
  const admit=productionAuthority({installation:{ownerScope},sourceDigest:source.sourceDigest,configuration:productionConfiguration,contractSha256:productionExecutionContractSha256,clientId,authorizationSha256});
  if(allowed)await admit(client,request,now,'prepare');
  else await assert.rejects(admit(client,request,now,'prepare'),/PRODUCTION_WORK_NOT_AUTHORIZED/);
  assert.equal(writes,allowed?1:0);
  assert.equal(JSON.stringify(row),original);
 }
});

test('successor inventory binds every receiving schema and the independent witness without rewriting historical records',()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const {record,files}=JSON.parse(execFileSync(process.execPath,['apps/cloud-control/scripts/cloud-source-identity.mjs','--manifest'],{cwd:root,encoding:'utf8'}));
 assert.deepEqual(record,source);
 for(const path of ['apps/cloud-control/migrations/014-receiver-lookup-qualification.sql','apps/cloud-control/migrations/013-capability-control-receipts.sql','docs/capability-control/receiver-witness.sql',
  'apps/cloud-control/src/ordered-capability-admission.mjs','packages/capability-enforcement/src/factory-preparation-terminal.ts']){
  assert.match(files[path],/^[a-f0-9]{64}$/);
  assert.notEqual(digest({...files,[path]:'0'.repeat(64)}),source.sourceDigest);
 }
 assert.equal(retained.sourceDigest,'14e9984eb50322e79103424bbcf135ea4dfe955f25ec545d0e7996c5ed62f684');
 assert.equal(predecessor.factoryVersion,'fed1724f60a7783a2dc5155928bd7f4df5a34970d9de3be53cdacc4dd0a9c30b');
});
