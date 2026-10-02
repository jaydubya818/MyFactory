import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assertStagingEnvironment, databaseConfig, stagingProjectId } from '../src/config.mjs';
assertStagingEnvironment(process.env);
const client = new pg.Client(databaseConfig(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL));
try {
  await client.connect();
  if (!client.connection.stream.encrypted || !client.connection.stream.authorized) throw new Error('VERIFIED_TLS_REQUIRED');
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(81427601)');
  // Refuse adopting an existing non-Factory database, even under a staging project.
  const { rows } = await client.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE'");
  if (rows.some(row => row.table_schema !== 'factory')) throw new Error('DATABASE_NOT_DEDICATED');
  await client.query(await readFile(new URL('../migrations/001-staging-boundary.sql', import.meta.url), 'utf8'));
  await client.query(`CREATE TABLE IF NOT EXISTS factory.schema_migrations (version text PRIMARY KEY, sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const version of ['001-staging-boundary','002-canonical-execution-ledger','003-queue-delivery-checks']) {
    const sql = await readFile(new URL(`../migrations/${version}.sql`, import.meta.url), 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    const prior = (await client.query('SELECT sha256 FROM factory.schema_migrations WHERE version=$1',[version])).rows[0];
    if (prior && prior.sha256 !== sha256) throw Error('MIGRATION_CHECKSUM_MISMATCH');
    if (!prior) {
      await client.query(sql);
      await client.query('INSERT INTO factory.schema_migrations(version,sha256) VALUES ($1,$2)',[version,sha256]);
    }
  }
  const marker = (await client.query('SELECT * FROM factory.environment WHERE singleton')).rows[0];
  if (marker.project_id !== stagingProjectId || marker.environment !== 'staging') throw new Error('DATABASE_BOUNDARY_MISMATCH');
  await client.query('COMMIT');
  console.log(JSON.stringify({ migration: '003-queue-delivery-checks', result: 'PASS', certificateVerified: true, ownerDataCopied: false }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ migration: '003-queue-delivery-checks', result: 'FAIL', code: error.code ?? 'MIGRATION_FAILED' }));
  process.exitCode = 1;
} finally { await client.end(); }
