import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { shapeErrors } from './schema.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
import { INSTALLATION_FIELDS, INSTALLATION_SLOTS, GOLDEN_STAGES, NEGATIVE_CASES, JOURNEY_IDENTITIES, pointerValue, resolveInstallation, verifyInstallationQualification, verifyGoldenReceipt, verifyGoldenCohort } from './installation-evidence.mjs';
export { GOLDEN_STAGES, NEGATIVE_CASES, JOURNEY_IDENTITIES, verifyGoldenReceipt };
export const COORDINATION_FILES = ['generate.mjs','retained-evidence.mjs','retained-evidence-pins.json','schema.mjs','validate.mjs','installation-evidence.mjs','risk-tier.mjs','export.mjs','validate.test.mjs','evidence.test.mjs','fixtures/release-manifest.json'].map(name=>'scripts/unified-release/'+name).concat(['docs/releases/unified-beta/release-manifest.schema.json','.github/workflows/unified-release-coordination.yml']);
const REQUIRED_COMPONENTS = ['myeve', 'myfactory', 'missioncontrol', 'myapps', 'relay', 'capability-control'];
const HOLDS = ['MERGE', 'DEPLOY', 'REAL_MIGRATION', 'PAID_EXECUTION', 'CREDENTIAL_CHANGE', 'TESTER_ACTIVATION', 'PUBLISH', 'CUSTODY_RETRY'];
const RELEASE_GATES = ['protected-custody', 'installed-owner-binding', 'installed-factory-admission', 'installed-golden', 'bounded-live', 'deployment-controls', 'historical-runtime'];
const isoTime = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const unique = (items) => [...new Set(items)];

// Read only. Roots are operator-supplied. Reject traversal and symlinks rather
// than following evidence references into a credential directory. No commands
// or URLs in a manifest are executed. This is not a hostile-host attestation.
export function readReference(ref, roots) {
  if (!ref || !Object.hasOwn(roots, ref.root)) throw Error('ROOT_UNAVAILABLE');
  if (isAbsolute(ref.path) || ref.path.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) throw Error('REFERENCE_PATH_DENIED');
  const root = realpathSync(roots[ref.root]);
  const path = resolve(root, ref.path);
  if (relative(root, path).startsWith('..' + sep) || !relative(root, path)) throw Error('REFERENCE_PATH_DENIED');
  let walk = root;
  for (const part of ref.path.split('/')) {
    walk = resolve(walk, part);
    if (lstatSync(walk).isSymbolicLink()) throw Error('REFERENCE_SYMLINK');
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw Error('REFERENCE_SIZE_OR_TYPE');
  const bytes = readFileSync(path);
  if (sha256(bytes) !== ref.sha256) throw Error('EVIDENCE_CHECKSUM_CHANGED');
  return bytes;
}

export function filesDigest(files) {
  return sha256(JSON.stringify(files.map(({ root, path, sha256: digest }) => [root, path, digest]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))));
}

