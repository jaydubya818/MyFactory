# Local Software Factory

A supervised local workflow for turning a selected WorkOrder into a reviewable candidate commit. WorkOrders, attempts, checks, events, policies, publication decisions, signals, and releases are stored in SQLite. The web work desk and standalone Agent-Native console read those records through the same loopback supervisor.

This is an implementation in progress. The local path and Feedback Hub preview run; a real target repository and issue are still needed to qualify the first end-to-end GitHub draft PR.

The work desk now includes **Connections** and optional Linear issue creation. Approved sibling app backends can create WorkOrders, read evidence records, and add notes through scoped shared actions. These integrations are inactive until configured. See [app connections and Linear setup](docs/connections.md) for host settings, client registration, retry behavior, and current limits.

## Run the work desk

Requires Node 24. Coding attempts use a logged-in Codex CLI on the Mac host and Docker Desktop with the cached `node:22-bookworm` image for offline verification.

```sh
npm ci
npm run preview:prepare
npm run build
npm start --workspace @factory/supervisor
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). Set `FACTORY_PORT` for another loopback port or `FACTORY_DATA_DIR` for another local data directory. The default is `~/.local/share/sellerfi-factory`. The supervisor continues a run if the browser closes.

The [standalone Agent-Native console](factory-console/README.md) has a contextual factory view and agent actions. Start it separately with `FACTORY_SUPERVISOR_URL` pointed at the running supervisor. It uses the same WorkOrder and evidence records; its own database holds app and chat state. A model provider must be configured before natural-language chat can answer.

## Build a Feedback Hub

Open **App builder**, choose the versioned Feedback Hub starter, and enter a product brief. The factory saves a linked WorkOrder and a file manifest with source hashes. `npm run preview:prepare` fetches the pinned starter dependencies once during host setup; it disables package scripts. Open the WorkOrder and choose **Start local preview**. The supervisor checks the unchanged scaffold, installs those cached dependencies offline with scripts disabled, runs typecheck and build, and starts a loopback preview of the app and its action API. Preview status and bounded logs remain in the WorkOrder. **Stop preview** ends the child process. This is a template preview, not independent verification of a modified candidate.

## Run and review a coding WorkOrder

1. Create a WorkOrder with a local Git repository path, base branch, acceptance criteria, permitted file paths, and check commands. A defect also needs a reproduction command and the expected substring in the failing baseline log.
2. Start a bounded Mac coding attempt. The supervisor makes a task worktree, checks the baseline failure in offline Docker, runs Codex, validates the changed paths and modes, then commits the candidate with an isolated Git index. It verifies the exact candidate commit in offline Docker. One attempt runs at a time; each WorkOrder is limited to two attempts.
3. Review the candidate diff, check logs and digests, and policy revision. A publication request is a local proposal. The device owner must confirm approval of the exact request. A changed candidate, diff, check log, policy, or expired approval blocks a new draft PR.
4. After approval, the host-side GitHub adapter checks the destination branch and existing PR, pushes the exact candidate only to an absent stable WorkOrder branch, and creates a draft PR. It records the external outcome. If the response is uncertain, retries are read-only reconciliation; the factory does not repeat an unconfirmed push or PR creation.

Human-only actions use macOS device-owner confirmation because the loopback browser token is available to local processes. The agent can create a WorkOrder, add a note, pause dispatch, prepare a local preview, and propose publication through shared typed actions. It cannot resume dispatch, start or cancel a coding run, approve publication, or publish a draft on its own.

The Mac coding agent may inherit host credentials and network access under its Codex sandbox. The supervisor checks the resulting candidate, but this is not a complete sandbox for the host coding step. Docker verification receives an exported commit tree without `.git`, the Docker socket, or model credentials. Keep work within trusted local repositories and review the exact candidate before publication.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm run smoke:docker
```

The [Phase 0 baseline](docs/phase-0-baseline.md) and [integrated smoke evidence](docs/evidence/integration-smoke/README.md) show the fixture, reproduction, candidate, and independent check. The [architecture](docs/architecture.md) and [backlog](docs/backlog.md) separate this first delivery path from scheduled intake, merge, deployment, and release promotion. Reviewed Builder.io Factory instructions are pinned under [skills/vendor/builderio](skills/vendor/builderio/README.md).
