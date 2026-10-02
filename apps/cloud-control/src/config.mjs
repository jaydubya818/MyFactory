export const stagingProjectId = 'prj_IRXTY6HOzS2q9wRPdabsJnmddzl4';
export const stagingTeamId = 'team_p8z8exJRTGfOPk1GC9vUOpv3';
export const custodyStoreId = 'store_kZ9n2mzEmqmKX7bZ';

// This deployment is qualification-only. Environment flags cannot enable Work.
export function assertStagingEnvironment(env) {
  if (env.VERCEL_PROJECT_ID !== stagingProjectId || env.VERCEL_ENV !== 'preview') {
    throw new Error('STAGING_BOUNDARY_MISMATCH');
  }
}

export function databaseConfig(connectionString) {
  if (!connectionString) throw new Error('DATABASE_NOT_CONFIGURED');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password) {
    throw new Error('AUTHENTICATED_DATABASE_REQUIRED');
  }
  // Verify the server certificate; do not inherit weaker connection URL modes.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
  return {
    connectionString: url.toString(), ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000,
    max: 2, idleTimeoutMillis: 1000, allowExitOnIdle: true,
  };
}
