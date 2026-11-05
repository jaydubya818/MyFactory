#!/usr/bin/env node
/**
 * Host launcher for the ordered LOCAL_V4 MyFactory supervisor (private beta, one Mac, exact loopback).
 *
 *   node scripts/local-v4-host.mjs provision /abs/host-config.json   # one-time: receiver signer, result key, client token (0600)
 *   node scripts/local-v4-host.mjs identity  /abs/host-config.json   # print the Factory identity MyEve must pin (no listener)
 *   node scripts/local-v4-host.mjs start     /abs/host-config.json   # compose and listen on 127.0.0.1:<port>
 *
 * The only argument is a config path. No secrets on argv or in the environment; composition is apps/supervisor/src/local-v4-host.ts.
 */
import { loadHostConfig, provisionHostMaterial, startLocalV4Host, hostFactoryIdentity, hostPreflight, HostConfigRefused } from '../apps/supervisor/src/local-v4-host.ts';

const [command, path, ...rest] = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`local-v4-host: ${message}\n`); process.exit(2); };
if (!['provision', 'identity', 'start'].includes(command) || !path || rest.length) fail('usage: local-v4-host.mjs provision|identity|start /absolute/config.json');
if (process.env.NODE_ENV) fail('refusing to run with NODE_ENV set; launch with env -u NODE_ENV');
try {
  const config = loadHostConfig(path);
  if (command === 'provision') {
    console.log(JSON.stringify(await provisionHostMaterial(config)));
  } else if (command === 'identity') {
    const preflight = await hostPreflight(config);   // executable trust checked first; owner-login route uses the allowlisted env
    if (!preflight.version) fail('HOST_CODEX_UNAVAILABLE');
    const { configuration, ...identity } = hostFactoryIdentity(config, preflight.version);
    console.log(JSON.stringify({ ...identity, configuration }, null, 2));
  } else {
    const host = await startLocalV4Host(config);
    console.log(`MyFactory LOCAL_V4 host ready at ${host.origin} factoryVersion=${host.facts.factory.factoryVersion} facts=${config.materialDir}/host-facts.json`);
    let closing = false;
    const shutdown = () => { if (closing) return; closing = true; host.close().then(() => process.exit(0), () => process.exit(1)); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  }
} catch (error) {
  fail(error instanceof HostConfigRefused ? error.code : `refused: ${error?.message ?? error}`);
}
