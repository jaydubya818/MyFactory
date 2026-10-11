import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {protectedAlphaProvider,verifierCredentials} from '../src/protected-alpha-provider.mjs';
import {protectedSandboxRunner,alphaOperationDriver,protectedLauncher} from '../src/protected-alpha-runner.mjs';
import {externalAlphaVerifierProfile} from '../src/external-alpha-verifier-profile.mjs';
import {alphaTasksVerificationPolicy as policy,alphaTasksVerificationPolicySha256 as policySha256} from '../src/external-alpha-verifier.mjs';
import {protectedDockerSandboxApi} from './fixtures/protected-docker-sandbox.mjs';
import {verifyAlphaTask,loadHiddenSuite,loadHiddenSuiteSecret,gitTreeId,HIDDEN_SUITE_SHA256} from '../../supervisor/src/alpha-task-verifier.ts';
import {baseFiles,correctFiles,negativeFixtures} from '../../supervisor/test/fixtures/alpha-tasks/index.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
test('host hidden custody requires exact decoded bytes before loading code',async()=>{
 for(const text of ['', '{}',JSON.stringify({probeBase64:'!!!',suiteBase64:'!!!'}),JSON.stringify({probeBase64:Buffer.from('not reviewed').toString('base64'),suiteBase64:Buffer.from('export default {}').toString('base64')})])await assert.rejects(loadHiddenSuiteSecret(text));
 assert.match(HIDDEN_SUITE_SHA256,/^[a-f0-9]{64}$/);
});
test('production profile is exact, digest-pinned host input',()=>{
 const tree='a'.repeat(40),p={id:'alpha-tasks-node-json-v1',kind:'PRODUCT',tree},json=JSON.stringify({version:1,kind:'EXTERNAL_ALPHA_VERIFIER_PROFILES_V1',entries:[p]});
 const env={FACTORY_EXTERNAL_ALPHA_VERIFIER_PROFILES_JSON:json,FACTORY_EXTERNAL_ALPHA_VERIFIER_PROFILES_SHA256:hash(json)};
 assert.deepEqual(externalAlphaVerifierProfile(env,{source:{treeSha:tree}}),p);
 for(const e of [{},{...env,FACTORY_EXTERNAL_ALPHA_VERIFIER_PROFILES_SHA256:'0'.repeat(64)},{...env,FACTORY_EXTERNAL_ALPHA_VERIFIER_PROFILES_JSON:json+' '}])assert.throws(()=>externalAlphaVerifierProfile(e,{source:{treeSha:tree}}),/VERIFIER_PROFILE_REQUIRED/);
 assert.throws(()=>externalAlphaVerifierProfile(env,{source:{treeSha:'b'.repeat(40)}}),/VERIFIER_PROFILE_REQUIRED/);
});
test('credential options cannot replace isolation or resource bounds',async()=>{
 for(const options of [{networkPolicy:'allow-all'},{env:{TOKEN:'x'}},{image:'other'},{timeout:1},{ports:[80]},{fetch:()=>{}}])await assert.rejects(verifierCredentials(async()=>options),/VERIFIER_CREDENTIAL_SCOPE/);
 assert.deepEqual(await verifierCredentials(async()=>({token:'opaque',projectId:'prj_fixture',teamId:'team_fixture'})),{token:'opaque',projectId:'prj_fixture',teamId:'team_fixture'});
});
test('request creation metadata is insufficient to attest isolation',async()=>{
 let commands=0;const session=()=>({sessionId:'sbx_fixture',networkPolicy:'deny-all',routes:[]});
 const base={name:'fixture',image:policy.image,persistent:false,networkPolicy:'deny-all',routes:[],mounts:{},currentSession:session,asUser:()=>({runCommand:async()=>{commands++;throw Error('unexpected');}})};
 for(const patch of [{networkPolicy:'allow-all'},{persistent:true},{routes:[{}]},{mounts:{'/data':{}}},{interactivePort:80},{currentSession:()=>({...session(),networkPolicy:'allow-all'})}]){
  const r=protectedSandboxRunner(base,{image:policy.image,deadline:Date.now()+10000,readSandbox:async()=>({...base,...patch})});await assert.rejects(r.attestation(),/VERIFIER_ISOLATION_UNPROVEN/);
 }
 assert.equal(commands,0);
});
test('public candidate driver and launcher contain no acceptance values or hidden probe',()=>{
 assert.ok(alphaOperationDriver.includes('process.stdin'));assert.ok(protectedLauncher.includes('request.ops[at]'));assert.ok(protectedLauncher.includes('--no-new-privs'));assert.ok(!alphaOperationDriver.includes('nonce'));assert.ok(!alphaOperationDriver.includes('scenarios'));
});

const runLinux=process.env.FACTORY_VERIFIER_DOCKER_QUALIFICATION==='1';
test('real offline Linux confinement: exact candidate, all ten criteria, negative candidate, isolation and confirmed teardown',{skip:!runLinux,timeout:240000},async()=>{
 const api=protectedDockerSandboxApi(),host=protectedAlphaProvider({policy,policySha256,projectId:'prj_fixture',sandboxApi:api});
 const hidden=await loadHiddenSuite(),source={commit:'a'.repeat(40),tree:gitTreeId(baseFiles),files:baseFiles};
 try{
  for(const [label,files,want] of [['correct',correctFiles(),'PASS'],['negative',Object.values(negativeFixtures())[0].files,'FAIL']]){
   const resource={run_id:label,provider_name:'factory-verify-'+label,image:policy.image,policy_sha256:policySha256,deadline:new Date(Date.now()+110000).toISOString()};
   const sandbox=await host.allocate(resource),runner=host.runnerFor(sandbox),isolationAttestation=await host.attestationFor(sandbox,runner),candidate={commit:'b'.repeat(40),tree:gitTreeId(files),parent:source.commit,files};
   const report=await verifyAlphaTask({mode:'production',productionProfile:{id:'alpha-tasks-node-json-v1',kind:'PRODUCT',tree:source.tree},runner,hidden,isolationAttestation,source,candidate,expected:{sourceCommit:source.commit,sourceTree:source.tree,candidateCommit:candidate.commit,candidateTree:candidate.tree},producer:{environmentId:'producer-fixture'},verifier:{environmentId:sandbox.name},observedEffects:['PRIVATE_SOURCE_READ'],limits:{runMs:90000}});
   assert.equal(report.verdict,want,JSON.stringify(report.checks.map(c=>({id:c.id,status:c.status,code:c.code}))));
   if(want==='PASS')assert.equal(report.criteria.filter(c=>c.status==='PASS').length,10);
   if(want==='PASS'){
    const ws=await runner.workspace(files);
    try{
     const title='€'.repeat(24000),out=await runner.probe(ws,{id:'public-unicode-stream',ops:[{do:'open',store:'s'},{do:'create',store:'s',input:{title}}]},{timeoutMs:10000});
     assert.equal(out.crashed,false);assert.equal(out.results[1].value.title,title);
    }finally{await ws.dispose();}
   }
   await host.destroy(resource,sandbox);await assert.rejects(api.get({name:resource.provider_name}),e=>e.response?.status===404);
  }
 }finally{await api.cleanup();}
});
