# Evidence provider extension

Status: **PARTIAL local implementation**. This successor branch does not change the frozen private-alpha producer receipt or MyEve Proof schema.

## Types and custody

`packages/verification/src/evidence.ts` defines the seven evidence kinds: `TestEvidence`, `ScreenshotEvidence`, `VideoEvidence`, `BrowserJourneyEvidence`, `AccessibilityEvidence`, `PerformanceEvidence`, and `DiffEvidence`. A record binds WorkOrder, Run, candidate commit, FactoryVersion, media type, source, byte count, and SHA-256. Its file and metadata sidecar live in the persistent Factory data directory under `evidence/<runId>/`, outside the temporary task worktree. The store writes files with owner-only permissions and durable file sync. A stable `factory-evidence:sha256:...` reference is suitable for a future consumer Proof record once its bytes have been independently transported and checked.

The supervisor now collects `TestEvidence` from the protected command results and `DiffEvidence` from the committed candidate diff. It records references in `run.evidence_collected`, then reopens the durable files and checks their hashes, metadata, candidate binding, and required kinds before `ready_for_review`. The collection event is **not** a PASS judgment. Existing command status checks still decide whether required tests passed. The Factory receipt remains `MYFACTORY_RESULT_V1`, containing its existing signed candidate and check logs. These additional evidence records are not falsely described as signed Result artifacts or as MyEve Proof.

## Browser collection

`collectBrowserEvidence` uses pinned Playwright Chromium against an explicit loopback preview and produces a bounded viewport PNG plus JSON journey. It rejects public, credentialed, or query-bearing preview URLs, blocks cross-origin requests, limits viewport, assertions, and timeouts, and does not create video by default. `evaluateEvidence` checks byte integrity and rejects a browser journey with failed text assertions or an unsuccessful HTTP status. `SATISFIED` means required evidence is present and internally consistent; it does not mean the UI matches a product specification.

**Candidate preview is not yet qualified.** The browser collector accepts a local URL; no current production path proves that this URL serves the exact committed candidate. Therefore UI evidence is not used to assert candidate verification or Ready. A future FactoryVersion/verification policy can require `ScreenshotEvidence` and `BrowserJourneyEvidence` only after a trusted preview launcher exports the exact candidate, starts it within a bounded environment, and binds the preview to the attempt. `VideoEvidence` should be requested only when motion or temporal behavior is part of the acceptance criteria. Accessibility and performance providers likewise need explicit acceptance thresholds and independent interpretation.

## Proof handoff and transport gap

MyEve owns Proof and independent protected verification. It must store received evidence outside ephemeral producer environments, verify candidate/FactoryVersion/hash binding, evaluate policy against acceptance criteria, and cite the `factory-evidence:sha256:...` references in Proof. It must not infer PASS from Factory collection or from this package's structural `SATISFIED` result.

The connected artifact-return endpoint was **not added**. Automatic approval review rejected the proposed endpoint because it would export candidate diffs and verification files through the connected API. A narrow authorized transport contract, including recipient scope, byte limits, retention, and sensitivity handling, is required before MyEve can resolve these references. Until then, Proof integration and UI evidence policy enforcement are **not complete**.

## Local qualification

On this branch, `npm test` passed **176 tests**, failed 0, skipped 9; the verification workspace includes the real Chromium fixture. `npm run typecheck:producer`, `npm run check:producer-governance`, and `npm run build` passed. The focused browser fixture exercises persistent readback, tamper detection, candidate mismatch, bounded screenshot/browser collection, optional video, failed text assertions, and URL restrictions. No live provider or MyEve Proof qualification was run.
