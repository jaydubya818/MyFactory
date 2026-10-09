# Local provider qualification

Engineering base: fa48a820ba185eb9b891130c78166463b61cba74. Existing Vercel V2 and legacy local V1 remain unchanged. No release deployment or production compatibility adoption is authorized.

Reuse the canonical PostgreSQL dispatch, spend, verification, candidate custody, lifecycle, and signed Result implementation. Add a local Docker resource adapter to the existing provider seam. Add execution snapshot V3 with an explicit local configuration and signed local execution evidence. Preserve strict V2 parsing and never interpret a Docker resource as Vercel.

Data shape: existing Work/Run/lease plus immutable local provider identity, implementation digest, Docker runtime digest, host qualification digest, exact image, owner/delegation, source snapshot, sandbox policy, deterministic harness digest, verifier policy and resource limits. Runtime allocation and cleanup evidence bind actual Docker container IDs to candidate custody. FactoryVersion remains the existing source/configuration digest calculation, after qualification stabilizes.

Trust model: the authenticated Factory host, Docker daemon, signing key and database are trusted. Containers isolate ordinary untrusted workload code from sibling containers, host files and credentials; they are not a VM security boundary and do not protect against a malicious host administrator or kernel/container-runtime exploit. Those properties are unsupported. No host mounts, network, socket, credentials, privileged mode, added capabilities or unconfined seccomp. Producer and verifier use separate allocations; protected expectations remain in the host and producer is destroyed before verifier allocation.

Qualification sequence: contract refusal and Vercel regressions; actual Docker resource/isolation probes; PostgreSQL duplicate and fencing tests; actual deterministic producer and custody; protected verifier; authenticated local Result; isolated MissionControl approved authority, quality evaluation and reconciliation; failure/restart/UNKNOWN tests; independent security and architecture review; fresh clones, CI, exact remote SHAs. Production adoption remains a separate decision.

Throughput checkpoint: one implementation writer. Independent reviewers assess the stable contract and tested implementation. No dependency PR edits and no silent compatibility pin change.
