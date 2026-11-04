import { mkdtemp, mkdir, writeFile, chmod, readFile, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bin = process.env.CAPABILITY_TEST_POSTGRES_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const directory = await mkdtemp('/tmp/myfactory-gated-');
const data = join(directory, 'data');
const socket = join(directory, 'socket');
await mkdir(socket);
const passwordFile = join(directory, 'password');
await writeFile(passwordFile, 'disposable-fixture-only\n', { mode: 0o600 });
let started = false;
try {
  await exec(join(bin, 'initdb'), ['-D', data, '-U', 'factory_fixture', '--pwfile', passwordFile,
    '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--no-locale', '-E', 'UTF8']);
  await exec('openssl', ['req', '-new', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout', join(data, 'server.key'), '-out', join(data, 'server.crt')]);
  await chmod(join(data, 'server.key'), 0o600);
  await writeFile(join(data, 'postgresql.auto.conf'), `listen_addresses = '127.0.0.1'\nport = 55492\nunix_socket_directories = '${socket}'\nssl = on\n`);
  await exec(join(bin, 'pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-w', 'start']);
  started = true;
  const connectionString = 'postgres://factory_fixture:disposable-fixture-only@127.0.0.1:55492/postgres';
  const pool = new pg.Pool({ connectionString });
  await pool.query(await readFile(join(root, 'apps/cloud-control/migrations/001-staging-boundary.sql'), 'utf8'));
  await pool.end();
  const files = (await readdir(join(root, 'apps/cloud-control/test')))
    .filter(file => file.endsWith('.test.mjs')).sort().map(file => 'apps/cloud-control/test/' + file);
  const env = { ...process.env, FACTORY_POSTGRES_TEST: '1', FACTORY_PAID_TEST_DATABASE_URL: connectionString,
    DATABASE_URL_UNPOOLED: connectionString, VERCEL_PROJECT_ID: 'prj_IRXTY6HOzS2q9wRPdabsJnmddzl4',
    VERCEL_ENV: 'preview', NODE_EXTRA_CA_CERTS: join(data, 'server.crt') };
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: root, env, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  process.exitCode = code ?? 1;
} finally {
  if (started) await exec(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
