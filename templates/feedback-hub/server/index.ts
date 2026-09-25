import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ValidationError } from "../src/shared/actions.ts";
import { executeBrowserAction } from "./actions.ts";
import { databasePath, templateRoot } from "./paths.ts";
import { FeedbackStore } from "./store.ts";

type ViteServer = Awaited<ReturnType<typeof import("vite")["createServer"]>>;

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function hasLoopbackHost(req: IncomingMessage): boolean {
  const hosts: string[] = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === "host") hosts.push(req.rawHeaders[index + 1] ?? "");
  }
  if (hosts.length !== 1 || hosts[0] !== req.headers.host) return false;
  const match = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9]\d{0,4}))?$/i.exec(hosts[0]);
  return !!match && (match[1] === undefined || Number(match[1]) <= 65535);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > 64_000) throw new ValidationError("Request body is too large.");
  }
  try { return JSON.parse(body); }
  catch { throw new ValidationError("Request body must be valid JSON."); }
}

function serveBuiltAsset(req: IncomingMessage, res: ServerResponse): void {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const dist = join(templateRoot, "dist");
  const target = resolve(dist, `.${decodeURIComponent(pathname)}`);
  if (target !== dist && !target.startsWith(`${dist}${sep}`)) {
    json(res, 403, { error: "Forbidden." });
    return;
  }
  const file = existsSync(target) && statSync(target).isFile() ? target : join(dist, "index.html");
  if (!existsSync(file) || (file.endsWith("index.html") && extname(pathname) && pathname !== "/index.html")) {
    json(res, 404, { error: "Not found." });
    return;
  }
  res.writeHead(200, {
    "content-type": mimeTypes[extname(file)] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
}

export async function createFeedbackServer(options: {
  dbPath?: string;
  mode?: "api" | "development" | "production";
} = {}) {
  const store = new FeedbackStore(options.dbPath ?? databasePath());
  const mode = options.mode ?? "development";
  let vite: ViteServer | undefined;
  if (mode === "development") {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      configFile: join(templateRoot, "vite.config.ts"),
      root: templateRoot,
      server: { middlewareMode: true, hmr: { port: 24680 } },
      appType: "spa",
    });
  }

  const server = createServer(async (req, res) => {
    try {
      if (!hasLoopbackHost(req)) {
        json(res, 403, { error: "Forbidden host." });
        return;
      }
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/api/health" && req.method === "GET") {
        json(res, 200, { status: "ok" });
        return;
      }
      if (pathname === "/api/actions") {
        if (req.method !== "POST") {
          json(res, 405, { error: "Use POST for actions." });
          return;
        }
        if (!req.headers["content-type"]?.startsWith("application/json")) {
          json(res, 415, { error: "Use application/json." });
          return;
        }
        json(res, 200, { result: executeBrowserAction(store, await readJson(req)) });
        return;
      }
      if (pathname.startsWith("/api/")) {
        json(res, 404, { error: "Not found." });
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        json(res, 405, { error: "Method not allowed." });
        return;
      }
      if (vite) vite.middlewares(req, res);
      else if (mode === "production") serveBuiltAsset(req, res);
      else json(res, 404, { error: "Not found." });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof ValidationError || (error instanceof Error && "status" in error)) {
        json(res, Number((error as { status: number }).status), { error: error.message });
      } else {
        console.error(error);
        json(res, 500, { error: "The request could not be completed." });
      }
    }
  });

  return {
    server,
    store,
    async listen(port: number): Promise<number> {
      await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolveListen();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Server address is unavailable.");
      return address.port;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      await vite?.close();
      store.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.FEEDBACK_HUB_PORT ?? "4173");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("FEEDBACK_HUB_PORT must be a valid port.");
  const app = await createFeedbackServer({ mode: process.argv.includes("--production") ? "production" : "development" });
  await app.listen(port);
  console.log(`Feedback Hub is ready at http://127.0.0.1:${port}`);
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
