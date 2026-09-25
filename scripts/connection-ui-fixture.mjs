// Isolated UI acceptance host. All Linear traffic is simulated; no external credentials are used.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSupervisor } from "../apps/supervisor/src/server.ts";

const dataDir = mkdtempSync(join(tmpdir(), "factory-connection-ui-"));
const repositoryPath = join(dataDir, "disposable-repo");
mkdirSync(repositoryPath);
const issues = new Map();
let creations = 0;
const host = createSupervisor({
  dataDir,
  confirmHumanPresence: async () => true,
  startRun: async () => { throw new Error("This fixture tests connections only; coding attempts are unavailable."); },
  publishDraft: async () => { throw new Error("GitHub publication is unavailable in this fixture."); },
  linear: { apiKey: "ui-fixture-only", teamId: "ui-fixture-team", mode: "manual", fetch: async (_url, request) => {
    const { query, variables } = JSON.parse(request.body);
    if (query.includes("FactoryIssueCreate")) {
      if (issues.has(variables.input.id)) throw new Error("Duplicate create detected");
      creations++;
      const issue = { id: variables.input.id, identifier: `TEST-${creations}`,
        url: `https://linear.app/ui-fixture/issue/TEST-${creations}`, team: { id: "ui-fixture-team" } };
      issues.set(issue.id, issue);
      writeFileSync(join(dataDir, "provider-evidence.json"), JSON.stringify({ creations, issues: [...issues.values()] }, null, 2));
      // First creation succeeds remotely but its response is lost. The UI must offer reconciliation.
      throw new Error("Simulated lost response");
    }
    return Response.json({ data: { issues: { nodes: issues.has(variables.id) ? [issues.get(variables.id)] : [] } } });
  } },
});
host.server.listen(8791, "127.0.0.1", () => console.log(JSON.stringify({ origin: "http://127.0.0.1:8791", dataDir, repositoryPath })));
const close = () => void host.close().then(() => process.exit(0));
process.once("SIGINT", close);
process.once("SIGTERM", close);
