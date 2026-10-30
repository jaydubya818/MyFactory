import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = 'node@sha256:19cd848a0e073d34bd8cd5545a1b6b4d28489b3e3b607366621ced442bd5f6b4';
const context = fileURLToPath(new URL('.', import.meta.url));
const tag = 'qdev-dashboard-profile:20261030';
execFileSync('docker', ['build', '--pull=false', '--build-arg', `NODE_IMAGE=${base}`, '--tag', tag, context], {
  stdio: 'inherit', timeout: 600_000,
});
const image = execFileSync('docker', ['image', 'inspect', tag, '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 30_000 }).trim();
if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Built image did not have an immutable ID');
console.log(JSON.stringify({ schema: 'qdev-dashboard-verification-image/v1', base, image, command: 'node /opt/qdev-dashboard/check.mjs' }));
