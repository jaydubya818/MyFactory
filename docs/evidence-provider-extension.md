# Evidence provider extension

Status: **Factory transport locally qualified; MyEve Proof integration pending.** This successor branch does not change the frozen private-alpha producer receipt or MyEve Proof schema.

## Types and custody

`packages/verification/src/evidence.ts` defines the seven evidence kinds: `TestEvidence`, `ScreenshotEvidence`, `VideoEvidence`, `BrowserJourneyEvidence`, `AccessibilityEvidence`, `PerformanceEvidence`, and `DiffEvidence`. A record binds WorkOrder, Run, candidate commit, FactoryVersion, media type, source, byte count, and SHA-256. Its file and metadata sidecar live in the persistent Factory data directory under `evidence/<runId>/`, outside the temporary task worktree. The store writes files with owner-only permissions and durable file sync. A stable `factory-evidence:sha256:...` reference is suitable for a future consumer Proof record once its bytes have been independently transported and checked.

The supervisor now collects `TestEvidence` from the protected command results and `DiffEvidence` from the committed candidate diff. It records references in `run.evidence_collected`, then reopens the durable files and checks their hashes, metadata, candidate binding, and required kinds before `ready_for_review`. The collection event is **not** a PASS judgment. Existing command status checks still decide whether required tests passed. The Factory receipt remains `MYFACTORY_RESULT_V1`, containing its existing signed candidate and check logs. These additional evidence records are not falsely described as signed Result artifacts or as MyEve Proof.

## Browser collection

`collectBrowserEvidence` uses pinned Playwright Chromium against an explicit loopback preview and produces a bounded viewport PNG plus JSON journey. It rejects public, credentialed, or query-bearing preview URLs, blocks cross-origin requests, limits viewport, assertions, and timeouts, and does not create video by default. `evaluateEvidence` checks byte integrity and rejects a browser journey with failed text assertions or an unsuccessful HTTP status. `SATISFIED` means required evidence is present and internally consistent; it does not mean the UI matches a product specification.

The narrow `CandidatePreviewProvider` reads and hashes regular static files from the exact Git commit, serves them on an ephemeral loopback server, binds WorkOrder/Run/commit/tree, and closes after capture. It never installs packages or executes candidate commands. A mutable working tree cannot replace the served candidate. The supervisor accepts a preview lease only from this trusted provider; an arbitrary developer-provided localhost URL cannot satisfy the UI evidence policy. This qualifies static UI fixtures. Dynamic applications still need a qualified candidate environment. The `browser` worker profile remains held at admission; this branch does not enable general browser execution. `VideoEvidence` is required only for acceptance criteria involving temporal behavior. Accessibility and performance providers still need explicit thresholds and independent interpretation.

## Bounded transport and Proof handoff

MyEve owns Proof and independent protected verification. The Factory server exposes **POST `/api/connect/v1/evidence/read`** to a backend client explicitly configured with `purpose: "myeve-proof"`, `ownerScope`, `expiresAt`, and `evidence.read`. Preparation records the owner scope beside the exact Work. Historical Work without this owner binding is not eligible for this transport. Removing the connection or passing its expiry revokes reads.

The request must specify owner scope, repository, Work ID/generation, request ID, WorkOrder, Run, candidate commit, FactoryVersion, canonical `factory-evidence:sha256:...` reference, expected SHA-256, and evidence kind. Extra fields, paths, arbitrary IDs, and listing requests are rejected. The server resolves the reference only from the candidate's durable event, verifies its signed terminal Result and exact binding, then reopens one artifact with a per-kind limit. The response includes one bounded base64 payload and metadata **without its internal storage path**. `FactoryClient.readEvidence` independently checks scope, kind, binding, size, canonical base64, and SHA-256 before returning bytes to its caller. The endpoint is not a public/browser URL and responses use `Cache-Control: no-store`.

| Kind | Maximum bytes |
| --- | ---: |
| TestEvidence | 512 KiB |
| DiffEvidence | 4 MiB |
| ScreenshotEvidence | 2 MiB |
| BrowserJourneyEvidence | 256 KiB |
| AccessibilityEvidence | 512 KiB |
| PerformanceEvidence | 256 KiB |
| VideoEvidence | 8 MiB |

Evidence remains in the persistent Factory data directory after the producer worktree is removed. There is **no automatic evidence deletion** in this version. An explicit future retention/deletion workflow must preserve retained Proof references or mark them unavailable; filesystem deletion cannot be reported as valid retained evidence. If the signed receipt is not yet durable, transport returns `waiting_for_evidence` while leaving the candidate untouched. The MyEve owner must map this to a canonical waiting state and must not rerun the producer merely because transport is temporarily unavailable.

MyEve must durably retain received bytes, verify the binding again from its own Work and signed Result, evaluate them against acceptance criteria, and cite the stable references in Proof. It must not infer PASS from Factory collection, transport success, or structural `SATISFIED`. The [read-only consumer handoff](evidence-provider-consumer-handoff.md) identifies the protected integration points and owner UX. No MyEve worktree was edited here.

## Local qualification

Local tests include exact-reference authenticated transport with wrong owner, repository, Work, WorkOrder, Run, candidate, FactoryVersion, reference, digest, kind, token, expiry, revocation, path injection, and enumeration attempts. They also cover per-kind byte ceilings, restart readback, and a static UI candidate whose working tree is changed after commit. No live provider call, external deployment, MyEve Proof admission, or paid operation was run. See the [qualification report](evidence/evidence-provider-transport/REPORT.md) for counts and remaining gates.
