import { createHash, createHmac, timingSafeEqual, sign, verify } from "node:crypto";

const REQUEST = "MYFACTORY_REQUEST_V1";
const RECEIPT = "MYFACTORY_RECEIPT_V1";
function text(value, name, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}
export function parseInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid factory request");
  const keys = ["idempotencyKey", "title", "description", "kind", "acceptanceCriteria", "allowedPaths"];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error("Unsupported factory request field");
  if (!["feature", "defect", "investigation"].includes(input.kind)) throw new Error("Invalid work kind");
  const list = (value, name) => {
    if (!Array.isArray(value) || !value.length || value.length > 30) throw new Error(`Invalid ${name}`);
    return value.map(item => text(item, name, 500));
  };
  const allowedPaths = list(input.allowedPaths, "allowed paths");
  if (allowedPaths.some(path => path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || path.includes("\0"))) throw new Error("Invalid allowed path");
  if (JSON.stringify(input).includes("MYFACTORY_REQUEST_V1") || JSON.stringify(input).includes("MYFACTORY_RECEIPT_V1")) throw new Error("Reserved factory envelope marker");
  return { idempotencyKey: text(input.idempotencyKey, "idempotencyKey", 160),
    title: text(input.title, "title", 200), description: text(input.description, "description", 12000), kind: input.kind,
    acceptanceCriteria: list(input.acceptanceCriteria, "acceptance criteria"), allowedPaths };
}
export function requestId(clientId, key) {
  const hash = createHash("sha256").update(JSON.stringify(["myfactory-linear-v1", clientId, key])).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
function block(marker, value) { return `<!-- ${marker} -->\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n<!-- /${marker} -->`; }
function extract(description, marker) {
  if (typeof description !== "string" || description.length > 60000) throw new Error("Invalid factory envelope");
  const start = `<!-- ${marker} -->\n\`\`\`json\n`, end = `\n\`\`\`\n<!-- /${marker} -->`;
  if (description.split(start).length !== 2) throw new Error(`Missing or ambiguous ${marker}`);
  const rest = description.split(start)[1];
  if (rest.split(end).length !== 2) throw new Error(`Invalid ${marker}`);
  return JSON.parse(rest.split(end)[0]);
}
export function requestDescription(config, input, expiresAt = new Date(Date.now() + 7 * 86400000).toISOString()) {
  input = parseInput(input);
  const payload = { version: 1, clientId: config.clientId, repository: config.repository,
    issueId: requestId(config.clientId, input.idempotencyKey), teamId: config.teamId, expiresAt, input };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = createHash("sha256").update(config.token).digest();
  const signature = createHmac("sha256", key).update(`${REQUEST}\0${encoded}`).digest("hex");
  return `${input.description}\n\n## Acceptance criteria\n${input.acceptanceCriteria.map(item => `- ${item}`).join("\n")}\n\n## MyFactory handoff\nRepository: ${config.repository}\nThis signed request creates a local WorkOrder. Execution and publication require their own factory decisions.\n\n${block(REQUEST, { encoded, signature })}`;
}
export function readRequest(issue, client, route, now = Date.now()) {
  const { encoded, signature } = extract(issue.description, REQUEST);
  if (typeof encoded !== "string" || encoded.length > 40000 || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("Invalid request signature");
  const expected = createHmac("sha256", Buffer.from(client.tokenSha256, "hex")).update(`${REQUEST}\0${encoded}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new Error("Invalid request signature");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  const input = parseInput(payload.input);
  if (payload.version !== 1 || payload.clientId !== client.id || payload.repository !== route.repository ||
      payload.teamId !== route.teamId || issue.team?.id !== route.teamId || issue.title !== input.title ||
      payload.issueId !== issue.id || issue.id !== requestId(client.id, input.idempotencyKey) ||
      !Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= now) throw new Error("Factory request binding is invalid or expired");
  return { ...payload, input };
}
export function peekClientId(issue) {
  const { encoded } = extract(issue.description, REQUEST);
  if (typeof encoded !== "string" || encoded.length > 40000) throw new Error("Invalid factory envelope");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")).clientId;
}
export function receiptDescription(description, receipt, privateKey) {
  const encoded = Buffer.from(JSON.stringify(receipt)).toString("base64url");
  const signature = sign(null, Buffer.from(`${RECEIPT}\0${encoded}`), privateKey).toString("base64url");
  const marker = `<!-- ${RECEIPT} -->`;
  const base = description.includes(marker) ? description.slice(0, description.indexOf(marker)).trimEnd() : description.trimEnd();
  return `${base}\n\n${block(RECEIPT, { encoded, signature })}`;
}
export function readReceipt(description, publicKey, issueId) {
  if (!description?.includes(`<!-- ${RECEIPT} -->`)) return null;
  const { encoded, signature } = extract(description, RECEIPT);
  if (typeof encoded !== "string" || encoded.length > 8000 || typeof signature !== "string" ||
      !verify(null, Buffer.from(`${RECEIPT}\0${encoded}`), publicKey, Buffer.from(signature, "base64url"))) throw new Error("Unverified factory receipt");
  const receipt = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (receipt.version !== 1 || receipt.issueId !== issueId || typeof receipt.workOrderId !== "string") throw new Error("Wrong factory receipt");
  return receipt;
}

const FIELDS = "id identifier url title description team { id }";
export async function submitHostedRequest(config, rawInput, graphql) {
  const input = parseInput(rawInput), id = requestId(config.clientId, input.idempotencyKey);
  const read = async () => (await graphql(`query FactoryHostedRead($id: ID!) { issues(first: 1, includeArchived: true, filter: {id: {eq: $id}}) { nodes { ${FIELDS} } } }`, { id })).issues.nodes[0];
  let issue = await read();
  if (!issue) {
    const description = requestDescription(config, input);
    const created = await graphql(`mutation FactoryHostedCreate($input: IssueCreateInput!) { issueCreate(input:$input) { success issue { ${FIELDS} } } }`,
      { input: { id, teamId: config.teamId, ...(config.labelId ? { labelIds: [config.labelId] } : {}), title: input.title, description } });
    if (!created.issueCreate?.success) throw new Error("Factory request outcome is unknown. Check the same request ID before retrying.");
    issue = created.issueCreate.issue;
  }
  const payload = readRequest(issue, { id: config.clientId, tokenSha256: createHash("sha256").update(config.token).digest("hex") }, config);
  if (JSON.stringify(payload.input) !== JSON.stringify(input)) throw new Error("Idempotency key belongs to another factory request");
  return { requestId: id, issueIdentifier: issue.identifier, issueUrl: issue.url,
    receipt: readReceipt(issue.description, config.receiptPublicKey, id) };
}

export async function getHostedRequest(config, id, graphql) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid request ID");
  const issue = (await graphql(`query FactoryHostedStatus($id: ID!) { issues(first: 1, includeArchived: true, filter: {id: {eq: $id}}) { nodes { ${FIELDS} } } }`, { id })).issues.nodes[0];
  if (!issue) throw new Error("Factory request was not found");
  readRequest(issue, { id: config.clientId, tokenSha256: createHash("sha256").update(config.token).digest("hex") }, config, 0);
  return { requestId: id, issueIdentifier: issue.identifier, issueUrl: issue.url,
    receipt: readReceipt(issue.description, config.receiptPublicKey, id) };
}
