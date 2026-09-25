import { randomUUID } from "node:crypto";
import type { FactoryEvent, LinearLink, WorkOrder, ConnectionStatus } from "../../../packages/contracts/src/index.ts";
import type { FactoryStorage } from "../../../packages/storage/src/index.ts";

export interface LinearOptions {
  apiKey?: string;
  teamId?: string;
  projectId?: string;
  mode?: "manual" | "automatic";
  fetch?: typeof fetch;
}

interface LinearIssue {
  id: string;
  identifier: string;
  url: string;
  team: { id: string };
}

export function linearOptionsFromEnvironment(): LinearOptions {
  const mode = process.env.FACTORY_LINEAR_MODE ?? "manual";
  if (!["manual", "automatic"].includes(mode)) throw new Error("FACTORY_LINEAR_MODE must be manual or automatic");
  return {
    apiKey: process.env.FACTORY_LINEAR_API_KEY,
    teamId: process.env.FACTORY_LINEAR_TEAM_ID,
    projectId: process.env.FACTORY_LINEAR_PROJECT_ID,
    mode: mode as LinearOptions["mode"],
  };
}

export class LinearIntegration {
  readonly status: ConnectionStatus["linear"];
  readonly #storage: FactoryStorage;
  readonly #options: LinearOptions;
  readonly #notify: (event: FactoryEvent) => void;
  readonly #inFlight = new Map<string, Promise<LinearLink>>();

  constructor(storage: FactoryStorage, notify: (event: FactoryEvent) => void, options: LinearOptions) {
    this.#storage = storage;
    this.#options = options;
    this.#notify = notify;
    this.status = {
      configured: Boolean(options.apiKey?.trim() && options.teamId?.trim()),
      mode: options.mode ?? "manual",
      teamId: options.teamId?.trim() || null,
      projectId: options.projectId?.trim() || null,
    };
  }

  prepare(workOrder: WorkOrder): LinearLink {
    return this.#storage.transaction(() => {
      const existing = this.#storage.getLinearLink(workOrder.id);
      if (existing) return existing;
      if (!this.status.configured || !this.status.teamId) throw new Error("Linear needs an API key and team ID on the factory host.");
      return this.#storage.saveLinearLink({
        workOrderId: workOrder.id, issueId: randomUUID(), teamId: this.status.teamId,
        projectId: this.status.projectId, state: "pending", identifier: null, url: null,
        error: null, updatedAt: new Date().toISOString(),
      });
    });
  }

  sync(workOrder: WorkOrder, actorId: string): Promise<LinearLink> {
    const active = this.#inFlight.get(workOrder.id);
    if (active) return active;
    const promise = this.#sync(workOrder, actorId).finally(() => this.#inFlight.delete(workOrder.id));
    this.#inFlight.set(workOrder.id, promise);
    return promise;
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.#inFlight.values());
  }

  async #graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await (this.#options.fetch ?? fetch)("https://api.linear.app/graphql", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json", Authorization: this.#options.apiKey! },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new Error("Linear could not be reached. Retry to reconcile the saved issue ID.");
    }
    if (!response.ok) throw new Error(`Linear returned HTTP ${response.status}. Check the host connection and retry.`);
    const body = await response.json().catch(() => null) as { data?: T; errors?: unknown[] } | null;
    // Provider errors can echo submitted data. Keep credentials and raw responses out of audit events.
    if (!body?.data || body.errors?.length) throw new Error("Linear rejected the request. Check the API key, team, project, and issue permissions, then retry.");
    return body.data;
  }

  #save(link: LinearLink, actorId: string): LinearLink {
    const { saved, event } = this.#storage.transaction(() => {
      const saved = this.#storage.saveLinearLink(link);
      const event = this.#storage.appendEvent({
        workOrderId: link.workOrderId, runId: null, type: `linear.${link.state}`,
        payload: { actor: actorId, issueId: link.issueId, identifier: link.identifier, error: link.error },
      });
      return { saved, event };
    });
    this.#notify(event);
    return saved;
  }

  async #sync(workOrder: WorkOrder, actorId: string): Promise<LinearLink> {
    let link = this.prepare(workOrder);
    if (link.state === "synced") return link;
    if (!this.status.configured || link.teamId !== this.status.teamId || link.projectId !== this.status.projectId) {
      throw new Error("Restore the Linear destination used by this work order before retrying its sync.");
    }
    link = this.#save({ ...link, state: "syncing", error: null }, actorId);
    try {
      const found = await this.#graphql<{ issues: { nodes: LinearIssue[] } }>(
        `query FactoryIssue($id: ID!) { issues(first: 1, includeArchived: true, filter: { id: { eq: $id } }) {
          nodes { id identifier url team { id } }
        } }`, { id: link.issueId });
      if (!Array.isArray(found.issues?.nodes)) throw new Error("Linear returned an invalid issue lookup.");
      let issue = found.issues.nodes[0];
      if (!issue) {
        const description = `${workOrder.description}\n\n## Acceptance criteria\n${workOrder.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}\n\nMyFactory WorkOrder: ${workOrder.id}\nType: ${workOrder.kind}\n\nExecution, evidence, and publication decisions are tracked in MyFactory.`;
        const created = await this.#graphql<{ issueCreate: { success: boolean; issue: LinearIssue } }>(
          `mutation FactoryIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) {
            success issue { id identifier url team { id } }
          } }`, { input: { id: link.issueId, teamId: link.teamId, ...(link.projectId ? { projectId: link.projectId } : {}), title: workOrder.title, description } });
        if (!created.issueCreate?.success) throw new Error("Linear did not confirm issue creation. Retry to reconcile the saved issue ID.");
        issue = created.issueCreate.issue;
      }
      if (!issue || issue.id !== link.issueId || issue.team?.id !== link.teamId ||
          typeof issue.identifier !== "string" || typeof issue.url !== "string" ||
          !/^https:\/\/linear\.app\//.test(issue.url)) throw new Error("Linear returned an unexpected issue identity. Retry to reconcile.");
      return this.#save({ ...link, state: "synced", identifier: issue.identifier, url: issue.url, error: null }, actorId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Linear outcome is unknown. Retry to reconcile.";
      this.#save({ ...link, state: "unknown", error: message }, actorId);
      throw error;
    }
  }
}
