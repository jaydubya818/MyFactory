import { authorized } from '../src/readiness.mjs';
import { assertStagingEnvironment } from '../src/config.mjs';
import { withInfrastructureStore } from '../src/infrastructure-store.mjs';
import { infrastructureProvider } from '../src/infrastructure-provider.mjs';
import { executeInfrastructure, reconcileInfrastructure } from '../src/infrastructure-lifecycle.mjs';

export async function handleInfrastructure(request, env, withStore = withInfrastructureStore, providerFactory = infrastructureProvider) {
  const respond = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
  if (!authorized(request, env.FACTORY_INFRASTRUCTURE_TOKEN)) return respond({ error: 'UNAUTHORIZED' },401);
  try { assertStagingEnvironment(env); } catch { return respond({ error: 'STAGING_BOUNDARY_MISMATCH' },503); }
  const url = new URL(request.url); const id = url.searchParams.get('id');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id ?? '') || [...url.searchParams.keys()].some(key=>key!=='id')) return respond({ error: 'INVALID_ATTEMPT' },400);
  if (!['GET','POST','DELETE'].includes(request.method)) return respond({ error: 'METHOD_NOT_ALLOWED' },405);
  // No caller-selected image, source, code, credentials, model or publication.
  if (request.body !== null) {
    // The hosted adapter supplies an empty stream even for a bodyless POST.
    const reader = request.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.byteLength) { await reader.cancel(); return respond({ error: 'BODY_NOT_ALLOWED' },400); }
      }
    } finally { reader.releaseLock(); }
  }
  try {
    const row = await withStore(env,request.method!=='GET',store => request.method==='GET' ? store.read(id) : request.method==='POST' ? executeInfrastructure(store,providerFactory(),id) : reconcileInfrastructure(store,providerFactory(),id));
    return respond({ purpose: 'deterministic-infrastructure', admission: 'DISABLED', attempt: row },row?200:404);
  } catch (error) {
    const expected = ['INFRASTRUCTURE_BUSY','INFRASTRUCTURE_ATTEMPT_LIMIT','RECONCILIATION_TOO_EARLY'];
    return respond({ error: expected.includes(error.message) ? error.message : 'INFRASTRUCTURE_UNAVAILABLE', admission: 'DISABLED' },503);
  }
}
export default { fetch: request => handleInfrastructure(request, process.env) };
