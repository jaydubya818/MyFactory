import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkpointScript,unchangedCandidateScript} from '../src/cloud-harness-checkpoint.mjs';
import {productionCheckpointPlan as plan,productionSpendPlan,productionExecutionContract,productionConfiguration} from '../src/production-execution-plan.mjs';
import {validateCandidateBundle} from '../src/candidate-custody.mjs';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
test('production checkpoint uses the new exact source, preserves scope and seals read-only completion',t=>{
 const dir=mkdtempSync(join(tmpdir(),'production-checkpoint-')),repo=join(dir,'repo');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 execFileSync('git',['clone','--quiet','--no-checkout',repository,repo],{stdio:'pipe'});
 execFileSync('git',['checkout','--quiet','--detach',plan.source.commit],{cwd:repo});
 // Synthetic implementation is confined to this disposable local test checkout.
 writeFileSync(join(repo,plan.allowedPaths[0]),"export function normalizeLineEndings(value){if(typeof value!=='string')throw Error();return value.replace(/\\r\\n?/g,'\\n');}\n");
 const script=checkpointScript(plan).replaceAll('/home/factoryproducer',dir);
 const manifest=JSON.parse(execFileSync(process.execPath,['-e',script,'1'],{cwd:repo,encoding:'utf8',stdio:'pipe'}));
 const candidate=validateCandidateBundle(readFileSync(join(dir,'checkpoint-1.json')),{source:plan.source,input:{allowedPaths:plan.allowedPaths,checkCommands:[plan.checkCommand]}});
 assert.equal(manifest.passed,true);assert.equal(candidate.tree,manifest.tree);assert.equal(candidate.bundle.base,plan.source.commit);
 assert.equal(execFileSync(process.execPath,['-e',unchangedCandidateScript(candidate.tree,plan.source)],{cwd:repo,encoding:'utf8'}),'UNCHANGED');
 writeFileSync(join(repo,plan.allowedPaths[0]),'mutated');assert.throws(()=>execFileSync(process.execPath,['-e',unchangedCandidateScript(candidate.tree,plan.source)],{cwd:repo,stdio:'pipe'}));
});
test('production contract is explicit, bounded and cannot claim admission or paid qualification',()=>{
 assert.equal(productionSpendPlan.perOperationReserveMicrousd,84864);
 assert.equal(productionSpendPlan.maxPaidOperations,3);assert.equal(productionSpendPlan.completionReserveMicrousd,84864);
 assert.equal(productionConfiguration.cloud.evidenceClass,'LIVE');
 assert.equal(productionExecutionContract.status,'AWAITING_COMPOSED_QUALIFICATION');
 assert.equal(productionExecutionContract.publication,false);assert.equal(productionExecutionContract.merge,false);assert.equal(productionExecutionContract.deployGeneratedCandidate,false);
 assert(productionSpendPlan.perOperationReserveMicrousd*3<productionExecutionContract.maxSpendMicrousd);
});
