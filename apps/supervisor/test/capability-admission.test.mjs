import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openStorage } from '../../../packages/storage/src/index.ts';
import { FactoryDispatchControl } from '../src/dispatch-control.ts';

test('enrolled local Factory preparation fails before intake or execution', async t => {
  const directory=mkdtempSync(join(tmpdir(),'capability-local-'));
  const storage=openStorage(join(directory,'factory.sqlite'));
  const previous=process.env.FACTORY_CAPABILITY_CONTROL_ENABLED;
  process.env.FACTORY_CAPABILITY_CONTROL_ENABLED='true';
  t.after(()=>{storage.close();rmSync(directory,{recursive:true,force:true});
    if(previous===undefined)delete process.env.FACTORY_CAPABILITY_CONTROL_ENABLED;else process.env.FACTORY_CAPABILITY_CONTROL_ENABLED=previous;});
  const control=new FactoryDispatchControl(storage,{prepare:()=>assert.fail('execution must not start')},{},{});
  const requestId=randomUUID();
  const request={requestId,workId:randomUUID(),workGeneration:1,repository:'fixture/repository',deadline:new Date(Date.now()+60000).toISOString(),maxSpendUsd:1,
    input:{title:'Synthetic Work',description:'No execution',kind:'feature',repositoryPath:directory,baseRef:'a'.repeat(40),
      acceptanceCriteria:['Pass'],reproductionCommand:null,expectedFailureText:null,checkCommands:['node --test'],allowedPaths:['src/**'],workerProfile:'mac'}};
  await assert.rejects(control.prepare({id:'synthetic',ownerScope:'owner',repositoryPaths:[directory],actions:['factory.prepare']},request),
    error=>error.code==='capability_policy_unavailable');
  assert.equal(storage.getIntake('gateb:synthetic',requestId),null);
});
