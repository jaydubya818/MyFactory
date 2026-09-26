# First beta readiness — 2026-09-26

The local Factory and generated Feedback Hub were qualified against a clean checkout of MyFactory main (`543906d`). This is a local workflow check, not approval to invite a live tester.

## Verified locally

- `npm test`, `npm run typecheck`, and `npm run build` passed. Tests needed loopback socket access; the first sandboxed run could not bind its HTTP test server.
- The work desk loaded in a browser with an isolated data directory. App builder saved a Feedback Hub WorkOrder and launched its local preview.
- The generated app captured feedback, changed its status to Reviewing, saved a note, and retained the record after page reload.
- Its agent CLI read that same record with `get_agent_context` and added a note. Refreshing the UI displayed the agent note and activity. This confirms the shared action path for this template.

## Related hosted work

- MyEveBot main contains correlated peer reply handling and passed 79 focused tests plus a disposable local Relay/Ava harness. The harness used a deterministic Sofie test answer, so it does not prove a live model-authored conversation.
- Relay main has account-bound beta invitation support and the public Federation trust endpoint. The invite flow passed local browser and API checks, including wrong-email rejection and one-time redemption. Protected-main PR #23 passed required quality checks and merged at `221a9e7`.

## Gates before sending a first invite

1. Apply Relay's additive beta-invite database migration to production, then deploy current Relay main. Verify the public signup URL, one-time redemption, separate tester account, and Federation trust endpoint on the deployed site. The previous public deployment was still serving older code when checked.
2. Independently approve the production Federation signing-key fingerprint before configuring a new MyEve to trust Relay. A deployment-time key fetch without that pin was rejected in automatic review.
3. Finish the MyEve Builder's Relay pairing path and test a disposable tester deployment with a tester-owned Vercel token. The public Builder currently stops at that token step and does not configure Relay automatically.
4. Complete a live, model-authored Ava/Sofie message exchange and an approved memory share across separate stores. The local deterministic harness is supporting evidence only.
5. Obtain the first tester's intended email address, generate an account-bound invite, and walk through the public URL in a clean browser session.

Do not call the beta ready until these hosted checks pass. The local Factory worker was unavailable in the isolated browser run, so an autonomous coding attempt and draft PR were not qualified by that run.
