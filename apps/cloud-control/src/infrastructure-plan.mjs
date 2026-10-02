import { stagingProjectId } from './config.mjs';
export const source = Object.freeze({ repository: 'https://github.com/jaydubya818/MyFactory.git', commit: '4753ba1bbbe2ee1cd81a3583e8a8f62f2233c3d9' });
export function allocationPlan(id, image, remainingMs) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('INVALID_ATTEMPT');
  if (!/^factory-worker@sha256:[a-f0-9]{64}$/.test(image ?? '')) throw new Error('PINNED_STAGING_IMAGE_REQUIRED');
  if (!Number.isInteger(remainingMs) || remainingMs < 1000 || remainingMs > 120000) throw new Error('INVALID_DEADLINE');
  return {
    name: `factory-infra-${id}`, image, persistent: false, region: 'iad1', failoverRegions: [],
    resources: { vcpus: 1 }, timeout: remainingMs, ports: [], env: {},
    source: { type: 'git', url: source.repository, revision: source.commit, depth: 1 },
    networkPolicy: { allow: ['github.com'] },
    tags: { purpose: 'factory-infrastructure', attempt: id, project: stagingProjectId },
  };
}

// No caller-supplied code or paths. Source is read from one public pinned commit.
export const probeScript = `
const {execFileSync,spawnSync}=require('node:child_process');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(commit!==${JSON.stringify(source.commit)})throw Error('SOURCE_MISMATCH');
if(process.getuid()===0)throw Error('UNPRIVILEGED_WORKER_REQUIRED');
const secretNames=Object.keys(process.env).filter(k=>/TOKEN|SECRET|PASSWORD|DATABASE_URL|PRIVATE_KEY/.test(k));
if(secretNames.length)throw Error('UNEXPECTED_WORKER_CREDENTIAL');
const test=spawnSync('node',['--test','apps/cloud-control/test/readiness.test.mjs'],{encoding:'utf8',timeout:60000,maxBuffer:128000});
const report={commit,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),node:process.version,uid:process.getuid(),secretNames,testsExit:test.status,stdout:test.stdout,stderr:test.stderr};
process.stdout.write(JSON.stringify(report));process.exitCode=test.status===0?0:1;
`;
