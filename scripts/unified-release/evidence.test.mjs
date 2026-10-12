// Public, disposable fixtures. These tests do not qualify real installations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {assessRelease, filesDigest, sha256, COORDINATION_FILES} from './validate.mjs';
import {retainedEvidenceDependencies, retainedEvidenceBinding, validateEvidenceSelection} from './retained-evidence.mjs';
import {INSTALLATION_FIELDS, GOLDEN_STAGES, NEGATIVE_CASES, JOURNEY_IDENTITIES, pointerValue, verifyGoldenReceipt} from './installation-evidence.mjs';

const original=JSON.parse(readFileSync(new URL('./fixtures/release-manifest.json',import.meta.url)));
const has=(report,code)=>[...report.errors,...report.blockers].some(row=>row.code===code);
const input=(m,id)=>m.inputs.find(row=>row.id===id);
const evidence=(m,id)=>m.evidence.find(row=>row.id===id);

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'coordination-public-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');writeFileSync(join(dir,'tracked.txt'),'PUBLIC FIXTURE');git('add','tracked.txt');
  git('-c','user.name=Public Fixture','-c','user.email=fixture@example.invalid','commit','-qm','public fixture');
  const commit=git('rev-parse','HEAD');
  // Evidence and dummy qualification inputs are not product source.
  writeFileSync(join(dir,'.git/info/exclude'),'*\n');
  const ref=(name,value)=>{
    const data=JSON.stringify(value), path=join(dir,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,data);
    return {root:'fixture',path:name,sha256:sha256(data)};
  };
  const record=ref('record.json',{status:'PUBLIC_FIXTURE'});
  const m=structuredClone(original),roots={fixture:dir,'coordination-source':dir};
  m.canonicalAuthorizationPackage=record;m.authorization.record=record;
  for(const i of m.inputs){
    if(i.kind==='SOURCE'){i.value=commit;roots[i.root]=dir;}
    else if(i.kind==='FILES'){
      i.files=i.id==='coordination.code'?COORDINATION_FILES.map(path=>({...ref(path,{publicFixture:path}),root:'coordination-source'})):[record];
      i.value=filesDigest(i.files);
    } else {i.value=i.id==='pricing.expiration'?'2099-01-01T00:00:00.000Z':'public-'+i.id;i.canonicalRecord=ref(i.id+'.json',{value:i.value});i.pointer='/value';}
  }
  for(const e of m.evidence){
    e.status='PASS';e.record=record;e.expiresAt=null;e.checks=e.checks.map(c=>({...c,status:'PASS'}));
    e.dependencies=Object.fromEntries(Object.keys(e.dependencies).map(id=>[id,input(m,id).value]));
    if(e.scope==='REVIEW'){e.reviewer='independent';e.implementationOwner='implementer';}
  }
  for(const c of m.components){c.sourceSha=commit;c.adoption='ACCEPTED';c.runtimeIdentity='public-runtime-'+c.id;c.migrations=[];c.blockers=[];if(c.pricingId!==null){c.pricingId=input(m,'pricing.identity').value;c.pricingExpiresAt=input(m,'pricing.expiration').value;}}
  for(const r of m.requirements)r.expected=input(m,r.input).value;
  const sourceShas=Object.fromEntries(m.components.map(c=>[c.id,c.sourceSha]));
  const journeys=[];
  for(const installation of m.installations){
    const bindings=Object.fromEntries(INSTALLATION_FIELDS.map(field=>[field,installation.slot+'-'+field]));
    Object.assign(installation,bindings);
    installation.canonicalPointers=Object.fromEntries(INSTALLATION_FIELDS.map(field=>[field,'/bindings/'+field]));
    installation.canonicalRecord=ref(installation.slot+'.json',{bindings});
    const id='qualification-'+installation.slot;
    installation.qualificationEvidence=[id];
    const receipt={schema:'unified-installation-qualification/v1',status:'PASS',releaseId:m.releaseId,sourceShas,slot:installation.slot,bindings,canonicalRecord:installation.canonicalRecord};
    m.evidence.push({...structuredClone(evidence(m,'installed-owner-binding')),id,record:ref(id+'.json',receipt),dependencies:Object.fromEntries(m.components.map(c=>[c.id+'.source',c.sourceSha]))});
    const identity={...Object.fromEntries(JOURNEY_IDENTITIES.map(key=>[key,installation.slot+'-'+key])),owner:bindings.ownerBinding,installation:bindings.identity,capabilityPolicy:bindings.capabilityPolicy,factoryVersion:bindings.factoryVersion};
    journeys.push({schema:'unified-installed-journey/v1',environment:'APPROVED_NONPRODUCTION',synthetic:false,releaseId:m.releaseId,sourceShas,slot:installation.slot,canonicalIdentity:identity,stages:GOLDEN_STAGES.map(stage=>({stage,status:'PASS',identity:{...identity}})),negativeCases:NEGATIVE_CASES.map(id=>({id,status:'PASS'})),cleanup:'VERIFIED',independentVerification:'PASS'});
  }
  const cohort={schema:'unified-installed-cohort/v1',releaseId:m.releaseId,sourceShas,journeys};
  evidence(m,'installed-golden').record=ref('golden.json',cohort);
  for(const task of m.ownership)task.verificationOwner='independent-fixture-reviewer';
  m.goldenJourney.status='PASS';m.goldenJourney.evidence='installed-golden';
  m.authorization.pricingRenewal.record=input(m,'pricing.expiration').canonicalRecord;m.authorization.pricingRenewal.expiresAt=input(m,'pricing.expiration').value;
  return {m,dir,ref,cohort,assess:(manifest=m)=>assessRelease(manifest,{roots,now:Date.parse('2026-10-11T12:00:00Z')})};
}

