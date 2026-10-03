# Read-only MyEve Proof integration handoff

This document is for the sole MyEve consumer owner. No MyEve source or protected worktree was changed in this producer task.

## Exact Factory contract

1. Configure the Factory preparation connection with `ownerScope` equal to the MyEve Work principal scope ID. This writes `factory.owner_scope_bound` atomically beside the prepared Work. Historical attempts without the binding cannot use the new evidence transport.
2. Configure a separate backend-only connection with `purpose: "myeve-proof"`, `ownerScope`, an explicit short `expiresAt`, repository scope, and only `evidence.read`. Store its bearer token in the existing server credential boundary, never browser code. Removal of the connection revokes reads immediately.
3. From the authorized WorkOrder detail, read the sanitized `run.evidence_collected` references for the exact Run. The Proof connection sees only WorkOrders in its owner scope. The event reveals reference, type, digest, candidate, FactoryVersion and Work/Run IDs, without a storage path or bytes.
4. POST one reference at a time to `/api/connect/v1/evidence/read`. Supply exact `ownerScope`, repository slug, `workId`, `workGeneration`, `requestId`, `workOrderId`, `runId`, `candidateCommit`, `factoryVersion`, `evidenceReference`, `expectedDigest`, and `evidenceKind`. The response has exact scope, metadata, canonical base64 bytes and no internal path. `FactoryClient.readEvidence` independently checks these fields and SHA-256/size before returning bytes.
5. Copy bytes into MyEve's durable evidence custody, then verify again against the retained Work, signed Factory Result, candidate, FactoryVersion, criterion and MyEve protected verification policy. Attach `factory-evidence:sha256:...` to Proof `artifactRefs` only after that custody succeeds. The reference identifies evidence; it is not an authority grant or PASS outcome.

The current MyEve protected implementation has `ProofOfWork.artifactRefs` and criterion-level `evidence` in `apps/eve/lib/digital-worker/contracts.ts`; `apps/eve/lib/engineering/native-results.ts` retains signed Proof after protected verification; and `apps/eve/lib/engineering/factory-live-adapter.ts` owns the exact Factory connection. The MyEve owner should integrate through these canonical paths, preserving its existing signed Result and protected verification gates. Default owner UI should show implementation checks, independent verification, and availability of visual evidence. Advanced inspection may show kind, digest, candidate and provenance. Raw files should appear only in an authorized Proof view.

`waiting_for_evidence` (HTTP 409) means the candidate remains in custody while the signed receipt is not yet durable. Network failure or temporary Factory unavailability after candidate custody should map to MyEve's canonical waiting state. Do not rerun a producer attempt or mark the Work Failed solely for missing transport. An integrity mismatch must fail closed and require investigation. Neither case authorizes publication, deployment, a new writer, or a paid model operation.

## Qualification status

MyFactory's local fixture covers exact non-UI Test/Diff evidence from candidate through durable custody, authenticated transport, independent client digest checks and a Proof-shaped reference. A separate static Git candidate fixture covers exact candidate/tree preview through Playwright Screenshot/BrowserJourney collection and durable custody. **Actual MyEve Proof storage/readback is not qualified in this branch.** The MyEve owner must add consumer tests for both journeys and retained Proof after Factory worktree cleanup before calling the end-to-end gate PASS.

## Consolidation successor (2026-10-03)

The assembled MyEve consumer now implements durable Test/Diff custody, signed-content checks, exact Proof references and authenticated owner/shared-Result readback. Local real-transport E2E and independent review PASS; hosted assembled-source qualification is pending. Cloud uses the accepted metadata/reference contract over existing private candidate custody, with an independent expiring read credential and durable owner event. This adds no Factory SQL migration. See the consolidation report for current release gates; preceding handoff status is historical.
