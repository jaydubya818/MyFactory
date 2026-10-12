import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assessRelease, readReference, sha256, verifyGoldenReceipt, GOLDEN_STAGES, NEGATIVE_CASES, JOURNEY_IDENTITIES } from './validate.mjs';
import { manifestSchema, shapeErrors } from './schema.mjs';
import { assessOperation } from './risk-tier.mjs';

const recordUrl = new URL('./fixtures/release-manifest.json', import.meta.url);
const original = JSON.parse(readFileSync(recordUrl));
const copy = () => structuredClone(original);
const now = Date.parse(original.recordedAt) + 1000;
const assess = (m) => assessRelease(m, { now, verifyFiles: false });
const has = (r, code) => [...r.errors, ...r.blockers].some((item) => item.code === code);
const findEvidence = (m, id) => m.evidence.find((item) => item.id === id);
const input = (m, id) => m.inputs.find((item) => item.id === id);

test('versioned schema and runtime shape agree; discovery remains not ready', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../../docs/releases/unified-beta/release-manifest.schema.json', import.meta.url))), manifestSchema);
  assert.deepEqual(shapeErrors(original), []);
  const result = assess(original);
  assert.equal(result.valid, true);
  assert.equal(result.ready, false);
  assert.equal(result.deploymentAuthorized, false);
  assert.ok(has(result, 'GOLDEN_JOURNEY_NOT_PASS'));
  assert.ok(has(result, 'INSTALLATION_BINDING_MISSING'));
});

test('missing exact source fails structural validation', () => {
  const m = copy(); delete m.components[0].sourceSha;
  assert.equal(assess(m).valid, false);
  m.components[0].sourceSha = 'main';
  assert.equal(assess(m).valid, false);
});

test('unexpected authority fields and removal of holds fail closed', () => {
  const m = copy(); m.authorization.productionAuthorized = true;
  assert.ok(has(assess(m), 'SCHEMA'));
  m.authorization.productionAuthorized = false; m.authorization.holds.pop();
  assert.ok(has(assess(m), 'RELEASE_HOLD_REMOVED'));
  m.authorization.authorizeAfterGreenCI = true;
  assert.ok(has(assess(m), 'SCHEMA'));
});

test('expired canonical pricing blocks release exactly at its deadline', () => {
  const report = assessRelease(copy(), { now: Date.parse(original.authorization.pricingRenewal.expiresAt), verifyFiles: false });
  assert.ok(has(report, 'PRICING_EXPIRED'));
  assert.ok(has(report, 'PRICING_RENEWAL_REQUIRED'));
  assert.equal(report.deploymentAuthorized, false);
});

test('changing a displayed expiration cannot renew the owning record', () => {
  const m = copy(); m.authorization.pricingRenewal.expiresAt = '2099-01-01T00:00:00Z';
  m.components.find((c) => c.id === 'myfactory').pricingExpiresAt = '2099-01-01T00:00:00Z';
  assert.ok(has(assess(m), 'PRICING_RECORD_MISMATCH'));
  assert.ok(has(assess(m), 'PRICING_RENEWAL_MISMATCH'));
});

test('one changed source invalidates its dependent evidence and preserves unrelated checks', () => {
  const m = copy(); input(m, 'relay.source').value = 'a'.repeat(40);
  const r = assess(m);
  assert.ok(r.staleEvidence.some((e) => e.id === 'relay-hosted'));
  assert.ok(r.staleEvidence.some((e) => e.id === 'relay-review'));
  assert.ok(r.preservedEvidence.includes('myeve-hosted'));
  assert.ok(r.preservedEvidence.includes('missioncontrol-hosted'));
  assert.ok(r.preservedEvidence.includes('myapps-migration'));
  assert.ok(r.requalificationPlan.some((p) => p.evidence === 'relay-hosted'));
  assert.ok(!r.requalificationPlan.some((p) => p.evidence === 'myeve-hosted'));
});