function rejected(report,code){assert.equal(report.ready,false);assert.equal(report.deploymentAuthorized,false);assert.ok(has(report,code),JSON.stringify(report));}

test('complete public cohort verifies integrity without authorizing deployment',t=>{
  const f=fixture(t),r=f.assess();assert.equal(r.valid,true,JSON.stringify(r));assert.equal(r.ready,true,JSON.stringify(r));assert.equal(r.deploymentAuthorized,false);
});
for(const field of INSTALLATION_FIELDS)test(`canonical installation record rejects displayed ${field} substitution`,t=>{
  const f=fixture(t);f.m.installations[0][field]='FOREIGN';rejected(f.assess(),'INSTALLATION_CANONICAL_VALUE_MISMATCH');
});
test('JSON pointers support escaped own keys and reject malformed or inherited lookup',()=>{
  assert.equal(pointerValue({'a/b':{'~key':'expected'}},'/a~1b/~0key'),'expected');
  for(const pointer of ['','a','/~2','/constructor','/missing'])assert.throws(()=>pointerValue({},pointer));
});
test('missing pointers and swapping owning records cannot qualify a slot',t=>{
  const f=fixture(t);f.m.installations[0].canonicalPointers=null;rejected(f.assess(),'INSTALLATION_POINTERS_MISSING');
  const g=fixture(t);g.m.installations[0].canonicalRecord=g.m.installations[1].canonicalRecord;rejected(g.assess(),'INSTALLATION_CANONICAL_VALUE_MISMATCH');
});
for(const field of ['releaseId','slot','sourceShas','canonicalRecord','bindings'])test(`installation qualification rejects unrelated ${field}`,t=>{
  const f=fixture(t),e=evidence(f.m,f.m.installations[0].qualificationEvidence[0]);
  const receipt=JSON.parse(readFileSync(join(f.dir,e.record.path)));
  if(field==='sourceShas')receipt.sourceShas.myeve='f'.repeat(40);
  else if(field==='canonicalRecord')receipt.canonicalRecord=f.m.installations[1].canonicalRecord;
  else if(field==='bindings')receipt.bindings.factoryVersion='foreign';
  else receipt[field]='FOREIGN';
  e.record=f.ref('changed-qualification.json',receipt);rejected(f.assess(),'INSTALLATION_EVIDENCE_BINDING');
});
test('one qualification cannot be reused for multiple slots',t=>{
  const f=fixture(t);f.m.installations[1].qualificationEvidence=f.m.installations[0].qualificationEvidence;
  const r=f.assess();rejected(r,'INSTALLATION_EVIDENCE_REUSED');assert.ok(r.staleEvidence.some(e=>e.id===f.m.installations[0].qualificationEvidence[0]));
});
test('installation evidence must declare every selected source dependency',t=>{
  const f=fixture(t);delete evidence(f.m,f.m.installations[0].qualificationEvidence[0]).dependencies['myfactory.source'];rejected(f.assess(),'INSTALLATION_SOURCE_NOT_BOUND');
});
for(const field of ['owner','installation','capabilityPolicy','factoryVersion'])test(`internally consistent foreign Golden ${field} is rejected`,t=>{
  const f=fixture(t),journey=f.cohort.journeys[0];journey.canonicalIdentity[field]='FOREIGN';for(const stage of journey.stages)stage.identity[field]='FOREIGN';
  evidence(f.m,'installed-golden').record=f.ref('foreign-golden.json',f.cohort);rejected(f.assess(),'GOLDEN_IDENTITY_MISMATCH');
});
for(const alteration of ['release','source','row-release','row-source','missing-slot','duplicate-slot'])test(`Golden cohort rejects ${alteration}`,t=>{
  const f=fixture(t);
  if(alteration==='release')f.cohort.releaseId='FOREIGN';
  if(alteration==='source')f.cohort.sourceShas={...f.cohort.sourceShas,myeve:'f'.repeat(40)};
  if(alteration==='row-release')f.cohort.journeys[1].releaseId='FOREIGN';
  if(alteration==='row-source')f.cohort.journeys[1].sourceShas={...f.cohort.sourceShas,myeve:'f'.repeat(40)};
  if(alteration==='missing-slot')f.cohort.journeys.pop();
  if(alteration==='duplicate-slot')f.cohort.journeys[2]=f.cohort.journeys[0];
  evidence(f.m,'installed-golden').record=f.ref('changed-golden.json',f.cohort);rejected(f.assess(),'GOLDEN_IDENTITY_MISMATCH');
});
test('Golden receipt cannot derive authority from its own declarations',t=>{
  const f=fixture(t);const receipt=f.cohort.journeys[0];assert.ok(verifyGoldenReceipt(receipt).length);
  for(const sourceShas of [undefined,{}, {myeve:'main'}])assert.ok(verifyGoldenReceipt(receipt,{releaseId:f.m.releaseId,slot:receipt.slot,identity:{owner:receipt.canonicalIdentity.owner,installation:receipt.canonicalIdentity.installation,capabilityPolicy:receipt.canonicalIdentity.capabilityPolicy,factoryVersion:receipt.canonicalIdentity.factoryVersion},sourceShas}).length);
});
test('Factory source advance invalidates custody even when historical runtime identity stays unchanged',t=>{
  const f=fixture(t),prior=input(f.m,'factory.runtime-source').value;
  input(f.m,'myfactory.source').value='f'.repeat(40);f.m.components.find(c=>c.id==='myfactory').sourceSha='f'.repeat(40);
  const r=f.assess();assert.equal(input(f.m,'factory.runtime-source').value,prior);assert.ok(r.staleEvidence.some(e=>e.id==='protected-custody'&&e.reasons.includes('myfactory.source')));assert.ok(!r.preservedEvidence.includes('protected-custody'));assert.equal(evidence(f.m,'protected-custody').status,'PASS');
});
test('custody cannot drop its selected Factory source dependency',t=>{
  const f=fixture(t);delete evidence(f.m,'protected-custody').dependencies['myfactory.source'];rejected(f.assess(),'CUSTODY_SOURCE_NOT_BOUND');
});
for(const path of ['scripts/unified-release/fixtures/release-manifest.json','docs/releases/unified-beta/release-manifest.schema.json','scripts/unified-release/generate.mjs','scripts/unified-release/retained-evidence.mjs','scripts/unified-release/retained-evidence-pins.json']){
  test(`qualification requires declared ${path}`,t=>{
    const f=fixture(t),i=input(f.m,'coordination.code');i.files=i.files.filter(file=>file.path!==path);i.value=filesDigest(i.files);rejected(f.assess(),'COORDINATION_INPUTS_INCOMPLETE');
  });
  test(`changed ${path} invalidates previous unit and fresh-clone qualification`,t=>{
    const f=fixture(t);writeFileSync(join(f.dir,path),'changed public fixture');const r=f.assess();
    for(const id of ['coordination-unit','coordination-fresh-clone'])assert.ok(r.staleEvidence.some(e=>e.id===id&&e.reasons.includes('coordination.code')),id);
    rejected(r,'EVIDENCE_CHECKSUM_CHANGED');
  });
}
test('updating the coordination digest does not transfer historical PASS',t=>{
  const f=fixture(t),i=input(f.m,'coordination.code');i.files[0]= {...f.ref(i.files[0].path,{changed:true}),root:'coordination-source'};i.value=filesDigest(i.files);
  const r=f.assess();assert.ok(r.staleEvidence.some(e=>e.id==='coordination-unit'));assert.equal(evidence(f.m,'coordination-unit').status,'PASS');assert.equal(r.ready,false);
});

