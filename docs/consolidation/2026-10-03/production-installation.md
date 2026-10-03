# Production installation foundation

The production installation is separate from qualification. It admits no Work and does not claim real-model readiness. Existing Cloud lifecycle, harness, custody, verifier and Result code remain canonical; the qualification grant, deterministic model, pricing and protected fixture policy are not production defaults.

Exact installation: Factory project `prj_4hfceCN8l6wN1gUyYOzZLQ7aJapK`, caller Sofie project `prj_L6faw25wnFGUZtrLKBIccg8gIDLR`, team `team_p8z8exJRTGfOPk1GC9vUOpv3`, Production → Production only. Fresh database resource `dry-morning-22844424` / `store_vUOtU0sIkDLU6TY4`; private custody `store_qBuivS8MmRxnBNnU`; iad1.

Readiness requires exact installation/owner binding and separate application/proof credentials. Every Blob/Sandbox probe obtains a fresh OIDC token, checks production project/team/environment/expiry, and passes it explicitly to the SDK. Provider signature checks remain authoritative. No ambient static-token fallback can mark a different resource ready. `platformReady` reports observed dependencies; `ready` stays false and `executionAdmission` stays DISABLED.

All production preparation/dispatch calls deny before database/provider access. Action discovery advertises no writer controls. A production execution contract is still required before the first paid canary can be prepared as executable. Source/materialization, current pricing, provider transport, bounded objective, implementation checkpoints and protected policy must be explicitly bound while reusing the existing harness. No paid calls or generated publication effects are authorized here.

## Explicit database installation

Migration007 is required solely for the production installation marker. EvidenceProvider still introduces no Factory migration. All001–006 bytes are preserved. Existing staging rows cannot be promoted. The operator initializer checks all application tables under locks and rejects cross-owner/resource rebinding.

`node apps/cloud-control/scripts/prepare-production-installation.mjs --owner REAL_OWNER_ID > reviewed-installation.sql` generates reviewable SQL without connecting to a database. Execute that plan only as an explicit operator action in the authenticated console of the exact new resource after confirming database `neondb`, no Factory schema and zero application tables. The single transaction applies the seven immutable files, records checksums and sets the exact production marker. Any existing application table or Factory schema causes rejection before mutation. Repeating the plan is rejected; subsequent operations must reconcile the checksum ledger explicitly.

Automatic approval rejected a proposed persistent build-time migration trigger. It was not applied. No build, request or deployment hook runs installation SQL.

Disposable verified-TLS qualification passed both initializer and exact generated SQL, including populated-schema refusal, repeated application refusal, owner literal escaping and zero Work rows. Source governance and full producer types pass. Independent read-only review of the identity/readiness/control foundation passed22 checks after fixes to credential identity and rewrite compatibility. Production execution and canary remain NOT_READY; production trust and live deployment verification remain pending.