test('consumer evidence can remain valid across a source change when it binds unchanged contract bytes', () => {
  const m = copy();
  const e = structuredClone(findEvidence(m, 'myeve-hosted'));
  e.id = 'contract-consumer'; e.scope = 'COMPOSED'; e.dependencies = { 'myeve.contract': input(m, 'myeve.contract').value };
  m.evidence.push(e); input(m, 'myeve.source').value = 'b'.repeat(40);
  const r = assess(m);
  assert.ok(r.staleEvidence.some((row) => row.id === 'myeve-hosted'));
  assert.ok(r.preservedEvidence.includes('contract-consumer'));
});

test('changed execution contracts and incompatible FactoryVersions are detected', () => {
  const m = copy();
  m.requirements.push({ consumer: 'myapps', input: 'factory.version', expected: 'accepted-version', reason: 'Exact installed version' });
  input(m, 'factory.version').value = 'different-version';
  const r = assess(m);
  assert.ok(has(r, 'INCOMPATIBLE_DEPENDENCY'));
  input(m, 'factory.execution').value = 'c'.repeat(64);
  assert.ok(has(assess(m), 'CONTRACT_DIGEST_INVALID'));
});

test('missing or reordered migration dependencies and normalized number collisions are rejected', () => {
  const m = copy(), c = m.components.find((c) => c.id === 'myapps');
  c.migrations[0].requires = ['0093'];
  assert.ok(has(assess(m), 'MIGRATION_DEPENDENCY_MISSING'));
  c.migrations[0].requires = [];
  c.migrations.push({ ...c.migrations[0], id: String(Number(c.migrations[0].id)) });
  assert.ok(has(assess(m), 'MIGRATION_NUMBER_COLLISION'));
});

test('NOT_RUN cannot hide inside a passing evidence record', () => {
  const m = copy(); findEvidence(m, 'myeve-hosted').checks[0].status = 'NOT_RUN';
  const r = assess(m);
  assert.ok(has(r, 'REQUIRED_CHECK_NOT_PASS'));
  assert.ok(!r.preservedEvidence.includes('myeve-hosted'));
  assert.ok(r.requalificationPlan.some((e) => e.evidence === 'myeve-hosted'));
});

test('independent review must bind the exact component source and a different reviewer', () => {
  const m = copy(), e = findEvidence(m, 'myeve-mc-review');
  e.reviewer = e.implementationOwner;
  assert.ok(has(assess(m), 'INDEPENDENT_REVIEW_MISSING'));
  e.reviewer = 'independent'; e.dependencies = { 'relay.source': input(m,'relay.source').value };
  assert.ok(has(assess(m), 'COMPONENT_SOURCE_NOT_REVIEWED'));
});

test('duplicate IDs, unknown dependencies, missing components and cohort slots fail closed', () => {
  const m = copy(); m.inputs.push(structuredClone(m.inputs[0])); m.components.pop(); m.installations.pop();
  m.ownership[0].dependencies.push('does-not-exist');
  const r = assess(m);
  for (const code of ['DUPLICATE_ID','COMPONENT_MISSING','INSTALLATION_SLOT_MISSING','TASK_DEPENDENCY_UNKNOWN']) assert.ok(has(r,code),code);
});

for (const field of ['identity', 'ownerBinding']) test(`owner and tester slots cannot reuse ${field}`, () => {
  const m = copy();
  m.installations[0][field] = 'owner-slot';
  m.installations[1][field] = 'tester-slot';
  m.installations[2][field] = 'owner-slot';
  assert.ok(has(assess(m), 'INSTALLATION_BINDING_REUSED'));
  m.installations[2][field] = 'second-tester-slot';
  assert.ok(!has(assess(m), 'INSTALLATION_BINDING_REUSED'));
});

for (const kind of ['BRANCH','CONTRACT','FACTORY_VERSION','PRICING','MIGRATION']) test(`detect concurrent ${kind} claims before writing`, () => {
  const m=copy(), first=m.ownership[0], second=structuredClone(first);
  first.claims=[{kind,key:'same-resource',value:'first'}];
  second.taskId='conflicting-task'; second.implementationOwner='other-agent'; second.claims=[{kind,key:'same-resource',value:'second'}];
  m.ownership.push(second);
  assert.ok(has(assess(m),'OWNERSHIP_CONFLICT'));
  second.state='COMPLETE';
  assert.ok(!has(assess(m),'OWNERSHIP_CONFLICT'));
});