test('reusing an unknown qualification ID fails closed without crashing',t=>{
  const f=fixture(t);for(const installation of f.m.installations)installation.qualificationEvidence=['unknown'];
  rejected(f.assess(),'INSTALLATION_EVIDENCE_INVALID');
});

// CI must continue selecting both dependency-free coordinator suites explicitly.
test('workflow selects exactly both coordinator test files without discovery or shell expansion',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/unified-release-coordination.yml',import.meta.url),'utf8');
  const commands=workflow.split(/\r?\n/).map(line=>line.trim()).filter(line=>/^run:.*node.*--test/.test(line));
  assert.deepEqual(commands,['run: node --test --test-reporter=tap scripts/unified-release/validate.test.mjs scripts/unified-release/evidence.test.mjs']);
});

const retainedPins=JSON.parse(readFileSync(new URL('./retained-evidence-pins.json',import.meta.url))).entries;
test('all retained PASS dependencies stay bound to their immutable original records',()=>{
  assert.equal(Object.keys(retainedPins).length,9);
  for(const [id,pin]of Object.entries(retainedPins)){
    const deps=retainedEvidenceDependencies(id,{sha256:pin.recordSha256});
    assert.deepEqual(deps,pin.dependencies);assert(Object.isFrozen(deps));
    assert.notEqual(deps,pin.dependencies);
  }
});
test('missing, foreign or changed retained provenance cannot inherit current qualification',()=>{
  for(const [id,pin]of Object.entries(retainedPins)){
    for(const record of [null,{}, {sha256:'f'.repeat(64)}])assert.throws(()=>retainedEvidenceDependencies(id,record),/RETAINED_EVIDENCE_PROVENANCE_UNQUALIFIED/);
    assert.throws(()=>retainedEvidenceDependencies(id+'-foreign',{sha256:pin.recordSha256}),/RETAINED_EVIDENCE_PROVENANCE_UNQUALIFIED/);
  }
});

