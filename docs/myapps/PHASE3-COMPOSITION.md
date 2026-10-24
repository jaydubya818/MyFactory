# MyApps production composition readiness — inactive preparation

Accepted Phase 2: `0e22176fbeaaeca54f268af6e1b8b00cf9fe528b`.
Canonical main: `030b1a51017f3159436b93817ed2d5bf6ae18288` (ancestor of Phase 2).
External-alpha private-source base: `2eb5f04f5824dc6957d0732fc7abf35a4d831537`.
External-alpha engineering: `fa48a820ba185eb9b891130c78166463b61cba74` (draft PR #12).

Source-level composition of the engineering snapshot and Phase 2 is textually clean. This does not make the production execution profiles interchangeable. MyApps uses the deterministic declarative controller, an injected exact Work admission callback, credential-free candidate custody, a separate verifier process and signed Result projection. External alpha has a distinct host installation, source registry, private custody, authority consumer, shared accounting and protected verifier. No existing installation or signer can be silently reused.

The MyEve Phase 3 rehearsal script composes these exact snapshots into a disposable detached source snapshot. It records both inputs, the Git tree and parentless snapshot commit. It never merges a branch, updates a release ref, installs a policy or deploys. The full composition plan and pinned manifest live under MyEve `docs/myapps/phase3/`.

Any integrated Factory source produces a new FactoryVersion. Its source digest, exact execution configuration, verifier image/profile, runtime byte binding, source registry, custody and Result key identities must be recomputed and separately approved. The deterministic `referenceConfiguration` is not a production profile. Historical Results retain their original source/configuration/version and must remain verifiable; never relabel them under the new version.

No Factory migrations are introduced by MyApps. If a future release adopts the separate engineering source, its additive host/authority/custody migrations must be reviewed and ordered using that release's canonical manifest. Existing alpha/canary registration and accounting records must not be mutated by a MyApps rollout. There is no authorization to apply any of these migrations now.

Production composition remains NOT_READY: native MyApps production binding, bounded production admission/accounting, remote candidate/proof transport, secret/custody provisioning, deployment target identity and operational qualification are absent. Active external-alpha QE remediation is a separate release hold. Its uncommitted changes are excluded from this reproducible rehearsal.

Paid model operations: 0. Publication: DISABLED. Executable production grants: 0. Production integration: NOT_RUN. External-alpha installation impact: NONE.
