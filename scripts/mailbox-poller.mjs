#!/usr/bin/env node
/**
 * Outbound-only Factory mailbox poller (hosted MAILBOX-CONTRACT v1). No inbound listener on the Mac.
 *
 *   env -u NODE_ENV node scripts/mailbox-poller.mjs /abs/mailbox-poller.json
 *
 * Config (operator-owned, not group/world-writable, outside the repository):
 *   { "schema": "myfactory-mailbox-poller/v1", "mailboxOrigin": "https://<hosted MyEve origin>", "installationId": "<id>",
 *     "credentialFile": "/abs/poller-credential (0600)", "factoryOrigin": "http://127.0.0.1:<port>", "idStore": "/abs/forwarded-ids.sqlite (0600)",
 *     "verifierOrigin": "http://127.0.0.1:<verifier port>" (optional; contract v1 target "verifier") }
 * The only argument is the config path. No secrets on argv or in the environment. Composition is apps/supervisor/src/mailbox-poller.ts.
 */
import { loadPollerConfig, MailboxPoller, MailboxRefused } from '../apps/supervisor/src/mailbox-poller.ts';

const [path, ...rest] = process.argv.slice(2);
const fail = message => { process.stderr.write(`mailbox-poller: ${message}\n`); process.exit(2); };
if (!path || rest.length) fail('usage: mailbox-poller.mjs /absolute/mailbox-poller.json');
if (process.env.NODE_ENV) fail('refusing to run with NODE_ENV set; launch with env -u NODE_ENV');
let poller;
try {
  poller = new MailboxPoller({ ...loadPollerConfig(path), log: event => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n') });
} catch (error) { fail(error instanceof MailboxRefused ? error.code : 'refused'); }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => poller.stop());
try { await poller.run(); } finally { poller.close(); }   // releases the single-poller lock; forwarded ids stay recorded forever
