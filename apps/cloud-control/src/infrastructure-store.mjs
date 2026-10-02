import pg from 'pg';
import { databaseConfig, stagingProjectId } from './config.mjs';
import { qualifiedImage, source } from './infrastructure-plan.mjs';

export async function withInfrastructureStore(env, mutate, action) {
  // Session advisory lock requires a direct connection, never transaction pooling.
  if (!env.DATABASE_URL_UNPOOLED) throw Error('DIRECT_DATABASE_REQUIRED');
  const client = new pg.Client(databaseConfig(env.DATABASE_URL_UNPOOLED));
  let locked = false;
  try {
    await client.connect();
    const marker = (await client.query('SELECT * FROM factory.environment WHERE singleton')).rows[0];
    if (marker?.environment !== 'staging' || marker.project_id !== stagingProjectId) throw Error('DATABASE_BOUNDARY_MISMATCH');
    if (mutate) {
      locked = (await client.query('SELECT pg_try_advisory_lock(81427602) AS locked')).rows[0].locked;
      if (!locked) throw Error('INFRASTRUCTURE_BUSY');
    }
    const read = async id => (await client.query('SELECT * FROM factory.infrastructure_attempts WHERE id=$1', [id])).rows[0] ?? null;
    const store = {
      read,
      async reserve(id) {
        // A small total attempt ceiling bounds this operator capability, in addition
        // to the unique unresolved-slot index. Changing the ceiling is source review.
        if (Number((await client.query('SELECT count(*) FROM factory.infrastructure_attempts')).rows[0].count) >= 8) throw Error('INFRASTRUCTURE_ATTEMPT_LIMIT');
        await client.query(`INSERT INTO factory.infrastructure_attempts (id,purpose,source_sha,image,provider_name,state,deadline) VALUES ($1,'deterministic-infrastructure',$2,$3,$4,'ALLOCATING',now()+interval '120 seconds')`, [id,source.commit,qualifiedImage,`factory-infra-${id}`]);
        return read(id);
      },
      async update(id, patch) {
        const allowed = ['state','provider_session_id','command_id','artifact_sha256','artifact_path','cleanup_confirmed','evidence'];
        const keys = Object.keys(patch);
        if (!keys.length || keys.some(key => !allowed.includes(key))) throw Error('INVALID_LEDGER_UPDATE');
        await client.query(`UPDATE factory.infrastructure_attempts SET ${keys.map((key,i)=>`${key}=$${i+2}`).join(',')}, updated_at=now() WHERE id=$1`, [id,...keys.map(key=>patch[key])]);
      },
    };
    return await action(store);
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(81427602)').catch(() => {});
    await client.end();
  }
}
