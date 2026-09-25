# Recovered existing connections — September 25, 2026

## Configuration recovered

Read the existing **Set up Eve Foreman template**, **Investigate missing management pages**, and **Atlas agent communication** tasks, plus the local MyEve and Relay repositories.

- MyEve: `jaydubya818/MyEveBot`, `/Users/jaywest/Myeve`.
- Relay: `jaydubya818/relay`, `/Users/jaywest/Documents/ChatGPT/New project/relay-protocol-canonical`.
- Linear: MyEveBot workspace, MYE team, existing Vercel Connect connector `linear/myeve-foreman`.
- Vercel project: existing `myeve-foreman` development authorization.

The old local OIDC identity had expired. The official Vercel OIDC SDK successfully refreshed the existing project identity using the signed-in CLI account. No new Linear key or connector was required. The host now uses the same OAuth installation and checks the exact workspace and team before sending work.

## Live checks

Host: `http://127.0.0.1:8788`.

1. The real Connections UI's **Verify Linear access** button returned **MyEveBot (MYE)** and a verification timestamp.
2. Agent-Native CLI `verify-factory-linear` returned the same connector, team, and automatic mode.
3. MyEve and Relay host registrations use separate tokens and exact repository scopes. Both clients successfully listed their permitted work.
4. The registered MyEve client created WorkOrder `ee547297-c891-4ac6-9b4b-09272c99b7d1` and real issue [MYE-8](https://linear.app/myevebot/issue/MYE-8/myeve-backend-to-myfactory-linear-connection-acceptance).
5. Repeating the same create input returned the same WorkOrder. Repeating Linear sync returned the same issue UUID `66082303-2705-44f2-ae4e-e00dc04b0188`.
6. Relay could not read the MyEve WorkOrder, and its list excluded it.
7. A note written by the MyEve client appeared in the real UI's Activity section. The WorkOrder UI displayed **Open MYE-8** after navigation/reload.

## Exact limits of this evidence

- The live human UI creation form correctly requested device-owner authentication. It timed out with **Device owner did not confirm the action**. Human UI submission was therefore not completed; no confirmation bypass was used.
- The successful issue creation above used the separately authorized app-client action path. It tested local intake, tracking, persistence, and scope checks.
- The acceptance WorkOrder has no coding attempt or publication. Its queued execution state is not evidence of completed software delivery.
- Host registrations and the local command adapter do not install tools into hosted Sofie/Relay. Their hosted runtimes still require an explicit transport to this local factory; production federation was not changed.
- Issue creation does not assign/delegate to Foreman, mirror subsequent state changes, merge code, or promote a release.

## Automated checks

- Workspace test suite: **72 passed, 0 failed**.
- Added OAuth authorization refresh, workspace mismatch rejection, token error redaction, and no-implicit-delegation coverage.
- Supervisor/client TypeScript check: passed.
- Web TypeScript check and Vite build: passed.
- Factory Console TypeScript check and Agent-Native doctor: passed; doctor reported no findings.
- Factory Console build: completed. Existing production diagnostics still require `BETTER_AUTH_SECRET` and a persistent database URL before a production deployment.

Local host settings and credentials are ignored by Git. Restart this configured host with `npm run start:connected`.
