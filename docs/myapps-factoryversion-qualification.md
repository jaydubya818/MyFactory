# MyApps reference FactoryVersion qualification

This qualifies the existing deterministic reference adapter. It does not change
production `source-identity.json`, pricing, custody, configuration semantics,
accounting, or any historical approval. It grants no execution, installation,
publication, release, or deployment authority.

## Identity contract

The existing Result v1 formula is unchanged:

```
sourceDigest = digest({ sourceCommit: exactMyFactoryCommit })
configurationDigest = digest(referenceConfiguration(exactMyEveCheckout))
factoryVersion = digest({ sourceDigest, configurationDigest })
```

`digest` is the canonical JSON SHA-256 implementation in hosted-routing. The
reference configuration binds four canonical MyApps modules and four MyEve
integration modules by bytes, plus the actual Node version, platform, architecture,
fixed commands and sandbox limits. Its model is `deterministic/no-model`.

`packages/app-builder/test/myapps-identity.test.mjs` verifies:

- Canonical candidate commit/tree bytes agree with native Git object hashing;
  reordering JSON keys preserves identity and changing candidate/source/config
  changes it.
- Changing each of the eight bound MyEve dependencies rejects the previously
  pinned FactoryVersion before candidate generation, even with an affirmative
  fixture authority callback.
- Signed Result validation rejects changed Factory source, changed execution
  configuration, substituted artifact bytes and expired current-admission keys.
  The original signed Result remains unchanged and verifies only in its original
  qualified context. No old approval is transferred to the successor.
- Receipt identity rejects dirty source, independently committed source,
  dependency-lock and migration changes, and fabricated release authority.

Run against an explicit MyEve checkout:

```sh
MYEVE_SOURCE_ROOT=/absolute/myeve node --test packages/app-builder/test/*.test.mjs apps/cloud-control/test/cloud-verification.test.mjs
```

## Exact source receipt

After committing the qualification tooling, create the immutable receipt outside
both clean source checkouts:

```sh
node packages/app-builder/scripts/qualify-myapps-identity.mjs create /absolute/myeve /absolute/myfactory /absolute/evidence/identity.json
node packages/app-builder/scripts/qualify-myapps-identity.mjs verify /absolute/myeve /absolute/myfactory /absolute/evidence/identity.json
```

Creation uses exclusive file creation: existing historical evidence is never
overwritten. Verification regenerates the complete receipt and demands exact
canonical equality, including its digest and non-authorizing status. The receipt
records both commit/tree identities, committed dependency manifests/lockfiles,
migration SQL hashes, MyApps and builder packaging source hashes, the reference
FactoryVersion, and the exact generator/configuration/digest implementation bytes.
The executing generator must match the declared Factory source. It contains no
credentials, provider rates, executable grants or mutable approval references.

The receipt is deterministic for the exact two checkouts and Node/platform tuple;
it intentionally changes after a source commit or runtime identity change. It is
source identity evidence, not proof that dependencies were installed from the
lockfile, a reproducible binary-build result, or a security/release approval. Pair
it with exact-head clean-install, export/build, browser, PostgreSQL, governance,
independent review and hosted CI evidence. An unchanged runtime-only FactoryVersion
does not make a changed repository receipt eligible to reuse release approval.

Historical receipts and signed Results remain immutable. Generate a new receipt
after the independently qualified canonical correction is integrated; requalify
the exact successor before requesting any mandatory owner-controlled release gate.
