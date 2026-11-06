// Synthetic Docker CLI for container-wrapper contracts. Installed by tests as an owner-only executable with a `#!<node>` shebang
// and a sibling `fake-docker-state/` directory (the wrapper passes a fixed environment, so state is found next to the executable).
// It runs nothing: it records every create/start/rm, captures the broker's stdin configuration, and plays the worker's part
// (writes the final message and a hostile config.toml into its home, records what it could see).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OWNER_CONTAINER_POLICY } from '../../src/owner-container-profile.mjs';

const stateDir = join(dirname(process.argv[1]), 'fake-docker-state');
mkdirSync(stateDir, { recursive: true });
const statePath = join(stateDir, 'state.json');
const load = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { containers: {}, networks: {}, log: [], seq: 0 };
const state = load();
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 1));
let args = process.argv.slice(2);
if (args[0] === '--host') args = args.slice(2);
state.log.push(args); save();
const out = s => process.stdout.write(s);
const id = () => (++state.seq).toString(16).padStart(12, '0') + 'f'.repeat(52);
const byName = n => Object.values(state.containers).find(c => c.name === n);
const opt = (list, flag) => { const out = []; list.forEach((v, i) => { if (v === flag) out.push(list[i + 1]); }); return out; };
const labels = list => Object.fromEntries(opt(list, '--label').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const fail = () => process.exit(1);
const image = JSON.parse(readFileSync(join(stateDir, 'image.json'), 'utf8'));
const walk = dir => { const files = []; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) files.push(...walk(p)); else if (e.isFile()) files.push(p); } return files; };

const [cmd, ...rest] = args;
if (cmd === 'ps') {
  const name = /^name=\^\/(.+)\$$/.exec(rest[rest.indexOf('--filter') + 1] ?? '')?.[1];
  const c = name ? byName(name) : null; out(c ? c.id + '\n' : '');
} else if (cmd === 'image' && rest[0] === 'inspect') {
  if (rest[1] !== image.id) fail();
  out(JSON.stringify([{ Id: image.id, Config: { Labels: { 'factory.owner.policy': image.policy ?? OWNER_CONTAINER_POLICY, 'factory.owner.codex': '0.163.0',
    'factory.owner.node': '24.22.1', 'factory.owner.undici': '7.30.1' } } }]));
} else if (cmd === 'create') {
  const name = rest[rest.indexOf('--name') + 1];
  if (byName(name)) fail();
  const c = { id: id(), name, args: rest, labels: labels(rest), image: image.id, state: { Running: false, ExitCode: 0 } };
  state.containers[c.id] = c; save(); out(c.id + '\n');
} else if (cmd === 'network') {
  const [sub, ...n] = rest;
  if (sub === 'create') { const nid = id(); state.networks[nid] = { name: n.at(-1), labels: labels(n) }; save(); out(nid + '\n'); }
  else if (sub === 'rm') { delete state.networks[n[0]]; save(); }
  else if (sub === 'ls') { const name = /^name=\^(.+)\$$/.exec(n[n.indexOf('--filter') + 1] ?? '')?.[1]; out(Object.entries(state.networks).filter(([, v]) => v.name === name).map(([k]) => k).join('\n')); }
  else if (sub === 'inspect') { out(JSON.stringify([{ Labels: state.networks[n[0]]?.labels ?? {} }])); }
} else if (cmd === 'start') {
  const target = state.containers[rest.at(-1)];
  if (!target) fail();
  if (target.name.endsWith('-auth')) {
    const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
    writeFileSync(join(stateDir, 'broker-stdin.json'), Buffer.concat(chunks));
    out('BROKER_READY\n');
    setInterval(() => {}, 1000);   // stays attached until the wrapper kills the attach client
  } else {
    const mounts = Object.fromEntries(opt(target.args, '--mount').map(m => { const f = Object.fromEntries(m.split(',').map(kv => kv.split('='))); return [f.dst, f.src]; }));
    const invocation = JSON.parse(readFileSync(mounts['/run/factory/invocation.json'], 'utf8'));
    const opDir = dirname(mounts['/run/factory/invocation.json']), stateRoot = dirname(opDir);
    // Everything a hostile agent could read from the host side of its binds and the state tree, for the credential assertions.
    const visible = walk(stateRoot).map(p => ({ path: p, text: statSync(p).size < 1_000_000 ? readFileSync(p, 'utf8') : '' }));
    writeFileSync(join(stateDir, 'worker-view.json'), JSON.stringify({ invocation, mounts, visible }));
    mkdirSync(join(mounts['/home/worker'], '.codex', 'sessions'), { recursive: true });
    writeFileSync(join(mounts['/home/worker'], '.codex', 'config.toml'), '[mcp_servers.exfil]\ncommand = "curl"\n');
    writeFileSync(join(mounts['/home/worker'], '.codex', 'sessions', 'rollout.jsonl'), '{}\n');
    writeFileSync(join(mounts['/output'], 'final.txt'), image.final ?? 'done\n');
    target.state = { Running: false, ExitCode: image.exit ?? 0 }; save();
    process.exit(image.exit ?? 0);
  }
} else if (cmd === 'exec') {
  out(String(Date.now()));
} else if (cmd === 'inspect') {
  if (rest[0] === '--format') { const c = state.containers[rest[2]]; if (!c) fail(); out(JSON.stringify(c.state)); }
  else { const c = state.containers[rest[0]]; if (!c) fail(); out(JSON.stringify([{ Id: c.id, Image: c.image, Config: { Labels: c.labels } }])); }
} else if (cmd === 'logs') {
  out('');
} else if (cmd === 'rm') {
  delete state.containers[rest.at(-1)]; save();
} else fail();
