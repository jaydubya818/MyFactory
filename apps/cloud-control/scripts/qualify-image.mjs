import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Sandbox } from '@vercel/sandbox';
import { diagnosticCredentials } from './staging-diagnostic-credentials.mjs';
const observed = JSON.parse(await readFile(new URL('../../../docs/cloud-execution/phase-2/provider-diagnosis/managed-node.json', import.meta.url)));
const image = observed.resolvedImage;
assert.match(image, /^vercel\/sandbox\/node@sha256:[a-f0-9]{64}$/);
const identity = await diagnosticCredentials();
const attempt = randomUUID();
const result = { attempt, image, evidenceClass: 'CONNECTED', purpose: 'image-qualification', status: 'RUNNING', startedAt: new Date().toISOString(), observations: [], sandboxes: [], cleanup: [] };
const output = new URL(`../../../docs/cloud-execution/phase-2/provider-diagnosis/image-${attempt}.json`, import.meta.url);
const save = () => writeFile(output, JSON.stringify(result,null,2)+'\n');
await save();
const create = async suffix => {
  const name = `factory-image-${attempt}-${suffix}`;
  result.sandboxes.push(name); await save();
  return Sandbox.create({ ...identity, name, image, region: 'iad1', failoverRegions: [], resources: { vcpus: 1 }, timeout: 120000, persistent: false, ports: [], env: {}, networkPolicy: 'deny-all', signal: AbortSignal.timeout(30000) });
};
const command = async (user, source) => {
  const cmd = await user.runCommand({ cmd: 'node', args: ['-e', source], timeoutMs: 12000, signal: AbortSignal.timeout(20000) });
  if (cmd.exitCode !== 0) throw Error(`CHECK_FAILED_${cmd.exitCode}`);
  const stdout = await cmd.stdout(); if (stdout.length > 30000) throw Error('OUTPUT_BOUND_EXCEEDED');
  return JSON.parse(stdout);
};
const destroy = async name => {
  try { const s=await Sandbox.get({...identity,name,resume:false,signal:AbortSignal.timeout(10000)});await s.stop({signal:AbortSignal.timeout(10000)});await s.delete({deleteOrphanSnapshots:true,signal:AbortSignal.timeout(10000)}); }
  catch(e){if(e.response?.status!==404)throw e;}
  try {await Sandbox.get({...identity,name,resume:false,signal:AbortSignal.timeout(10000)});throw Error('RESOURCE_REMAINS');}
  catch(e){if(e.response?.status!==404)throw e;}
  if(!result.cleanup.includes(name))result.cleanup.push(name);
};
try {
  const first = await create('a'); assert.equal(first.image,image);
  const user = await first.createUser('factoryproducer');
  const tools = await command(user, `const fs=require('node:fs'),cp=require('node:child_process');console.log(JSON.stringify({node:process.version,arch:process.arch,platform:process.platform,uid:process.getuid(),git:cp.execFileSync('git',['--version'],{encoding:'utf8'}).trim(),sudoExit:cp.spawnSync('sudo',['-n','true']).status,credentialNames:Object.keys(process.env).filter(k=>/TOKEN|SECRET|PASSWORD|DATABASE_URL|PRIVATE_KEY/.test(k)),ownerFilesystem:fs.existsSync('/Users/jaywest'),repoPresent:['/workspace/.git','/app/.git',process.env.HOME+'/.git'].some(p=>fs.existsSync(p)),credentialFiles:['.npmrc','.git-credentials','.ssh/id_rsa','.aws/credentials'].filter(p=>fs.existsSync(process.env.HOME+'/'+p))}));`);
  assert.match(tools.node,/^v24\./);assert.equal(tools.arch,'x64');assert.equal(tools.platform,'linux');assert.ok(tools.uid>0);assert.notEqual(tools.sudoExit,0);assert.deepEqual(tools.credentialNames,[]);assert.deepEqual(tools.credentialFiles,[]);assert.equal(tools.ownerFilesystem,false);assert.equal(tools.repoPresent,false);result.observations.push({tools});await save();
  await first.updateNetworkPolicy({allow:['github.com']});
  const ca = await command(user, `require('node:https').get('https://github.com',{timeout:5000,rejectUnauthorized:true},r=>{console.log(JSON.stringify({status:r.statusCode,tlsAuthorized:r.socket.authorized}));r.resume();}).on('timeout',function(){this.destroy(Error('TIMEOUT'))}).on('error',()=>process.exit(1));`);
  assert.equal(ca.tlsAuthorized,true);assert.equal(ca.status,200);result.observations.push({ca});
  await first.updateNetworkPolicy('deny-all');
  const network = await command(user, `(async()=>{const blocked=[];for(const url of ['https://github.com','http://169.254.169.254/latest/meta-data/']){try{const r=await fetch(url,{signal:AbortSignal.timeout(2500)});blocked.push([url,r.status===403||r.status===451]);}catch{blocked.push([url,true]);}}console.log(JSON.stringify({blocked}));})();`);
  assert.ok(network.blocked.every(x=>x[1]));result.observations.push({network});
  await command(user, `require('node:fs').writeFileSync('/tmp/factory-isolation-marker',${JSON.stringify(attempt)});console.log(JSON.stringify({written:true}));`);
  await destroy(first.name); await save();
  const second=await create('b');assert.equal(second.image,image);const secondUser=await second.createUser('factoryproducer');
  const isolation=await command(secondUser, `console.log(JSON.stringify({previousFilePresent:require('node:fs').existsSync('/tmp/factory-isolation-marker')}));`);
  assert.equal(isolation.previousFilePresent,false);result.observations.push({isolation});
  await destroy(second.name);result.status='PASS';
} catch(error) { result.status='FAIL';result.error={name:error.name,message:error.message?.slice(0,300),code:error.json?.error?.code};process.exitCode=1; }
finally {
  for(const name of result.sandboxes.filter(n=>!result.cleanup.includes(n))){try{await destroy(name);}catch{result.status='FAIL';result.cleanupUnresolved=true;process.exitCode=1;}}
  result.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify(result));
}
