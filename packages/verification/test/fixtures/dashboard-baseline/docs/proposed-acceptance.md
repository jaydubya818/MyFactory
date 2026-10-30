# Proposed dashboard acceptance specification

Status: **PROPOSED — NOT APPROVED FOR RELEASE QUALIFICATION**.
Owner: release coordinator. Approval owner: independent verifier or authorized
acceptance custodian, currently unconfirmed. This document contains proposed
observable behavior only. It contains no protected holdout test material.

Target: a React/TypeScript dashboard that displays GitHub repository health and
failing CI pipelines. The immutable baseline commit is recorded externally in
the MyEve release manifest. Development starts from that exact commit.

| ID | Proposed observable acceptance condition |
| --- | --- |
| D01 | Show the selected authorized repository, default branch, latest observed commit and observation time. Summarize health from available CI evidence; distinguish failing, pending, passing and unknown. Missing or inaccessible data never becomes healthy. |
| D02 | Identify failing CI pipelines and their workflow, branch, commit, conclusion and authenticated GitHub details link. Distinguish completed failure from running, queued, cancelled, skipped and no CI data. |
| D03 | Show recent workflow runs with timestamps, statuses and navigation to authorized GitHub run details. Explicitly disclose the observation window and pagination limit. |
| D04 | Show deployment status and environment when the authorized GitHub deployment data is available. Missing permissions, no deployments and unsupported hosting observation are distinct states. No deployment is initiated. |
| D05 | Provide initial loading, empty, partial data, access denied, rate limited, offline and request failure states. Retain observation timestamps; label retained data stale after a refresh fails. A user retry cannot start Work or paid execution. |
| D06 | Work at 375px mobile and 1280px desktop widths without horizontal page overflow. Use semantic landmarks, keyboard navigation, visible focus and readable status text independent of color. WCAG 2.2 AA is the proposed accessibility target; automated scans alone do not establish compliance. |
| D07 | Retrieve data only through the approved owner-scoped Relay/GitHub authorization path. Preserve existing repository permissions; deny cross-owner repository substitution and revoked access. Keep all credentials server-side; never embed tokens in browser code, browser storage, URLs, logs or build artifacts. |
| D08 | Include deterministic automated behavior and browser tests for health classification, filtering, partial failures, stale request races, denied access and desktop/mobile rendering. Tests use separate synthetic data and make no paid calls. |
| D09 | Produce an actual build from the exact final source with locked dependencies, test output, source/tree/lock identities and artifact SHA-256 inventory. An independent verifier must validate exact bytes and separately protect its acceptance cases before release qualification. An unsigned inventory never substitutes for signed Result/Proof. |
| D10 | Qualify the full Sofie → planning/agents → authorized Relay reads → source/build/tests → independent verification → signed Result/Proof → MyApps delivery journey, including interruption/reconnect, under separately approved Work authority. Demonstrate authenticated owner isolation and reversible installation/rollback. Synthetic tests and direct coordinator coding do not satisfy this condition. |

Before qualification, the verifier/custodian must approve the exact version and
digest, establish its protected acceptance location and execution authority, and
bind the accepted criteria to the exact repository/base/source tuple. Protected
holdouts must remain outside this repository and coding-agent context. No coding
agent may approve, replace, waive or self-certify those protected cases.

The repository baseline, this proposal and its smoke CI grant no paid Work,
production deployment, tester allowance change, protected custody access or
tester activation. Existing release holds remain effective.
