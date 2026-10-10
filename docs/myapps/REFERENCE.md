# Deterministic App Builder reference

This extension lives in `packages/app-builder/src/myapps`. It is not registered
in production admission, cloud APIs, external-alpha configuration or a paid
ExecutionProvider. Generated artifacts and evidence remain in a caller-supplied
private temporary directory. Nothing is published or installed by MyFactory.

The caller supplies an independent canonical Work authorization function. Every
build and verification checks that function; package content cannot grant Work
authority. The model provider is `deterministic/no-model`: this is a literal
reference identity, with no model request or spending operation.

The authorization callback receives `{work, appId, appVersion, appDigest,
factoryVersion}`. It must compare these with an independently admitted owner
intent as well as current Work version/generation/control. An active Work alone
is insufficient. The controller also checks its real Factory Git commit and
configuration digest. Configuration binds the exact trusted MyEve contract/store/
CRM source bytes and actual Node/platform/architecture. Result carries that exact
configuration, so changing the trusted runtime dependency changes FactoryVersion.

The producer receives the exact declarative package on stdin, imports only the
trusted MyEve contract, and runs with Node's permission mode and a minimal
environment. It has no filesystem write, child process, worker or protected-test
access. It stops before custody is written. JSON is never executed as code.
The private custody file is immutable to the producer, read-only after creation,
and checked against AppDigest before every use. App source is a one-file Git
object tree, with an exact empty source or predecessor candidate as its base.
It is not a commit to a production application repository.

The separate verifier receives the exact candidate and digest, with permission
to read the trusted host modules. It runs required checks against an in-memory
reference runtime and cannot rewrite custody. Successor behavior uses the same
validated declaration in disposable state; the composed journey separately tests
actual predecessor data preservation and installation. The verifier is a local
reference process, not a claim of cloud sandbox qualification.

The controller reuses `apps/cloud-control/src/cloud-verification.mjs` for claim,
duplicate-delivery reconciliation, outcome and cleanup semantics. Durable local
SQLite records fence duplicate candidate production and preserve verification
across controller restart. An interrupted BUILDING record remains UNKNOWN and
cannot be silently rerun. A separately admitted Work/candidate can advance to the
next candidate version, targeting the exact installed base (or no base for an
initial recovery), without replacing the failed attempt or its custody history.
Incomplete verifier cleanup cannot produce an installable result. The generation
kill switch is durable and rechecked after producer completion and before/after
verification, after asynchronous authority responses, and within candidate and
verification completion transactions; no new authority is minted by recovery.

`result.mjs` uses the existing `MYFACTORY_RESULT_V1` signing, artifact hashing,
correlation, validation and signature verification. A local App verification is
a check artifact, never `INDEPENDENT_CLOUD_VERIFICATION`. The App Proof records
claims separately from publication, installation and owner acceptance. Fixture
signing keys are generated in memory by tests, never saved or shipped. Only a
COMPLETED outer Result can establish App verification. A valid signature on a
FAILED/CANCELLED Result with a PASS check artifact cannot promote the candidate.

The MyEve reference host is a read-only compatibility dependency selected by an
exact GitHub checkout in CI. Skill bindings use the separately owned MySkills
contract; the deterministic template executes no Skill. No Relay changes or
credentials are needed.

## Qualification

From MyFactory, set `MYEVE_SOURCE_ROOT` to the isolated qualified MyEve checkout:

```sh
MYEVE_SOURCE_ROOT=/path/to/qualified/MyEveBot node --test \
  packages/app-builder/test/*.test.mjs \
  apps/cloud-control/test/cloud-verification.test.mjs
```

After independent review remediation: 21 affected tests cover all pre-existing App Builder and
preview tests, verifier continuation faults, candidate tampering, Work denial,
duplicate build/result handling, restart, signature tampering and correlation,
failed-terminal Result denial, generation-disable races and fresh-attempt recovery.
The MyEve composed qualification adds canonical PostgreSQL Work creation,
canonical migrations, browser install/update and retained CRM state.

Production integration and FactoryVersion impact require a separate reviewed
change-impact envelope. The external-alpha FactoryVersion is untouched.
