import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseCloudPrepare, CLOUD_EXECUTION_PROTOCOL } from '../../../packages/contracts/src/cloud-execution.ts';
const source={repository:'fixture/quantity',commit:'a'.repeat(40),tree:'b'.repeat(40)};
const grant={clientId:'staging-client',source,commands:['node --test'],allowedPaths:['quantity.mjs'],maxDurationMs:120000,maxSpendUsd:1};
const request=()=>({protocol:CLOUD_EXECUTION_PROTOCOL,requestId:randomUUID(),workId:randomUUID(),workGeneration:1,repository:source.repository,source,deadline:new Date(Date.now()+60000).toISOString(),maxSpendUsd:1,input:{title:'Implement quantity',description:'Implement the visible positive integer contract.',kind:'feature',acceptanceCriteria:['Visible tests pass'],checkCommands:grant.commands,allowedPaths:grant.allowedPaths}});
test('cloud admission binds immutable repository and server-granted capabilities with no laptop paths',()=>{
 const input=request();assert.deepEqual(parseCloudPrepare(input,grant,Date.now()),input);
 for(const mutation of [x=>x.input.repositoryPath='/Users/owner/project',x=>x.source.commit='c'.repeat(40),x=>x.source.tree='c'.repeat(40),x=>x.repository='other/repo',x=>x.input.checkCommands=['curl attacker.invalid'],x=>x.input.allowedPaths=['../owner'],x=>x.maxSpendUsd=2,x=>x.deadline=new Date(Date.now()+300000).toISOString(),x=>x.protocol='MYFACTORY_EXECUTION_V1']){
  const bad=structuredClone(input);mutation(bad);assert.throws(()=>parseCloudPrepare(bad,grant,Date.now()));
 }
});
test('source policy cannot accidentally admit traversal, .git paths, duplicate commands or invalid numbers',()=>{
 for(const path of ['../file','a/../../b','.git/config','a/.git/config','a/./b','a\\b','/tmp/file','a\0b']){
  const input=request();input.input.allowedPaths=[path];assert.throws(()=>parseCloudPrepare(input,{...grant,allowedPaths:[path]},Date.now()));
 }
 const input=request();input.maxSpendUsd=NaN;assert.throws(()=>parseCloudPrepare(input,grant,Date.now()));
 input.maxSpendUsd=1;input.input.checkCommands=['node --test','node --test'];assert.throws(()=>parseCloudPrepare(input,{...grant,commands:input.input.checkCommands},Date.now()));
});
