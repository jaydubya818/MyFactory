import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'../../..');
const inventoryPath=join(root,'docs/evidence/myfactory-private-alpha-reconstruction/source-inventory.json');
const dispatchControlPath='apps/supervisor/src/dispatch-control.ts';
const githubPath='apps/supervisor/src/github.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const runGovernance=()=>execFileSync(process.execPath,[join(root,'scripts/check-producer-governance.mjs')],{
 cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']
});

test.describe('producer governance',{concurrency:1},()=>{
 test('accepts the reviewed dispatch-control identity and classification',()=>{
  const inventory=JSON.parse(readFileSync(inventoryPath,'utf8'));
  const entry=inventory.sources[dispatchControlPath];
  const current=hash(readFileSync(join(root,dispatchControlPath)));
  assert.equal(entry?.classification,'COMPLETION_ADMISSION');
  assert.equal(typeof entry?.authorityBoundary,'string');
  assert.ok(entry.authorityBoundary.length>0);
  assert.equal(entry.sha256,current);
  const github=inventory.sources[githubPath];
  assert.equal(github?.classification,'DRAFT_PUBLICATION_ADAPTER');
  assert.equal(typeof github?.authorityBoundary,'string');
  assert.ok(github.authorityBoundary.length>0);
  assert.equal(github.sha256,hash(readFileSync(join(root,githubPath))));
  const spend=inventory.sources['apps/supervisor/src/spend-gateway.ts'];
  assert.equal(spend?.classification,'PAID_BOUNDARY');
  assert.equal(spend.sha256,hash(readFileSync(join(root,'apps/supervisor/src/spend-gateway.ts'))));
  const admission=inventory.sources['apps/supervisor/src/local-ordered-admission.ts'];
  assert.equal(admission?.classification,'CAPABILITY_CONTROL');
  assert.equal(admission.sha256,hash(readFileSync(join(root,'apps/supervisor/src/local-ordered-admission.ts'))));
  const output=runGovernance();
  assert.match(output,/Reconstruction producer governance PASS: \d+ reviewed changed runtime sources; UNKNOWN=0/);
 });

 test('rejects an unreviewed producer source',()=>{
  const original=readFileSync(inventoryPath);
  const inventory=JSON.parse(original.toString('utf8'));
  const target='apps/supervisor/src/jobs.ts';
  assert.equal(inventory.sources[target].sha256,hash(readFileSync(join(root,target))));
  inventory.sources[target].sha256='0'.repeat(64);
  writeFileSync(inventoryPath,JSON.stringify(inventory));
  try{
   assert.throws(()=>runGovernance(),error=>{
    assert.equal(error.status,1);
    assert.match(String(error.stderr||error.message),/Unreviewed producer source: apps\/supervisor\/src\/jobs\.ts/);
    return true;
   });
  }finally{
   writeFileSync(inventoryPath,original);
  }
 });
});
