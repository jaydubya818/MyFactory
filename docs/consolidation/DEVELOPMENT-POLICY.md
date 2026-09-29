# Source and migration policy

Canonical main is integration truth after qualified publication. Branch from a current remote main; record owner, purpose, base SHA, expected integration target and affected shared surfaces. Keep feature branches short-lived.

A qualified handoff is incomplete until its exact commit is pushed and remotely verified. Include repository, branch, SHA, remote check, baseline, commands/counts, environment/fixture, migration hashes, limitations and dependencies. Qualification never automatically transfers to modified or reconstructed source.

Before assigning a migration, inspect canonical and active branches, reserve its number and owner, and retain applied bytes. Shared schema, Work, routing, provider adapters, authority and the migration registry have one explicit integration owner. Never infer empty authority from unavailable evidence.

Inventory dirty worktrees, locally-only commits and migration collisions at each handoff/release and before cleanup. Use `git worktree list --porcelain`, per-worktree `git status --short --untracked-files=all`, and `git log --branches --not --remotes --oneline`. Fetch before assessing source durability. The migration check rejects duplicate active numbers. An unpushed qualified commit is a warning until exact `git ls-remote` parity is established.

Preserve evidence separately from runtime. Tag only after canonical post-merge qualification. Publish a source/release manifest from exact canonical SHAs and deployment receipts; repository merge alone proves neither deployment nor live qualification. Archive only intentional releases/deferred capabilities; delete only after checking unique source, active consumers and evidence.
