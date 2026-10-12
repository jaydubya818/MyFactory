import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assessRelease, sha256 } from './validate.mjs';

const [manifestPath, rootsPath] = process.argv.slice(2);
if (!manifestPath || !rootsPath) throw Error('Usage: node scripts/unified-release/export.mjs MANIFEST ROOTS');
const bytes = readFileSync(manifestPath);
const manifest = JSON.parse(bytes);
const report = assessRelease(manifest, { roots: JSON.parse(readFileSync(rootsPath)) });
if (!report.valid) throw Error('Manifest is invalid; no views were written.');
const directory = dirname(manifestPath);
const provenance = { generatedFrom: 'release-manifest.json', manifestSha256: sha256(bytes), authority: 'DERIVED_VIEW_ONLY' };
const write = (name, data) => writeFileSync(join(directory, name), JSON.stringify({ ...provenance, ...data }, null, 2) + '\n');
write('dependency-graph.json', {
  componentEdges: manifest.components.flatMap((c) => c.dependencies.map((dependency) => ({ consumer: c.id, dependency }))),
  qualificationEdges: manifest.evidence.flatMap((e) => Object.keys(e.dependencies).map((dependency) => ({ evidence: e.id, dependency }))),
  compatibility: manifest.requirements,
});
write('qualification-evidence.json', { ...report, assessedAt: new Date().toISOString() });
write('authorization-boundaries.json', { ...manifest.authorization, canonicalPackage: manifest.canonicalAuthorizationPackage });
const lines = [
  '# Unified beta release readiness', '',
  `**${report.ready ? 'QUALIFICATION PREREQUISITES SATISFIED' : 'NOT READY'}. Deployment and activation remain held.**`, '',
  'This generated report is a coordination view. The existing consolidated authorization package remains the authority index. It does not adopt source, approve execution, issue capability grants, or change installation/accounting records.', '',
  `Manifest SHA-256: \`${provenance.manifestSha256}\`.`, '',
  '| Component | Source | Adoption |', '| --- | --- | --- |',
  ...manifest.components.map((c) => `| ${c.id} | \`${c.sourceSha}\` | ${c.adoption} |`), '',
  `${report.preservedEvidence.length} evidence records retain matching declared dependencies and checksums. ${report.requalificationPlan.length} required qualification items remain. Historical PASS records are reused, not rerun.`, '',
  '| Required evidence | Status | Next action |', '| --- | --- | --- |',
  ...report.requalificationPlan.map((item) => `| ${item.evidence} | ${manifest.evidence.find((e) => e.id === item.evidence).status} | ${item.action} Prerequisites: ${item.blockedBy.join('; ') || 'changed dependencies only'}. |`), '',
  'The owner installation and original two tester slots remain separate. Unavailable installation identity references and FactoryVersions are null. No replacement registry, ledger, custody package or authorization record is created.', '',
  `Pricing revalidation deadline is **${manifest.authorization.pricingRenewal.expiresAt}**. This is October 16 at 5:00 PM America/Los_Angeles. It is the existing October 17 UTC deadline, not a new expiration. Renewal requires a new owning pricing record and only the affected qualification.`, '',
  'See qualification-evidence.json for every blocker. Missing gates, NOT_RUN tests and structural validity are never represented as installed Golden Journey PASS.', '',
];
writeFileSync(join(directory, 'release-readiness.md'), lines.join('\n'));
console.log(JSON.stringify({ manifestSha256: provenance.manifestSha256, valid: report.valid, ready: report.ready, preservedEvidence: report.preservedEvidence.length, requalificationItems: report.requalificationPlan.length }));
