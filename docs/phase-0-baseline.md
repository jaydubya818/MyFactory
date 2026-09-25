# Phase 0 baseline

**Status (2026-09-24, America/Los_Angeles):** The disposable local defect was reproduced, fixed by a headless coding agent, committed by the supervisor exercise, and verified independently on the host and in a restricted Docker container. Phase 0 remains open for a user-selected GitHub repository, dry-run triage calibration, and a full agent execution boundary decision. The fixture is a technical qualification case, not a SellerFi product change.

## Defect and input

The [fixture](../evals/phase-0-defect/README.md) represents a buyer-facing financial display defect: reported annual revenue of `0` appears as `Not provided`. Its source copy remains intentionally broken. A copied, disposable Git repository at `/private/tmp/sellerfi-factory-phase0.ccFLYb` began at commit `840d62f0e4598dda262274b7fa7a1d07f8a05595` with no remote. The pre-change `npm test` result was **2 passed, 1 failed**; the zero case expected `$0` and received `Not provided` ([reproduction log](evidence/phase-0/reproduction.log.txt)).

## Agent run and candidate

The successful invocation was:

```sh
codex exec -m gpt-5.5 -C /private/tmp/sellerfi-factory-phase0.ccFLYb \
  --sandbox workspace-write --json \
  -o /private/tmp/sellerfi-factory-phase0-final.txt \
  'Reproduce the annual revenue display defect with npm test. Implement the smallest source-code correction so 0 formats as $0 while missing values remain Not provided and positive values remain correct. Run npm test after the change. Do not commit, push, or touch files outside this repository. Report the failing test before, the final test result, and changed files.' \
  </dev/null
```

Codex CLI `0.153.3` used the Mac host with its own `workspace-write` command sandbox. The event stream ([JSONL](evidence/phase-0/codex-events.jsonl)) records a failing test before the edit, a single source-file edit, and 3 passing tests afterward. The edit changes `if (!annualRevenue)` to `if (annualRevenue == null)` ([patch](evidence/phase-0/candidate.patch)). No test, package, or other source file changed. The CLI reported 200,446 input tokens, of which 173,440 were cached, and 2,208 output tokens. Startup to final log was approximately 53 seconds; the invocation did not capture a precise monotonic duration.

Two earlier preflight invocations exited before making edits. The desktop-configured `gpt-6-sol` and an explicit `gpt-5.3-codex` were both rejected by this CLI's ChatGPT-account route with HTTP 400. The working `gpt-5.5` override is therefore an environment-specific fact to check in adapter preflight; a successful `codex login status` alone is insufficient. The host-installed nine Factory skill files matched the reviewed upstream commit at inspection time ([hashes](evidence/phase-0/installed-skill-hashes.txt)); the pinned copy and its full manifest are under [skills/vendor/builderio](../skills/vendor/builderio/README.md).

After validating the changed path and `git diff --check`, the local supervisor exercise created candidate commit `6f1bd46b71f1e158d29a47702f5a5ed7aebe463c` (tree `9bab694e8a8bb677fc2b489d22b943144c654739`). The complete two-commit fixture history is preserved as a [Git bundle](evidence/phase-0/fixture-history.bundle).

## Independent verification

The host ran `npm test` against the candidate commit: **3 passed, 0 failed** ([host log](evidence/phase-0/host-verification.log.txt)). The candidate commit was also exported with `git archive` into a clean directory containing no `.git` metadata. Docker ran the same `npm test` using cached `node:22-bookworm` with a read-only project mount, no network, no extra capabilities, `no-new-privileges`, 1 CPU, 512 MiB RAM, and a 128-process limit: **3 passed, 0 failed** ([container log](evidence/phase-0/container-verification.log.txt)). No model or GitHub credential was mounted into that container.

The Docker check qualifies isolated **verification** of this portable fixture. It does not qualify Codex authentication or implementation inside Docker. The Mac host run is a separate worker profile with a different trust boundary.

The integrated supervisor was then exercised with the same defective fixture and a **simulated coding step**. Its baseline Docker check failed with the expected defect text; after the simulated one-line edit, the supervisor created candidate `7d8afa379d233f650302b879d68a5e879f3bf0d0` and the exact candidate passed `npm test` in Docker. The persisted Run and WorkOrder reached `ready_for_review` ([integration smoke evidence](evidence/integration-smoke/README.md)). This checks orchestration without claiming a second real Codex run.

## Current environment and remaining gates

Git `2.48.1`, Node `24.18.1`, npm `11.16.0`, Docker Desktop `29.7.2`, Codex CLI `0.153.3`, Claude Code `2.1.278`, and GitHub CLI `2.86.0` are installed. Docker daemon and GitHub CLI access work in an allowed host execution context. `gh auth status` confirmed account `jaydubya818`; default sandbox checks could not access its keyring. This does not prove permission for a yet-unknown target repository. Claude Code is installed but not authenticated, so Codex is the initial adapter candidate.

1. The product owner will provide a disposable GitHub repository and issue. Record its base branch, expected behavior, permitted files, and required checks before running against it.
2. Run Factory configuration/read-only collection for that actual source, then calibrate selected, held, and rejected cases. No schedule or public reply is enabled.
3. Decide whether the first implementation profile uses host Codex command sandbox plus container verification, or supplies a separate credential to a containerized Codex worker. Display the profile and its access honestly.
4. Qualify the implemented supervisor/UI against that repository, then add scoped publication approval and remote reconciliation. Restart recovery currently holds retries when an orphaned host worker cannot be proven gone; it does not automatically signal an unverified process group.

Phase 0's **local fixture exercise** passed. Its **target-repository and triage gate** remains open; the draft PR milestone has not occurred.