test('required stages and negative coverage cannot disappear from the manifest', () => {
  const m=copy(); m.goldenJourney.stages.pop(); m.goldenJourney.negativeCases.pop();
  assert.ok(has(assess(m),'GOLDEN_STAGE_MISSING'));
  assert.ok(has(assess(m),'GOLDEN_NEGATIVE_MISSING'));
});

test('outstanding release controls cannot be removed or made optional',()=>{
  const m=copy(); m.evidence=m.evidence.filter((e)=>e.id!=='deployment-controls');
  assert.ok(has(assess(m),'REQUIRED_RELEASE_GATE_MISSING'));
  const second=copy(); findEvidence(second,'protected-custody').required=false;
  assert.ok(has(assess(second),'REQUIRED_RELEASE_GATE_MISSING'));
});

test('a held custody task retains its single-writer claim',()=>{
  const m=copy(), task=structuredClone(m.ownership.find((t)=>t.taskId==='external-alpha-custody'));
  task.taskId='unauthorized-custody-retry'; task.state='ACTIVE'; task.implementationOwner='another-agent';
  m.ownership.push(task);
  assert.ok(has(assess(m),'OWNERSHIP_CONFLICT'));
});

const goldenExpectation=()=>({releaseId:'synthetic-release',slot:'PLATFORM_OWNER',sourceShas:{myeve:'a'.repeat(40)},identity:Object.fromEntries(['owner','installation','capabilityPolicy','factoryVersion'].map(name=>[name,`synthetic-test-${name}`]))});
const golden = () => {
  const identity=Object.fromEntries(JOURNEY_IDENTITIES.map((name)=>[name,`synthetic-test-${name}`]));
  return {releaseId:'synthetic-release',slot:'PLATFORM_OWNER',sourceShas:goldenExpectation().sourceShas,schema:'unified-installed-journey/v1',environment:'APPROVED_NONPRODUCTION',synthetic:false,canonicalIdentity:identity,
    stages:GOLDEN_STAGES.map((stage)=>({stage,status:'PASS',identity:{...identity}})),
    negativeCases:NEGATIVE_CASES.map((id)=>({id,status:'PASS'})),cleanup:'VERIFIED',independentVerification:'PASS'};
};
test('receipt checker accepts a complete consistent retrospective identity chain',()=>assert.deepEqual(verifyGoldenReceipt(golden(),goldenExpectation()),[]));
for(const identity of JOURNEY_IDENTITIES) test(`reject Golden Journey ${identity} substitution`,()=>{
  const r=golden(); r.stages[7].identity[identity]='foreign';
  assert.ok(verifyGoldenReceipt(r,goldenExpectation()).some((message)=>message.includes(identity)));
});
test('synthetic, missing, duplicate, failed and unclean journey stages cannot become installed PASS',()=>{
  const r=golden(); r.synthetic=true;
  assert.ok(verifyGoldenReceipt(r,goldenExpectation()).length);
  r.synthetic=false; r.stages.push(r.stages[0]); r.stages[1].status='NOT_RUN'; r.negativeCases.pop(); r.cleanup='UNKNOWN';
  assert.ok(verifyGoldenReceipt(r,goldenExpectation()).length>=4);
});

test('a successful negative check cannot conceal a duplicate failed result',()=>{
  const r=golden(); r.negativeCases.push({id:NEGATIVE_CASES[0],status:'FAIL'});
  assert.ok(verifyGoldenReceipt(r,goldenExpectation()).some((message)=>message.includes(NEGATIVE_CASES[0])));
  r.negativeCases=null;
  assert.deepEqual(verifyGoldenReceipt(r,goldenExpectation()),['Stage and negative-case arrays required.']);
});

