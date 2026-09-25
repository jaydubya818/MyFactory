import assert from "node:assert/strict";
import test from "node:test";
import { PublicationAdapterError, publishDraftPullRequest } from "../src/github.ts";

const inputCommit = "a".repeat(40);
const candidateCommit = "b".repeat(40);
const workOrderId = "11111111-2222-4333-8444-555555555555";
const branch = `codex/factory/wo-${workOrderId}`;
const destination = "acme/widget";
const input = {
  destination, workOrderId, workspacePath: "/tmp/factory-task-worktree",
  inputCommit, candidateCommit, baseBranch: "main",
  title: "Fix duplicate feedback submissions",
  body: "Reviewed candidate and verification evidence.",
};

function success(body) {
  return { exitCode: 0, stdout: typeof body === "string" ? body : JSON.stringify(body), stderr: "" };
}

function failure(message = "gh: Not Found (HTTP 404)") {
  return { exitCode: 1, stdout: "", stderr: message };
}

function pullRequest(sha = candidateCommit, overrides = {}) {
  return {
    number: 7,
    html_url: `https://github.com/${destination}/pull/7`,
    state: "open",
    draft: true,
    head: { ref: branch, sha, repo: { full_name: destination } },
    base: { ref: "main" },
    ...overrides,
  };
}

function fakePublisher(options = {}) {
  const state = {
    head: candidateCommit,
    baseSha: inputCommit,
    branchSha: null,
    pull: null,
    pushResponseLost: false,
    createResponseLost: false,
    createAccepted: true,
    ...options,
  };
  const commands = [];
  const runner = async (file, args, commandOptions) => {
    commands.push({ file, args, commandOptions });
    if (file === "git") {
      if (args.includes("rev-parse")) return success(`${state.head}\n`);
      if (args.includes("rev-list")) return success(`${candidateCommit} ${inputCommit}\n`);
      if (args.includes("push")) {
        state.branchSha = candidateCommit;
        return state.pushResponseLost ? failure("network response lost") : success("push succeeded");
      }
    }
    if (file === "gh" && args[0] === "api") {
      const endpoint = args[3];
      if (endpoint === `repos/${destination}`) return success({ full_name: destination });
      if (endpoint === `repos/${destination}/git/ref/heads/main`) {
        return success({ ref: "refs/heads/main", object: { sha: state.baseSha } });
      }
      if (endpoint === `repos/${destination}/git/ref/heads/${branch}`) {
        return state.branchSha
          ? success({ ref: `refs/heads/${branch}`, object: { sha: state.branchSha } })
          : failure();
      }
      if (endpoint === `repos/${destination}/pulls` && args.includes("GET")) {
        return success([[...(state.pull ? [state.pull] : [])]]);
      }
      if (endpoint === `repos/${destination}/pulls` && args.includes("POST")) {
        if (state.createAccepted) state.pull = pullRequest();
        return state.createResponseLost ? failure("network response lost") : success(state.pull);
      }
    }
    throw new Error(`Unexpected command: ${file} ${args.join(" ")}`);
  };
  return { state, commands, runner };
}

function mutations(commands) {
  return commands.filter(({ file, args }) =>
    (file === "git" && args.includes("push")) ||
    (file === "gh" && args.includes("POST")));
}

test("fresh publication pushes only the reviewed commit and creates one draft PR", async () => {
  const fake = fakePublisher();
  const published = await publishDraftPullRequest(input, { runner: fake.runner });
  assert.deepEqual(published, {
    destination, branch, candidateCommit, pullRequestNumber: 7,
    url: `https://github.com/${destination}/pull/7`,
    remoteIdentity: `${destination}#7`, reconciled: false,
  });
  assert.equal(mutations(fake.commands).length, 2);
  const push = fake.commands.find(({ file, args }) => file === "git" && args.includes("push"));
  assert.ok(push.args.includes(`--force-with-lease=refs/heads/${branch}:`));
  assert.ok(push.args.includes(`${candidateCommit}:refs/heads/${branch}`));
  assert.ok(push.args.includes(`https://github.com/${destination}.git`));
  const create = fake.commands.find(({ file, args }) => file === "gh" && args.includes("POST"));
  assert.ok(create.args.includes("draft=true"));
  assert.ok(create.args.includes(`head=acme:${branch}`));
  assert.ok(create.args.includes("base=main"));
});

