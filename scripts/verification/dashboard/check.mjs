import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// This profile is for one reviewed dependency graph. A coding agent cannot
// silently select new packages or turn a frozen build/test script into a no-op.
if (process.version !== 'v24.18.1') throw new Error('Dashboard profile requires Node 24.18.1');
for (const name of ['package.json', 'package-lock.json']) {
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  if (hash(`/src/${name}`) !== hash(`/opt/qdev-dashboard/dependencies/${name}`)) {
    throw new Error(`Dashboard ${name} differs from the qualified dependency profile`);
  }
}
mkdirSync('/tmp/qdev-dashboard', { recursive: true });
const run = (binary, args) => {
  const result = spawnSync(binary, args, { cwd: '/src', stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) {
    throw new Error(`Dashboard check failed: ${binary} (${result.error?.message ?? result.status})`);
  }
};
// Candidate source stays read-only. Only output/cache paths move into /tmp;
// the project's actual typecheck, Vite configuration and tests still execute.
run('npm', ['run', 'build', '--', '--configLoader', 'runner', '--outDir', '/tmp/qdev-dashboard/dist']);
run('/node_modules/.bin/playwright', ['test', '--config=/opt/qdev-dashboard/playwright.config.mjs']);