test('checksums, traversal, symlinks and missing roots are rejected without reading unrelated files',()=>{
  const root=mkdtempSync(join(tmpdir(),'release-ref-'));
  try {
    writeFileSync(join(root,'evidence.json'),'{}');
    const ref={root:'test',path:'evidence.json',sha256:sha256('{}')};
    assert.equal(readReference(ref,{test:root}).toString(),'{}');
    assert.throws(()=>readReference({...ref,path:'../evidence.json'},{test:root}),/PATH_DENIED/);
    assert.throws(()=>readReference({...ref,sha256:'0'.repeat(64)},{test:root}),/CHECKSUM_CHANGED/);
    symlinkSync(join(root,'evidence.json'),join(root,'link.json'));
    assert.throws(()=>readReference({...ref,path:'link.json'},{test:root}),/SYMLINK/);
    assert.throws(()=>readReference(ref,{}),/ROOT_UNAVAILABLE/);
  } finally {rmSync(root,{recursive:true});}
});

test('manifest cannot rewrite an identity inside an unchanged owning JSON file',()=>{
  const root=mkdtempSync(join(tmpdir(),'release-canonical-'));
  try {
    writeFileSync(join(root,'price.json'),JSON.stringify({reviewBy:'2026-10-17T00:00:00.000Z'}));
    const m=copy(), e=input(m,'pricing.expiration');
    e.value='2099-01-01T00:00:00Z'; e.canonicalRecord={root:'test',path:'price.json',sha256:sha256(readFileSync(join(root,'price.json')))};
    const r=assessRelease(m,{roots:{test:root},now});
    assert.ok(r.blockers.some((b)=>b.code==='CANONICAL_VALUE_MISMATCH'&&b.subject==='pricing.expiration'));
  } finally {rmSync(root,{recursive:true});}
});

test('the public CLI fails closed when evidence roots are unavailable',()=>{
  const root=mkdtempSync(join(tmpdir(),'release-cli-'));
  try {
    writeFileSync(join(root,'roots.json'),'{}');
    const result=spawnSync(process.execPath,[new URL('./validate.mjs',import.meta.url).pathname,recordUrl.pathname,join(root,'roots.json')],{encoding:'utf8'});
    assert.equal(result.status,1);
    const r=JSON.parse(result.stdout);
    assert.equal(r.ready,false); assert.equal(r.deploymentAuthorized,false);
    assert.ok(has(r,'ROOT_UNAVAILABLE'));
  }finally{rmSync(root,{recursive:true});}
});

const local = () => ({effects:['SOURCE_EDIT','UNIT_TEST'],environment:'DISPOSABLE_LOCAL',realUsers:false,realCredentials:false,protectedMaterial:false,costCeilingUsd:0});
test('routine disposable development proceeds inside existing engineering scope',()=>{
  assert.deepEqual(assessOperation(local()),{tier:1,decision:'WITHIN_ENGINEERING_SCOPE',reason:'Bounded local development under the existing user instruction.',grantsExecutionAuthority:false});
});
for(const field of ['realUsers','realCredentials','protectedMaterial'])test(`local label cannot bypass ${field} boundary`,()=>{
  assert.equal(assessOperation({...local(),[field]:true}).decision,'CANONICAL_AUTHORIZATION_REQUIRED');
});
test('qualification requires exact source, independent review, evidence and cleanup',()=>{
  const q={...local(),effects:['ISOLATED_CI'],environment:'ISOLATED_QUALIFICATION'};
  assert.equal(assessOperation(q).decision,'QUALIFICATION_REQUIREMENTS_MISSING');
  q.qualification={sourceSha:'a'.repeat(40),evidenceDigest:'b'.repeat(64),reproducible:true,cleanupVerified:true,maxSeconds:900,implementer:'one',reviewer:'two'};
  assert.equal(assessOperation(q).decision,'WITHIN_ENGINEERING_SCOPE');
  q.qualification.reviewer='one';
  assert.equal(assessOperation(q).decision,'QUALIFICATION_REQUIREMENTS_MISSING');
});
for(const effect of ['MERGE','DEPLOY','REAL_MIGRATION','PAID_EXECUTION','CREDENTIAL_CHANGE','TESTER_ACTIVATION','PUBLISH','CUSTODY_RETRY','UNKNOWN_EFFECT'])test(`${effect} always refers back to canonical authority`,()=>{
  assert.equal(assessOperation({...local(),effects:[effect],ownerApproved:true}).decision,'CANONICAL_AUTHORIZATION_REQUIRED');
});
