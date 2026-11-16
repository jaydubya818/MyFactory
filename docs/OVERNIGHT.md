# Overnight governed issue-to-PR loop

File an issue in the evening, label it `factory:overnight`, and wake up to a verified candidate with a signed Result waiting for your approval. MyFactory does the bounded attempt overnight. It never merges, never approves its own publication and never retries a night.

```text
evening  you: open issue (template "Factory overnight task") + add label factory:overnight
23:30    launchd: scripts/overnight-run.mjs
           guard (enabled, inside 22:00-06:00 PT, night unused, dispatch not paused)
           → pick the oldest eligible labeled issue (one per night)
           → map it to a bounded Work (acceptance, allowed paths, checks, base = origin/main SHA)
           → factory.prepare → factory.dispatch   (private-alpha limits: ≤ $1.35, ≤ 600 s)
           → producer builds in its fenced worktree → separate verifier runs the checks
           → signed Result (Proof) → optional publication.request
morning  you: read $FACTORY_DATA_DIR/overnight/latest.md
           → review diff + check logs in the work desk
           → approve publication (Touch ID) → publish draft PR → review and merge on GitHub yourself
```

## Authority model

| Step | Who authorizes | Enforced by |
| --- | --- | --- |
| Pick the issue | You, by adding `factory:overnight` (needs triage access) to an issue authored by an allowlisted login | `selectIssue` (label + `FACTORY_OVERNIGHT_AUTHORS`; `factory:hold` excludes) |
| One attempt per night | Fixed | Ledger claim written before any Factory call; lock file; `FACTORY_OVERNIGHT_MAX_PER_NIGHT` must be 1 |
| Spend and time | Your supervisor's qualified price and the private-alpha ceilings | `FactoryDispatchControl.prepare` and the V2 spend ledger; config refuses > $1.35 or > 600 s |
| Build and verify | The admitted Work only | Writer fencing, allowed paths, independent verifier, signed Result |
| Publish a draft PR | You, in the morning | `publication.approve` requires human presence (Touch ID) |
| Merge | You, on GitHub | MyFactory has no merge path |

An overnight run that cannot reconcile its attempt reports `unknown` and stops; the next night does not start a second attempt for the same issue.

## Writing a good overnight issue

Use the **Factory overnight task** issue template, or include these sections. Missing sections are reported as `needs_clarification` and do not consume the night.

```markdown
One or two sentences describing the change.

## Acceptance criteria
- Observable outcome 1

## Allowed paths
- docs/OVERNIGHT.md

## Checks
- node --test apps/supervisor/test/overnight-config.test.mjs
```

A `bug` labeled issue with `## Reproduction` and `## Expected failure` becomes a defect Work; anything else is a feature Work. Keep issues small: one candidate, a few files, checks that run in minutes.

## One-time setup on the Mac

1. **Work checkout separate from the supervisor's source.** The supervisor attests its own source; do not let Work target the checkout it runs from.
   ```bash
   git clone https://github.com/jaydubya818/MyFactory.git ~/factory-work/MyFactory
   ```
2. **Pull this code into the supervisor checkout.**
   ```bash
   cd /Users/jaywest/Documents/ChatGPT/MyFactory && git checkout main && git pull --ff-only
   ```
3. **Register the overnight connection** (token is written to a file, never printed):
   ```bash
   node scripts/register-client.mjs --id overnight --name "Overnight loop" \
     --repo ~/factory-work/MyFactory \
     --action factory.prepare --action factory.dispatch --action factory.observe --action factory.stop \
     --action publication.request \
     --token-file ~/.local/share/sellerfi-factory/overnight-token
   ```
   Drop `--action publication.request` if you prefer to request publication yourself in the morning. Use the same `--data-dir` / `FACTORY_DATA_DIR` as the supervisor that will execute the Work.
4. **Create `data/overnight.env`** (gitignored):
   ```bash
   FACTORY_OVERNIGHT_ENABLED=1
   FACTORY_OVERNIGHT_REPOSITORY=jaydubya818/MyFactory
   FACTORY_OVERNIGHT_REPOSITORY_PATH=/Users/jaywest/factory-work/MyFactory
   FACTORY_OVERNIGHT_DATA_DIR=/Users/jaywest/.local/share/sellerfi-factory
   FACTORY_OVERNIGHT_TOKEN_FILE=/Users/jaywest/.local/share/sellerfi-factory/overnight-token
   # Leave LIVE unset for rehearsal nights; dry runs plan the exact request and dispatch nothing.
   # FACTORY_OVERNIGHT_LIVE=1
   # FACTORY_OVERNIGHT_PRICING_REVISION=<revision your executing supervisor is qualified for>
   # FACTORY_OVERNIGHT_ORIGIN=http://127.0.0.1:8789
   ```
