import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { IncomingMessage } from "node:http";
import type { WorkOrder } from "../../../packages/contracts/src/index.ts";
import { ActionError } from "./actions.ts";

export const clientActions = ["workorder.create", "workorder.note.add", "publication.request", "linear.sync"] as const;
export interface FactoryClient {
  id: string;
  name: string;
  tokenSha256: string;
  repositoryPaths: string[];
  actions: string[];
}

export function readClients(path: string): FactoryClient[] {
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8")) as { clients?: FactoryClient[] };
  if (!Array.isArray(data.clients)) throw new Error("Connection configuration needs a clients array");
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const client of data.clients) {
    if (!client || typeof client.id !== "string" || !/^[a-z0-9_-]{1,64}$/.test(client.id) ||
        typeof client.name !== "string" || !client.name.trim() ||
        typeof client.tokenSha256 !== "string" || !/^[a-f0-9]{64}$/.test(client.tokenSha256) ||
        !Array.isArray(client.repositoryPaths) || !client.repositoryPaths.length ||
        client.repositoryPaths.some((path) => typeof path !== "string" || !isAbsolute(path)) ||
        !Array.isArray(client.actions) || client.actions.some((action) => !clientActions.includes(action as typeof clientActions[number])) ||
        ids.has(client.id) || hashes.has(client.tokenSha256)) {
      throw new Error("Invalid or duplicate connection configuration");
    }
    ids.add(client.id);
    hashes.add(client.tokenSha256);
  }
  return data.clients;
}

export function authenticateClient(request: IncomingMessage, clients: FactoryClient[]): FactoryClient {
  // This interface is for app backends on the local host, not arbitrary web pages.
  if (request.headers.origin) throw new ActionError("Use this connection from the app backend", "forbidden", 403);
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? "")?.[1];
  if (!token) throw new ActionError("A connection token is required", "unauthorized", 401);
  const digest = createHash("sha256").update(token).digest();
  const client = clients.find((entry) => timingSafeEqual(digest, Buffer.from(entry.tokenSha256, "hex")));
  if (!client) throw new ActionError("Invalid connection token", "unauthorized", 401);
  return client;
}

export function canAccessRepository(client: FactoryClient, repositoryPath: string): boolean {
  if (!isAbsolute(repositoryPath)) return false;
  try {
    const canonical = realpathSync(repositoryPath);
    return client.repositoryPaths.some((path) => {
      try { return realpathSync(path) === canonical; } catch { return false; }
    });
  } catch { return false; }
}

export function authorizeClientAction(client: FactoryClient, action: string, input: unknown,
  getWorkOrder: (id: string) => WorkOrder | null): Record<string, unknown> {
  if (!clientActions.includes(action as typeof clientActions[number]) || !client.actions.includes(action)) {
    throw new ActionError("This connection cannot perform that action", "forbidden", 403);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ActionError("Action input must be an object", "invalid_input");
  const data = input as Record<string, unknown>;
  let repositoryPath: string | undefined;
  if (action === "workorder.create") {
    if (typeof data.idempotencyKey !== "string" || !data.idempotencyKey.trim()) {
      throw new ActionError("Connected apps must supply a stable idempotencyKey for WorkOrder creation", "invalid_input");
    }
    // Creation can trigger Linear automatically, so sharing needs the same explicit client scope.
    if (data.syncToLinear === true && !client.actions.includes("linear.sync")) {
      throw new ActionError("This connection cannot send work to Linear", "forbidden", 403);
    }
    repositoryPath = typeof data.repositoryPath === "string" ? data.repositoryPath : undefined;
  } else {
    repositoryPath = typeof data.workOrderId === "string" ? getWorkOrder(data.workOrderId)?.repositoryPath : undefined;
  }
  if (!repositoryPath || !canAccessRepository(client, repositoryPath)) {
    throw new ActionError("WorkOrder repository is outside this connection's scope", "forbidden", 403);
  }
  return action === "workorder.create"
    ? { ...data, repositoryPath: realpathSync(repositoryPath),
      ...(!client.actions.includes("linear.sync") ? { syncToLinear: false } : {}) }
    : data;
}
