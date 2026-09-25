import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicKey } from "node:crypto";
import { peekClientId, readRequest, readReceipt, receiptDescription } from "../../../packages/hosted-routing/src/index.mjs";
import { ActionError, performAction, type ActionContext } from "./actions.ts";
import { authorizeClientAction, readClients } from "./connections.ts";
import type { LinearIntegration } from "./linear.ts";
import type { WorkOrder } from "../../../packages/contracts/src/index.ts";

interface Issue { id: string; title: string; description: string; identifier: string; url: string; team: { id: string } }
interface RoutingConfig { routes: Record<string, { repository: string; repositoryPath: string; baseRef: string; checkCommands: string[] }> }

export class HostedIntake {
  readonly status = { enabled: true, lastCheckedAt: null as string | null, imported: 0, rejected: 0, error: null as string | null };
  #timer: ReturnType<typeof setTimeout> | undefined;
  #active: Promise<void> | undefined;
  #stopped = false;
  #cursor: string | null = null;
  readonly #context: ActionContext;
  readonly #linear: LinearIntegration;
  readonly #dataDir: string;
  constructor(context: ActionContext, linear: LinearIntegration, dataDir: string) {
    this.#context = context; this.#linear = linear; this.#dataDir = dataDir;
  }
  start() {
    const tick = () => {
      if (this.#stopped) return;
      this.#active = this.poll().catch(() => { this.status.error = "Hosted intake could not reach or verify its configured Linear queue. It will retry."; })
        .finally(() => { if (!this.#stopped) { this.#timer = setTimeout(tick, 15000); this.#timer.unref(); } });
    };
    tick();
  }
  async close() { this.#stopped = true; clearTimeout(this.#timer); await this.#active; }
  async poll() {
    const config = JSON.parse(readFileSync(join(this.#dataDir, "hosted-routing.json"), "utf8")) as RoutingConfig;
    const clients = readClients(join(this.#dataDir, "connections.json"));
    const privateKey = readFileSync(join(this.#dataDir, "hosted-receipt-key.pem"), "utf8");
    const publicKey = createPublicKey(privateKey);
    await this.#linear.verify();
    const page = await this.#linear.graphql<{ issues: { nodes: Issue[]; pageInfo: { hasNextPage: boolean; endCursor: string } } }>(
      `query FactoryHostedQueue($team: ID!, $after: String) {
        issues(first: 50, after: $after, orderBy: createdAt, filter: {team: {id: {eq: $team}}, description: {contains: "MYFACTORY_REQUEST_V1"}}) {
          nodes { id title description identifier url team { id } } pageInfo { hasNextPage endCursor }
        }
      }`, { team: this.#linear.status.teamId, after: this.#cursor });
    for (const issue of page.issues.nodes) {
      let payload, client, route;
      try {
        client = clients.find(item => item.id === peekClientId(issue));
        route = client && config.routes[client.id];
        if (!client || !route || !client.actions.includes("linear.sync")) throw new Error("Unregistered client");
        // Expiry limits first admission; an admitted request still receives status updates.
        const admitted = this.#context.storage.getIntake(`agent:connection:${client.id}`, `linear-intake:${issue.id}`);
        payload = readRequest(issue, client, { ...route, teamId: this.#linear.status.teamId! }, admitted ? 0 : Date.now());
      } catch { this.status.rejected++; continue; }
      let work: WorkOrder;
      try {
      const input = authorizeClientAction(client, "workorder.create", {
        ...payload.input, idempotencyKey: `linear-intake:${issue.id}`, repositoryPath: route.repositoryPath,
        baseRef: route.baseRef, checkCommands: route.checkCommands, workerProfile: "mac", syncToLinear: false,
        reproductionCommand: null, expectedFailureText: null,
      }, id => this.#context.storage.getWorkOrder(id));
      work = await performAction(this.#context, "workorder.create", input, { kind: "agent", id: `connection:${client.id}` }) as WorkOrder;
      } catch (error) {
        if (!(error instanceof ActionError) || error.status >= 500) throw error;
        this.status.rejected++;
        continue;
      }
      this.#context.storage.transaction(() => {
        const link = this.#context.storage.getLinearLink(work.id);
        if (link && link.issueId !== issue.id) throw new Error("Intake issue differs from saved destination");
        if (!link) {
          this.#context.storage.saveLinearLink({ workOrderId: work.id, issueId: issue.id, teamId: issue.team.id,
            projectId: null, state: "synced", identifier: issue.identifier, url: issue.url, error: null, updatedAt: new Date().toISOString() });
          this.#context.notify(this.#context.storage.appendEvent({ workOrderId: work.id, runId: null,
            type: "hosted.intake_received", payload: { actor: `connection:${client.id}`, issueId: issue.id, identifier: issue.identifier, transport: "linear" } }));
          this.status.imported++;
        }
      });
      const receipt = { version: 1, issueId: issue.id, workOrderId: work.id, state: work.state,
        updatedAt: work.updatedAt, workOrderUrl: `http://127.0.0.1:8788/?workOrder=${work.id}` };
      let previous;
      try { previous = readReceipt(issue.description, publicKey, issue.id); } catch { previous = null; }
      if (JSON.stringify(previous) !== JSON.stringify(receipt)) {
        const result = await this.#linear.graphql<{ issueUpdate: { success: boolean } }>(
          "mutation FactoryHostedReceipt($id: String!, $input: IssueUpdateInput!) { issueUpdate(id:$id,input:$input) {success} }",
          { id: issue.id, input: { description: receiptDescription(issue.description, receipt, privateKey) } });
        if (!result.issueUpdate.success) throw new Error("Hosted receipt was not confirmed");
      }
    }
    this.#cursor = page.issues.pageInfo.hasNextPage ? page.issues.pageInfo.endCursor : null;
    this.status.lastCheckedAt = new Date().toISOString(); this.status.error = null;
  }
}
