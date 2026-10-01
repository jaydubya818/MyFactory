import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStorage } from '../../../packages/storage/src/index.ts';
import { SpendLedger } from '../../../packages/storage/src/spend.ts';
import { SpendGateway, validatePrice } from '../src/spend-gateway.ts';

async function fixture(t, reply, ceiling = 4000, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-gateway-'));
  const path = join(dir, 'factory.sqlite'), storage = openStorage(path);
  const order = storage.createWorkOrder({ title: 'Gateway fixture', description: 'Synthetic provider', kind: 'feature',
    repositoryPath: dir, baseRef: 'a'.repeat(40), acceptanceCriteria: ['Safe'], reproductionCommand: null,
    expectedFailureText: null, checkCommands: [], allowedPaths: ['test.txt'], workerProfile: 'mac' });
  const run = storage.createRun({ workOrderId: order.id, workerProfile: 'mac', inputCommit: 'a'.repeat(40), workspacePath: dir });
  const ledger = new SpendLedger(path);
  const binding = { workId: 'work-a', workGeneration: 1, dispatchIdentity: 'dispatch-a', requestId: 'request-a',
    workOrderId: order.id, factoryVersion: 'factory-a', runId: run.id };
  let calls = 0;
  const upstream = createServer(async (req, res) => { calls++; await reply(req, res); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const price = { revision: 'local-v1', model: 'fixture-model', validUntil: new Date(Date.now() + 60_000).toISOString(),
    contextLimitTokens: 1000, outputLimitTokens: 100, inputMicrousdPerMillion: 1_000_000,
    outputMicrousdPerMillion: 2_000_000 };
  ledger.createBudget(binding, ceiling, new Date(Date.now() + 60_000).toISOString(),
    {version:'WORK_LEDGER_V2',pricingRevision:price.revision,model:price.model,validUntil:price.validUntil,perOperationReserveMicrousd:1200,
      plannedProductiveOperations:2,plannedCompletionOperations:1,maxPaidOperations:3,completionReserveMicrousd:1200});
  ledger.bindAuthority(binding);
  const gateway = new SpendGateway({ ledger, binding, price, upstreamOrigin: `http://127.0.0.1:${upstream.address().port}`,
    upstreamApiKey: 'provider-secret', childToken: 'a'.repeat(64),phase:'productive',...options });
  const base = await gateway.listen();
  const call = (body = { model: 'fixture-model', input: 'hello' }, token = 'a'.repeat(64)) =>
    fetch(base + '/responses', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body) });
  t.after(async () => { await gateway.close(); await new Promise(resolve => upstream.close(resolve)); ledger.close(); storage.close(); rmSync(dir, { recursive: true, force: true }); });
  return { ledger, binding, price, call, get calls() { return calls; } };
}

function complete(req, res) {
  assert.equal(req.headers.authorization, 'Bearer provider-secret');
  const payload = [];
  req.on('data', part => payload.push(part));
  req.on('end', () => {
    assert.equal(JSON.parse(Buffer.concat(payload).toString()).max_output_tokens, 100);
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'provider-1' });
    res.end(JSON.stringify({ id: 'response-1', status: 'completed', usage: { input_tokens: 10, output_tokens: 10 } }));
  });
}

test('request is reserved before provider and settles only authoritative usage', async t => {
  const f = await fixture(t, complete);
  const denied = await f.call({ model: 'other', input: 'hello' });
  assert.equal(denied.status, 400);
  assert.equal(f.calls, 0);
  const response = await f.call();
  assert.equal(response.status, 200);
  const spend = f.ledger.read(f.binding.workId);
  assert.equal(spend.operations.length, 1);
  assert.equal(spend.operations[0].reservedMicrousd, 1200);
  assert.equal(spend.operations[0].actualMicrousd, 30);
  assert.equal(spend.operations[0].providerRequestId, 'provider-1');
  assert.equal(spend.status, 'KNOWN');
});

