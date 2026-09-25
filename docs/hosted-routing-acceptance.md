# Hosted routing acceptance — September 25, 2026

## Verified live: hosted Sofie → Linear → local MyFactory → hosted receipt

Tests were initiated through the signed-in production Sofie chat UI, not by a local adapter posing as hosted Sofie.

| Check | Evidence |
| --- | --- |
| Hosted create | Sofie called `create_factory_work_order`; Linear issue MYE-10 was created. |
| Local admission | WorkOrder `fe63aeeb-ae82-4e7a-ab1c-56e44cba65ee`; local UI shows `Hosted Intake Received`, `Workorder Created`, and the MYE-10 link. |
| Return receipt | Hosted `get_factory_work_order` returned `received_by_factory` and the same WorkOrder ID; Ed25519 signature also verified independently from the terminal. |
| Crash recovery | Stopped the running process; launchd restarted it and polling resumed. Exactly one matching WorkOrder remained. |
| Offline admission | Unloaded the local service; hosted create returned `awaiting_local_factory`, a null receipt and MYE-11. |
| Delivery after restart | Reloaded service; hosted read returned WorkOrder `e912d59e-babf-4a24-a0e4-98d1340dfba3`. Terminal count: exactly one matching WorkOrder. |

MYE-10 request ID: `5210c64f-604f-4134-ada2-6a728d3c8be1`.
MYE-11 request ID: `20f1403d-56eb-45b3-a8f1-637cc33a029c`.

The first live create exposed Linear's Markdown reserialization: it adds blank lines around the signed code block. Fixed framing parsing without changing signature verification, added regression coverage, and deployed the correction. Reconciled the existing request rather than creating a replacement. Subsequent hosted create and read both succeeded.

These were **routing tests**. Their WorkOrders remain queued with no coding attempts or publication. They do not establish a complete coding-to-PR delivery cycle.

## Automated and build checks

- Factory workspace suite passed before live testing (77 tests). Added and passed two further protocol regressions for Linear spacing and oversized input; targeted protocol + hosted-intake run: 7 passed.
- Local web production build and supervisor TypeScript check passed.
- Sofie TypeScript, capability registry, executor governance and four new authority/destination tests passed. Production deployment succeeded.
- Relay TypeScript and production build passed. Ten new tests cover owner/origin/account restrictions, destination verification, invalid inputs, MCP grant projection, revoked credentials and guessed tools without grants.

## Relay live acceptance status

The owner approved the production-only connector attachment and then the exact Relay production patch. Both are complete. **Hosted Relay has not yet passed end-to-end routing acceptance:** its owner UI is signed out, and the configured bootstrap credentials are not accepted by the current application account.

After owner sign-in, exercise the hosted owner UI and scoped MCP flow through Linear to an actual local receipt. A deployed build and successful access-control checks do not establish successful routing.

## Source and operations

- MyFactory: branch `codex/local-factory`.
- Sofie: PR 26 in `jaydubya818/MyEveBot`, branch `codex/myfactory-hosted-routing` (preserves current production Foreman fixes).
- Relay: PR 19 in `jaydubya818/relay`, branch `codex/myfactory-hosted-routing`.
- Local service: `com.myfactory.supervisor`, starts at login and restarts after process exit; loopback port 8788.
- Setup and wire contract: [hosted-routing.md](hosted-routing.md).

## Relay live-test preparation update

The owner subsequently requested the live Relay test and approved the production-only connector attachment. The attachment succeeded for `linear/myeve-foreman` on project `prj_3IRvr9knK5VJcBTgTYMvhv6ixmJK`; Vercel reported only the `production` environment. Seven scoped MyFactory settings were saved for its next deployment.

The previous Relay production base was `7ea29b2886d2b8bad7b1a1ca1c3e8df1d39ee9ee`; main at preparation was `a0e6b3ca297836aba442c43c975d4fd267614346`. Main includes unrelated features and migrations 0021–0023, so an isolated deployment branch was created from the exact live base. Only the four factory commits were applied. Candidate `6967261` on `codex/myfactory-relay-live` passed typecheck, all 10 routing tests and production build. No schema or migration files changed. The branch is pushed and reviewable in Relay PR 20; PR 19 remains the implementation branch based on main.

## Approved Relay deployment and live checks

The owner explicitly approved the exception for Relay commit `6967261`. Deployment succeeded and Vercel reported READY:

- Deployment: `dpl_3mKUdqAMH342SRAVSiEsuh4KNxcs`.
- Immutable URL: https://relay-qtl5evio4-jaydubya818.vercel.app.
- Production alias: https://relay-jaydubya818.vercel.app.
- No direct production database access or migrations were performed during this deployment and verification.

Live terminal checks used authenticated `vercel curl` to reach the application through Vercel protection without changing that protection. The owner factory endpoint rejected an unauthenticated read with HTTP 401 and `Dashboard authentication required.` The MCP endpoint rejected a request without a Relay credential with HTTP 401 and `INVALID_CREDENTIAL`.

The normal application login endpoint rejected the existing configured credentials with `Email or password is incorrect.` Browser inspection confirmed the owner sign-in form remains open. The owner has been asked to sign in; no password reset, session fabrication, or authentication bypass was attempted.

Local intake health at `2026-09-25T22:22:45.323Z`: enabled, polling, zero rejected items, no error. No live Relay factory request has yet been submitted. Remaining acceptance: authenticated owner UI create, Linear admission, local WorkOrder UI confirmation, verified hosted receipt, and scoped agent MCP create/read. The separate Golden Work coding-to-review milestone remains unqualified.
