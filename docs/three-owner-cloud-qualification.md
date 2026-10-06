# Fixed three-owner CLOUD qualification

The production Cloud host can retain its personal installation while accepting
three explicitly configured synthetic source-owner/client bindings. The roster
is fixed to A/B/C and is inert without separate credentials, verified production
OIDC, an exact immutable approval and an operator-installed Work grant.

Application and Proof credentials are separate for each owner. Queue deliveries
derive the client from durable intake. Reads, stops, custody and queue mutations
check the immutable admission owner/roster binding; reassigning a slot cannot
transfer historical data. Proof authorization does not permit execution. A slot
has a lifetime one-Work limit; this does not increase the personal Work limit.

Migration 010 only extends the existing authority table's client constraint.
The explicit operator runner pins the preceding migration checksums, serializes
installation, requires zero reusable grants and no unresolved paid operations,
and records the new checksum exactly once. It preserves historical records and
creates no execution authority. Builds and requests never apply migrations.

Local qualification uses disposable PostgreSQL, checks all six cross-owner
substitutions and slot reassignment, preserves revoked history, and proves
idempotent installation. These are deterministic implementation checks, not a
claim that live synthetic-owner paid CLOUD Work has run. General Work,
publication and automatic repair remain disabled. Live installation and each
paid attempt require their separate exact authorization.
