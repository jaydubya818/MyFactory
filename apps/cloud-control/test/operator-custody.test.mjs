import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Regress the actual unsafe entry points, including a syntactically valid request.
// No provider credentials, real infrastructure, or model calls are used here.
for (const script of ['hosted-infrastructure-probe.mjs', 'hosted-queue-check.mjs']) {
 test(`${script} refuses before provider execution`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-custody-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const invoked = join(dir, 'provider-invoked');
  for (const command of ['vercel', 'npx', 'curl']) {
   writeFileSync(join(dir, command), '#!/bin/sh\n: > "$PROVIDER_INVOKED"\nexit 99\n', { mode: 0o700 });
  }
  const deployment = 'https://myfactory-cloud-staging-fixture-jaydubya818.vercel.app';
  const args = script.includes('queue') ? ['submit', deployment] : [deployment];
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, '../scripts', script), ...args], {
   cwd: dir, encoding: 'utf8', timeout: 5000,
   env: { PATH: dir, PROVIDER_INVOKED: invoked, FACTORY_INFRASTRUCTURE_TOKEN: 'synthetic-test-only' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FACTORY_BYPASS_LOCAL_CUSTODY_FORBIDDEN/);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(invoked), false);
 });
}
