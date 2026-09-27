import { createHash, createHmac, timingSafeEqual, sign, verify } from "node:crypto";

const REQUEST = "MYFACTORY_REQUEST_V1";
const RECEIPT = "MYFACTORY_RECEIPT_V1";
const RESULT = "MYFACTORY_RESULT_V1";
const hex64 = /^[a-f0-9]{64}$/;
const gitId = /^[a-f0-9]{40,64}$/;
function binding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid factory binding");
  const keys = ["ownerId", "agentId", "workId", "workVersion", "workGeneration", "criteriaVersion",
    "submissionDigest", "expectedFactoryId", "expectedFactoryVersion"];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error("Unsupported factory binding field");
  const version = value.expectedFactoryVersion;
  if (!version || typeof version !== "object" || Array.isArray(version) ||
      Object.keys(version).some(key => !["sourceCommit", "sourceTree", "configurationDigest"].includes(key)) ||
      !gitId.test(version.sourceCommit) || !gitId.test(version.sourceTree) ||
      !hex64.test(version.configurationDigest)) throw new Error("Invalid expected FactoryVersion");
  for (const key of ["ownerId", "agentId", "workId", "expectedFactoryId"])
    text(value[key], key, 160);
  for (const key of ["workVersion", "workGeneration", "criteriaVersion"])
    if (!Number.isSafeInteger(value[key]) || value[key] < 1) throw new Error(`Invalid ${key}`);
  if (!hex64.test(value.submissionDigest)) throw new Error("Invalid submission digest");
  return { ownerId: value.ownerId, agentId: value.agentId, workId: value.workId,
    workVersion: value.workVersion, workGeneration: value.workGeneration, criteriaVersion: value.criteriaVersion,
    submissionDigest: value.submissionDigest, expectedFactoryId: value.expectedFactoryId,
    expectedFactoryVersion: { sourceCommit: version.sourceCommit, sourceTree: version.sourceTree,
      configurationDigest: version.configurationDigest } };
}
function text(value, name, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}
export function parseInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid factory request");
  const keys = ["idempotencyKey", "title", "description", "kind", "acceptanceCriteria", "allowedPaths", "factoryBinding"];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new Error("Unsupported factory request field");
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > 20000) throw new Error("Factory request exceeds the 20 KB intake limit");
  if (!["feature", "defect", "investigation"].includes(input.kind)) throw new Error("Invalid work kind");
  const list = (value, name) => {
    if (!Array.isArray(value) || !value.length || value.length > 30) throw new Error(`Invalid ${name}`);
    return value.map(item => text(item, name, 500));
  };
  const allowedPaths = list(input.allowedPaths, "allowed paths");
  if (allowedPaths.some(path => path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || path.includes("\0"))) throw new Error("Invalid allowed path");
  if ([REQUEST, RECEIPT, RESULT].some(marker => JSON.stringify(input).includes(marker)))
    throw new Error("Reserved factory envelope marker");
  return { idempotencyKey: text(input.idempotencyKey, "idempotencyKey", 160),
    title: text(input.title, "title", 200), description: text(input.description, "description", 12000), kind: input.kind,
    acceptanceCriteria: list(input.acceptanceCriteria, "acceptance criteria"), allowedPaths,
    ...(input.factoryBinding === undefined ? {} : { factoryBinding: binding(input.factoryBinding) }) };
}
export function requestId(clientId, key) {
  const hash = createHash("sha256").update(JSON.stringify(["myfactory-linear-v1", clientId, key])).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
function block(marker, value) { return `<!-- ${marker} -->\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n<!-- /${marker} -->`; }
function extract(description, marker) {
  if (typeof description !== "string" || description.length > 60000) throw new Error("Invalid factory envelope");
  // Linear inserts blank lines around fenced blocks. Only framing whitespace is
  // flexible: the encoded payload is still authenticated byte for byte.
  const start = `<!-- ${marker} -->`, end = `<!-- /${marker} -->`;
  if (description.split(start).length !== 2) throw new Error(`Missing or ambiguous ${marker}`);
  const rest = description.split(start)[1];
  if (rest.split(end).length !== 2) throw new Error(`Invalid ${marker}`);
  const fenced = rest.split(end)[0].trim().match(/^```json\r?\n([\s\S]*?)\r?\n```$/);
  if (!fenced) throw new Error(`Invalid ${marker} block`);
  return JSON.parse(fenced[1]);
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

/** A distinct signed result domain. The encoded bytes are the exact immutable
 * result saved by the producer; admission receipts cannot be replayed here. */
export function resultDescription(description, encoded, privateKey) {
  if (typeof encoded !== "string" || encoded.length > 48000 || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new Error("Invalid bounded factory result");
  const signature = sign(null, Buffer.from(`${RESULT}\0${encoded}`), privateKey).toString("base64url");
  const marker = `<!-- ${RESULT} -->`;
  const receiptMarker = `<!-- ${RECEIPT} -->`;
  const beforeReceipt = description.includes(receiptMarker) ? description.slice(0, description.indexOf(receiptMarker)).trimEnd() : description.trimEnd();
  const oldResult = beforeReceipt.includes(marker) ? beforeReceipt.slice(0, beforeReceipt.indexOf(marker)).trimEnd() : beforeReceipt;
  const receipt = description.includes(receiptMarker) ? description.slice(description.indexOf(receiptMarker)).trim() : "";
  const updated = `${oldResult}\n\n${block(RESULT, { encoded, signature })}${receipt ? `\n\n${receipt}` : ""}`;
  if (Buffer.byteLength(updated, "utf8") > 60000) throw new Error("Hosted result exceeds issue transport limit");
  return updated;
}

export function readResult(description, publicKey, issueId) {
  if (!description?.includes(`<!-- ${RESULT} -->`)) return null;
  const { encoded, signature } = extract(description, RESULT);
  if (typeof encoded !== "string" || encoded.length > 48000 || !/^[A-Za-z0-9_-]+$/.test(encoded) ||
      typeof signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature) ||
      !verify(null, Buffer.from(`${RESULT}\0${encoded}`), publicKey, Buffer.from(signature, "base64url")))
    throw new Error("Unverified factory result");
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.length > 36000 || bytes.toString("base64url") !== encoded) throw new Error("Invalid factory result encoding");
  const result = JSON.parse(bytes.toString("utf8"));
  if (result?.version !== 1 || result.issueId !== issueId || typeof result.operationId !== "string" ||
      !hex64.test(result.manifestDigest) || result.keyVersion !== "ed25519-v1" ||
      typeof result.factoryId !== "string" || !result.factoryVersion || !result.manifest)
    throw new Error("Wrong factory result");
  const manifest = result.manifest;
  if (createHash("sha256").update(JSON.stringify(manifest)).digest("hex") !== result.manifestDigest ||
      !Array.isArray(manifest.artifacts) || manifest.artifacts.length < 2 || manifest.artifacts.length > 21 ||
      !Array.isArray(manifest.checks) || manifest.checks.length < 1 || manifest.checks.length > 20 ||
      !gitId.test(manifest.inputCommit) || !gitId.test(manifest.candidateCommit) || !gitId.test(manifest.candidateTree) ||
      !hex64.test(manifest.requestBindingDigest) ||
      result.operationId !== createHash("sha256").update(JSON.stringify(["myfactory-result-v1", issueId, manifest.runId])).digest("hex"))
    throw new Error("Invalid factory result manifest");
  const ids = new Set();
  for (const item of manifest.artifacts) {
    if (!item || !["patch", "log"].includes(item.kind) || typeof item.id !== "string" || ids.has(item.id) ||
        !hex64.test(item.sha256) || !Number.isSafeInteger(item.byteLength) || item.byteLength < 0 ||
        item.byteLength > 16000 || typeof item.bytes !== "string") throw new Error("Invalid factory artifact");
    const artifactBytes = Buffer.from(item.bytes, "base64url");
    if (artifactBytes.toString("base64url") !== item.bytes || artifactBytes.length !== item.byteLength ||
        createHash("sha256").update(artifactBytes).digest("hex") !== item.sha256 ||
        item.id !== `${item.kind}:${item.sha256}`) throw new Error("Factory artifact integrity failed");
    ids.add(item.id);
  }
  const rawCommit = Buffer.from(manifest.commitObject ?? "", "base64url");
  const algorithm = manifest.candidateCommit.length === 64 ? "sha256" : "sha1";
  const gitDigest = createHash(algorithm).update(`commit ${rawCommit.length}\0`).update(rawCommit).digest("hex");
  if (rawCommit.toString("base64url") !== manifest.commitObject || gitDigest !== manifest.candidateCommit ||
      !rawCommit.toString("utf8").includes(`tree ${manifest.candidateTree}\n`) ||
      !rawCommit.toString("utf8").includes(`parent ${manifest.inputCommit}\n`))
    throw new Error("Factory candidate commit object integrity failed");
  if (manifest.checks.some(check => check.candidateCommit !== manifest.candidateCommit ||
      check.status !== "passed" || check.exitCode !== 0 ||
      !manifest.artifacts.some(item => item.kind === "log" && item.sha256 === check.logSha256)) ||
      !manifest.artifacts.some(item => item.kind === "patch"))
    throw new Error("Factory check evidence integrity failed");
  return result;
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
    receipt: readReceipt(issue.description, config.receiptPublicKey, id),
    result: readResult(issue.description, config.receiptPublicKey, id) };
}

export async function getHostedRequest(config, id, graphql) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid request ID");
  const issue = (await graphql(`query FactoryHostedStatus($id: ID!) { issues(first: 1, includeArchived: true, filter: {id: {eq: $id}}) { nodes { ${FIELDS} } } }`, { id })).issues.nodes[0];
  if (!issue) throw new Error("Factory request was not found");
  readRequest(issue, { id: config.clientId, tokenSha256: createHash("sha256").update(config.token).digest("hex") }, config, 0);
  return { requestId: id, issueIdentifier: issue.identifier, issueUrl: issue.url,
    receipt: readReceipt(issue.description, config.receiptPublicKey, id),
    result: readResult(issue.description, config.receiptPublicKey, id) };
}
