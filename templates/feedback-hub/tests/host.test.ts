import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { createFeedbackServer } from "../server/index.ts";

test("the local server accepts loopback Host and rejects DNS rebinding hosts on every route", async () => {
  const app = await createFeedbackServer({ dbPath: ":memory:", mode: "api" });

  async function request(host: string | undefined, url: string, rawHosts = host === undefined ? [] : [host]) {
    return new Promise<{ status: number; body: unknown }>((resolve) => {
      let status = 0;
      const response = {
        headersSent: false,
        writeHead(code: number) { status = code; return this; },
        end(body?: string) { resolve({ status, body: body ? JSON.parse(body) as unknown : null }); return this; },
      } as unknown as ServerResponse;
      const incoming = {
        method: "GET",
        url,
        headers: host === undefined ? {} : { host },
        rawHeaders: rawHosts.flatMap((value) => ["Host", value]),
      } as IncomingMessage;
      app.server.emit("request", incoming, response);
    });
  }

  try {
    for (const host of ["localhost:4173", "127.0.0.1:4173", "[::1]:4173"]) {
      assert.deepEqual(await request(host, "/api/health"), { status: 200, body: { status: "ok" } });
    }
    for (const [host, route] of [
      ["attacker.example:4173", "/api/health"],
      ["localhost.attacker.example", "/"],
      ["127.0.0.1.attacker.example", "/api/actions"],
      ["0.0.0.0:4173", "/api/health"],
    ]) {
      assert.deepEqual(await request(host, route), { status: 403, body: { error: "Forbidden host." } });
    }
    assert.equal((await request(undefined, "/api/health")).status, 403);
    assert.equal((await request("localhost:4173", "/api/health", ["localhost:4173", "attacker.example"])).status, 403);
  } finally {
    app.store.close();
  }
});
