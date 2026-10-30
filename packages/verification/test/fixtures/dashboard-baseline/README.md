# MyEve beta dashboard

Private, isolated target for the complete MyEve autonomous engineering journey.
This initial application is a baseline. It does not implement the dashboard or
prove Sofie, Relay, Factory, independent verification or MyApps delivery.

Use Node 24.18.1 and npm 11.16.0.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npx --no-install playwright install chromium
npm test
node scripts/describe-build.mjs > build-evidence.json
```

`npm run dev` starts a loopback-only development server. The production build
is in `dist/`; `npm run preview` serves it locally for inspection. There is no
deployment workflow or GitHub credential configuration. No tokens belong in
`VITE_*` variables, source, browser storage or build output.

The public-to-coders [proposed acceptance specification](docs/proposed-acceptance.md)
is **pending verifier/custodian approval**. Protected holdout tests must live in
separate verifier custody. The initial commit is recorded in the platform release
manifest as the immutable baseline. Build inventories are unsigned observations,
not signed Results, Proof or release approval.
