import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorized, readiness, handleReadiness } from '../src/readiness.mjs';
import { assertStagingEnvironment, databaseConfig, stagingProjectId } from '../src/config.mjs';
const secret = 'qualification-only-token-with-sufficient-length';
const env = { VERCEL_PROJECT_ID: stagingProjectId, VERCEL_ENV: 'preview', FACTORY_QUALIFICATION_TOKEN: secret };
const request = token => new Request('https://factory.invalid/api/readiness', { headers: token ? { authorization: `Bearer ${token}` } : {} });
test('rejects absent, short and incorrect operator tokens', () => {
  assert.equal(authorized(request(), secret), false);
  assert.equal(authorized(request('wrong'), secret), false);
  assert.equal(authorized(request('short'), 'short'), false);
  assert.equal(authorized(request(secret), secret), true);
});
test('no dependency access before authentication', async () => {
  let calls = 0;
  const r = await handleReadiness(request(), env, { database: () => calls++ });
  assert.equal(r.status, 401); assert.equal(calls, 0);
});
test('denies production and another project even with valid token', async () => {
  for (const overrides of [{ VERCEL_ENV: 'production' }, { VERCEL_PROJECT_ID: 'sofie-project' }]) {
    const r = await handleReadiness(request(secret), { ...env, ...overrides }, {});
    assert.equal(r.status, 503); assert.equal((await r.json()).error, 'STAGING_BOUNDARY_MISMATCH');
  }
  assert.doesNotThrow(() => assertStagingEnvironment(env));
});
test('healthy infrastructure cannot enable cloud Work admission', async () => {
  const ok = async () => {};
  const r = await handleReadiness(request(secret), env, { database: ok, artifacts: ok, provider: ok });
  assert.equal(r.status, 503);
  const body = await r.json(); assert.equal(body.ready, false); assert.equal(body.admission, 'DISABLED');
  assert.deepEqual(Object.values(body.dependencies), ['AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
});
test('independent dependency failures are retained without raw credential errors', async () => {
  const fail = () => { throw new Error('postgres://secret:password@private/database'); };
  const result = await readiness({ database: fail, artifacts: async () => {}, provider: fail });
  assert.deepEqual(result.dependencies, { database: 'UNAVAILABLE', artifacts: 'AVAILABLE', provider: 'UNAVAILABLE' });
  assert.equal(JSON.stringify(result).includes('password'), false);
});
test('requires authenticated database URL and verified TLS regardless of URL flags', () => {
  assert.throws(() => databaseConfig('postgres://host/db'));
  const config = databaseConfig('postgres://factory:secret@host/db?sslmode=disable&uselibpqcompat=true');
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
  assert.equal(config.max, 2);
  assert.equal(config.connectionTimeoutMillis, 15000);
  assert.equal(config.statement_timeout, 5000);
});
