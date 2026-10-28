# Local V4 native preparation, finite unit A

Only `createLocalV4Supervisor` installs this preparation. Legacy `createSupervisor`, JobManager, Git helpers, producer classes, codecs, packages, lockfile and default resource observation keep their existing bodies. The V4 constructor refuses presence of any resolve/create/remove dependency override before storage effects. There is no CLI, HTTP, environment or payload mode selector. Live providers remain refused.

`createLocalV4Preparation(dataDir)` returns exactly three frozen existing JobDependencies functions. It has no eager native or filesystem effects, no arbitrary runner/argv/environment callback and no authority to dispatch Work. Resolve accepts a literal full immutable SHA-1/SHA-256 commit only. The unchanged input identity reader qualifies the normal repository/configuration and typed commit/root tree before creation; this is not a full recursive input policy. A repository/input observation from the same helper instance is required before create.

The qualified native host is macOS arm64 with Node24.18.1 and Git `/opt/homebrew/Cellar/git/2.48.1/bin/git` (3557248 bytes, SHA256 `7ed424dafb29f1d4e3df1ca215efcba044b19cc78cf8b8df5a74cbdbfcbf4899`). Before each new native operation and before entering the unchanged reader, filesystem checks verify the exact executable, its canonical helper directory and `git` symlink, and these non-system dependencies:

| Load path | Canonical target | Bytes | SHA256 |
|---|---|---|---|
| `/opt/homebrew/opt/pcre2/lib/libpcre2-8.0.dylib` | `/opt/homebrew/Cellar/pcre2/10.47_1/lib/libpcre2-8.0.dylib` | 588224 | `fc0491cc252c2938b6c37d1b6b4d7bfedffb9edb2519c47cef577637eddb73d5` |
| `/opt/homebrew/opt/gettext/lib/libintl.8.dylib` | `/opt/homebrew/Cellar/gettext/1.0/lib/libintl.8.dylib` | 228800 | `0c6d618e75fea85cc3d631e164a71766fba9341d19ce1f723300c52e63037c51` |

Canonical files must retain safe ownership/modes and exact bytes; bounded no-follow reads check descriptor identity before/after. Helper-directory resolution is fixed to the Cellar directory, including both PATH and GIT_EXEC_PATH. Parent environment and loader variables are omitted. Locale, global/system configuration, protocol/credential/hooks/fsmonitor/attributes/pager/maintenance/GC/replace/lazy-fetch controls are fixed. Git propagates its fixed configuration to its own children. No shell, remote guessing/fetch or submodule update is requested.

The OS/system libraries and exclusive stable trusted host administration are explicit preconditions. These checks do not claim atomic revocation against a concurrent privileged administrator. The unchanged synchronous identity reader is entry-guarded only: its internal read commands do not acquire this unit's new process-group settlement proof. Any failure quarantines that repository in this helper and prevents later native mutation/cleanup/retry. Its existing bounded typed identity checks are preserved, not promoted to full input/materialization qualification.

New native commands use owned detached process groups, a 10-second deadline and a combined1MiB stdout/stderr bound. Success requires actual close, exit0, no signal/error/overflow/deadline and separately observed owned-group absence. Parent exit, signal delivery, or timeout interruption is insufficient. Failure retains HOLD even if an owned group is interrupted. No error exposes raw stderr, credentials or repository paths.

Creation uses an exclusive fresh UUID directory beneath the exact canonical host-owned dataDir/workspaces. It creates only a detached worktree at the literal observed commit, retaining device/inode, directory, repository/configuration, administrative pointer/common-directory and index evidence. It checks those identities around observations. No old workspace, failed partial creation or crash resource is adopted by a new helper. A failure may happen before JobManager receives a path or registers a Run: original intake/prepare failure is retained, with a bounded retained-HOLD error. No automatic retry, history reset or second financial authority is added. At most128 observed inputs and128 retained resources are allowed; held resources are not evicted to regain capacity.

Only a clean, exactly owned pre-capture workspace may be removed without force. Cleanup requires exact HEAD/root tree/index, normal index flags, no staged or working changes, and no untracked, ignored or additional empty-directory contents. A bounded independent filesystem walk compares every regular tracked file's actual typed blob hash, so Git stat caching alone cannot authorize removal. Cleanup conservatively permits at most200 regular100644 files,100000 bytes/file,500000 total bytes and1024 directory entries; unsupported forms retain HOLD. These post-checkout cleanup bounds do not qualify arbitrary input safety before checkout. There is no force, prune, repair, recursive product deletion or cleanup on close.

A fixed forwarding binder uses a module-private ownership marker before the original producer capture. Once capture is entered, physical cleanup remains irrevocably held in this unit, including when capture throws. The marker can only deny cleanup; it has no reset or grant callback. Later producer/native operations and their process custody need separate review. Dirty, replaced, partial, uncertain or capture-entered resources are retained. Original admission, writer claims, stop/UNKNOWN and financial fences remain unchanged.

Portable public tests run in the existing source-only workflow:

```sh
node --test apps/supervisor/test/local-v4-preparation.test.mjs
npm run typecheck:producer
npm run check:producer-governance
```

Actual Mac qualification is separate:

```sh
node --test apps/supervisor/qualification/local-v4-preparation.test.mjs apps/supervisor/qualification/local-v4-service.test.mjs
```

Only ordinary small owned repositories, ephemeral keys and synthetic service dependencies are used. No adversarial child, malicious hook, timeout/resource-growth, private/protected, provider, paid Work, Docker, production or tester experiment is included. Failure branches not exercised by those ordinary fixtures rely on exact source review; they are not called experimentally qualified. Fixture teardown is restricted to its owned model-free directory after all fixture commands finish and is not evidence that product cleanup may bypass a HOLD.

Mandatory later work: full typed recursive regular-text input validation **before createTaskWorktree checkout**; compatible raw candidate export checked before ready_for_review and again at freeze/read; preserved raw commit/tree/diff/signature identities; later context/progress/snapshot/commit/verifier native operations; installed FactoryVersion/MC/owner/financial/protected acceptance authority; real multi-agent execution; independent signed Proof; MyApps delivery/recovery/rollback and both tester qualifications. Source A does not establish any of those. Paid Work, production and tester activation remain disabled.
