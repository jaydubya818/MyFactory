# Producer startup status qualification

An owner-scoped CLOUD status read could report `UNKNOWN` while the original producer allocation still held a live lease. The durable allocation intent starts with `allocation_unknown=true` until its provider receipt arrives. Only the model-free validation client previously applied the lease-aware progress projection; paid and alpha clients treated that initial flag as a failure. The owner controller consequently fenced a valid in-progress allocation before source preparation.

All CLOUD clients now use the same lease-aware projection for allocation and producer-to-verifier handoff. Read and Result status agree. Expired leases, cancellation, recorded failures, unknown cleanup, mismatched custody/verifier bindings, ambiguous delivery, and unknown paid operations remain fenced. No allocation, dispatch, fallback, retry, authority, or accounting limit is added by this change.

Fixed startup-stage evidence distinguishes allocation, sandbox readiness, harness installation, source materialization, model transport initialization, harness startup, and the model gateway boundary. These observations never substitute for the durable operation ledger: reaching a gateway is not proof of provider dispatch or settlement.

`producer-startup-qualification.mjs` is an operator-only diagnostic, with no HTTP/queue entrypoint. It uses the production image, provider, source fixture, harness installer and worker entrypoint. It stops at the first loopback mailbox request and destroys the sandbox without constructing a SpendGateway, creating Work authority, calling a model, generating a candidate, or publishing anything. It verifies startup to the pre-dispatch boundary, not permission to execute a production Work.

Qualification covers the original allocation state in real disposable PostgreSQL, concurrent observations, no second claim, expiry fencing, owner isolation, paid ambiguity accounting, failure-stage teardown, and audit failure during uncertain-allocation cleanup. An uncertain allocation waits for the original deadline plus grace before absence can be claimed. An early 404 is insufficient.

Live zero-paid qualification reached the first pinned-model request and independently verified teardown. Historical production evidence and exact operational identities remain private. The original failed paid journey is preserved as failed; this repair does not qualify Result/Proof completion or external-alpha readiness.

A separately approved successor envelope may authorize one additional alpha-A intake after a preserved, cancelled, fully cleaned-up predecessor with zero Factory model operations. The exception names both Works and the exact historical receipt/grant digests. It does not raise the global limit, remove history, admit another owner, or grant execution by itself. PostgreSQL serialization preserves one new receipt under concurrent calls, exact replay, revocation and expiry.
