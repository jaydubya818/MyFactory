import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { createSupervisor } from "../src/server.ts";
import { HostedIntake } from "../src/hosted-intake.ts";
import { requestDescription, requestId, readReceipt } from "../../../packages/hosted-routing/src/index.mjs";

// QA-08/09 regression: receipt URL must use the supplied desk port, not the former hard-coded 8788.
test("receipt URL uses the configured desk port (QA-08/09)", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "factory-intake-port-"));
  const repositoryPath = join(dataDir, "repo");
  mkdirSync(repositoryPath);
  const pair = generateKeyPairSync("ed25519");
  const token = "d".repeat(64);
  const config = { clientId: "myeve", repository: "owner/myeve", teamId: "t1", token, receiptPublicKey: pair.publicKey };
  const input = { idempotencyKey: "port-test", title: "Port check", description: "Verify receipt URL", kind: "feature", acceptanceCriteria: ["URL matches port"], allowedPaths: ["docs/"] };
  const issue = { id: requestId("myeve", input.idempotencyKey), title: input.title, description: requestDescription(config, input), team: { id: "t1" }, identifier: "T-1", url: "https://linear.app/test/issue/T-1" };
  writeFileSync(join(dataDir, "connections.json"), JSON.stringify({ clients: [{ id: "myeve", name: "MyEve", tokenSha256: createHash("sha256").update(token).digest("hex"), repositoryPaths: [repositoryPath], actions: ["workorder.create", "linear.sync"] }] }));
  writeFileSync(join(dataDir, "hosted-routing.json"), JSON.stringify({ routes: { myeve: { repository: config.repository, repositoryPath, baseRef: "main", checkCommands: ["git diff --check"] } } }));
  writeFileSync(join(dataDir, "hosted-receipt-key.pem"), pair.privateKey.export({ format: "pem", type: "pkcs8" }));
  const seenMutations = [];
  const remote = {
    status: { teamId: "t1" },
    verify: async () => {},
    graphql: async (query, variables) => {
      if (query.includes("FactoryHostedQueue")) return { issues: { nodes: [issue], pageInfo: { hasNextPage: false, endCursor: null } } };
      issue.description = variables.input.description;
      seenMutations.push(variables.input.description);
      return { issueUpdate: { success: true } };
    },
  };
  const host = createSupervisor({ dataDir, linear: {} });
  t.after(async () => { await host.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const intake = new HostedIntake(host.context, remote, dataDir, 9999);
  await intake.poll();
  assert.ok(seenMutations.length > 0, "At least one receipt mutation should have been sent");
  const workOrder = host.storage.listWorkOrders()[0];
  assert.ok(workOrder, "WorkOrder should have been created");
  const receipt = readReceipt(issue.description, pair.publicKey, issue.id);
  assert.match(receipt.workOrderUrl, /http:\/\/127\.0\.0\.1:9999\/\?workOrder=/, "Receipt URL should use port 9999, not the old hard-coded 8788");
});

test("hosted request reaches shared actions, survives lost receipt/restart, and rejects revocation and forgery", async t => {
  const dataDir=mkdtempSync(join(tmpdir(),"factory-hosted-")), repositoryPath=join(dataDir,"repo");mkdirSync(repositoryPath);
  const pair=generateKeyPairSync("ed25519"), token="c".repeat(64);
  const config={clientId:"myeve",repository:"owner/myeve",teamId:"team-1",token,receiptPublicKey:pair.publicKey};
  const input={idempotencyKey:"hosted-test",title:"Route the request",description:"Bounded acceptance test",kind:"feature",acceptanceCriteria:["Same durable work"],allowedPaths:["docs/"]};
  const issue={id:requestId("myeve",input.idempotencyKey),title:input.title,description:requestDescription(config,input),team:{id:"team-1"},identifier:"MYE-20",url:"https://linear.app/test/issue/MYE-20"};
  writeFileSync(join(dataDir,"connections.json"),JSON.stringify({clients:[{id:"myeve",name:"MyEve",tokenSha256:createHash("sha256").update(token).digest("hex"),repositoryPaths:[repositoryPath],actions:["workorder.create","linear.sync"]}]}));
  writeFileSync(join(dataDir,"hosted-routing.json"),JSON.stringify({routes:{myeve:{repository:config.repository,repositoryPath,baseRef:"main",checkCommands:["git diff --check"]}}}));
  writeFileSync(join(dataDir,"hosted-receipt-key.pem"),pair.privateKey.export({format:"pem",type:"pkcs8"}));
  let lost=true;
  const remote={status:{teamId:"team-1"},verify:async()=>{},graphql:async(query,variables)=>{
    if(query.includes("FactoryHostedQueue"))return {issues:{nodes:[issue],pageInfo:{hasNextPage:false,endCursor:null}}};
    if(lost)throw new Error("Receipt connection lost");
    issue.description=variables.input.description;return {issueUpdate:{success:true}};
  }};
  let host=createSupervisor({dataDir,linear:{}});
  t.after(async()=>{await host.close();rmSync(dataDir,{recursive:true,force:true});});
  await assert.rejects(new HostedIntake(host.context,remote,dataDir,8787).poll());
  const first=host.storage.listWorkOrders()[0];assert.ok(first);assert.equal(host.storage.getLinearLink(first.id).issueId,issue.id);
  await host.close();host=createSupervisor({dataDir,linear:{}});lost=false;
  const intake=new HostedIntake(host.context,remote,dataDir,8787);await intake.poll();await intake.poll();
  assert.equal(host.storage.listWorkOrders().length,1);assert.equal(host.storage.listEvents(first.id).filter(e=>e.type==="hosted.intake_received").length,1);
  assert.equal(readReceipt(issue.description,pair.publicKey,issue.id).workOrderId,first.id);
  assert.equal(host.storage.listEvents(first.id)[0].payload.actor,"connection:myeve");
  issue.title="Tampered title";await intake.poll();assert.equal(intake.status.rejected,1);
  issue.title=input.title;writeFileSync(join(dataDir,"connections.json"),JSON.stringify({clients:[]}));await intake.poll();assert.equal(intake.status.rejected,2);
  assert.equal(host.storage.listWorkOrders().length,1);
});
