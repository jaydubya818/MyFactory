import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { requestDescription, requestId, readRequest, receiptDescription, readReceipt, submitHostedRequest, getHostedRequest, parseInput } from "../src/index.mjs";
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