5. **Install the nightly trigger** (fires 23:30 and 02:00 local; the guard keeps it to one attempt):
   ```bash
   node scripts/install-overnight-service.mjs
   ```
6. **Rehearse now:**
   ```bash
   node --env-file=data/overnight.env scripts/overnight-run.mjs --dry-run --ignore-window
   ```
   The output ends with the exact `factory.prepare` request a live night would send.

## Going live

A live night dispatches only through a supervisor whose dispatch control is live. The default `com.myfactory.supervisor` (`node apps/supervisor/src/server.ts`) reports paid execution as **DISABLED**, so `dispatch` is refused and the morning summary says `dispatch_failed`. To go live:

1. Run the executing supervisor through the qualified private-alpha entry (`apps/supervisor/src/private-alpha.ts` with `FACTORY_REAL_PROVIDER_CONFIG`, result signing provisioned, default port 8789).
2. Its price card must be current. The `20261020-v3` revisions expired on 2026-10-27, and renewal is a separate owner decision (see the pricing proposal PR). `prepare` refuses an expired or mismatched `pricingRevision`.
3. Set `FACTORY_OVERNIGHT_LIVE=1`, `FACTORY_OVERNIGHT_PRICING_REVISION` and `FACTORY_OVERNIGHT_ORIGIN` to that supervisor.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `FACTORY_OVERNIGHT_ENABLED` | off | `1` arms the loop |
| `FACTORY_OVERNIGHT_LIVE` | off (dry run) | `1` allows one real dispatch per night |
| `FACTORY_OVERNIGHT_REPOSITORY` | required | `owner/repo` |
| `FACTORY_OVERNIGHT_REPOSITORY_PATH` | required | absolute Work checkout inside the client's `repositoryPaths` |
| `FACTORY_OVERNIGHT_DATA_DIR` | `FACTORY_DATA_DIR` | ledger, lock, summaries under `overnight/` |
| `FACTORY_OVERNIGHT_TOKEN_FILE` | required when live | from `register-client.mjs` |
| `FACTORY_OVERNIGHT_PRICING_REVISION` | required when live | must equal the executing supervisor's price revision |
| `FACTORY_OVERNIGHT_ORIGIN` | `http://127.0.0.1:8789` | loopback only |
| `FACTORY_OVERNIGHT_WINDOW` | `22:00-06:00` | may wrap midnight |
| `FACTORY_OVERNIGHT_TIMEZONE` | `America/Los_Angeles` | IANA name |
| `FACTORY_OVERNIGHT_LABEL` | `factory:overnight` | the authorization label |
| `FACTORY_OVERNIGHT_HOLD_LABEL` | `factory:hold` | excludes an issue |
| `FACTORY_OVERNIGHT_AUTHORS` | repo owner | comma-separated GitHub logins |
| `FACTORY_OVERNIGHT_BASE_BRANCH` | `main` | resolved to `origin/<branch>` SHA at run time |
| `FACTORY_OVERNIGHT_MAX_SPEND_USD` | `1.35` | cannot exceed 1.35 |
| `FACTORY_OVERNIGHT_DEADLINE_SECONDS` | `600` | 60–600 |
| `FACTORY_OVERNIGHT_MAX_PER_NIGHT` | `1` | fixed |
| `FACTORY_OVERNIGHT_REQUEST_PUBLICATION` | off | `1` files `publication.request` when every check passed (approval stays yours) |

## Morning summary outcomes

| Outcome | Meaning | What to do |
| --- | --- | --- |
| `ready_for_review` | Verified candidate and signed Result | Review, approve with Touch ID, publish draft PR, merge yourself |
| `planned` | Dry run | Read the planned request; set `FACTORY_OVERNIGHT_LIVE=1` when ready |
| `no_issue` | Nothing labeled and eligible | Label an issue tomorrow evening |
| `needs_clarification` | Issue lacks scope/acceptance/checks | Edit the issue; the night was not consumed |
| `prepare_failed` / `dispatch_failed` | Supervisor refused (pricing, limits, disabled execution) | Read the reason in the summary |
| `not_completed` | Attempt failed or was cancelled | Read evidence; file a smaller or clearer issue |
| `unknown` | Attempt not reconciled | Reconcile in the work desk before anything else |
| `skipped:*` | Disabled, outside window, night used, paused, supervisor down | As named |

Files: `$FACTORY_OVERNIGHT_DATA_DIR/overnight/latest.md`, `summaries/<night>-<mode>.md`, `ledger.json`. Logs from launchd: `data/overnight.log`, `data/overnight-error.log`.

## Not yet covered

- Linear intake as an overnight source (GitHub labels only for now).
- The Proof block is in the morning summary; the draft PR body still carries only the WorkOrder/candidate/evidence-digest lines from the governed publication adapter.
- Containerized local execution (Docker worker) lands separately.
