import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { assertStagingEnvironment, databaseConfig, stagingProjectId } from './config.mjs';

export const queueTopic = 'factory-staging-delivery-check';
export const validCheckId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const hash = value => createHash('sha256').update(value).digest('hex');
const publicColumns = 'id,deployment_id,state,message_id,created_at,expires_at,delivered_at,delivery_count';

export async function withQueueStore(env, action) {
  assertStagingEnvironment(env);
  if (!/^dpl_[A-Za-z0-9]+$/.test(env.VERCEL_DEPLOYMENT_ID ?? '')) throw Error('DEPLOYMENT_ID_REQUIRED');
  const client = new pg.Client(databaseConfig(env.DATABASE_URL));
  try {
    await client.connect();
    const marker = (await client.query('SELECT * FROM factory.environment WHERE singleton')).rows[0];
    if (marker?.environment !== 'staging' || marker.project_id !== stagingProjectId) throw Error('DATABASE_BOUNDARY_MISMATCH');
    const read = async id => (await client.query(`SELECT ${publicColumns} FROM factory.queue_delivery_checks WHERE id=$1`,[id])).rows[0] ?? null;
    return await action({
      read,
      async reserve(id, nonce) {
        await client.query('BEGIN');
        try {
          await client.query('SELECT pg_advisory_xact_lock(81427604)');
          const prior = await read(id);
          if (prior) { await client.query('COMMIT'); return { created: false, row: prior }; }
          if (Number((await client.query('SELECT count(*) FROM factory.queue_delivery_checks')).rows[0].count) >= 8) throw Error('QUEUE_CHECK_LIMIT');
          await client.query(`INSERT INTO factory.queue_delivery_checks(id,deployment_id,nonce_sha256,state) VALUES($1,$2,$3,'SENDING')`,[id,env.VERCEL_DEPLOYMENT_ID,hash(nonce)]);
          const row = await read(id);
          await client.query('COMMIT');
          return { created: true, row };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      },
      async sent(id, messageId) {
        // Delivery may beat the sender's receipt; never regress durable completion.
        await client.query(`UPDATE factory.queue_delivery_checks SET state='ACCEPTED',message_id=$2 WHERE id=$1 AND state='SENDING'`,[id,messageId]);
      },
      async unknown(id) {
        await client.query(`UPDATE factory.queue_delivery_checks SET state='UNKNOWN' WHERE id=$1 AND state='SENDING'`,[id]);
      },
      async delivered(payload, metadata) {
        const result = await client.query(`UPDATE factory.queue_delivery_checks SET state='DELIVERED',message_id=$4,delivered_at=now(),delivery_count=$5 WHERE id=$1 AND deployment_id=$2 AND nonce_sha256=$3 AND expires_at>now() AND state IN ('SENDING','ACCEPTED','UNKNOWN') AND (message_id IS NULL OR message_id=$4) RETURNING id`,[payload.id,env.VERCEL_DEPLOYMENT_ID,hash(payload.nonce),metadata.messageId,metadata.deliveryCount]);
        return result.rowCount === 1;
      },
    });
  } finally { await client.end(); }
}

export async function sendQueueCheck(store, send, id) {
  if (!validCheckId(id)) throw Error('INVALID_CHECK');
  const nonce = randomBytes(32).toString('hex');
  const reservation = await store.reserve(id, nonce);
  if (!reservation.created) return reservation.row; // Never repeat an ambiguous send.
  try {
    const result = await send(queueTopic,{ version: 1, id, nonce },{ idempotencyKey: id, retentionSeconds: 120, delaySeconds: 10 });
    await store.sent(id,result.messageId);
  } catch {
    await store.unknown(id); // A later authenticated delivery can resolve UNKNOWN.
  }
  return store.read(id);
}

export async function receiveQueueCheck(store, payload, metadata) {
  if (!payload || payload.version !== 1 || !validCheckId(payload.id) || !/^[a-f0-9]{64}$/.test(payload.nonce ?? '') || Object.keys(payload).sort().join(',') !== 'id,nonce,version') throw Error('INVALID_CHECK_MESSAGE');
  if (metadata.topicName !== queueTopic || metadata.region !== 'iad1' || typeof metadata.messageId !== 'string' || !metadata.messageId.length || !Number.isSafeInteger(metadata.deliveryCount) || metadata.deliveryCount < 1) throw Error('INVALID_CHECK_METADATA');
  return store.delivered(payload,metadata);
}
