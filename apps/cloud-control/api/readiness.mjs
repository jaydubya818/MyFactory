import { handleReadiness, authorized } from '../src/readiness.mjs';
import { dependencies } from '../src/dependencies.mjs';
import {handleProductionReadiness} from '../src/production-readiness.mjs';
export default { async fetch(request) {
  if(process.env.VERCEL_ENV==='production'||process.env.FACTORY_PRODUCTION_INSTALLATION)return handleProductionReadiness(request,process.env);
  // Do not initialize dependencies before authenticating the operator.
  if (!authorized(request, process.env.FACTORY_QUALIFICATION_TOKEN)) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try { return await handleReadiness(request, process.env, dependencies()); }
  catch { return Response.json({ error: 'STAGING_BOUNDARY_MISMATCH', ready: false }, { status: 503 }); }
} };
