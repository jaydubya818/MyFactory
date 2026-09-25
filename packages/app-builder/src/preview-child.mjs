import { join } from "node:path";
import { pathToFileURL } from "node:url";

const outputDir = process.argv[2];
if (!outputDir) throw new Error("Preview output directory is required");

const appModule = await import(pathToFileURL(join(outputDir, "server", "index.ts")).href);
if (typeof appModule.createFeedbackServer !== "function") {
  throw new Error("Generated app has no production server");
}

const app = await appModule.createFeedbackServer({ mode: "production" });
const port = await app.listen(0);
process.stdout.write(`FACTORY_PREVIEW_READY ${JSON.stringify({ url: `http://127.0.0.1:${port}` })}\n`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await app.close(); }
  finally { process.exit(0); }
}

process.stdin.resume();
process.stdin.once("end", shutdown);
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
