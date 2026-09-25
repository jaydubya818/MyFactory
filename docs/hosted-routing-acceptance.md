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

## Relay deployment gate

Relay source is implemented and pushed in `jaydubya818/relay` PR 19. **Hosted Relay has not passed live acceptance and is not deployed by this task.** Automatic approval review rejected attaching the existing Linear connector to Relay across all environments. A narrower request for explicit owner approval to attach `linear/myeve-foreman` to Relay **production only** is pending. Do not bypass that decision with another API or proxy.

After approval: attach production only, set the scoped MyFactory environment configuration, deploy the tested branch while preserving current production changes, then exercise the hosted owner UI and scoped MCP flow through Linear to an actual local receipt.

## Source and operations

- MyFactory: branch `codex/local-factory`.
- Sofie: PR 26 in `jaydubya818/MyEveBot`, branch `codex/myfactory-hosted-routing` (preserves current production Foreman fixes).
- Relay: PR 19 in `jaydubya818/relay`, branch `codex/myfactory-hosted-routing`.
- Local service: `com.myfactory.supervisor`, starts at login and restarts after process exit; loopback port 8788.
- Setup and wire contract: [hosted-routing.md](hosted-routing.md).

## Relay live-test preparation update

The owner subsequently requested the live Relay test and approved the production-only connector attachment. The attachment succeeded for `linear/myeve-foreman` on project `prj_3IRvr9knK5VJcBTgTYMvhv6ixmJK`; Vercel reported only the `production` environment. Seven scoped MyFactory settings were saved for its next deployment.

The currently deployed Relay base is `7ea29b2886d2b8bad7b1a1ca1c3e8df1d39ee9ee`; main is `a0e6b3ca297836aba442c43c975d4fd267614346`. Main includes unrelated features and migrations 0021–0023, so an isolated deployment branch was created from the exact live base. Only the four factory commits were applied. Candidate `6967261` on `codex/myfactory-relay-live` passed typecheck, all 10 routing tests and production build. No schema or migration files changed. The branch is pushed and reviewable in Relay PR 20; PR 19 remains the implementation branch based on main.

**New remaining gate:** automatic approval review rejected the production deployment because the newly supplied Golden Work instructions explicitly forbid production deployment. Explicit approval of an exception for Relay commit `6967261` is pending. The deployment did not execute. No production database access occurred in this preparation turn.

**UI preflight:** the hosted Relay tab reached `/login`; Chrome blocked automation due to an open extension UI. Requested that the owner dismiss the popup and sign in. No live factory request has yet been sent through Relay. Do not treat the successful connector attachment or local tests as end-to-end acceptance.