test('UNKNOWN denies a second paid call despite remaining Work headroom', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"response-1","status":"completed"}'); });
  assert.equal((await f.call()).status, 503);
  assert.equal(f.ledger.read(f.binding.workId).retainedMicrousd, 1200);
  assert.equal(f.ledger.read(f.binding.workId).status, 'UNKNOWN');
  assert.equal((await f.call()).status, 409);
  assert.equal(f.calls, 1);
  assert.equal(f.ledger.read(f.binding.workId).retainedMicrousd, 1200);
});

test('cancelled Work and expired pricing deny before provider', async t => {
  const f = await fixture(t, complete);
  f.ledger.cancel(f.binding.workId);
  assert.equal((await f.call()).status, 409);
  assert.equal(f.calls, 0);
  assert.equal(f.ledger.read(f.binding.workId).operations.length, 0);
});

test('concurrent requests cannot exceed the productive operation slot limit', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let started;
  const seen = new Promise(resolve => { started = resolve; });
  let invocation=0;
  const f = await fixture(t, async (_req, res) => {
    const n=++invocation;
    if(n===1){started();await held;}
    res.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'provider-concurrent-'+n });
    res.end(JSON.stringify({ status: 'completed', usage: { input_tokens: 10, output_tokens: 10 } }));
  }, 3600);
  const first = f.call();
  await seen;
  const second = await f.call();
  assert.equal(second.status, 200);
  assert.equal(f.calls, 2);
  assert.equal(f.ledger.read(f.binding.workId).retainedMicrousd, 1200);
  assert.equal((await f.call()).status,409);
  assert.equal(f.calls,2);
  release();
  assert.equal((await first).status, 200);
});

test('streaming completion carries authoritative usage; missing completion stays UNKNOWN', async t => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'provider-stream' });
    res.end('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":10}}}\n\n');
  });
  const response = await f.call({ model: 'fixture-model', input: 'hello', stream: true });
  assert.equal(response.status, 200);
  assert.equal(f.ledger.read(f.binding.workId).operations[0].providerRequestId, 'provider-stream');
  assert.equal(f.ledger.read(f.binding.workId).status, 'KNOWN');
});

test('missing, stale, or fractional pricing fails closed', () => {
  const valid = { revision: 'v1', model: 'fixture-model', validUntil: new Date(Date.now() + 60_000).toISOString(),
    contextLimitTokens: 1000, outputLimitTokens: 100, inputMicrousdPerMillion: 1_250_000,
    outputMicrousdPerMillion: 2_500_000 };
  assert.doesNotThrow(() => validatePrice(valid));
  assert.throws(() => validatePrice({ ...valid, validUntil: '2000-01-01T00:00:00Z' }), /pricing/);
  assert.throws(() => validatePrice({ ...valid, outputMicrousdPerMillion: 0 }), /pricing/);
  assert.throws(() => validatePrice({ ...valid, inputMicrousdPerMillion: 1.25 }), /pricing/);
});

test('client tool search is metered as part of its model request and hosted search is denied', async t => {
  let responseNumber=0;
  const f = await fixture(t, (_req,res)=>{responseNumber++;res.writeHead(200,{'content-type':'application/json','x-request-id':'client-search-'+responseNumber});res.end(JSON.stringify({id:'search-'+responseNumber,status:'completed',usage:{input_tokens:10,output_tokens:10}}));});
  const clientSearch={type:'tool_search',execution:'client',description:'Discover local tools',parameters:{type:'object'}};
  for (const tool of [{type:'tool_search'}, {type:'tool_search',execution:'server'},
    {...clientSearch,extra:'unqualified'}, {type:'web_search'}]) {
    assert.equal((await f.call({model:'fixture-model',input:'search',tools:[tool]})).status,400);
  }
  assert.equal(f.calls,0);
  assert.equal((await f.call({model:'fixture-model',input:'search',tools:[clientSearch]})).status,200);
  assert.equal(f.calls,1);
  assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,1);
  const localOutput={type:'tool_search_output',execution:'client',call_id:'local-1',status:'completed',
    tools:[{type:'function',name:'lookup',parameters:{type:'object'}}]};
  assert.equal((await f.call({model:'fixture-model',input:[localOutput],tools:[clientSearch]})).status,200);
  assert.equal(f.calls,2);
  assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,2);
  assert.equal((await f.call({model:'fixture-model',input:[localOutput],tools:[clientSearch]})).status,409);
  assert.equal(f.calls,2);
});