test("existing exact draft PR reconciles without another remote mutation", async () => {
  const fake = fakePublisher({ branchSha: candidateCommit, pull: pullRequest() });
  const published = await publishDraftPullRequest(input, { runner: fake.runner });
  assert.equal(published.reconciled, true);
  assert.deepEqual(mutations(fake.commands), []);
});

test("unknown prior outcome uses read-only reconciliation and holds a branch without a PR", async () => {
  const fake = fakePublisher({ branchSha: candidateCommit });
  await assert.rejects(() => publishDraftPullRequest(input, {
    runner: fake.runner, reconcileOnly: true,
  }), (error) => error instanceof PublicationAdapterError && error.code === "uncertain");
  assert.deepEqual(mutations(fake.commands), []);

  fake.state.pull = pullRequest();
  const reconciled = await publishDraftPullRequest(input, {
    runner: fake.runner, reconcileOnly: true,
  });
  assert.equal(reconciled.reconciled, true);
  assert.deepEqual(mutations(fake.commands), []);
});

test("read-only reconciliation works after the local workspace is gone or base moves", async () => {
  const fake = fakePublisher({
    head: "c".repeat(40), baseSha: "d".repeat(40),
    branchSha: candidateCommit, pull: pullRequest(),
  });
  const reconciled = await publishDraftPullRequest(input, {
    runner: fake.runner, reconcileOnly: true,
  });
  assert.equal(reconciled.remoteIdentity, `${destination}#7`);
  assert.ok(fake.commands.every(({ file, args }) => file === "gh" && !args.includes("POST")));
});

test("a moved base or occupied WorkOrder branch blocks all mutations", async () => {
  const movedBase = fakePublisher({ baseSha: "c".repeat(40) });
  await assert.rejects(() => publishDraftPullRequest(input, { runner: movedBase.runner }),
    (error) => error.code === "conflict" && /Base branch changed/.test(error.message));
  assert.deepEqual(mutations(movedBase.commands), []);

  const occupied = fakePublisher({ branchSha: "c".repeat(40) });
  await assert.rejects(() => publishDraftPullRequest(input, { runner: occupied.runner }),
    (error) => error.code === "conflict" && /already points/.test(error.message));
  assert.deepEqual(mutations(occupied.commands), []);
});

test("a ready or closed PR cannot be mistaken for the approved draft", async () => {
  for (const pull of [pullRequest(candidateCommit, { draft: false }),
    pullRequest(candidateCommit, { state: "closed" })]) {
    const fake = fakePublisher({ branchSha: candidateCommit, pull });
    await assert.rejects(() => publishDraftPullRequest(input, { runner: fake.runner }),
      (error) => error.code === "conflict");
    assert.deepEqual(mutations(fake.commands), []);
  }
});

test("lost push or PR response is reconciled from exact remote state", async () => {
  const lostPush = fakePublisher({ pushResponseLost: true });
  const publishedAfterPush = await publishDraftPullRequest(input, { runner: lostPush.runner });
  assert.equal(publishedAfterPush.remoteIdentity, `${destination}#7`);
  assert.equal(mutations(lostPush.commands).filter(({ file }) => file === "git").length, 1);

  const lostCreate = fakePublisher({ createResponseLost: true });
  const publishedAfterCreate = await publishDraftPullRequest(input, { runner: lostCreate.runner });
  assert.equal(publishedAfterCreate.reconciled, true);
  assert.equal(mutations(lostCreate.commands).filter(({ file }) => file === "gh").length, 1);
});

test("an unconfirmed create remains uncertain and reconcileOnly never retries it", async () => {
  const fake = fakePublisher({ createResponseLost: true, createAccepted: false });
  await assert.rejects(() => publishDraftPullRequest(input, { runner: fake.runner }),
    (error) => error.code === "uncertain");
  const initialMutations = mutations(fake.commands).length;
  await assert.rejects(() => publishDraftPullRequest(input, {
    runner: fake.runner, reconcileOnly: true,
  }), (error) => error.code === "uncertain");
  assert.equal(mutations(fake.commands).length, initialMutations);
});

test("invalid or changed local candidates never contact GitHub", async () => {
  const invalid = fakePublisher();
  await assert.rejects(() => publishDraftPullRequest({ ...input, destination: "other/repo;bad" },
    { runner: invalid.runner }), (error) => error.code === "invalid_input");
  assert.deepEqual(invalid.commands, []);

  const changed = fakePublisher({ head: "c".repeat(40) });
  await assert.rejects(() => publishDraftPullRequest(input, { runner: changed.runner }),
    (error) => error.code === "conflict");
  assert.ok(changed.commands.every(({ file }) => file === "git"));
});
