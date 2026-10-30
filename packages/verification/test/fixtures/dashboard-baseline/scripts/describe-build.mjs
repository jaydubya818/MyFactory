import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

// Build metadata is reproducible evidence, not a signed Result or release grant.
const root = resolve(import.meta.dirname, '..');
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('A clean committed source is required.');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
async function inventory(directory) {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name);
    const meta = await lstat(path);
    if (meta.isSymbolicLink()) throw new Error('Build artifacts must be regular files.');
    if (meta.isDirectory()) files.push(...await inventory(path));
    else if (meta.isFile()) {
      const bytes = await readFile(path);
      files.push({ path: relative(root, path), bytes: bytes.length, sha256: sha256(bytes) });
    } else throw new Error('Unsupported build artifact.');
  }
  return files;
}
const files = await inventory(resolve(root, 'dist'));
if (!files.some(file => file.path === 'dist/index.html')) throw new Error('Built entry point is absent.');
process.stdout.write(JSON.stringify({
  schema: 'myeve.dashboard.build-inventory/v1',
  scope: 'BASELINE_BUILD_ONLY',
  sourceCommit: git('rev-parse', 'HEAD'),
  sourceTree: git('rev-parse', 'HEAD^{tree}'),
  lockSha256: sha256(await readFile(resolve(root, 'package-lock.json'))),
  node: process.version,
  files,
  independentVerification: 'NOT_ESTABLISHED',
  signedResult: false,
  releaseQualified: false,
}, null, 2) + '\n');
