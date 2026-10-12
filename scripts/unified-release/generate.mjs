import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, isAbsolute, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { retainedEvidenceBinding, validateEvidenceSelection } from './retained-evidence.mjs';
import { sha256, filesDigest, GOLDEN_STAGES, NEGATIVE_CASES, COORDINATION_FILES } from './validate.mjs';
import { manifestSchema } from './schema.mjs';
export function generateReleaseRecord({base,roots,outputDirectory,evidenceSelection={}}) {
  if(typeof base!=='string'||!isAbsolute(base)||!roots||typeof roots!=='object'||typeof outputDirectory!=='string'||!isAbsolute(outputDirectory)||outputDirectory.split(/[\\/]/).includes('..'))throw Error('GENERATOR_INPUT_BOUNDARY');
  const parent=realpathSync(dirname(outputDirectory));
  const temporaryRoots=[tmpdir(),'/tmp'].filter(existsSync).map(path=>realpathSync(path));
  if(!temporaryRoots.some(root=>{const tail=relative(root,parent);return tail===''||(!tail.startsWith('..'+sep)&&tail!=='..'&&!isAbsolute(tail));}))throw Error('GENERATOR_OUTPUT_NOT_TEMPORARY');
  validateEvidenceSelection(evidenceSelection);
  // Fresh review output only. Historical releases and private roots are never overwritten.
  mkdirSync(outputDirectory,{mode:0o700});
  const docs=join(outputDirectory,'release');mkdirSync(docs,{mode:0o700});
const ref = (root, path) => ({ root, path, sha256: sha256(readFileSync(join(roots[root], path))) });
const discovery = JSON.parse(readFileSync(join(base, 'evidence/discovery-source-identities.json')));
const previous = JSON.parse(readFileSync(join(roots['legacy-coordination'], 'successor-status.json')));
const inputs = [];
const fileInput = (id, root, paths) => {
  const files = paths.map((path) => ref(root, path));
  inputs.push({ id, kind: 'FILES', value: filesDigest(files), root: null, files, canonicalRecord: null, pointer: null });
};
const valueInput = (id, value, canonicalRecord = null, pointer = null) => inputs.push({ id, kind: 'VALUE', value, root: null, files: [], canonicalRecord, pointer });
for (const [id, root] of Object.entries({ myeve: 'myeve', myfactory: 'myfactory', missioncontrol: 'missioncontrol', myapps: 'myeve', relay: 'relay', 'capability-control': 'missioncontrol', 'relay-consumer': 'relay-consumer' })) {
  inputs.push({ id: `${id}.source`, kind: 'SOURCE', value: discovery[root].sha, root, files: [], canonicalRecord: null, pointer: null });
}
fileInput('myeve.contract', 'myeve', ['apps/eve/lib/missioncontrol/contracts.ts', 'apps/eve/lib/missioncontrol/consumer.ts']);
fileInput('factory.execution', 'myfactory', ['apps/cloud-control/src/production-execution-plan.mjs', 'apps/cloud-control/src/cloud-harness-plan.mjs']);
fileInput('missioncontrol.contract', 'missioncontrol', ['convex/sofieEnterprise.ts']);
fileInput('capability.contract', 'missioncontrol', ['packages/capability-control/src/types.ts', 'packages/capability-control/src/resolver.ts', 'packages/capability-control/src/registry.ts']);
fileInput('relay.contract', 'relay-consumer', ['docs/integrations-native-receiving.md']);
for (const [id, root, path] of [['myeve.migrations','myeve','apps/eve/migrations'],['factory.migrations','myfactory','apps/cloud-control/migrations']]) {
  fileInput(id, root, readdirSync(join(roots[root], path)).filter((f) => f.endsWith('.sql')).sort().map((f) => path + '/' + f));
}
const pricingRef = ref('myfactory', 'docs/capability-control/pricing-20261010/20261010-v2.json');
const pricing = JSON.parse(readFileSync(join(roots.myfactory, pricingRef.path)));
valueInput('pricing.identity', pricing.version, pricingRef, '/version');
valueInput('pricing.expiration', pricing.reviewBy, pricingRef, '/reviewBy');
valueInput('factory.runtime-source', previous.factorySourceDigest, ref('myfactory', 'apps/cloud-control/src/source-identity.json'), '/sourceDigest');
for (const id of ['installation.platform-owner', 'installation.tester-1', 'installation.tester-2', 'clerk.binding', 'policy.installed', 'factory.version', 'recovery.witness']) valueInput(id, null);
const dep = (...ids) => Object.fromEntries(ids.map((id) => [id, inputs.find((input) => input.id === id).value]));
const evidence = [];
const add = (id, scope, status, record, dependencies, checks, blockedBy = [], action = `Requalify ${id} only when its dependencies change.`) => {
  // Retained PASS is bound to original record bytes and inputs, never current discovery.
  let reviewer=scope==='REVIEW'?'Independent:attributed-in-immutable-record':null;
  if(status==='PASS'){
    if(Object.hasOwn(evidenceSelection,id)){const selected=evidenceSelection[id];record=ref(selected.root,selected.path);}
    const binding=retainedEvidenceBinding(id,record);
    dependencies=binding.dependencies;
    if(binding.checks)checks=binding.checks;
    if(scope==='REVIEW'&&binding.reviewer)reviewer=binding.reviewer;
  }
  evidence.push({ id, scope, status, record, dependencies, required: true, suiteIdentity: id + '/v1',
    environmentIdentity: scope === 'HOSTED' ? 'github-actions-exact-source-recorded-run' : scope === 'INSTALLED' ? 'APPROVED_NONPRODUCTION_REQUIRED' : 'retained-component-qualification',
    reviewer,
    implementationOwner: scope === 'REVIEW' ? 'Codex:retained-implementation-workstream' : null,
    expiresAt: null, checks: checks.map((name) => ({ id: name, status })), blockedBy, action });
};
add('myeve-hosted', 'HOSTED', 'PASS', ref('legacy-coordination','claude-corrective-qualification/hosted-14f07/receipt.json'), dep('myeve.source','missioncontrol.source','myeve.contract'), ['six-unified-jobs']);
add('myeve-owner-hosted', 'HOSTED', 'PASS', ref('legacy-coordination','claude-corrective-qualification/owner-hosted-14f07/receipt.json'), dep('myeve.source'), ['four-owner-and-deterministic-work-jobs']);
add('missioncontrol-hosted', 'HOSTED', 'PASS', ref('legacy-coordination','claude-corrective-qualification/hosted-af521/receipt.json'), dep('missioncontrol.source'), ['ten-hosted-jobs']);
add('factory-hosted', 'HOSTED', 'PASS', ref('legacy-coordination','hosted-factory-e36.json'), dep('myfactory.source','factory.runtime-source','pricing.identity'), ['environment-fabric-run-38170107654']);
add('relay-hosted', 'HOSTED', 'PASS', ref('relay-evidence','qualification.json'), dep('relay.source','relay-consumer.source','myeve.source'), ['capability-composed-38176770698','quality-38176774228']);
add('myeve-mc-review', 'REVIEW', 'PASS', ref('legacy-coordination','claude-corrective-qualification/actual-claude-s1-s4-review/INDEPENDENT-S1-S4-RE-REVIEW.md'), dep('myeve.source','missioncontrol.source'), ['S1-S4-closure']);
add('factory-review', 'REVIEW', 'NOT_QUALIFIED', ref('legacy-coordination','claude-corrective-qualification/INDEPENDENT-RE-REVIEW.md'), dep('myfactory.source','factory.runtime-source'), ['exact-successor-independent-source-review'], ['Exact successor review receipt'], 'Locate the exact Factory successor source review; retained historical review confirms hosted CI but does not itself review this source.');
add('relay-review', 'REVIEW', 'PASS', ref('legacy-coordination','claude-corrective-qualification/actual-claude-hosted-relay-review/INDEPENDENT-HOSTED-14-AF521-AND-RELAY-1AEC-REVIEW.md'), dep('relay.source','relay-consumer.source'), ['RED2-GREEN43-composed1']);
add('myapps-migration', 'POSTGRES', 'PASS', ref('legacy-coordination','migration-recovery.json'), dep('myeve.migrations','factory.migrations'), ['twenty-disposable-migration-and-restore-checks']);
add('protected-custody', 'CUSTODY', 'NOT_RUN', ref('legacy-coordination','CUSTODY-EXECUTION-DECISION-V3-5.md'), dep('myfactory.source','factory.runtime-source','installation.tester-1','installation.tester-2'), ['original-protected-case-1','original-protected-case-2','original-protected-case-3'], ['V3.5 cloud authorization','Existing External Alpha operator'], 'Consume the existing custody workstream result. Do not rerun or replace its records.');
add('installed-owner-binding', 'INSTALLED', 'NOT_RUN', null, dep('clerk.binding','installation.platform-owner'), ['issuer-subject-owner-workspace','cross-owner','revocation','restart'], ['Approved nonproduction identity records'], 'Qualify authoritative Clerk subject and durable owner/workspace binding.');
add('installed-factory-admission', 'INSTALLED', 'NOT_RUN', null, dep('factory.version','policy.installed','factory.execution','missioncontrol.contract'), ['workorder-admission','budget','lease','UNKNOWN','cancel','cleanup'], ['Approved nonproduction endpoints','Qualified installation FactoryVersion'], 'Qualify actual delegated admission against canonical accounting.');
add('installed-golden', 'INSTALLED', 'NOT_RUN', null, dep(...inputs.map((input) => input.id)), [...GOLDEN_STAGES,...NEGATIVE_CASES], ['Installed identities','Custody disposition','Real admission','Independent review','Installation authorization'], 'Run one authenticated installed same-Mission journey and retain stage identity receipts.');
add('bounded-live', 'LIVE', 'NOT_RUN', null, dep('factory.version','pricing.identity','pricing.expiration','policy.installed'), ['authorized-bounded-execution'], ['Separate owner authorization','All prior qualification stages'], 'Run only the separately authorized bounded live envelope.');
add('deployment-controls', 'CONTROLS', 'NOT_QUALIFIED', ref('relay-evidence','deployment-readback-1aec.json'), dep('relay-consumer.source'), ['PR36-base-preview-prevention'], ['Reviewed target-branch deployment control'], 'Reconcile the existing PR36 base preview risk before merge approval.');
add('historical-runtime', 'COMPOSED', 'NOT_RUN', null, dep('missioncontrol.source'), ['ten-original-docker-cases','one-original-canary'], ['Original image identities','Approved isolated governed-context canary'], 'Reuse original runtime packages and execute only missing cases.');
add('factory-source-provenance-review', 'REVIEW', 'PASS', ref('factory-provenance-review', 'CLAUDE-INDEPENDENT-REVIEW-RECEIPT.md'), dep('myfactory.source', 'factory.runtime-source'), ['e36-runtime-identity-matches-60915', 'packaging-provenance-and-protected-source-pins']);
evidence.at(-1).required = false;
evidence.at(-1).action = 'Preserve the completed source identity and packaging review. It is not an installed or full-release approval.';
fileInput('coordination.code', 'coordination-source', COORDINATION_FILES);
// Generating a new input digest cannot rebind a historical TAP log to new code.
add('coordination-unit', 'UNIT', 'NOT_RUN', null, dep('coordination.code'), ['release-validator-behavior-and-negative-tests'], [], 'Run focused tests on this exact coordinator input digest and retain a new receipt.');
add('coordination-fresh-clone', 'FRESH_CLONE', 'NOT_RUN', null, dep('coordination.code'), ['exact-commit-fresh-clone'], [], 'Run the new coordination suite from an isolated clone of its committed source.');
if (existsSync(join(base, 'evidence/coordination-fresh-clone.json'))) {
  const receipt = JSON.parse(readFileSync(join(base, 'evidence/coordination-fresh-clone.json')));
  if (receipt.status === 'PASS' && receipt.cleanup === 'VERIFIED' && receipt.failed === 0 && receipt.skipped === 0 && receipt.coordinationCodeDigest === inputs.find((input) => input.id === 'coordination.code').value) {
    Object.assign(evidence.at(-1), { status: 'PASS', record: ref('coordination-evidence', 'coordination-fresh-clone.json'), checks: [{ id: 'exact-commit-fresh-clone', status: 'PASS' }], environmentIdentity: 'disposable-local-fresh-clone-no-dependencies', action: 'Preserve the exact-commit fresh-clone receipt while coordinator code bytes remain unchanged.' });
  }
}
add('coordination-hosted', 'HOSTED', 'NOT_RUN', null, dep('coordination.code'), ['exact-commit-tooling-ci'], ['Verified nondeploying publication path'], 'Run only the new coordination suite on the exact published candidate after confirming publication cannot deploy.');
add('coordination-review', 'REVIEW', 'NOT_RUN', null, dep('coordination.code'), ['independent-coordination-source-review'], ['Separate verifier'], 'Obtain independent review of the coordination delta; implementation self-review does not qualify.');
const componentSpecs = [
  ['myeve','myeve','jaydubya818/MyEveBot',null,'REHEARSAL',['missioncontrol','relay','myapps','capability-control'],['myeve-hosted','myeve-owner-hosted'],['myeve-mc-review'],'mc-service-command-v1'],
  ['myfactory','myfactory','jaydubya818/MyFactory','https://github.com/jaydubya818/MyFactory/pull/17','CANDIDATE',['capability-control'],['factory-hosted'],['factory-review'],'WORK_LEDGER_V2'],
  ['missioncontrol','missioncontrol','jaydubya818/MissionControl',null,'CANDIDATE',['myfactory','capability-control'],['missioncontrol-hosted'],['myeve-mc-review'],'mc-service-command-v1'],
  ['myapps','myeve','jaydubya818/MyEveBot',null,'REHEARSAL',['myfactory','capability-control'],['myeve-hosted'],['myeve-mc-review'],'myapps.production-authorization-draft.v1'],
  ['relay','relay','jaydubya818/relay','https://github.com/jaydubya818/relay/pull/35','CANDIDATE',['capability-control'],['relay-hosted'],['relay-review'],'relay.native-admission.v1'],
  ['capability-control','missioncontrol','jaydubya818/MissionControl',null,'CANDIDATE',['missioncontrol'],['missioncontrol-hosted'],['myeve-mc-review'],'qualified-capability-control'],
];
const components = componentSpecs.map(([id,root,repository,currentPr,adoption,dependencies,hostedEvidence,independentReview,contractVersion]) => {
  const migrationPath = id === 'myfactory' ? 'apps/cloud-control/migrations' : ['myeve','myapps'].includes(id) ? 'apps/eve/migrations' : null;
  const migrations = migrationPath ? readdirSync(join(roots[root],migrationPath)).filter((f) => f.endsWith('.sql')).sort().map((f,i,files) => ({id:f.split(/[_-]/)[0],file:ref(root,migrationPath+'/'+f),requires:i?[files[i-1].split(/[_-]/)[0]]:[]})) : [];
  return {id,repository,branch:discovery[root].branch,sourceSha:discovery[root].sha,parentShas:discovery[root].parents,sourceRoot:root,sourceLineage:'Selected immutable source '+discovery[root].sha+'; recorded parents '+discovery[root].parents.join(',')+'. Source selection does not authorize production adoption.',currentPr,adoption,runtimeIdentity:null,contractVersion,factoryVersion:null,pricingId:['myfactory','myeve','myapps'].includes(id)?pricing.version:null,pricingExpiresAt:['myfactory','myeve','myapps'].includes(id)?pricing.reviewBy:null,migrations,dependencies,hostedEvidence,independentReview,evidence:[...hostedEvidence,...independentReview],deploymentEligibility:'HELD',activationEligibility:'HELD',blockers:id==='myeve'?['Clerk integration and release ancestry not qualified']:id==='relay'?['Installed policy/recovery witnesses missing; remote Composio execution disabled']:['Installed integration not qualified']};
});
const currentThread='01a12e76-fab3-7ee2-aa22-284da9fd2268';
const task = (taskId,project,objective,implementationOwner,branch,state,claims,requiredQualification,approvalRequirements=[]) => ({ taskId,project,objective,implementationOwner,verificationOwner:null,repositories:[components.find((c)=>c.id===project)?.repository??'jaydubya818/MyFactory'],branch,state,dependencies:[],requiredQualification,releaseImpact:'Coordination or nonproduction engineering only. No release authority.',approvalRequirements,claims });
const ownership = [
  task('release-coordination','myfactory','Machine-readable release record, dependency freshness, ownership and risk tiers',currentThread,'codex/mission-control-release-coordination','ACTIVE',[{kind:'BRANCH',key:'jaydubya818/MyFactory:codex/mission-control-release-coordination',value:currentThread}],['coordination-unit','coordination-fresh-clone','coordination-hosted','coordination-review']),
  task('owner-browser-reporting','myeve','Correct an inaccurate claim that the existing MissionControl authorization UI is not implemented',currentThread,'codex/mission-control-owner-reporting','ACTIVE',[{kind:'BRANCH',key:'jaydubya818/MyEveBot:codex/mission-control-owner-reporting',value:currentThread}],[]),
  task('external-alpha-custody','myfactory','Complete existing V3.5 custody qualification only after separate authorization','01a11877-57bd-7a70-9240-e48ffc23f577','EXISTING_V3_5_SEALED_PACKAGE','HELD',[{kind:'FACTORY_VERSION',key:'external-alpha-installation-slots',value:'NOT_DERIVED'}],['protected-custody'],['Revised V3.5 cloud execution approval']),
  task('relay-receiving','relay','Preserve qualified receiver and consumer modules','01a123c4-c74f-7360-b0d8-2ced9401d077','codex/unified-beta-relay-receiving','COMPLETE',[],['relay-hosted','relay-review']),
  task('unified-installed-journey','myeve','Complete authenticated same-Mission integration',currentThread,'UNASSIGNED_PENDING_SOURCE_ADOPTION','HELD',[],['installed-owner-binding','installed-factory-admission','installed-golden'],['Approved identity and installation references','Installation qualification authorization']),
];
const authorizationRef=ref('legacy-coordination','AUTHORIZATION-PACKAGE.md');
const manifest={schemaVersion:2,releaseId:'unified-beta-20261011',recordedAt:new Date().toISOString(),authority:'COORDINATION_ONLY',canonicalAuthorizationPackage:authorizationRef,components,inputs,
  requirements:[{consumer:'myapps',input:'factory.runtime-source',expected:previous.factorySourceDigest,reason:'Canonical producer source identity must match verified application artifact admission.'},{consumer:'myeve',input:'missioncontrol.source',expected:discovery.missioncontrol.sha,reason:'Consumer qualification pins exact MissionControl source.'},{consumer:'relay',input:'relay-consumer.source',expected:discovery['relay-consumer'].sha,reason:'Only independently qualified consumer modules are paired with this receiver.'},{consumer:'myapps',input:'factory.version',expected:null,reason:'Installation-specific FactoryVersion has not been derived.'},{consumer:'capability-control',input:'policy.installed',expected:null,reason:'Owner preferences do not grant execution authority.'}],
  evidence,ownership,installations:['PLATFORM_OWNER','TESTER_1','TESTER_2'].map((slot)=>({slot,canonicalRecord:null,canonicalPointers:null,identity:null,ownerBinding:null,clerkApplication:null,missionControlWorkspace:null,myappsRegistry:null,relayConfiguration:null,capabilityPolicy:null,factoryVersion:null,qualificationEvidence:[]})),
  goldenJourney:{status:'NOT_RUN',evidence:'installed-golden',stages:GOLDEN_STAGES,negativeCases:NEGATIVE_CASES},
  authorization:{record:authorizationRef,development:['Source edits in isolated checkouts','Synthetic fixtures','Disposable local PostgreSQL','Local browser and static checks'],qualification:['Exact source and contract identity','Bounded resources','Independent verification','Evidence checksums','Cleanup and recovery','Separate protected-material authorization'],production:['Canonical owner authorization','Qualified runtime and installation','Current pricing and accounting admission','Independent release review','Explicit deployment and activation approval'],holds:['MERGE','DEPLOY','REAL_MIGRATION','PAID_EXECUTION','CREDENTIAL_CHANGE','TESTER_ACTIVATION','PUBLISH','CUSTODY_RETRY'],custodyOwner:'01a11877-57bd-7a70-9240-e48ffc23f577',custodyRetryAuthorized:false,productionAuthorized:false,pricingRenewal:{record:pricingRef,expiresAt:pricing.reviewBy,owner:'Canonical MyFactory pricing workstream',procedure:['Revalidate canonical provider and gateway pricing by the existing UTC deadline.','Create a new versioned pricing record with source evidence; never edit historical expiration.','Use dependency analysis to identify affected execution contracts and installation FactoryVersions.','Run the canonical pricing and compatibility checks and obtain independent review.','Preserve prior budgets, grants and UNKNOWN exposure; request separate activation approval.']}}};
writeFileSync(join(docs,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(docs,'release-manifest.schema.json'),JSON.stringify(manifestSchema,null,2)+'\n');
// Deliberately never emit the private absolute root map.
return {manifest,summary:{components:components.length,inputs:inputs.length,evidence:evidence.length,migrations:components.reduce((sum,c)=>sum+c.migrations.length,0)}};
}