test('separately charged hosted tools are denied before reservation', async t => {
  const f = await fixture(t, complete);
  const response = await f.call({ model: 'fixture-model', input: 'look up facts', tools: [{ type: 'web_search' }] });
  assert.equal(response.status, 400);
  assert.equal(f.calls, 0);
  assert.equal(f.ledger.read(f.binding.workId).operations.length, 0);
});

test('Attempt 4: exhausted productive calls are a local terminal denial, not a provider 503', async t => {
  let n=0;
  const f = await fixture(t, (_req,res)=>{res.writeHead(200,{'content-type':'application/json','x-request-id':'attempt4-'+(++n)});res.end(JSON.stringify({status:'completed',usage:{input_tokens:10,output_tokens:10}}));});
  for (let i=0;i<2;i++) assert.equal((await f.call()).status,200);
  const denied=await f.call();
  assert.equal(denied.status,409);
  assert.equal((await denied.json()).error.code,'LOCAL_ADMISSION_DENIED');
  assert.equal(f.calls,2);
  assert.equal(f.ledger.read(f.binding.workId).status,'KNOWN');
  assert.equal(f.ledger.read(f.binding.workId).completionReserveRemainingMicrousd,1200);
});

test('Attempt 4 reconnaissance cannot spend the final productive slot without actual implementation',async t=>{
 const events=[];let implemented=false,n=0;
 const f=await fixture(t,(_req,res)=>{res.writeHead(200,{'content-type':'application/json','x-request-id':'capacity-'+(++n)});res.end(JSON.stringify({status:'completed',usage:{input_tokens:10,output_tokens:10}}));},4000,{
  assertImplementationProgress:async()=>{if(!implemented)throw Error('synthetic private detail must never escape');},onDecision:e=>events.push(e),
 });
 assert.equal((await f.call()).status,200);
 const denied=await f.call();assert.equal(denied.status,409);
 assert.equal((await denied.json()).error.code,'IMPLEMENTATION_CAPACITY_PROTECTED');
 assert.equal(f.calls,1);assert.equal(f.ledger.read(f.binding.workId).paidOperationsUsed,1);
 assert.equal(f.ledger.read(f.binding.workId).completionReserveRemainingMicrousd,1200);
 assert(!JSON.stringify(events).includes('private detail'));
 implemented=true;assert.equal((await f.call()).status,200);assert.equal(f.calls,2);
});

test('real upstream 503 retains UNKNOWN exposure and repeated local requests never retry upstream',async t=>{
 const events=[];
 const f=await fixture(t,(_req,res)=>{res.writeHead(503,{'x-private-header':'do-not-record'});res.end('provider-secret');},4000,{onDecision:e=>events.push(e)});
 assert.equal((await f.call()).status,503);
 for(let i=0;i<5;i++)assert.equal((await f.call()).status,409);
 assert.equal(f.calls,1);const spend=f.ledger.read(f.binding.workId);
 assert.equal(spend.status,'UNKNOWN');assert.equal(spend.retainedMicrousd,1200);assert.equal(spend.paidOperationsUsed,1);
 assert.equal(events[0].code,'PROVIDER_OUTCOME_UNKNOWN');assert.equal(events[0].upstreamStatus,503);
 assert(!JSON.stringify(events).includes('provider-secret'));assert(!JSON.stringify(events).includes('do-not-record'));
});
