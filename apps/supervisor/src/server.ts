import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FactoryEvent, WorkOrderDetail } from "../../../packages/contracts/src/index.ts";
import { listAppTemplates, LocalAppPreviewManager } from "../../../packages/app-builder/src/index.ts";
import { openStorage } from "../../../packages/storage/src/index.ts";
import { ActionError, actionRegistry, performAction, type ActionContext } from "./actions.ts";
import { publishDraftPullRequest } from "./github.ts";
import { JobManager, type JobDependencies } from "./jobs.ts";

const defaultWebDist = resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));
const confirmApprovalScript = fileURLToPath(new URL("../native/confirm-approval.swift", import.meta.url));
const execFileAsync = promisify(execFile);
const defaultDataDir = resolve(homedir(), ".local", "share", "sellerfi-factory");
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sessionToken(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const tokenPath = resolve(dataDir, "session-token");
  if (!existsSync(tokenPath)) {
    try {
      writeFileSync(tokenPath, randomBytes(32).toString("hex"), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("EEXIST")) throw error;
    }
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Invalid local session token");
  return token;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function isLocalHost(host: string | undefined): boolean {
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host ?? "");
}

function allowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:") return false;
    if (parsed.host === host && isLocalHost(host)) return true;
    if (process.env.NODE_ENV !== "production") {
      return ["http://127.0.0.1:5173", "http://localhost:5173"].includes(parsed.origin);
    }
    return false;
  } catch {
    return false;
  }
}

function hasToken(request: IncomingMessage, token: string): boolean {
  const submitted = request.headers["x-factory-token"];
  if (typeof submitted !== "string" || !/^[0-9a-f]{64}$/.test(submitted)) return false;
  return timingSafeEqual(Buffer.from(submitted), Buffer.from(token));
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new ActionError("Content-Type must be application/json", "invalid_content_type", 415);
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString("utf8");
    if (body.length > 1_000_000) {
      throw new ActionError("Request is too large", "request_too_large", 413);
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ActionError("Malformed JSON", "invalid_json");
  }
}

function safeStaticPath(webDist: string, pathname: string): string | null {
  const candidate = resolve(webDist, `.${pathname}`);
  if (candidate !== webDist && !candidate.startsWith(`${webDist}${sep}`)) return null;
  return candidate;
}

function staticFile(response: ServerResponse, path: string): void {
  const file = statSync(path);
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream",
    "Content-Length": file.size,
    "Cache-Control": path.endsWith("index.html") ? "no-store" : "public, max-age=3600",
  });
  createReadStream(path).pipe(response);
}

