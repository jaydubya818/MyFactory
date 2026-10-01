# Productive → completion qualification

Attempt 5 is preserved as a failed live qualification. It created quantity.mjs and passed 11 local tests, then requested a third productive continuation. Both productive slots were already consumed. The local gateway returned 409 LOCAL_ADMISSION_DENIED; the reserved completion operation was never reached. No extra live operation, retry, historical Work mutation or candidate commit was made during this repair.

## Root cause and repair

The harness required an ordinary successful Codex turn before starting its separately reserved completion process. Installed Codex asks for another model continuation after the last local tool result, even when the implementation and tests are complete. The productive limit prevented that turn from ending, so completion was unreachable. The pre-repair regression reproduced the local denial twice.

At the next request after productive slots are exhausted, the exact-binding gateway checks settled/current authority and signals a host-owned productive boundary. It does not forward the request, reserve another operation, fabricate a model response or admit completion. The adapter returns `yielded`, not model success, and terminates/reaps its process group. Owner cancellation takes precedence.

The trusted job manager requires a quiescent process, unchanged approved base, nonempty allowed changes and valid modes. It stages an immutable tree through a temporary index without committing or moving HEAD, and checks that tree with pinned commands in the existing offline, read-only Docker verifier. Failed or unavailable checks deny completion. It rechecks the workspace tree, then the existing ledger atomically admits completion only for the exact active binding with settled operations and no prior completion. UNKNOWN, stale generation, fenced writer and cancellation remain closed.

Completion uses a new child credential, a read-only executor and bounded candidate context. Tools are forbidden; completion cannot edit or reopen productive capacity. Only after successful, accounted completion does the host deterministically commit the exact tree that passed eligibility checks. A changed tree denies commit. This is a local candidate commit, not publication or acceptance. Post-commit Factory checks, signed custody, Gate C and MyEve's independent protected verification still run separately.

## Qualification

The installed CLI replay uses Attempt 5's two-response structure: response 1 edits quantity.mjs; response 2 invokes node --test; the next request yields to host checks without an upstream call. The complete connected fixture passes 24 checks through signed custody, independent protected verification, canonical Result/Proof and synthetic final Sofie explanation. It asserts host closure precedes completion, completion occurs once, and the finalized tree equals the checked tree.

Exact primary journey: Sofie 1 → Factory productive 1 → Factory productive 2 → Factory completion 1 → final Sofie. Total 5; productive 2/2; completion 1/1. Reserve $0.336864 remains protected. Only quantity.mjs changes. Separate negative/safety fixtures do not expand the live envelope.

Negative coverage: no changes, out-of-scope changes, failed checks, UNKNOWN, stale generation, fenced writer, duplicate completion, exhausted incomplete work, completion failure and mutation during completion. No failure reopens productive authority or resets a budget. Attempts 1–4 response normalization, admission, model identity, capacity, 503/UNKNOWN/no-retry and custody regressions remain qualified.

The controlled Result/Proof are honestly PARTIAL, with every objective criterion PASS: publication, CI, review and owner acceptance remain unestablished. Complete offline journey PASS does not claim live success. No additional real model operations were made.

Factory full suite: 169 passed, one gated installed-CLI case separately passed. MyEve: 144 root tests; 1979 application tests, 94 environment-gated skipped. Affected types, governance and builds passed. The broader builder workspace has a pre-existing unrelated manifest omission for connection-reporting.md; it was preserved, not folded into this repair.

## Historical preservation and limits

Attempts 1–5 database rows match preserved snapshots. Attempt 5 Factory rows and 40 evidence files match, and its original quantity.mjs remains unchanged and uncommitted. Its envelope is not reusable.

No retry, fallback, operation increase, spend increase, new candidate attempt or publication capability was added. Real-provider variation remains unqualified until a separately authorized fresh Work. A productive boundary is eligibility for host inspection, not proof of correctness or model authority. Completion/check failure stops honestly. Source identity is recorded in connected-final.json; deployment and the fresh paused Work are recorded separately after integration.
