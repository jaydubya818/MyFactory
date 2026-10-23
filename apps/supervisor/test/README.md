# Supervisor test suite

## Running the full suite

```sh
npm test --workspace=@factory/supervisor
```

The suite includes both unit/integration tests and Playwright browser tests. Before running the full suite for the first time, complete the prerequisites below.

## Prerequisites for browser tests (`browser-qa-regressions.test.mjs`)

The browser tests start a real supervisor HTTP server and drive Chromium against the built web UI. They require:

1. **Web UI built:** the supervisor serves `apps/web/dist` to the browser.
   ```sh
   npm run build --workspace=@factory/web
   ```

2. **Playwright Chromium installed:**
   ```sh
   npx playwright install --with-deps chromium
   # or using the pinned local copy:
   node node_modules/playwright/cli.js install --with-deps chromium
   ```

These are the same steps the CI workflow runs before `npm test`. They are one-time setup per machine; re-run when `playwright` or the web source changes.

## Running only unit/integration tests (no browser, no prerequisites)

```sh
npm run test:unit --workspace=@factory/supervisor
```

## Running only browser tests

```sh
npm run test:browser --workspace=@factory/supervisor
```

## Pre-existing failures

The following tests require Docker and a Codex binary that are not available on all machines. They fail on the box (CI environment without Docker/Codex) and that is expected:

- `dispatch-control.test.mjs`: "No terminal proof within 20s" / FAILED vs COMPLETED (Docker/Codex not configured)

All other failures are regressions.
