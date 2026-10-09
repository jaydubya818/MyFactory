import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const root = process.argv[2];
const { validatePackage, digest, ACTIONS, QUERIES } = await import(
  pathToFileURL(join(root, "contracts.ts")).href
);
const { ReferenceStore } = await import(
  pathToFileURL(join(root, "store.ts")).href
);
const { Crm } = await import(pathToFileURL(join(root, "crm.ts")).href);
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 100000) throw Error("VERIFIER_BOUND");
}
const { pkg, expectedDigest } = JSON.parse(input),
  checks = [];
const check = (id, body) => {
  try {
    body();
    checks.push({ id, result: "PASS" });
  } catch {
    checks.push({ id, result: "FAIL" });
  }
};
check("app-package-schema", () => validatePackage(pkg));
check("candidate-digest", () => assert.equal(digest(pkg), expectedDigest));
check("required-views", () =>
  assert.ok(
    ["Overview", "Pipeline", "Leads", "Lead Detail", "Follow-ups"].every((v) =>
      pkg.spec.ui.views.includes(v),
    ),
  ),
);
const store = new ReferenceStore();
const principal = {
  ownerId: pkg.spec.ownerId,
  actorId: "protected-verifier",
  kind: "human",
  allowedOperations: [
    "apps.read",
    "apps.manage",
    "apps.install",
    ...ACTIONS.map((x) => x.name),
    ...QUERIES.map((x) => x.name),
  ],
};
const crm = new Crm(store, principal);
try {
  // Install into the verifier's disposable reference store, never the owner registry.
  // Successor verification needs its exact base; its compatibility is checked separately below.
  const runnable = { ...pkg, version: 1, base: null };
  const hash = digest(runnable);
  store.register(process.argv[3], runnable);
  store.recordVerification(principal.ownerId, pkg.appId, 1, {
    format: "myapps.verification.reference.v1",
    appDigest: hash,
    candidateId: pkg.source.candidateId,
    verifier: "test-bootstrap-only",
    status: "PASS",
    cleanupConfirmed: true,
    claims: [],
  });
  const session = store.session(principal),
    preview = store.createPreview(principal.ownerId, pkg.appId, 1),
    approval = session.requestInstall(pkg.appId, preview.id);
  session.approveInstall(pkg.appId, approval.id);
  let lead;
  check("create-lead", () => {
    lead = crm.action(
      pkg.appId,
      1,
      hash,
      "createLead",
      {
        name: "Protected contact",
        company: "Fixture Company",
        contact: "test@example.invalid",
        source: "Protected fixture",
        valueCents: 123456,
      },
      "create",
    );
    assert.equal(lead.stage, "New");
  });
  const mutate = (operation, fields) => {
    lead = crm.action(
      pkg.appId,
      1,
      hash,
      operation,
      { leadId: lead.id, expectedRevision: lead.revision, ...fields },
      operation,
    );
  };
  check("update-stage", () => {
    mutate("updateStage", { stage: "Proposal" });
    assert.equal(lead.stage, "Proposal");
  });
  check("notes-persist", () => {
    mutate("addNote", { note: "Protected synthetic note" });
    assert.equal(
      crm.query(pkg.appId, 1, hash, "getLead", { leadId: lead.id }).notes
        .length,
      1,
    );
  });
  check("spend-persists", () => {
    mutate("recordSpend", { amountCents: 789 });
    assert.equal(lead.spendCents, 789);
  });
  check("followup-persists", () => {
    mutate("scheduleFollowup", { date: "2026-10-08" });
    assert.equal(
      crm.query(pkg.appId, 1, hash, "getFollowupsDue", {
        through: "2026-10-08",
      }).length,
      1,
    );
  });
  check("metrics-derived", () =>
    assert.deepEqual(
      crm.query(pkg.appId, 1, hash, "getMetrics", {
        asOf: "2026-10-08",
        periodStart: "2026-10-01",
      }),
      {
        openLeads: 1,
        openPipelineCents: 123456,
        followupsDue: 1,
        winRateBasisPoints: 0,
        closedThisPeriod: 0,
        acquisitionSpendCents: 789,
      },
    ),
  );
  check("ui-agent-state", () => {
    const agent = new Crm(store, { ...principal, kind: "agent" });
    const observed = agent.query(pkg.appId, 1, hash, "getLead", {
      leadId: lead.id,
    });
    assert.deepEqual(observed, lead);
    agent.action(
      pkg.appId,
      1,
      hash,
      "updateStage",
      { leadId: lead.id, expectedRevision: lead.revision, stage: "Won" },
      "agent",
    );
    assert.equal(
      crm.query(pkg.appId, 1, hash, "getLead", { leadId: lead.id }).stage,
      "Won",
    );
  });
  check("owner-isolation", () => {
    const foreign = new Crm(store, {
      ...principal,
      ownerId: "foreign-fixture",
    });
    assert.throws(
      () => foreign.query(pkg.appId, 1, hash, "listLeads", {}),
      /APP_UNAVAILABLE/,
    );
    assert.deepEqual(
      store.session({ ...principal, ownerId: "foreign-fixture" }).list(),
      [],
    );
  });
  check("effects-denied", () =>
    assert.throws(
      () => crm.action(pkg.appId, 1, hash, "sendEmail", {}, "send"),
      /APP_UNAVAILABLE/,
    ),
  );
  check("migration-compatibility", () =>
    assert.deepEqual(pkg.migration, {
      kind: "identity",
      fromSchema: 1,
      toSchema: 1,
    }),
  );
} catch {
  checks.push({ id: "runtime-start", result: "FAIL" });
} finally {
  store.close();
  checks.push({ id: "cleanup", result: "PASS" });
}
process.stdout.write(JSON.stringify({ checks }));
