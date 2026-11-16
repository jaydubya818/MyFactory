// Loopback client for the supervisor's connection API, used by the overnight runner.
// Uses node:http so no Origin header is ever sent (the connection API refuses browsers).
import { request as httpRequest } from "node:http";

export function connectionClient({ origin, token, request = httpRequest }) {
  const validToken = /^[a-f0-9]{64}$/.test(token ?? "");
  const base = new URL(origin);
  const call = (method, path, body, auth = true) => new Promise((resolve, reject) => {
    if (auth && !validToken) return reject(new Error("Overnight connection token file must hold the 64-hex token from register-client"));
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = request({ host: base.hostname, port: base.port, method, path, timeout: 30_000,
      headers: { Host: base.host, ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`Supervisor ${method} ${path} returned ${res.statusCode}${data?.error ? `: ${data.error}` : ""}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Supervisor ${method} ${path} timed out`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
  return {
    policy: async () => (await call("GET", "/api/policy", undefined, false))?.policy ?? null,
    prepare: (body) => call("POST", "/api/connect/v1/dispatches", body),
    read: (requestId) => call("GET", `/api/connect/v1/dispatches/${requestId}`),
    dispatch: (requestId, identity) => call("POST", `/api/connect/v1/dispatches/${requestId}/dispatch`, identity),
    stop: (requestId, identity) => call("POST", `/api/connect/v1/dispatches/${requestId}/stop`, identity),
    result: (workOrderId, runId) => call("GET", `/api/connect/v1/work-orders/${workOrderId}/runs/${runId}/result`),
    requestPublication: async (workOrderId, destination) => (await call("POST", "/api/connect/v1/actions",
      { action: "publication.request", input: { workOrderId, destination } }))?.result ?? null,
  };
}
