import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { requestDescription, requestId, readRequest, receiptDescription, readReceipt, resultDescription,
  readResult, submitHostedRequest, getHostedRequest, parseInput } from "../src/index.mjs";
const keys = generateKeyPairSync("ed25519");
const config = { clientId: "myeve", repository: "owner/myeve", token: "a".repeat(64), teamId: "team-1", labelId: "label-1", receiptPublicKey: keys.publicKey };
const client = { id: "myeve", tokenSha256: createHash("sha256").update(config.token).digest("hex") };
const input = { idempotencyKey: "test-1", title: "Hosted request", description: "Bounded change requested by the owner", kind: "feature", acceptanceCriteria: ["It works"], allowedPaths: ["docs/"] };
function issue() { return { id: requestId(client.id,input.idempotencyKey), title: input.title, description: requestDescription(config,input), team:{id:config.teamId}, identifier:"MYE-10",url:"https://linear.app/test/issue/MYE-10" }; }

test("signed intake binds caller, repository, team, issue and expiry", () => {
  const value = issue();
  assert.deepEqual(readRequest(value,client,config).input,input);
  for (const changed of [{...value,id:crypto.randomUUID()},{...value,title:"Changed"},{...value,team:{id:"other"}},
    {...value,description:value.description.replace('"signature":"','"signature":"00')}]) assert.throws(()=>readRequest(changed,client,config));
  assert.throws(()=>readRequest(value,{...client,id:"relay"},config));
  assert.throws(()=>readRequest(value,client,{...config,repository:"owner/other"}));
  assert.throws(()=>readRequest(value,{...client,tokenSha256:"b".repeat(64)},config));
  assert.throws(()=>readRequest(value,client,config,Date.now()+8*86400000));
});
test("only the local host key can produce an accepted receipt",()=>{
  const value=issue(), receipt={version:1,issueId:value.id,workOrderId:crypto.randomUUID(),state:"queued",updatedAt:new Date().toISOString(),workOrderUrl:"http://127.0.0.1:8788/"};
  const description=receiptDescription(value.description,receipt,keys.privateKey);
  assert.deepEqual(readReceipt(description,keys.publicKey,value.id),receipt);
  assert.throws(()=>readReceipt(description,generateKeyPairSync("ed25519").publicKey,value.id));
  assert.throws(()=>readReceipt(description,keys.publicKey,crypto.randomUUID()));
  assert.deepEqual(readRequest({...value,description},client,config).input,input);
});
test("lost provider response is reconciled without a duplicate and changed requests conflict",async()=>{
  let saved, creates=0;
  const graphql=async(query,variables)=>{
    if(query.includes("FactoryHostedCreate")){ creates++; saved={...issue(),description:variables.input.description}; throw new Error("lost response"); }
    return {issues:{nodes:saved?[saved]:[]}};
  };
  await assert.rejects(submitHostedRequest(config,input,graphql));
  const result=await submitHostedRequest(config,input,graphql);
  assert.equal(result.requestId,saved.id); assert.equal(creates,1); assert.equal(result.receipt,null);
  await assert.rejects(submitHostedRequest(config,{...input,description:"changed"},graphql));
  await assert.rejects(getHostedRequest({...config,clientId:"relay"},saved.id,graphql));
});
test("remote intake cannot introduce arbitrary execution fields or escape paths",()=>{
  assert.throws(()=>parseInput({...input,checkCommands:["curl attacker"]}));
  assert.throws(()=>parseInput({...input,allowedPaths:["../secrets"]}));
  assert.throws(()=>parseInput({...input,description:"MYFACTORY_REQUEST_V1"}));
});

test("Linear blank-line serialization preserves signed requests and receipts",()=>{
  const value=issue();
  const receipt={version:1,issueId:value.id,workOrderId:crypto.randomUUID(),state:"queued"};
  const serialized=receiptDescription(value.description,receipt,keys.privateKey)
    .replaceAll('-->\n```','-->\n\n```').replaceAll('```\n<!--','```\n\n<!--');
  assert.deepEqual(readRequest({...value,description:serialized},client,config).input,input);
  assert.deepEqual(readReceipt(serialized,keys.publicKey,value.id),receipt);
  assert.throws(()=>readRequest({...value,description:serialized+'\n<!-- MYFACTORY_REQUEST_V1 -->'},client,config));
});

