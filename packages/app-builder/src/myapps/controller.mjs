import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  lstatSync,
  chmodSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyCloudCandidate } from "../../../../apps/cloud-control/src/cloud-verification.mjs";
import {
  canonical,
  digest as factoryDigest,
} from "../../../hosted-routing/src/result.ts";

import { referenceConfiguration } from "./configuration.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const objectId = (kind, bytes) =>
  createHash("sha1")
    .update(`${kind} ${Buffer.byteLength(bytes)}\0`)
    .update(bytes)
    .digest("hex");
const emptyTree = objectId("tree", Buffer.alloc(0));
export const EMPTY_APP_SOURCE_COMMIT = objectId(
  "commit",
  `tree ${emptyTree}\nauthor MyApps Fixture <fixture@example.invalid> 0 +0000\ncommitter MyApps Fixture <fixture@example.invalid> 0 +0000\n\nEmpty App source\n`,
);
export function candidateObjects(pkg) {
  const content = canonical(pkg) + "\n",
    blob = objectId("blob", content);
  const treeBytes = Buffer.concat([
      Buffer.from("100644 app-package.json\0"),
      Buffer.from(blob, "hex"),
    ]),
    tree = objectId("tree", treeBytes);
  const commitBytes = Buffer.from(
    `tree ${tree}\nparent ${pkg.source.repositoryCommit}\nauthor MyApps Fixture <fixture@example.invalid> 0 +0000\ncommitter MyApps Fixture <fixture@example.invalid> 0 +0000\n\nDeterministic declarative App candidate\n`,
  );
  return {
    commit: objectId("commit", commitBytes),
    tree,
    commitBytes,
    treeBytes,
    content,
  };
}
function child(script, args, input, readPaths) {
  return execFileSync(
    process.execPath,
    [
      "--permission",
      ...readPaths.map((p) => "--allow-fs-read=" + p),
      script,
      ...args,
    ],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 200000,
      env: { PATH: process.env.PATH ?? "", TZ: "UTC" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
/** Reference adapter inside existing MyFactory. No model, network, publication or deployment provider. */
export class AppReferenceController {
  #db;
  #root;
  #custody;
  #authorize;
  #contracts;
  #factoryCommit;
  #configuration;
  static async open({ myeveRoot, custodyDirectory, authorize }) {
    if (typeof authorize !== "function")
      throw Error("APP_WORK_AUTHORITY_REQUIRED");
    const source = resolve(myeveRoot, "packages/myapps/src");
    const contracts = await import(
      pathToFileURL(join(source, "contracts.ts")).href
    );
    return new AppReferenceController(
      source,
      resolve(custodyDirectory),
      authorize,
      contracts,
    );
  }
  constructor(root, custody, authorize, contracts) {
    mkdirSync(custody, { recursive: true, mode: 0o700 });
    if (
      !lstatSync(custody).isDirectory() ||
      lstatSync(custody).isSymbolicLink()
    )
      throw Error("APP_CUSTODY_DIRECTORY");
    this.#factoryCommit = execFileSync(
      "git",
      ["-C", resolve(here, "../../../.."), "rev-parse", "HEAD"],
      { encoding: "utf8" },
    ).trim();
    this.#root = root;
    this.#configuration = referenceConfiguration(resolve(root, "../../.."));
    this.#custody = custody;
    this.#authorize = authorize;
    this.#contracts = contracts;
    this.#db = new DatabaseSync(join(custody, "controller.sqlite"), {
      timeout: 5000,
    });
    this.#db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,row TEXT NOT NULL); CREATE TABLE IF NOT EXISTS verifier(id TEXT PRIMARY KEY,row TEXT NOT NULL)",
    );
    this.#db.exec(
      "CREATE TABLE IF NOT EXISTS controls(id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL); INSERT OR IGNORE INTO controls VALUES(1,1)",
    );
  }
  close() {
    this.#db.close();
  }
  setEnabled(value) {
    if (typeof value !== "boolean") throw Error("APP_CONTROL_INVALID");
    this.#db
      .prepare("UPDATE controls SET enabled=? WHERE id=1")
      .run(Number(value));
  }
  #enabled() {
    return (
      this.#db.prepare("SELECT enabled FROM controls WHERE id=1").get()
        .enabled === 1
    );
  }
  async #assertAuthority(pkg, denial = "APP_WORK_AUTHORITY_DENIED") {
    const admission = {
      work: pkg.work,
      appId: pkg.appId,
      appVersion: pkg.version,
      appDigest: this.#contracts.digest(pkg),
      factoryVersion: pkg.factoryVersion,
    };
    if (
      !this.#enabled() ||
      (await this.#authorize(admission)) !== true ||
      !this.#enabled()
    )
      throw Error(denial);
    if (
      pkg.factoryVersion.sourceCommit !== this.#factoryCommit ||
      pkg.factoryVersion.configurationDigest !==
        "sha256:" + factoryDigest(this.#configuration)
    )
      throw Error("APP_FACTORY_VERSION_BINDING");
  }
  #read(id) {
    const row = this.#db.prepare("SELECT row FROM runs WHERE id=?").get(id);
    return row ? JSON.parse(row.row) : null;
  }
  #write(id, row) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      // Serialize candidate publication with durable generation fencing, including
      // other controller connections. UNKNOWN/cleanup records may still persist.
      if (row.status === "CANDIDATE" && !this.#enabled())
        throw Error("APP_WORK_AUTHORITY_DENIED");
      this.#db
        .prepare("UPDATE runs SET row=? WHERE id=?")
        .run(canonical(row), id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  async build({ creationIntent, pkg: input }) {
    const pkg = this.#contracts.validatePackage(input),
      hash = this.#contracts.digest(pkg),
      id = factoryDigest({
        owner: pkg.spec.ownerId,
        work: pkg.work,
        app: pkg.appId,
        version: pkg.version,
      });
    await this.#assertAuthority(pkg);
    if (pkg.appId !== this.#contracts.appId(pkg.spec.ownerId, creationIntent))
      throw Error("APP_ID_BINDING");
    let baseRunId = null;
    if (pkg.base) {
      const previous = this.#db
        .prepare(
          "SELECT row FROM runs WHERE json_extract(row,'$.ownerId')=? AND json_extract(row,'$.appDigest')=?",
        )
        .get(pkg.spec.ownerId, pkg.base.digest);
      if (!previous) throw Error("APP_SOURCE_BASE_MISSING");
      const base = JSON.parse(previous.row),
        baseCandidate = this.readCandidate(pkg.spec.ownerId, base.id);
      if (
        baseCandidate.pkg.appId !== pkg.appId ||
        baseCandidate.pkg.version !== pkg.base.version ||
        baseCandidate.commit !== pkg.source.repositoryCommit
      )
        throw Error("APP_SOURCE_BASE_MISMATCH");
      baseRunId = base.id;
    } else if (pkg.source.repositoryCommit !== EMPTY_APP_SOURCE_COMMIT)
      throw Error("APP_SOURCE_BASE_MISMATCH");
    const requestHash = factoryDigest({ creationIntent, pkg });
    this.#db.exec("BEGIN IMMEDIATE");
    let existing;
    try {
      if (!this.#enabled()) throw Error("APP_WORK_AUTHORITY_DENIED");
      existing = this.#read(id);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw Error("APP_REQUEST_CONFLICT");
      } else
        this.#db.prepare("INSERT INTO runs VALUES(?,?,?)").run(
          id,
          requestHash,
          canonical({
            id,
            requestHash,
            ownerId: pkg.spec.ownerId,
            status: "BUILDING",
            appDigest: hash,
            creationIntent,
            configuration: this.#configuration,
            baseRunId,
          }),
        );
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    if (existing) {
      if (existing.status !== "CANDIDATE")
        throw Error("APP_BUILD_OUTCOME_UNKNOWN");
      return existing;
    }
    let row = this.#read(id);
    try {
      const bytes = child(
        join(here, "producer.mjs"),
        [join(this.#root, "contracts.ts")],
        pkg,
        [join(here, "producer.mjs"), join(this.#root, "contracts.ts")],
      );
      const produced = this.#contracts.validatePackage(JSON.parse(bytes));
      if (this.#contracts.digest(produced) !== hash)
        throw Error("APP_PRODUCER_SUBSTITUTION");
      await this.#assertAuthority(pkg);
      // execFileSync returned: producer is stopped before custody and verification.
      const objects = candidateObjects(produced),
        path = join(this.#custody, id + ".json");
      writeFileSync(path, bytes, { flag: "wx", mode: 0o400 });
      chmodSync(path, 0o400);
      row = {
        ...row,
        status: "CANDIDATE",
        candidateCommit: objects.commit,
        candidateTree: objects.tree,
        producerStopped: true,
        producer: "deterministic-declarative.v1",
      };
      this.#write(id, row);
      return row;
    } catch {
      this.#write(id, { ...row, status: "UNKNOWN" });
      throw Error("APP_BUILD_OUTCOME_UNKNOWN");
    }
  }
  readCandidate(owner, id) {
    const row = this.#read(id);
    if (!row || row.ownerId !== owner || row.status !== "CANDIDATE")
      throw Error("APP_UNAVAILABLE");
    const path = join(this.#custody, id + ".json");
    if (lstatSync(path).isSymbolicLink())
      throw Error("APP_CANDIDATE_SUBSTITUTION");
    const pkg = this.#contracts.validatePackage(
      JSON.parse(readFileSync(path, "utf8")),
    );
    if (this.#contracts.digest(pkg) !== row.appDigest)
      throw Error("APP_CANDIDATE_SUBSTITUTION");
    let basePackage = null;
    if (row.baseRunId) {
      const previous = this.#read(row.baseRunId);
      if (!previous || previous.ownerId !== owner)
        throw Error("APP_SOURCE_BASE_MISMATCH");
      const basePath = join(this.#custody, previous.id + ".json");
      if (lstatSync(basePath).isSymbolicLink())
        throw Error("APP_CANDIDATE_SUBSTITUTION");
      basePackage = this.#contracts.validatePackage(
        JSON.parse(readFileSync(basePath, "utf8")),
      );
      if (
        this.#contracts.digest(basePackage) !== pkg.base.digest ||
        candidateObjects(basePackage).commit !== pkg.source.repositoryCommit
      )
        throw Error("APP_SOURCE_BASE_MISMATCH");
    }
    return { pkg, basePackage, ...candidateObjects(pkg) };
  }
  async verify(owner, id) {
    const run = this.#read(id);
    if (!run || run.ownerId !== owner || !run.producerStopped)
      throw Error("APP_UNAVAILABLE");
    const candidate = this.readCandidate(owner, id);
    await this.#assertAuthority(candidate.pkg);
    const read = () => {
      const v = this.#db.prepare("SELECT row FROM verifier WHERE id=?").get(id);
      return v ? JSON.parse(v.row) : null;
    };
    const change = (update) => {
      this.#db.exec("BEGIN IMMEDIATE");
      try {
        const row = read();
        update(row);
        this.#db
          .prepare("UPDATE verifier SET row=? WHERE id=?")
          .run(canonical(row), id);
        this.#db.exec("COMMIT");
      } catch (e) {
        this.#db.exec("ROLLBACK");
        throw e;
      }
    };
    let processFinished = false;
    const store = {
      claim: async () => {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          if (!this.#enabled()) throw Error("VERIFIER_AUTHORITY_FENCED");
          let record = read(),
            created = !record;
          if (!record) {
            record = {
              run_id: id,
              lease_owner: randomUUID(),
              provider_session_id: null,
              deadline: new Date(Date.now() + 15000).toISOString(),
              candidate_commit: run.candidateCommit,
              candidate_tree: run.candidateTree,
              cleanup_confirmed: false,
              outcome: "UNKNOWN",
              checks: [],
            };
            this.#db
              .prepare("INSERT INTO verifier VALUES(?,?)")
              .run(id, canonical(record));
          }
          this.#db.exec("COMMIT");
          return { created, record };
        } catch (e) {
          this.#db.exec("ROLLBACK");
          throw e;
        }
      },
      read: async () => read(),
      assertActive: () =>
        this.#assertAuthority(candidate.pkg, "VERIFIER_AUTHORITY_FENCED"),
      allocated: async (_r, _l, session) =>
        change((row) => {
          row.provider_session_id = session;
        }),
      finish: async (_r, _l, checks) =>
        change((row) => {
          if (!this.#enabled()) throw Error("VERIFIER_AUTHORITY_FENCED");
          row.checks = checks;
          row.outcome =
            checks.length && checks.every((c) => c.result === "PASS")
              ? "PASS"
              : "FAIL";
        }),
      failed: async (_r, _l, code) =>
        change((row) => {
          row.failure = code;
          row.outcome = "UNKNOWN";
        }),
      cleanup: async () =>
        change((row) => {
          row.cleanup_confirmed = true;
        }),
    };
    const provider = {
      allocate: async () => ({
        currentSession: () => ({ sessionId: "reference-verifier-" + id }),
      }),
      verify: async (_sandbox, bundle, active) => {
        await active();
        try {
          const raw = child(
            join(here, "verifier.mjs"),
            [this.#root, run.creationIntent],
            { pkg: bundle.pkg, expectedDigest: run.appDigest },
            [join(here, "verifier.mjs"), this.#root],
          );
          const { checks } = JSON.parse(raw);
          if (
            !Array.isArray(checks) ||
            checks.length < 10 ||
            checks.length > 20 ||
            checks.some(
              (c) =>
                !/^[-a-z]+$/.test(c.id) || !["PASS", "FAIL"].includes(c.result),
            )
          )
            throw Error("VERIFIER_RESULT_INVALID");
          await active();
          return checks;
        } finally {
          processFinished = true;
        }
      },
      destroy: async () => {
        if (!processFinished) throw Error("VERIFIER_CLEANUP_UNPROVEN");
      },
    };
    const result = await verifyCloudCandidate({
      clientId: owner,
      requestId: id,
      store,
      provider,
      readCustody: async () => this.readCandidate(owner, id),
    });
    return {
      format: "myapps.verification.reference.v1",
      appDigest: run.appDigest,
      candidateId: candidate.pkg.source.candidateId,
      verifier: "myfactory-separate-process.v1",
      status: result.outcome,
      cleanupConfirmed: result.cleanup_confirmed,
      claims: result.checks.filter((c) => c.result === "PASS").map((c) => c.id),
    };
  }
}
