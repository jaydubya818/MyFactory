import { INSTALLATION_FIELDS } from './installation-evidence.mjs';
// Deliberately small JSON Schema vocabulary. Both the checked-in schema and the
// runtime validator come from these definitions, so the two cannot drift.
const string = { type: 'string', minLength: 1 };
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const array = (items) => ({ type: 'array', items });
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const choice = (...values) => ({ type: 'string', enum: values });
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{40}$' };
const map = (values) => ({ type: 'object', additionalProperties: values });
export const reference = object({ root: string, path: string, sha256: digest });
const status = choice('PASS', 'FAIL', 'NOT_RUN', 'NOT_QUALIFIED');

export const manifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Unified beta release coordination record; never execution authority',
  ...object({
    schemaVersion: { const: 2 },
    releaseId: string,
    recordedAt: string,
    authority: { const: 'COORDINATION_ONLY' },
    canonicalAuthorizationPackage: reference,
    components: array(object({
      id: string, repository: string, branch: string, sourceSha: sha,
      parentShas: array(sha), sourceLineage: string, currentPr: nullable(string),
      sourceRoot: string, adoption: choice('CANDIDATE', 'REHEARSAL', 'ACCEPTED'),
      runtimeIdentity: nullable(string), contractVersion: string,
      factoryVersion: nullable(string), pricingId: nullable(string), pricingExpiresAt: nullable(string),
      migrations: array(object({ id: string, file: reference, requires: array(string) })),
      dependencies: array(string), hostedEvidence: array(string), independentReview: array(string),
      evidence: array(string), deploymentEligibility: { const: 'HELD' }, activationEligibility: { const: 'HELD' },
      blockers: array(string),
    })),
    inputs: array(object({
      id: string, kind: choice('SOURCE', 'FILES', 'VALUE'), value: nullable(string),
      root: nullable(string), files: array(reference), canonicalRecord: nullable(reference), pointer: nullable(string),
    })),
    requirements: array(object({ consumer: string, input: string, expected: nullable(string), reason: string })),
    evidence: array(object({
      id: string, status, scope: choice('UNIT', 'POSTGRES', 'COMPOSED', 'BROWSER', 'FRESH_CLONE', 'HOSTED', 'REVIEW', 'INSTALLED', 'LIVE', 'CUSTODY', 'CONTROLS'),
      record: nullable(reference), dependencies: map(nullable(string)), required: { type: 'boolean' },
      suiteIdentity: string, environmentIdentity: string, reviewer: nullable(string), implementationOwner: nullable(string),
      expiresAt: nullable(string), checks: array(object({ id: string, status })),
      blockedBy: array(string), action: string,
    })),
    ownership: array(object({
      taskId: string, project: string, objective: string, implementationOwner: string,
      verificationOwner: nullable(string), repositories: array(string), branch: string,
      state: choice('ACTIVE', 'HELD', 'COMPLETE'), dependencies: array(string),
      requiredQualification: array(string), releaseImpact: string, approvalRequirements: array(string),
      claims: array(object({ kind: choice('BRANCH', 'CONTRACT', 'FACTORY_VERSION', 'PRICING', 'MIGRATION'), key: string, value: string })),
    })),
    installations: array(object({
      slot: choice('PLATFORM_OWNER', 'TESTER_1', 'TESTER_2'), canonicalRecord: nullable(reference),
      canonicalPointers: nullable(object(Object.fromEntries(INSTALLATION_FIELDS.map(field => [field,string])))),
      identity: nullable(string), ownerBinding: nullable(string), clerkApplication: nullable(string),
      missionControlWorkspace: nullable(string), myappsRegistry: nullable(string), relayConfiguration: nullable(string),
      capabilityPolicy: nullable(string), factoryVersion: nullable(string), qualificationEvidence: array(string),
    })),
    goldenJourney: object({
      status, evidence: nullable(string), stages: array(string), negativeCases: array(string),
    }),
    authorization: object({
      record: reference,
      development: array(string), qualification: array(string), production: array(string),
      holds: array(string), custodyOwner: string,
      custodyRetryAuthorized: { const: false }, productionAuthorized: { const: false },
      pricingRenewal: object({ record: reference, expiresAt: string, owner: string, procedure: array(string) }),
    }),
  }),
};

/** Validate only the finite vocabulary used above; not a general schema engine. */
export function shapeErrors(value, schema = manifestSchema, path = '$') {
  if (schema.anyOf) return schema.anyOf.some((s) => shapeErrors(value, s, path).length === 0) ? [] : [`${path}: invalid type`];
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return [`${path}: must equal ${JSON.stringify(schema.const)}`];
  if (schema.enum && !schema.enum.includes(value)) return [`${path}: invalid enum`];
  if (!schema.type) return [];
  const type = schema.type;
  if (type === 'null') return value === null ? [] : [`${path}: expected null`];
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    return value.flatMap((item, i) => shapeErrors(item, schema.items, `${path}[${i}]`));
  }
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected object`];
    const errors = (schema.required ?? []).filter((key) => !Object.hasOwn(value, key)).map((key) => `${path}.${key}: missing`);
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key] ?? schema.additionalProperties;
      if (!child) errors.push(`${path}.${key}: unexpected property`);
      else errors.push(...shapeErrors(item, child, `${path}.${key}`));
    }
    return errors;
  }
  if (type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum ? [] : [`${path}: expected nonnegative safe integer`];
  if (typeof value !== type) return [`${path}: expected ${type}`];
  if (type === 'string' && ((schema.minLength && value.trim().length < schema.minLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) return [`${path}: invalid string`];
  return [];
}
