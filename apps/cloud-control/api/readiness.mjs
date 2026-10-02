import { handleReadiness, authorized } from '../src/readiness.mjs';
import { dependencies } from '../src/dependencies.mjs';
export default { async fetch(request) {
  // Do not initialize dependencies before authenticating the operator.
  if (!authorized(request, process.env.FACTORY_QUALIFICATION_TOKEN)) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try { return await handleReadiness(request, process.env, dependencies()); }
  catch { return Response.json({ error: 'STAGING_BOUNDARY_MISMATCH', ready: false }, { status: 503 }); }
} };
