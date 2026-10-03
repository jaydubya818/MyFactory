import pg from 'pg';
import { list } from '@vercel/blob';
import { Sandbox } from '@vercel/sandbox';
import { assertStagingEnvironment, databaseConfig, stagingProjectId } from './config.mjs';

export function dependencies(env = process.env) {
  assertStagingEnvironment(env);
  return {
    database: async () => {
      const pool = new pg.Pool(databaseConfig(env.DATABASE_URL));
      try {
        const { rows } = await pool.query('SELECT environment, project_id, schema_version FROM factory.environment WHERE singleton');
        const row = rows[0];
        if (row?.environment !== 'staging' || row.project_id !== stagingProjectId || row.schema_version !== 1) throw new Error('DATABASE_BOUNDARY_MISMATCH');
      } finally { await pool.end(); }
    },
    artifacts: async () => {
      if (!env.BLOB_READ_WRITE_TOKEN) throw new Error('ARTIFACTS_NOT_CONFIGURED');
      await list({ token: env.BLOB_READ_WRITE_TOKEN, prefix: 'factory/staging/', limit: 1, abortSignal: AbortSignal.timeout(5000) });
    },
    provider: async () => {
      // SDK resolves hosted project OIDC; no static deployment token fallback.
      await Sandbox.list({ limit: 1, signal: AbortSignal.timeout(5000) });
    },
  };
}
