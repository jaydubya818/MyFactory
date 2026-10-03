import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { diagnosticCredentials } from './staging-diagnostic-credentials.mjs';
import { Sandbox } from '@vercel/sandbox';
import { stagingProjectId, stagingTeamId } from '../src/config.mjs';
const image = process.argv[2];
if (!['vercel/sandbox/node:24', 'vercel/sandbox/universal:latest'].includes(image)) throw Error('DIAGNOSTIC_IMAGE_NOT_ALLOWED');
const identity = await diagnosticCredentials();
const name = 'factory-image-diagnostic-' + randomUUID();
const events = [];
const scopedFetch = async (url, options) => {
  const response = await fetch(url, options);
  events.push({ method: options?.method ?? 'GET', path: new URL(url).pathname, status: response.status, requestId: response.headers.get('x-vercel-id') });
  return response;
};
const credentials = { ...identity, fetch: scopedFetch };
const result = { name, image, purpose: 'image-resolution-only-NOT-qualification', projectId: stagingProjectId, startedAt: new Date().toISOString(), allocation: 'NOT_RUN', cleanup: 'UNKNOWN', events };
const output = new URL(`../../../docs/cloud-execution/phase-2/provider-diagnosis/${image.includes('node') ? 'managed-node' : 'managed-universal'}.json`, import.meta.url);
await writeFile(output, JSON.stringify(result, null, 2)+'\n');
let sandbox;
try {
  sandbox = await Sandbox.create({ ...credentials, name, image, region: 'iad1', resources: { vcpus: 1 }, timeout: 60000, persistent: false, ports: [], env: {}, networkPolicy: 'deny-all', signal: AbortSignal.timeout(30000) });
  result.allocation = 'ALLOCATED'; result.resolvedImage = sandbox.image; result.sessionId = sandbox.currentSession().sessionId;
} catch (error) {
  result.allocation = 'UNAVAILABLE'; result.error = { name: error.name, status: error.response?.status, code: error.json?.error?.code, message: error.json?.error?.message?.slice(0,500) };
} finally {
  try {
    sandbox ??= await Sandbox.get({ ...credentials, name, resume: false, signal: AbortSignal.timeout(10000) });
    await sandbox.stop({ signal: AbortSignal.timeout(10000) });
    await sandbox.delete({ deleteOrphanSnapshots: true, signal: AbortSignal.timeout(10000) });
  } catch (error) { if (error.response?.status !== 404) result.cleanupError = { name: error.name, status: error.response?.status }; }
  try { await Sandbox.get({ ...credentials, name, resume: false, signal: AbortSignal.timeout(10000) }); result.cleanup = 'RESOURCE_PRESENT'; }
  catch (error) { result.cleanup = error.response?.status === 404 ? 'ABSENT_CONFIRMED' : 'UNKNOWN'; }
  result.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(result, null, 2)+'\n'); console.log(JSON.stringify(result));
}
