import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { FactoryClient } from "../packages/client/src/index.ts";

// Local backend entry point for apps that already have an authorized command bridge.
// Credentials remain in host files; callers never need to put tokens in arguments.
const { values } = parseArgs({ options: {
  id: { type: "string" }, command: { type: "string" }, input: { type: "string" },
  "data-dir": { type: "string" }, origin: { type: "string", default: "http://127.0.0.1:8788" },
} });
if (!values.id || !/^[a-z0-9_-]{1,64}$/.test(values.id)) throw new Error("Pass a registered --id.");
const client = new FactoryClient({ origin: values.origin,
  token: readFileSync(resolve(values["data-dir"] ?? process.env.FACTORY_DATA_DIR ?? "data", `${values.id}-factory-token`), "utf8").trim(),
});
const input = values.input ? JSON.parse(readFileSync(values.input, "utf8")) : {};
let result;
switch (values.command) {
  case "list": result = await client.listWorkOrders(); break;
  case "get": result = await client.getWorkOrder(input.workOrderId); break;
  case "create": result = await client.createWorkOrder(input); break;
  case "note": result = await client.addNote(input.workOrderId, input.text); break;
  case "sync": result = await client.syncToLinear(input.workOrderId); break;
  default: throw new Error("Use --command list, get, create, note, or sync; pass --input with a JSON file when needed.");
}
console.log(JSON.stringify(result, null, 2));
