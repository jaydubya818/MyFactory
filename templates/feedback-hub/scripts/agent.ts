import { pathToFileURL } from "node:url";
import { parseAction } from "../src/shared/actions.ts";
import { executeAction } from "../server/actions.ts";
import { databasePath } from "../server/paths.ts";
import { FeedbackStore } from "../server/store.ts";

export function runAgentAction(type: string, input: unknown, dbPath = databasePath()): unknown {
  const store = new FeedbackStore(dbPath);
  try { return executeAction(store, parseAction({ type, input }), "agent"); }
  finally { store.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [type, inputText = "{}"] = process.argv.slice(2);
  if (!type) {
    console.error("Usage: npm run agent -- <action_name> '<JSON input>'");
    process.exitCode = 2;
  } else {
    try {
      const input: unknown = JSON.parse(inputText);
      console.log(JSON.stringify(runAgentAction(type, input), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Action failed.");
      process.exitCode = 1;
    }
  }
}
