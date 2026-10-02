import pg from 'pg';
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
  const marker = (await client.query('SELECT * FROM factory.environment WHERE singleton')).rows[0];
  if (marker.project_id !== stagingProjectId || marker.environment !== 'staging') throw new Error('DATABASE_BOUNDARY_MISMATCH');
  await client.query('COMMIT');
  console.log(JSON.stringify({ migration: '001-staging-boundary', result: 'PASS', certificateVerified: true, ownerDataCopied: false }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ migration: '001-staging-boundary', result: 'FAIL', code: error.code ?? 'MIGRATION_FAILED' }));
  process.exitCode = 1;
} finally { await client.end(); }