test('real generator preserves historical bindings across regeneration and rejects receipt tampering',t=>{
  // Original receipts are private. This disposable fixture substitutes PUBLIC
  // receipt bytes and pins only; generator and validator source are copied exactly.
  const dir=mkdtempSync(join(tmpdir(),'coordination-generator-public-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=new URL('../../',import.meta.url).pathname;
  const repo=join(dir,'repo'),base=join(dir,'inputs');
  for(const path of COORDINATION_FILES){mkdirSync(dirname(join(repo,path)),{recursive:true});copyFileSync(join(source,path),join(repo,path));}
  const roots=Object.fromEntries(['myeve','myfactory','missioncontrol','relay','relay-consumer','legacy-coordination','relay-evidence','factory-provenance-review','coordination-evidence'].map(root=>[root,join(base,root)]));
  roots['coordination-source']=repo;
  const put=(root,path,value)=>{const target=join(roots[root],path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));};
  const paths={myeve:['apps/eve/lib/missioncontrol/contracts.ts','apps/eve/lib/missioncontrol/consumer.ts','apps/eve/migrations/0001_public.sql'],myfactory:['apps/cloud-control/src/production-execution-plan.mjs','apps/cloud-control/src/cloud-harness-plan.mjs','apps/cloud-control/migrations/0001_public.sql','apps/cloud-control/src/source-identity.json'],missioncontrol:['convex/sofieEnterprise.ts','packages/capability-control/src/types.ts','packages/capability-control/src/resolver.ts','packages/capability-control/src/registry.ts'],'relay-consumer':['docs/integrations-native-receiving.md'],'legacy-coordination':['claude-corrective-qualification/hosted-14f07/receipt.json','claude-corrective-qualification/owner-hosted-14f07/receipt.json','claude-corrective-qualification/hosted-af521/receipt.json','hosted-factory-e36.json','claude-corrective-qualification/actual-claude-s1-s4-review/INDEPENDENT-S1-S4-RE-REVIEW.md','claude-corrective-qualification/INDEPENDENT-RE-REVIEW.md','claude-corrective-qualification/actual-claude-hosted-relay-review/INDEPENDENT-HOSTED-14-AF521-AND-RELAY-1AEC-REVIEW.md','migration-recovery.json','CUSTODY-EXECUTION-DECISION-V3-5.md','AUTHORIZATION-PACKAGE.md'],'relay-evidence':['qualification.json','deployment-readback-1aec.json'],'factory-provenance-review':['CLAUDE-INDEPENDENT-REVIEW-RECEIPT.md']};
  for(const [root,names]of Object.entries(paths))for(const path of names)put(root,path,'PUBLIC FIXTURE\n');
  put('legacy-coordination','successor-status.json',{factorySourceDigest:'1'.repeat(64)});
  put('myfactory','docs/capability-control/pricing-20261010/20261010-v2.json',{version:'PUBLIC',reviewBy:'2099-01-01T00:00:00Z'});
  const discovery=Object.fromEntries(['myeve','myfactory','missioncontrol','relay','relay-consumer'].map(root=>[root,{sha:'a'.repeat(40),branch:'PUBLIC',parents:[]} ]));
  mkdirSync(join(base,'evidence'),{recursive:true});
  const discoveryFile=join(base,'evidence/discovery-source-identities.json');writeFileSync(discoveryFile,JSON.stringify(discovery));
  const publicPins={entries:structuredClone(retainedPins),currentEntries:[]};
  for(const pin of Object.values(publicPins.entries))pin.recordSha256=sha256('PUBLIC FIXTURE\n');
  const pinFile=join(repo,'scripts/unified-release/retained-evidence-pins.json');writeFileSync(pinFile,JSON.stringify(publicPins));
  let n=0;
  const regenerate=()=>{const outputDirectory=join(dir,'output-'+n++);const config=join(dir,'config.json');writeFileSync(config,JSON.stringify({base,roots,outputDirectory}));execFileSync(process.execPath,['--input-type=module','-e',`import {readFileSync} from 'node:fs';import {generateReleaseRecord} from ${JSON.stringify(join(repo,'scripts/unified-release/generate.mjs'))};generateReleaseRecord(JSON.parse(readFileSync(process.argv[1])));`,config],{stdio:['ignore','pipe','pipe']});return JSON.parse(readFileSync(join(outputDirectory,'release/release-manifest.json')));};
  const initial=regenerate();
  // Bind synthetic fixture expectations once, before the adversarial advance.
  for(const pin of Object.values(publicPins.entries))for(const key of Object.keys(pin.dependencies))pin.dependencies[key]=initial.inputs.find(input=>input.id===key).value;
  writeFileSync(pinFile,JSON.stringify(publicPins));
  const before=regenerate(),ids=Object.keys(publicPins.entries);
  const options={verifyFiles:false,now:Date.now()+1000};
  const first=assessRelease(before,options);for(const id of ids)assert(first.preservedEvidence.includes(id),id);
  for(const entry of Object.values(discovery))entry.sha='b'.repeat(40);writeFileSync(discoveryFile,JSON.stringify(discovery));
  put('myeve','apps/eve/migrations/0001_public.sql','-- changed public fixture; never executed\n');put('myfactory','apps/cloud-control/migrations/0001_public.sql','-- changed public fixture; never executed\n');
  const after=regenerate(),report=assessRelease(after,options);
  for(const id of ids){assert(report.staleEvidence.some(row=>row.id===id),id);assert(!report.preservedEvidence.includes(id),id);assert.deepEqual(evidence(after,id).dependencies,evidence(before,id).dependencies);}
  const mutant=structuredClone(after);for(const row of mutant.evidence.filter(row=>ids.includes(row.id)))for(const key of Object.keys(row.dependencies))row.dependencies[key]=mutant.inputs.find(input=>input.id===key).value;
  const defective=assessRelease(mutant,options);for(const id of ids)assert(defective.preservedEvidence.includes(id),id);
  assert.equal(report.ready,false);assert.equal(report.deploymentAuthorized,false);
  put('legacy-coordination',paths['legacy-coordination'][0],'CORRUPTED PUBLIC FIXTURE\n');
  assert.throws(regenerate,/RETAINED_EVIDENCE_PROVENANCE_UNQUALIFIED:myeve-hosted/);
  assert(!existsSync(join(dir,'output-'+(n-1),'release/release-manifest.json')));
});

test('explicit evidence selection cannot supply status, dependencies or protected gates',()=>{
 validateEvidenceSelection({'myeve-hosted':{root:'public',path:'receipt.json'}});
 for(const selection of [null,[],{'protected-custody':{root:'public',path:'receipt.json'}},{'factory-review':{root:'public',path:'receipt.json'}},{'myeve-hosted':{root:'public',path:'receipt.json',status:'PASS'}},{'myeve-hosted':{root:'public',path:'../receipt.json'}}])assert.throws(()=>validateEvidenceSelection(selection),/EVIDENCE_SELECTION_INVALID/);
});

test('explicit current receipts preserve their recorded sources, bounded checks and actual reviewer',()=>{
 const current=JSON.parse(readFileSync(new URL('./retained-evidence-pins.json',import.meta.url))).currentEntries;
 assert.equal(current.length,8);
 for(const pin of current){const bound=retainedEvidenceBinding(pin.id,{sha256:pin.recordSha256});assert.deepEqual(bound.dependencies,pin.dependencies);assert.deepEqual(bound.checks,pin.checks);assert.equal(bound.reviewer,pin.reviewer??null);assert(Object.isFrozen(bound.checks));assert.throws(()=>retainedEvidenceBinding(pin.id,{sha256:'0'.repeat(64)}),/PROVENANCE_UNQUALIFIED/);}
 const relay=current.find(pin=>pin.id==='relay-review');assert.equal(retainedEvidenceBinding(relay.id,{sha256:relay.recordSha256}).reviewer,'Codex:independent-existing-capability-workstream');
 const hosted=current.find(pin=>pin.id==='relay-hosted');assert(!Object.hasOwn(hosted.dependencies,'myeve.source'));assert(hosted.checks.some(check=>check.includes('frozen-myeve14f-and-consumer80')));
});