function containedText(rootDirectory: string, candidate: unknown, maxBytes = 5_000_000): string | null {
  if (typeof candidate !== "string") return null;
  try {
    const root = realpathSync(rootDirectory);
    const path = realpathSync(candidate);
    const file = statSync(path);
    if (!path.startsWith(`${root}${sep}`) || !file.isFile() || file.size > maxBytes) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function artifactText(dataDir: string, candidate: unknown): string | null {
  return containedText(resolve(dataDir, "artifacts"), candidate);
}

export interface SupervisorOptions {
  dataDir?: string;
  webDist?: string;
  startRun?: ActionContext["startRun"];
  cancelRun?: ActionContext["cancelRun"];
  confirmHumanPresence?: NonNullable<ActionContext["confirmHumanPresence"]>;
  publishDraft?: NonNullable<ActionContext["publishDraft"]>;
  jobDependencies?: Partial<JobDependencies>;
}

async function confirmHumanPresence(request: Parameters<NonNullable<ActionContext["confirmHumanPresence"]>>[0]): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const reason = `Factory ${request.action}: ${request.summary.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 250)}`;
  try {
    await execFileAsync("/usr/bin/swift", [confirmApprovalScript, reason], {
      timeout: 120_000,
      maxBuffer: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

export function createSupervisor(options: SupervisorOptions = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.FACTORY_DATA_DIR ?? defaultDataDir);
  const webDist = resolve(options.webDist ?? defaultWebDist);
  const token = sessionToken(dataDir);
  const storage = openStorage(resolve(dataDir, "factory.sqlite"));
  const subscribers = new Map<string, Set<ServerResponse>>();

  const notify = (event: FactoryEvent) => {
    const listeners = subscribers.get(event.workOrderId);
    if (!listeners) return;
    for (const response of listeners) {
      if (response.destroyed || response.writableLength > 1_000_000) {
        response.destroy();
        listeners.delete(response);
        continue;
      }
      try {
        response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        response.destroy();
        listeners.delete(response);
      }
    }
    if (listeners.size === 0) subscribers.delete(event.workOrderId);
  };
  const jobs = new JobManager(storage, dataDir, notify, options.jobDependencies);
  for (const order of storage.listWorkOrders()) {
    for (const external of storage.listExternalActions(order.id)) {
      if (external.kind !== "draft_pr" || external.state !== "dispatched") continue;
      storage.transaction(() => {
        storage.saveExternalAction({
          ...external, state: "unknown", error: "Supervisor restarted before GitHub outcome was recorded",
        });
        storage.appendEvent({
          workOrderId: order.id, runId: external.runId, type: "publication.outcome_unknown",
          payload: { externalActionId: external.id, requestId: external.publicationRequestId,
            reason: "Supervisor restarted before GitHub outcome was recorded" },
        });
      });
    }
    const lastPreviewEvent = storage.listEvents(order.id)
      .filter((event) => event.type.startsWith("builder.preview_")).at(-1);
    if (lastPreviewEvent && ["builder.preview_requested", "builder.preview_started"].includes(lastPreviewEvent.type)) {
      storage.appendEvent({
        workOrderId: order.id, runId: null, type: "builder.preview_interrupted",
        payload: { reason: "Supervisor restarted before the preview was stopped" },
      });
    }
  }
  const previews = new LocalAppPreviewManager({
    evidenceDirectory: join(dataDir, "preview-artifacts"),
    onEvent: (workOrderId, type, payload) => {
      const event = storage.appendEvent({ workOrderId, runId: null, type, payload });
      notify(event);
    },
  });
  const context: ActionContext = {
    storage,
    appBuildDirectory: join(dataDir, "app-builds"),
    previewManager: previews,
    confirmHumanPresence: options.confirmHumanPresence ?? confirmHumanPresence,
    publishDraft: options.publishDraft ?? publishDraftPullRequest,
    notify,
    startRun: options.startRun ?? ((workOrder) => jobs.startRun(workOrder)),
    cancelRun: options.cancelRun ?? ((workOrder) => jobs.cancelRun(workOrder)),
  };

  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    const host = request.headers.host;
    if (!isLocalHost(host)) return json(response, 403, { error: "Local host required" });

    try {
      const url = new URL(request.url ?? "/", `http://${host}`);
      const pathname = url.pathname;

      if (request.method === "GET" && pathname === "/api/health") {
        return json(response, 200, { status: "ok" });
      }
      if (request.method === "GET" && pathname === "/api/session") {
        return json(response, 200, { token });
      }
      if (request.method === "GET" && pathname === "/api/actions") {
        return json(response, 200, { actions: Object.values(actionRegistry) });
      }
      if (request.method === "GET" && pathname === "/api/policy") {
        return json(response, 200, { policy: storage.getPolicy() });
      }
      if (request.method === "GET" && pathname === "/api/app-builder/templates") {
        return json(response, 200, { templates: listAppTemplates() });
      }
      if (request.method === "GET" && pathname === "/api/work-orders") {
        return json(response, 200, { workOrders: storage.listWorkOrders() });
      }
      if (request.method === "GET" && pathname === "/api/signals") {
        return json(response, 200, { signals: storage.listSignals() });
      }
      if (request.method === "GET" && pathname === "/api/releases") {
        return json(response, 200, { releases: storage.listReleases() });
      }

      const detailMatch = /^\/api\/work-orders\/([0-9a-f-]{36})$/.exec(pathname);
      if (request.method === "GET" && detailMatch) {
        const workOrder = storage.getWorkOrder(detailMatch[1]);
        if (!workOrder) return json(response, 404, { error: "WorkOrder not found" });
        const runs = storage.listRuns(workOrder.id);
        const detail: WorkOrderDetail = {
          workOrder,
          runs,
          checks: runs.flatMap((run) => storage.listChecks(run.id)),
          events: storage.listEvents(workOrder.id),
          externalActions: storage.listExternalActions(workOrder.id),
          publicationRequests: storage.listPublicationRequests(workOrder.id),
          publicationApprovals: storage.listPublicationApprovals(workOrder.id),
        };
        return json(response, 200, detail);
      }

      const buildManifestMatch = /^\/api\/work-orders\/([0-9a-f-]{36})\/build-manifest$/.exec(pathname);
      if (request.method === "GET" && buildManifestMatch) {
        const workOrder = storage.getWorkOrder(buildManifestMatch[1]);
        if (!workOrder) return json(response, 404, { error: "WorkOrder not found" });
        const event = storage.listEvents(workOrder.id)
          .filter((item) => item.type === "builder.scaffold_created").at(-1);
        const manifest = containedText(resolve(dataDir, "app-builds"), event?.payload.manifestPath, 1_000_000);
        if (manifest === null) return json(response, 404, { error: "Build manifest is unavailable" });
        return json(response, 200, JSON.parse(manifest));
      }

      const previewMatch = /^\/api\/work-orders\/([0-9a-f-]{36})\/preview$/.exec(pathname);
      if (request.method === "GET" && previewMatch) {
        const workOrder = storage.getWorkOrder(previewMatch[1]);
        if (!workOrder) return json(response, 404, { error: "WorkOrder not found" });
        const lastEvent = storage.listEvents(workOrder.id)
          .filter((event) => event.type.startsWith("builder.preview_")).at(-1);
        const live = previews.status(workOrder.id);
        const status = live?.status ?? ({
          "builder.preview_requested": "interrupted",
          "builder.preview_started": "interrupted",
          "builder.preview_failed": "failed",
          "builder.preview_stopped": "stopped",
          "builder.preview_exited": "stopped",
          "builder.preview_interrupted": "interrupted",
        } as Record<string, string>)[lastEvent?.type ?? ""] ?? "not_started";
        const lastPayload = lastEvent ? { ...lastEvent.payload } : null;
        if (lastPayload) delete lastPayload.url;
        return json(response, 200, {
          status,
          url: live?.status === "running" ? live.url : null,
          lastEvent: lastEvent ? { type: lastEvent.type, createdAt: lastEvent.createdAt, payload: lastPayload } : null,
        });
      }

      const previewLogMatch = /^\/api\/work-orders\/([0-9a-f-]{36})\/preview\/log$/.exec(pathname);
      if (request.method === "GET" && previewLogMatch) {
        const workOrder = storage.getWorkOrder(previewLogMatch[1]);
        if (!workOrder) return json(response, 404, { error: "WorkOrder not found" });
        const live = previews.status(workOrder.id);
        const lastEvent = storage.listEvents(workOrder.id)
          .filter((event) => event.type.startsWith("builder.preview_") &&
            typeof event.payload.logPath === "string").at(-1);
        const log = containedText(resolve(dataDir, "preview-artifacts"),
          live?.logPath ?? lastEvent?.payload.logPath, 2_000_000);
        if (log === null) return json(response, 404, { error: "Preview log is unavailable" });
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end(log);
        return;
      }

      const diffMatch = /^\/api\/work-orders\/([0-9a-f-]{36})\/diff$/.exec(pathname);
      if (request.method === "GET" && diffMatch) {
        const workOrder = storage.getWorkOrder(diffMatch[1]);
        if (!workOrder) return json(response, 404, { error: "WorkOrder not found" });
        const run = storage.listRuns(workOrder.id).at(-1);
        const event = storage.listEvents(workOrder.id)
          .filter((item) => item.runId === run?.id && item.type === "run.candidate_committed" &&
            item.payload.candidateCommit === run?.candidateCommit).at(-1);
        const diff = artifactText(dataDir, event?.payload.diffPath);
        if (diff === null) return json(response, 404, { error: "Candidate diff is unavailable" });
        const observedHash = createHash("sha256").update(diff).digest("hex");
        if (event?.payload.diffSha256 !== observedHash) {
          return json(response, 409, { error: "Candidate diff changed since it was recorded", code: "evidence_stale" });
        }
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end(diff);
        return;
      }

      const checkLogMatch = /^\/api\/work-orders\/([0-9a-f-]{36})\/checks\/([0-9a-f-]{36})\/log$/.exec(pathname);
      if (request.method === "GET" && checkLogMatch) {
        const workOrder = storage.getWorkOrder(checkLogMatch[1]);
        if (!workOrder) return json(response, 404, { error: "WorkOrder not found" });
        const check = storage.listRuns(workOrder.id)
          .flatMap((run) => storage.listChecks(run.id))
          .find((item) => item.id === checkLogMatch[2]);
        const log = artifactText(dataDir, check?.logPath);
        if (log === null) return json(response, 404, { error: "Check log is unavailable" });
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end(log);
        return;
      }

      const eventsMatch = /^\/api\/work-orders\/([0-9a-f-]{36})\/events$/.exec(pathname);
      if (request.method === "GET" && eventsMatch) {
        const workOrderId = eventsMatch[1];
        if (!storage.getWorkOrder(workOrderId)) {
          return json(response, 404, { error: "WorkOrder not found" });
        }
        const cursor = Number(url.searchParams.get("after") ?? 0);
        if (!Number.isSafeInteger(cursor) || cursor < 0) {
          throw new ActionError("Invalid event cursor", "invalid_input");
        }
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        response.write(": connected\n\n");
        for (const event of storage.listEvents(workOrderId, cursor)) {
          response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        const listeners = subscribers.get(workOrderId) ?? new Set<ServerResponse>();
        listeners.add(response);
        subscribers.set(workOrderId, listeners);
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 25_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          listeners.delete(response);
          if (listeners.size === 0) subscribers.delete(workOrderId);
        });
        return;
      }

      if (request.method === "POST" &&
          (pathname === "/api/actions" || pathname === "/api/agent/actions")) {
        if (!allowedOrigin(request.headers.origin, host) || !hasToken(request, token)) {
          return json(response, 403, { error: "Invalid local session or origin" });
        }
        const body = await requestBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          throw new ActionError("Action request must be an object", "invalid_input");
        }
        const { action, input } = body as { action?: unknown; input?: unknown };
        if (typeof action !== "string") {
          throw new ActionError("Action name is required", "invalid_input");
        }
        const actor = pathname === "/api/agent/actions"
          ? { kind: "agent" as const, id: "factory-agent" }
          : { kind: "human" as const, id: "local-user" };
        const result = await performAction(context, action, input, actor);
        return json(response, 200, { result });
      }

      if (request.method === "GET" && !pathname.startsWith("/api/")) {
        const path = safeStaticPath(webDist, pathname);
        if (path && existsSync(path) && statSync(path).isFile()) {
          return staticFile(response, path);
        }
        const index = resolve(webDist, "index.html");
        if (existsSync(index)) return staticFile(response, index);
        return json(response, 503, { error: "Web UI is not built yet" });
      }

      return json(response, 404, { error: "Route not found" });
    } catch (error) {
      if (error instanceof ActionError) {
        return json(response, error.status, { error: error.message, code: error.code });
      }
      console.error("Supervisor request failed", error);
      return json(response, 500, { error: "Internal supervisor error" });
    }
  });

  return {
    server,
    storage,
    context,
    jobs,
    close: async () => {
      await previews.close();
      await jobs.close();
      for (const listeners of subscribers.values()) {
        for (const response of listeners) response.end();
      }
      await new Promise<void>((resolveClose, reject) => {
        if (!server.listening) return resolveClose();
        server.close((error) => error ? reject(error) : resolveClose());
      });
      storage.close();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.FACTORY_PORT ?? 8787);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("FACTORY_PORT must be a valid TCP port");
  }
  const supervisor = createSupervisor();
  supervisor.server.listen(port, "127.0.0.1", () => {
    console.log(`Local Factory is ready at http://127.0.0.1:${port}`);
  });
  const shutdown = () => {
    void supervisor.close().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
