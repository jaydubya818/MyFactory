# Independent QE remediation candidate

Based on frozen source `fa48a820ba185eb9b891130c78166463b61cba74`. The companion MyEve remediation starts at UX source `474bd465c2773bf55536b1914045c646deaa644f`.

QE-002 now preserves ten individual criterion outcomes plus an aggregate check. Every check references the SHA-256 of the same full protected report. Missing, duplicate, unknown or contradictory criteria fail closed. The protected report's hidden assertions and private expected values are not exposed in the result manifest.

The verifier policy is a reviewed successor (`alpha-tasks-priority-criterion-evidence-v2`), not a silent reuse of historical FactoryVersion identities. The generic PostgreSQL verification store enforces the successor's exact check order, common report digest and aggregate consistency. The signed result contract adds an optional validated report digest for backward parsing compatibility; acceptance consumers must still require the pinned successor policy and individual criteria.

Local PostgreSQL tests use a strict loopback disposable database and random isolated schemas. Frozen-date unit fixtures reproduce the original valid pricing interval; a separate expiration test verifies present-day refusal after validity ends. The production price record is unchanged and is expired. This branch does not renew pricing, perform paid model calls or claim live producer qualification.

All installed resources, authority, credentials, historical qualification evidence and old FactoryVersions remain unchanged. Deployment is disabled in this repository. The new branch workflow runs unpaid contracts, PostgreSQL tests, source identity and type checking only. Final independent review of exact successor source/configuration pins remains required before adoption.