test("oversized envelopes fail before an external issue is created",async()=>{
 let requests=0;const graphql=async()=>{requests++;return {issues:{nodes:[]}};};
 await assert.rejects(submitHostedRequest(config,{...input,description:'a'.repeat(12000),acceptanceCriteria:Array(30).fill('b'.repeat(500))},graphql),/20 KB/);
 assert.equal(requests,0);
});

test("authenticated Work binding and exact signed candidate artifacts survive receipt updates", () => {
  const tree="a".repeat(40), base="b".repeat(40);
  const binding={ownerId:"owner-1",agentId:"agent-1",workId:crypto.randomUUID(),workVersion:1,
    workGeneration:1,criteriaVersion:1,submissionDigest:"c".repeat(64),expectedFactoryId:"factory-1",
    expectedFactoryVersion:{sourceCommit:"d".repeat(40),sourceTree:"e".repeat(40),configurationDigest:"f".repeat(64)}};
  const boundInput={...input,factoryBinding:binding};
  const value={...issue(),description:requestDescription(config,boundInput)};
  assert.deepEqual(readRequest(value,client,config).input,boundInput);
  assert.throws(()=>readRequest({...value,description:value.description.replace(/("encoded":")([^\"]+)/,
    (_,prefix,encoded)=>prefix+(encoded[0]==="A"?"B":"A")+encoded.slice(1))},client,config));
  const commitObject=`tree ${tree}\nparent ${base}\nauthor Factory <factory@example.invalid> 1 +0000\ncommitter Factory <factory@example.invalid> 1 +0000\n\nCandidate\n`;
  const commit=createHash("sha1").update(`commit ${Buffer.byteLength(commitObject)}\0`).update(commitObject).digest("hex");
  const artifact=(kind,content)=>{const bytes=Buffer.from(content);const sha256=createHash("sha256").update(bytes).digest("hex");
    return {id:`${kind}:${sha256}`,kind,byteLength:bytes.length,sha256,bytes:bytes.toString("base64url")};};
  const patch=artifact("patch","tiny patch"),log=artifact("log","passed");
  const runId=crypto.randomUUID();
  const manifest={requestBindingDigest:"1".repeat(64),workOrderId:crypto.randomUUID(),runId,attemptNumber:1,
    inputCommit:base,candidateCommit:commit,candidateTree:tree,changedPaths:["docs/test.md"],
    commitObject:Buffer.from(commitObject).toString("base64url"),checks:[{id:crypto.randomUUID(),command:"true",
      candidateCommit:commit,status:"passed",exitCode:0,startedAt:new Date().toISOString(),
      finishedAt:new Date().toISOString(),logSha256:log.sha256}],artifacts:[patch,log]};
  const result={version:1,keyVersion:"ed25519-v1",issueId:value.id,
    operationId:createHash("sha256").update(JSON.stringify(["myfactory-result-v1",value.id,runId])).digest("hex"),
    factoryId:binding.expectedFactoryId,factoryVersion:binding.expectedFactoryVersion,
    manifestDigest:createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),manifest,issuedAt:new Date().toISOString()};
  const encoded=Buffer.from(JSON.stringify(result)).toString("base64url");
  const description=resultDescription(value.description,encoded,keys.privateKey);
  assert.deepEqual(readResult(description,keys.publicKey,value.id),result);
  assert.deepEqual(readResult(receiptDescription(description,{version:1,issueId:value.id,workOrderId:manifest.workOrderId,
    state:"ready_for_review",updatedAt:new Date().toISOString(),workOrderUrl:"http://127.0.0.1/"},keys.privateKey),
    keys.publicKey,value.id),result);
  assert.throws(()=>readResult(description,generateKeyPairSync("ed25519").publicKey,value.id));
  assert.throws(()=>readResult(description.replace(encoded,encoded.slice(0,-1)+(encoded.at(-1)==="A"?"B":"A")),keys.publicKey,value.id));
  assert.throws(()=>readResult(resultDescription(value.description,Buffer.from(JSON.stringify({ ...result,
    manifest:{...manifest,artifacts:[{...patch,bytes:Buffer.from("altered").toString("base64url")},log]}})).toString("base64url"),keys.privateKey),keys.publicKey,value.id));
});
