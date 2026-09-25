import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { clientActions, readClients } from "../apps/supervisor/src/connections.ts";

const { values } = parseArgs({ options: {
  id: { type: "string" }, name: { type: "string" }, repo: { type: "string", multiple: true },
  action: { type: "string", multiple: true }, "token-file": { type: "string" },
  "data-dir": { type: "string" }, revoke: { type: "boolean", default: false },
} });
if (!values.id || !/^[a-z0-9_-]{1,64}$/.test(values.id)) throw new Error("Pass --id using lowercase letters, digits, underscores, or hyphens.");
const directory = resolve(values["data-dir"] ?? process.env.FACTORY_DATA_DIR ?? resolve(homedir(), ".local/share/sellerfi-factory"));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const configPath = resolve(directory, "connections.json");
const clients = readClients(configPath);
if (values.revoke) {
  if (!clients.some((client) => client.id === values.id)) throw new Error("Connection was not found.");
} else {
  if (clients.some((client) => client.id === values.id)) throw new Error("Connection already exists. Revoke it before registering a replacement.");
  if (!values.repo?.length || !values["token-file"]) throw new Error("Pass --repo and --token-file. Tokens are written to a file, never printed.");
  const actions = values.action ?? ["workorder.create", "workorder.note.add"];
  if (actions.some((action) => !clientActions.includes(action))) throw new Error("Unsupported action scope.");
  const token = randomBytes(32).toString("hex");
  const tokenPath = resolve(values["token-file"]);
  if (tokenPath === configPath || existsSync(tokenPath)) throw new Error("Token file must be a new, separate file.");
  const { realpathSync } = await import("node:fs");
  const repositoryPaths = values.repo.map((path) => realpathSync(path));
  writeFileSync(tokenPath, token + "\n", { mode: 0o600, flag: "wx" });
  clients.push({ id: values.id, name: values.name ?? values.id, actions, repositoryPaths,
    tokenSha256: createHash("sha256").update(token).digest("hex") });
}
const next = values.revoke ? clients.filter((client) => client.id !== values.id) : clients;
const temporary = `${configPath}.${randomBytes(8).toString("hex")}.tmp`;
writeFileSync(temporary, JSON.stringify({ clients: next }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
// Validate before atomically replacing the host configuration.
readClients(temporary);
renameSync(temporary, configPath);
chmodSync(configPath, 0o600);
console.log(`${values.revoke ? "Revoked" : "Registered"} ${values.id}. Configuration: ${configPath}`);
