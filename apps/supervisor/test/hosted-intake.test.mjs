import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { createSupervisor } from "../src/server.ts";
import { HostedIntake } from "../src/hosted-intake.ts";
import { requestDescription, requestId, readReceipt } from "../../../packages/hosted-routing/src/index.mjs";

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
  await assert.rejects(new HostedIntake(host.context,remote,dataDir).poll());
  const first=host.storage.listWorkOrders()[0];assert.ok(first);assert.equal(host.storage.getLinearLink(first.id).issueId,issue.id);
  await host.close();host=createSupervisor({dataDir,linear:{}});lost=false;
  const intake=new HostedIntake(host.context,remote,dataDir);await intake.poll();await intake.poll();
  assert.equal(host.storage.listWorkOrders().length,1);assert.equal(host.storage.listEvents(first.id).filter(e=>e.type==="hosted.intake_received").length,1);
  assert.equal(readReceipt(issue.description,pair.publicKey,issue.id).workOrderId,first.id);
  assert.equal(host.storage.listEvents(first.id)[0].payload.actor,"connection:myeve");
  issue.title="Tampered title";await intake.poll();assert.equal(intake.status.rejected,1);
  issue.title=input.title;writeFileSync(join(dataDir,"connections.json"),JSON.stringify({clients:[]}));await intake.poll();assert.equal(intake.status.rejected,2);
  assert.equal(host.storage.listWorkOrders().length,1);
});