export function assessRelease(manifest, { roots = {}, now = Date.now(), verifyFiles = true } = {}) {
  const errors = shapeErrors(manifest).map((message) => ({ code: 'SCHEMA', subject: '$', message }));
  const blockers = [], stale = new Map(), warnings = [];
  const add = (list, code, subject, message) => list.push({ code, subject, message });
  const block = (code, subject, message) => add(blockers, code, subject, message);
  const invalid = (code, subject, message) => add(errors, code, subject, message);
  if (errors.length) return { valid: false, ready: false, deploymentAuthorized: false, errors, blockers, staleEvidence: [], preservedEvidence: [], requalificationPlan: [], warnings };
  if (!verifyFiles) block('INTEGRITY_NOT_VERIFIED', 'assessment', 'Structural assessment alone cannot establish release readiness.');
  if (!Number.isFinite(now)) invalid('CLOCK_INVALID', 'clock', 'A finite current clock is required.');
  if (!isoTime(manifest.recordedAt) || Date.parse(manifest.recordedAt) > now) invalid('RECORD_TIME_INVALID', 'recordedAt', 'Record timestamp must be valid and not in the future.');
  const index = (items, key, name) => {
    const result = new Map();
    for (const item of items) {
      if (result.has(item[key])) invalid('DUPLICATE_ID', name, item[key]);
      result.set(item[key], item);
    }
    return result;
  };
  const components = index(manifest.components, 'id', 'components');
  const inputs = index(manifest.inputs, 'id', 'inputs');
  const evidence = index(manifest.evidence, 'id', 'evidence');
  const tasks = index(manifest.ownership, 'taskId', 'ownership');
  const slots = index(manifest.installations, 'slot', 'installations');
  for (const id of REQUIRED_COMPONENTS) if (!components.has(id)) invalid('COMPONENT_MISSING', id, 'All six platform records are required.');
  for (const id of RELEASE_GATES) if (!evidence.has(id) || evidence.get(id).required !== true) invalid('REQUIRED_RELEASE_GATE_MISSING', id, 'An outstanding release gate cannot be deleted or made optional.');
  for (const hold of HOLDS) if (!manifest.authorization.holds.includes(hold)) invalid('RELEASE_HOLD_REMOVED', hold, 'This coordination record cannot lift execution holds.');
  const verifyRef = (ref, subject) => {
    if (!ref) { block('EVIDENCE_MISSING', subject, 'Canonical evidence reference is missing.'); return false; }
    if (!verifyFiles) return true;
    try { readReference(ref, roots); return true; }
    catch (error) { block(error.message, subject, 'Canonical file is unavailable or does not match its recorded checksum.'); return false; }
  };
  verifyRef(manifest.canonicalAuthorizationPackage, 'canonicalAuthorizationPackage');
  verifyRef(manifest.authorization.record, 'authorization');
  const changed = new Set();
  for (const input of inputs.values()) {
    if (input.value === null) changed.add(input.id);
    if (input.kind === 'SOURCE') {
      if (!input.root || !/^[a-f0-9]{40}$/.test(input.value ?? '')) invalid('SOURCE_IDENTITY_MISSING', input.id, 'Exact source SHA and root required.');
      if (verifyFiles) {
        try {
          if (!Object.hasOwn(roots, input.root)) throw Error('SOURCE_ROOT_UNAVAILABLE');
          const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: roots[input.root], encoding: 'utf8', timeout: 10000 }).trim();
          const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: roots[input.root], encoding: 'utf8', timeout: 10000 }).trim();
          if (head !== input.value || dirty) { changed.add(input.id); block('SOURCE_CHANGED', input.id, 'HEAD or working source differs from the recorded exact source.'); }
        } catch { changed.add(input.id); block('SOURCE_UNVERIFIABLE', input.id, 'Source checkout could not be read.'); }
      }
    } else if (input.kind === 'FILES') {
      if (!input.files.length || filesDigest(input.files) !== input.value) invalid('CONTRACT_DIGEST_INVALID', input.id, 'Digest must bind the complete declared file set.');
      for (const ref of input.files) if (!verifyRef(ref, input.id)) changed.add(input.id);
    } else if (input.value !== null && (!input.canonicalRecord || !input.pointer)) invalid('CANONICAL_RECORD_REQUIRED', input.id, 'A non-null identity requires an owning JSON record and JSON pointer.');
    if (input.canonicalRecord && !verifyRef(input.canonicalRecord, input.id)) changed.add(input.id);
    else if (input.kind === 'VALUE' && input.value !== null && verifyFiles) {
      try {
        const current = pointerValue(JSON.parse(readReference(input.canonicalRecord, roots)), input.pointer);
        if (current !== input.value) throw Error('CANONICAL_VALUE_MISMATCH');
      } catch { changed.add(input.id); block('CANONICAL_VALUE_MISMATCH', input.id, 'Identity or deadline differs from its owning record.'); }
    }
  }
  const coordination = inputs.get('coordination.code');
  if (!coordination || coordination.kind !== 'FILES' || COORDINATION_FILES.some(path => !coordination.files.some(file => file.root === 'coordination-source' && file.path === path)))
    invalid('COORDINATION_INPUTS_INCOMPLETE','coordination.code','Qualification must bind every coordinator source, static fixture, schema and workflow file.');
  const custody = evidence.get('protected-custody'), factorySource = inputs.get('myfactory.source');
  if (!factorySource || factorySource.kind !== 'SOURCE' || !custody || !Object.hasOwn(custody.dependencies,'myfactory.source'))
    invalid('CUSTODY_SOURCE_NOT_BOUND','protected-custody','Protected custody must declare the selected Factory source dependency.');
  for (const requirement of manifest.requirements) {
    if (!components.has(requirement.consumer) || !inputs.has(requirement.input)) invalid('DEPENDENCY_MISSING', requirement.consumer, requirement.input);
    else if (requirement.expected === null || inputs.get(requirement.input).value !== requirement.expected || changed.has(requirement.input)) block('INCOMPATIBLE_DEPENDENCY', requirement.consumer, `${requirement.input}: ${requirement.reason}`);
  }
  const addStale = (id, reason) => stale.set(id, unique([...(stale.get(id) ?? []), reason]));
  for (const e of evidence.values()) {
    if (['coordination-unit','coordination-fresh-clone','coordination-hosted','coordination-review'].includes(e.id) && !Object.hasOwn(e.dependencies,'coordination.code')) invalid('COORDINATION_DEPENDENCY_MISSING',e.id,'Coordinator evidence must bind its complete qualification input digest.');
    if (!Object.keys(e.dependencies).length) invalid('EVIDENCE_DEPENDENCIES_MISSING', e.id, 'Evidence must bind the source or contract it actually verifies.');
    for (const [id, expected] of Object.entries(e.dependencies)) {
      if (!inputs.has(id)) invalid('EVIDENCE_INPUT_UNKNOWN', e.id, id);
      if (!inputs.has(id) || expected === null || inputs.get(id).value !== expected || changed.has(id)) addStale(e.id, id);
    }
    if (e.expiresAt !== null && (!isoTime(e.expiresAt) || Date.parse(e.expiresAt) <= now)) addStale(e.id, 'EXPIRED');
    if (e.status === 'PASS') {
      if (!verifyRef(e.record, e.id)) addStale(e.id, 'EVIDENCE_INTEGRITY');
      if (!e.checks.length || e.checks.some((check) => check.status !== 'PASS')) {
        block('REQUIRED_CHECK_NOT_PASS', e.id, 'PASS evidence cannot contain missing, skipped, failed, or NOT_RUN required checks.');
        addStale(e.id, 'REQUIRED_CHECK_NOT_PASS');
      }
      if (e.scope === 'REVIEW' && (!e.reviewer || !e.implementationOwner || e.reviewer === e.implementationOwner)) {
        block('INDEPENDENT_REVIEW_MISSING', e.id, 'Independent reviewer must differ from implementation owner.');
        addStale(e.id, 'INDEPENDENT_REVIEW_MISSING');
      }
    } else if (e.required) block('REQUIRED_EVIDENCE_NOT_PASS', e.id, e.status);
  }
  for (const c of components.values()) {
    if (inputs.get(`${c.id}.source`)?.value !== c.sourceSha) invalid('SOURCE_IDENTITY_MISMATCH', c.id, 'Component source must match its source dependency.');
    for (const id of c.dependencies) if (!components.has(id)) invalid('COMPONENT_DEPENDENCY_MISSING', c.id, id);
    for (const [kind, ids] of [['HOSTED', c.hostedEvidence], ['REVIEW', c.independentReview]]) {
      if (!ids.length) block(kind === 'HOSTED' ? 'HOSTED_CI_MISSING' : 'INDEPENDENT_REVIEW_MISSING', c.id, 'Required component evidence is absent.');
      for (const id of ids) if (!evidence.has(id) || evidence.get(id).scope !== kind || evidence.get(id).status !== 'PASS' || stale.has(id)) block('COMPONENT_EVIDENCE_INVALID', c.id, id);
      for (const id of ids) {
        const e = evidence.get(id);
        if (e && !Object.entries(e.dependencies).some(([key, value]) => inputs.get(key)?.kind === 'SOURCE' && inputs.get(key)?.root === c.sourceRoot && value === c.sourceSha)) block('COMPONENT_SOURCE_NOT_REVIEWED', c.id, `${id} does not bind this component source.`);
      }
    }
    for (const id of c.evidence) if (!evidence.has(id)) invalid('EVIDENCE_ID_UNKNOWN', c.id, id);
    if (!c.runtimeIdentity) block('RUNTIME_IDENTITY_MISSING', c.id, 'Installed runtime identity has not been qualified.');
    if (c.pricingId !== null && (!isoTime(c.pricingExpiresAt) || Date.parse(c.pricingExpiresAt) <= now)) block('PRICING_EXPIRED', c.id, 'Canonical pricing must be revalidated; expiration cannot be extended here.');
    if (c.pricingId !== null && (c.pricingId !== inputs.get('pricing.identity')?.value || c.pricingExpiresAt !== inputs.get('pricing.expiration')?.value)) invalid('PRICING_RECORD_MISMATCH', c.id, 'Pricing identity and expiration must reference the canonical input.');
    if (c.adoption !== 'ACCEPTED') block('SOURCE_ADOPTION_HELD', c.id, c.sourceLineage);
    const migrations = index(c.migrations, 'id', `${c.id}.migrations`);
    const numbers = new Set();
    const seen = new Set();
    for (const m of c.migrations) {
      const number = Number(m.id);
      if (!/^\d+$/.test(m.id) || numbers.has(number)) invalid('MIGRATION_NUMBER_COLLISION', c.id, m.id);
      numbers.add(number);
      for (const id of m.requires) if (!migrations.has(id) || !seen.has(id)) invalid('MIGRATION_DEPENDENCY_MISSING', c.id, `${m.id} requires earlier ${id}`);
      verifyRef(m.file, `${c.id}.migration.${m.id}`);
      seen.add(m.id);
    }
    for (const blocker of c.blockers) block('COMPONENT_BLOCKER', c.id, blocker);
  }
  const sourceShas = Object.fromEntries([...components.values()].map(c=>[c.id,c.sourceSha]));
  const resolvedInstallations = new Map(), installationEvidenceOwners = new Map();
  const installationBindings = { identity: new Map(), ownerBinding: new Map() };
  for (const slot of INSTALLATION_SLOTS) {
    const installation = slots.get(slot);
    if (!installation) { invalid('INSTALLATION_SLOT_MISSING', slot, 'Existing three-user cohort must be preserved.'); continue; }
    for (const [field, bindings] of Object.entries(installationBindings)) {
      const value = installation[field];
      if (!value) continue;
      if (bindings.has(value)) invalid('INSTALLATION_BINDING_REUSED', slot, `${field} is already assigned to ${bindings.get(value)}; owner and tester slots must stay separate.`);
      bindings.set(value, slot);
    }
    for (const field of INSTALLATION_FIELDS) if (!installation[field]) block('INSTALLATION_BINDING_MISSING', slot, field);
    if (!installation.canonicalPointers) block('INSTALLATION_POINTERS_MISSING',slot,'Explicit pointers into the original owning record are required.');
    const recordVerified = verifyRef(installation.canonicalRecord, slot);
    if (recordVerified && verifyFiles) {
      try { resolvedInstallations.set(slot,resolveInstallation(installation,JSON.parse(readReference(installation.canonicalRecord,roots)))); }
      catch(error) { block(error.message,slot,'Displayed installation fields must equal the original owning record.'); }
    }
    if (!installation.qualificationEvidence.length) block('INSTALLATION_QUALIFICATION_MISSING', slot, 'Each installation requires its own qualification.');
    for (const id of installation.qualificationEvidence) {
      const e=evidence.get(id), previous=installationEvidenceOwners.get(id);
      if (previous && previous!==slot) {block('INSTALLATION_EVIDENCE_REUSED',slot,`Qualification ${id} belongs to ${previous}.`);if (e) addStale(id,'INSTALLATION_EVIDENCE_REUSED');}
      installationEvidenceOwners.set(id,slot);
      if (!e || e.scope!=='INSTALLED' || e.status!=='PASS' || stale.has(id)) {block('INSTALLATION_EVIDENCE_INVALID',slot,id);continue;}
      if (Object.entries(sourceShas).some(([component,sha])=>e.dependencies[component+'.source']!==sha)) {block('INSTALLATION_SOURCE_NOT_BOUND',slot,id);addStale(id,'INSTALLATION_SOURCE_NOT_BOUND');}
      if (verifyFiles) {
        try {
          if (!resolvedInstallations.has(slot) || !verifyInstallationQualification(JSON.parse(readReference(e.record,roots)),{releaseId:manifest.releaseId,sourceShas,slot,bindings:resolvedInstallations.get(slot),canonicalRecord:installation.canonicalRecord})) throw Error('INSTALLATION_EVIDENCE_BINDING');
        } catch {addStale(id,'INSTALLATION_EVIDENCE_BINDING');block('INSTALLATION_EVIDENCE_BINDING',slot,'Qualification must bind the exact release, source tuple, cohort slot and original installation record.');}
      }
    }
  }
  for (const task of tasks.values()) {
    for (const id of task.dependencies) if (!tasks.has(id)) invalid('TASK_DEPENDENCY_UNKNOWN', task.taskId, id);
    for (const id of task.requiredQualification) if (!evidence.has(id)) invalid('TASK_QUALIFICATION_UNKNOWN', task.taskId, id);
    if (task.state === 'ACTIVE' && (!task.verificationOwner || task.verificationOwner === task.implementationOwner)) block('TASK_REVIEWER_UNASSIGNED', task.taskId, 'Independent verification owner must be assigned before completion.');
  }
  const claims = new Map();
  for (const task of tasks.values()) if (task.state === 'ACTIVE' || task.state === 'HELD') for (const claim of task.claims) {
    const key = `${claim.kind}:${claim.key}`, prior = claims.get(key);
    if (prior && prior.taskId !== task.taskId) block('OWNERSHIP_CONFLICT', task.taskId, `${key} is already claimed by ${prior.taskId}; a hold does not release ownership.`);
    claims.set(key, task);
  }
  const journey = manifest.goldenJourney;
  for (const stage of GOLDEN_STAGES) if (!journey.stages.includes(stage)) invalid('GOLDEN_STAGE_MISSING', 'goldenJourney', stage);
  for (const name of NEGATIVE_CASES) if (!journey.negativeCases.includes(name)) invalid('GOLDEN_NEGATIVE_MISSING', 'goldenJourney', name);
  const golden = evidence.get(journey.evidence);
  if (journey.status !== 'PASS' || !golden || golden.status !== 'PASS' || golden.scope !== 'INSTALLED' || stale.has(golden.id)) block('GOLDEN_JOURNEY_NOT_PASS', 'goldenJourney', 'Synthetic component fixtures do not qualify the installed same-Mission journey.');
  else if (verifyFiles) {
    try { for (const message of verifyGoldenCohort(JSON.parse(readReference(golden.record, roots)),{releaseId:manifest.releaseId,sourceShas,installations:resolvedInstallations})) {block('GOLDEN_IDENTITY_MISMATCH', golden.id, message);addStale(golden.id,'GOLDEN_IDENTITY_MISMATCH');} }
    catch { addStale(golden.id,'GOLDEN_RECEIPT_INVALID');block('GOLDEN_RECEIPT_INVALID', golden.id, 'Cannot verify installed journey receipt.'); }
  }
  const renewal = manifest.authorization.pricingRenewal;
  if (renewal.expiresAt !== inputs.get('pricing.expiration')?.value) invalid('PRICING_RENEWAL_MISMATCH', 'pricingRenewal', 'Renewal cannot silently extend the canonical deadline.');
  verifyRef(renewal.record, 'pricingRenewal');
  if (!isoTime(renewal.expiresAt) || Date.parse(renewal.expiresAt) <= now) block('PRICING_RENEWAL_REQUIRED', 'pricingRenewal', 'Obtain a new canonical pricing record and requalify affected execution contracts.');
  else if (Date.parse(renewal.expiresAt) - now < 7 * 86400000) warnings.push({ code: 'PRICING_REVIEW_DUE', deadline: renewal.expiresAt });
  for (const [id, reasons] of stale) if (evidence.get(id).required) block('QUALIFICATION_STALE', id, reasons.join(', '));
  const plan = [...evidence.values()].filter((e) => e.required && (e.status !== 'PASS' || stale.has(e.id))).map((e) => ({ evidence: e.id, action: e.action, changedInputs: stale.get(e.id) ?? [], blockedBy: e.blockedBy, automatic: false }));
  return { valid: errors.length === 0, ready: errors.length === 0 && blockers.length === 0, deploymentAuthorized: false,
    errors, blockers, warnings, staleEvidence: [...stale].map(([id, reasons]) => ({ id, reasons })),
    preservedEvidence: [...evidence.values()].filter((e) => e.status === 'PASS' && !stale.has(e.id)).map((e) => e.id), requalificationPlan: plan };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [manifestPath, rootsPath, ...flags] = process.argv.slice(2);
    if (!manifestPath || !rootsPath || flags.some((f) => f !== '--check-record')) throw Error('Usage: node scripts/unified-release/validate.mjs MANIFEST ROOTS [--check-record]');
    const report = assessRelease(JSON.parse(readFileSync(manifestPath, 'utf8')), { roots: JSON.parse(readFileSync(rootsPath, 'utf8')) });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    // Record validity and release readiness are intentionally different gates.
    process.exitCode = report.valid && (flags.includes('--check-record') || report.ready) ? 0 : 1;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
