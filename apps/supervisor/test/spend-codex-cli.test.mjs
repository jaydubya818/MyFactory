import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStorage } from '../../../packages/storage/src/index.ts';
import { SpendLedger } from '../../../packages/storage/src/spend.ts';
import { SpendGateway } from '../src/spend-gateway.ts';
import { runCodex } from '../../../packages/agents/src/index.ts';

test('installed Codex CLI reaches only the metered loopback Responses boundary', { skip: process.env.FACTORY_TEST_CODEX_CLI !== '1' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-codex-spend-'));
  const workspacePath = join(dir, 'workspace'), artifactsDir = join(dir, 'artifacts');
  mkdirSync(workspacePath); mkdirSync(artifactsDir);
  execFileSync('git', ['init', '-q', workspacePath]);
  const path = join(dir, 'factory.sqlite'), storage = openStorage(path);
  const order = storage.createWorkOrder({ title: 'CLI route fixture', description: 'Do not call a paid provider', kind: 'feature',
    repositoryPath: workspacePath, baseRef: 'a'.repeat(40), acceptanceCriteria: ['No paid call'], reproductionCommand: null,
    expectedFailureText: null, checkCommands: [], allowedPaths: ['test.txt'], workerProfile: 'mac' });
  const run = storage.createRun({ workOrderId: order.id, workerProfile: 'mac', inputCommit: 'a'.repeat(40), workspacePath });
  const ledger = new SpendLedger(path);
  const binding = { workId: 'cli-fixture', workGeneration: 1, dispatchIdentity: 'dispatch-cli', requestId: 'request-cli',
    workOrderId: order.id, factoryVersion: 'version-cli', runId: run.id };
  ledger.createBudget(binding, 1_000_000, new Date(Date.now() + 60_000).toISOString());
  let upstreamCalls = 0;
  const upstream = createServer((_req, res) => { upstreamCalls++; res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{"error":{"message":"synthetic provider denied","type":"server_error"}}'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = new SpendGateway({ ledger, binding,
    price: { revision: 'cli-v1', model: 'gpt-5.5', validUntil: new Date(Date.now() + 60_000).toISOString(),
      contextLimitTokens: 100_000, outputLimitTokens: 4_000,
      inputMicrousdPerMillion: 1_000_000, outputMicrousdPerMillion: 2_000_000 },
    upstreamOrigin: `http://127.0.0.1:${upstream.address().port}`,
    upstreamApiKey: 'synthetic-only', childToken: 'a'.repeat(64), timeoutMs: 5000 });
  const baseUrl = await gateway.listen();
  t.after(async () => { await gateway.close(); await new Promise(resolve => upstream.close(resolve)); ledger.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  const result = await runCodex({ workspacePath, artifactsDir, prompt: 'Say hello; do not use tools.',
    model: 'gpt-5.5', timeoutMs: 12_000, gateway: { baseUrl, childToken: 'a'.repeat(64) } });
  assert.equal(result.success, false);
  assert(upstreamCalls > 0, `Codex never reached the local provider: ${result.error ?? result.status}; stderr=${readFileSync(result.stderrPath, 'utf8').slice(0, 2000)}; events=${readFileSync(result.eventsPath, 'utf8').slice(0, 2000)}; spend=${JSON.stringify(ledger.read(binding.workId))}`);
  assert.equal(ledger.read(binding.workId).status, 'UNKNOWN');
});
