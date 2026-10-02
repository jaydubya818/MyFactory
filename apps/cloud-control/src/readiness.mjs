import { createHash, timingSafeEqual } from 'node:crypto';
import { assertStagingEnvironment } from './config.mjs';

export function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const received = request.headers.get('authorization') ?? '';
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(received), hash(`Bearer ${secret}`));
}

export async function readiness(checks) {
  const names = ['database', 'artifacts', 'provider'];
  const settled = await Promise.allSettled(names.map(name => Promise.resolve().then(() => checks[name]())));
  return {
    service: 'myfactory', environment: 'staging', alive: true, ready: false,
    admission: 'DISABLED', modelOperations: 0,
    dependencies: Object.fromEntries(names.map((name, index) => [name, settled[index].status === 'fulfilled' ? 'AVAILABLE' : 'UNAVAILABLE'])),
    gates: { canonicalCloudWork: 'NOT_IMPLEMENTED', cloudHarness: 'NOT_RUN', custody: 'NOT_RUN', independentVerifier: 'NOT_RUN', macOff: 'NOT_RUN' },
  };
}

export async function handleReadiness(request, env, checks) {
  if (request.method !== 'GET') return Response.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });
  if (!authorized(request, env.FACTORY_QUALIFICATION_TOKEN)) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try { assertStagingEnvironment(env); } catch {
    return Response.json({ error: 'STAGING_BOUNDARY_MISMATCH', ready: false }, { status: 503 });
  }
  // Raw SDK/DB errors may contain credentials or sensitive URLs: never return them.
  return Response.json(await readiness(checks), { status: 503, headers: { 'cache-control': 'no-store' } });
}
