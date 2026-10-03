# Evidence provider transport qualification

Candidate branch: `codex/evidence-providers`, successor to checkpoint `8c9defd4e5315aa7f26f267b7b4c31e11ec19321`. This report describes local/synthetic qualification only. Frozen producer/private-alpha branches and MyEve were not modified.

| Gate | Result | Evidence and limit |
| --- | --- | --- |
| EvidenceProvider | PARTIAL | Seven typed kinds, durable custody, per-kind limits, static UI collector; MyEve Proof admission pending. |
| Factory durable custody | PASS | Candidate-bound bytes and metadata survive readback and supervisor restart; no automatic deletion. |
| Transport authentication | PASS | Backend bearer token, `myeve-proof` purpose, owner scope, expiry, revocation, repository check. |
| Work/Run/candidate binding | PASS | Exact Work ID/generation, request, WorkOrder, Run, commit and FactoryVersion checked before one reference resolves. |
| Digest verification | PASS | Factory bounded read and independent `FactoryClient` SHA-256/size/base64 check; changed bytes denied. |
| Size limits | PASS | Individual cap for each of seven kinds; oversized TestEvidence transport denied. |
| Retention | PASS (Factory) | Persistent data directory, restart readback, no implicit cleanup with task worktree. Consumer Proof retention remains pending. |
| Cross-owner isolation | PASS (fixture) | Wrong owner token/scope cannot read or list another owner's Work. |
| Cross-Work isolation | PASS (fixture) | Wrong Work, generation, WorkOrder or Run denied. |
| MyEve Proof readback | NOT_RUN | Protected MyEve worktree was not edited; read-only handoff supplied. |
| CandidatePreviewProvider | PARTIAL | Exact static Git commit/tree preview passes; dynamic application environment not implemented. |
| ScreenshotEvidence E2E | NOT_RUN | Exact static candidate → Playwright → durable custody passes locally; MyEve transport/Proof leg not run. |
| BrowserJourneyEvidence E2E | NOT_RUN | Exact static candidate → Playwright assertions → durable custody passes locally; MyEve transport/Proof leg not run. |
| TestEvidence E2E | PASS (local Factory client) | Candidate → protected checks → durable custody → authenticated exact transport → independent client byte verification. MyEve Proof pending. |
| DiffEvidence E2E | PASS (local Factory client) | Candidate → exact diff → durable custody → authenticated exact transport → independent client byte verification. MyEve Proof pending. |

Required safety counts in local fixtures: unauthorized disclosures **0**; candidate mutations **0**; publication effects **0**; paid model operations **0**. The static preview fixture deliberately changes the working tree after committing Candidate A and confirms that Playwright still sees Candidate A; this does not mutate the candidate commit.

Full `npm test`: **179 passed, 0 failed, 9 skipped**. The affected transport test passed again after adding supervisor-restart readback. `npm run typecheck:producer`, `npm run check:producer-governance` (24 reviewed runtime sources, unknown 0), `npm run build`, and `git diff --check` passed. No live provider was contacted.

Release gate: **PARTIAL**. The sole MyEve consumer owner must complete durable Proof admission and both end-to-end journeys against the canonical MyEve protected verifier. Dynamic UI Work needs a qualified candidate application environment before its visual evidence can satisfy policy. This branch does not enable browser worker admission, publication, deployment, paid execution or cloud admission.
