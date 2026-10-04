import { createHash } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import { put, get } from '@vercel/blob';
import { allocationPlan, qualifiedImage, probeScript, source, sourceMaterializationScript } from './infrastructure-plan.mjs';
import { custodyStoreId } from './config.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const artifactLimit = 256000;
export async function boundedBytes(stream, limit = artifactLimit) {
  if (!stream) throw Error('ARTIFACT_MISSING');
  const chunks = []; let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk); length += bytes.length;
    if (length > limit) throw Error('ARTIFACT_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

// SDK 3.5.1 retries 429/5xx and transport failures. Its retry loop passes the same
// options object. Permit only one transport attempt for each mutating request.
// Ambiguous allocation/command dispatch is reconciled, never replayed.
export function noReplayFetch(transport = fetch) {
  const dispatched = new WeakSet();
  return async (url, options) => {
    if (!['GET', 'HEAD'].includes(options.method ?? 'GET')) {
      if (dispatched.has(options)) throw new DOMException('MUTATION_REPLAY_FENCED', 'AbortError');
      dispatched.add(options);
    }
    return transport(url, options);
  };
}

export function infrastructureProvider({providerOptions=async()=>({})}={}) {
  const sdk = { fetch: noReplayFetch() }; // Hosted staging OIDC only; no keys enter worker.
  const signal = () => AbortSignal.timeout(15000);
  return {
    async allocate(id, remainingMs) {
      const sandbox = await Sandbox.create({ ...allocationPlan(id, qualifiedImage, remainingMs), ...sdk, signal: AbortSignal.timeout(30000) });
      if (sandbox.image !== qualifiedImage) throw Error('IMAGE_MISMATCH');
      return sandbox;
    },
    async execute(sandbox, recordCommand, recordEvidence) {
      const user = await sandbox.createUser('factoryproducer', { signal: signal() });
      const materialized = await user.runCommand({ cmd: 'node', args: ['-e', sourceMaterializationScript], timeoutMs: 30000, signal: AbortSignal.timeout(35000) });
      await recordEvidence({ stage: 'MATERIALIZATION', sourceExit: materialized.exitCode, sourceStderr: (await materialized.stderr({ signal: signal() })).slice(0,8000) });
      if (materialized.exitCode !== 0) throw Error('SOURCE_MATERIALIZATION_FAILED');
      const checkout = JSON.parse(await materialized.stdout({ signal: signal() }));
      if (checkout.commit !== source.commit || checkout.tree !== source.tree || checkout.cwd !== '/home/factoryproducer/workspace') throw Error('SOURCE_MISMATCH');
      await sandbox.updateNetworkPolicy('deny-all', { signal: signal() });
      const command = await user.runCommand({ cmd: 'node', args: ['-e', probeScript], cwd: checkout.cwd, detached: true, timeoutMs: 65000, signal: signal() });
      await recordCommand(command.cmdId);
      const finished = await command.wait({ signal: AbortSignal.timeout(70000) });
      const stderr = (await finished.stderr({ signal: signal() })).slice(0,8000);
      await recordEvidence({ commandExit: finished.exitCode, stderr });
      if (finished.exitCode !== 0) throw Error('WORKER_COMMAND_FAILED');
      const bytes = await boundedBytes(await sandbox.readFile({ path: '/home/factoryproducer/result.json' }, { signal: signal() }));
      const manifestText = await finished.stdout({ signal: signal() });
      if (manifestText.length > 1000) throw Error('MANIFEST_TOO_LARGE');
      const manifest = JSON.parse(manifestText);
      if (manifest.sha256 !== digest(bytes) || manifest.bytes !== bytes.length) throw Error('WORKER_MANIFEST_MISMATCH');
      const report = JSON.parse(bytes.toString('utf8'));
      if (finished.exitCode !== 0 || report.testsExit !== 0 || report.commit !== source.commit || report.tree !== source.tree || report.uid <= 0 || report.secretNames.length !== 0 || !/^v24\./.test(report.node)) throw Error('WORKER_REPORT_REJECTED');
      return bytes;
    },
    async collect(id, bytes) {
      const sha256 = digest(bytes);
      const pathname = `factory/staging/infrastructure/${id}/${sha256}.json`;
      await put(pathname, bytes, { access: 'private', storeId: custodyStoreId, addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', abortSignal: signal() });
      const stored = await get(pathname, { access: 'private', storeId: custodyStoreId, useCache: false, abortSignal: signal() });
      if (stored?.statusCode !== 200 || stored.blob.size !== bytes.length || digest(await boundedBytes(stored.stream)) !== sha256) throw Error('CUSTODY_READBACK_MISMATCH');
      return { sha256, pathname, bytes: bytes.length };
    },
    async destroy(name, knownSandbox) {
      const boundSdk = {...(await providerOptions()), ...sdk};
      let sandbox = knownSandbox;
      if (!sandbox) {
        try { sandbox = await Sandbox.get({ name, resume: false, ...boundSdk, signal: signal() }); }
        catch (error) { if (error.response?.status !== 404) throw error; }
      }
      if (sandbox) {
        if (sandbox.name !== name || sandbox.image !== qualifiedImage) throw Error('RESOURCE_IDENTITY_MISMATCH');
        await sandbox.stop({ signal: signal() });
        await sandbox.delete({ deleteOrphanSnapshots: true, signal: signal() });
      }
      try { await Sandbox.get({ name, resume: false, ...boundSdk, signal: signal() }); }
      catch (error) { if (error.response?.status === 404) return; throw error; }
      throw Error('CLEANUP_NOT_CONFIRMED');
    },
  };
}
