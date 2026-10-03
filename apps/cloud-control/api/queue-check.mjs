import { QueueClient } from '@vercel/queue';
import { authorized } from '../src/readiness.mjs';
import { assertStagingEnvironment } from '../src/config.mjs';
import { sendQueueCheck, validCheckId, withQueueStore } from '../src/queue-delivery.mjs';

export async function handleQueueCheck(request, env, withStore = withQueueStore, send = (...args) => new QueueClient({ region: 'iad1' }).send(...args)) {
  const respond = (data,status=200) => Response.json(data,{status,headers:{'cache-control':'no-store'}});
  if (!authorized(request,env.FACTORY_INFRASTRUCTURE_TOKEN)) return respond({error:'UNAUTHORIZED'},401);
  try { assertStagingEnvironment(env); } catch { return respond({error:'STAGING_BOUNDARY_MISMATCH'},503); }
  const url = new URL(request.url); const id = url.searchParams.get('id');
  if (!validCheckId(id) || [...url.searchParams.keys()].some(key=>key!=='id')) return respond({error:'INVALID_CHECK'},400);
  if (!['GET','POST'].includes(request.method)) return respond({error:'METHOD_NOT_ALLOWED'},405);
  if (request.body) {
    const reader = request.body.getReader();
    try {
      for (;;) {
        const {done,value} = await reader.read();
        if (done) break;
        if (value.byteLength) { await reader.cancel(); return respond({error:'BODY_NOT_ALLOWED'},400); }
      }
    } finally { reader.releaseLock(); }
  }
  try {
    const check = await withStore(env,store => request.method==='GET' ? store.read(id) : sendQueueCheck(store,send,id));
    return respond({purpose:'infrastructure-queue-delivery',admission:'DISABLED',check},check?200:404);
  } catch { return respond({error:'QUEUE_CHECK_UNAVAILABLE',admission:'DISABLED'},503); }
}
export default { fetch: request => handleQueueCheck(request,process.env) };
