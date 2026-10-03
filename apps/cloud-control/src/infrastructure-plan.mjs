import { stagingProjectId } from './config.mjs';
export const qualifiedImage = 'vercel/sandbox/node@sha256:6ad1291a9fe7d243ee9f23626e6b08614a596431801c55e14cc5ee9d525f28d1';
export const source = Object.freeze({ repository: 'https://github.com/jaydubya818/MyFactory.git', commit: '4753ba1bbbe2ee1cd81a3583e8a8f62f2233c3d9', tree: 'e190b3bf0fb6fbe4311ddb7dcc13d77cf33c99e2' });
export function allocationPlan(id, image, remainingMs) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('INVALID_ATTEMPT');
  if (image !== qualifiedImage) throw new Error('PINNED_STAGING_IMAGE_REQUIRED');
  if (!Number.isInteger(remainingMs) || remainingMs < 1000 || remainingMs > 120000) throw new Error('INVALID_DEADLINE');
  return {
    name: `factory-infra-${id}`, image, persistent: false, region: 'iad1', failoverRegions: [],
    resources: { vcpus: 1 }, timeout: remainingMs, ports: [], env: {},
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
const bytes=Buffer.from(JSON.stringify(report));
require('node:fs').writeFileSync('/home/factoryproducer/result.json',bytes,{flag:'wx',mode:0o644});
process.stdout.write(JSON.stringify({sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}));process.exitCode=test.status===0?0:1;
`;

// Materialize explicitly in a Factory-owned path. Image WORKDIR is not a source
// checkout contract, and no image/default home directory is recursively chowned.
export const sourceMaterializationScript = `
const fs=require('node:fs'),cp=require('node:child_process');
const cwd='/home/factoryproducer/workspace';
fs.mkdirSync(cwd,{mode:0o755});
const git=args=>cp.execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,encoding:'utf8',timeout:20000,maxBuffer:128000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
git(['init','-q']);
git(['fetch','--depth=1',${JSON.stringify(source.repository)},${JSON.stringify(source.commit)}]);
git(['checkout','--detach','FETCH_HEAD']);
const commit=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']);
if(commit!==${JSON.stringify(source.commit)}||tree!==${JSON.stringify(source.tree)}||git(['status','--porcelain']))throw Error('SOURCE_MISMATCH');
process.stdout.write(JSON.stringify({commit,tree,cwd}));
`;
