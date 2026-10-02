# Dedicated Sofie runtime bypass qualification

**CONNECTED access boundary: PASS**, 2026-10-02. This is service access and
credential containment qualification, not productive cloud Work qualification.
The owner explicitly approved the provider-required server/build injection into
only `sofie-cloud-qualification`. The earlier provider scope decision is resolved.

Qualified deployments:

- Sofie: `dpl_BZqJ2MMH5BHopFtdy3bEFtFChKU9`,
  https://sofie-cloud-qualification-e59wu5lwv-jaydubya818.vercel.app.
- Factory: `dpl_AfixwRxvsn7Yaj1ZKJSWFHG74dYv`,
  https://myfactory-cloud-staging-o7m5zok7s-jaydubya818.vercel.app.
- Both provider targets are preview. Factory source digest:
  `306dd313c1f442adc2bb4e88f2ffe662cf8581798e13f2fc5c864df03d058330`.

## Access and revocation

The [hosted matrix](sofie-runtime-access-matrix.json) passes all ten Sofie cases
and all five nested Sofie → Factory cases. No bypass returns Vercel protection
(302); bypass alone or invalid application identity returns 401; valid operator
identity succeeds only at the fixed diagnostic; unauthorized Work/Routine/Relay
routes are denied. The real Eve session endpoint rejects both bypass-only and
operator credentials as owner authentication. Factory independently denies
missing Work authority with 403. No canonical Work was created or dispatched.

The exact named Sofie credential was then revoked without regeneration.
[Revocation](sofie-runtime-revocation.json) confirms that the formerly successful
transport returns Vercel protection (302) and the project has zero active
bypasses. The Factory service credential was not revoked or copied elsewhere.

For subsequent staging qualification, provision a fresh credential under the
owner's continuing dedicated-project authorization, retain it in the approved
operator/server boundary only, and redeploy so Vercel injects the new value.
Never restore a revoked value or reuse this credential in another project.

To revoke: locate `Sofie deterministic qualification runtime and operator` in
this project's Deployment Protection settings, or PATCH the documented project
protection-bypass API with `revoke.secret` and `regenerate:false`. Pass the value
in memory/private body, not arguments, query strings or logs. Verify absence and
an unauthenticated protection redirect with the revoked credential. Existing
builds may retain the now-invalid environment value; future builds must use a
fresh approved scoped credential and rerun containment checks.

## Containment and evidence limits

The build fails before upload if any of four server credentials is missing,
publicly configured, or found in client output. It scanned 77 browser files,
934 HTML/hydration/prerender metadata files and two public files: PASS. Tests
inject plaintext and base64 secrets into these surfaces and confirm rejection.
The diagnostic rejects response bodies containing the Sofie runtime secret as
well as its existing application/Factory secrets. Observed API responses contain
zero matches. [Runtime log scan](sofie-runtime-log-scan.json): nine available
request entries, zero matches. Logs were scanned in memory; raw runtime logs
were not written into evidence. No screenshots were created.

[Containment report](sofie-runtime-containment.json): model/agent operations,
producer allocations and verifier allocations were all zero during access
qualification, so credential exposure to those consumers was zero. This does
**not** qualify runtime containment in a productive worker or verifier that has
not run. Keep those connected checks explicitly NOT_RUN until composition.

## Repairs and preserved attempt

[Attempt 1](sofie-runtime-access-attempt-1.json) is retained as failed. Sofie auth
passed, but the deployed Factory module could not load an explicit `.ts` import.
The Vercel Node builder emits traced TypeScript files with `.js` names while MJS
imports retain `.ts`; the deployment now includes the exact required raw source
files for Node 24 type stripping. A packaging regression reproduces the missing
module before the repair and verifies authentication after inclusion.

Vercel also supplies its named rewrite capture as a `path` query parameter.
The controller normalizes only the exact canonical projection after independent
application authentication. Extra/duplicate parameters, conflicting routes and
unsafe segments are denied. No scope, admission or credential check is removed.
[Factory transport evidence](factory-transport-repair.json) verifies the repaired
preview. Targeted Factory regression: 159 PASS, zero FAIL, three gated skips;
producer typecheck/governance pass. Separate cloud suite before the routing
repair: 73 PASS, two gated skips; six packaging/API checks pass after it.

## Next composition boundary

Product was explicitly informed: **WAITING_FOR_CANONICAL_STAGING_COMPOSITION**.
There is no qualified real-browser deterministic productive hook yet. Continue
hosted canonical configuration/source, EnvironmentRouter admission, existing
Codex harness through the durable model ledger, cloud custody consumption,
independent cloud verification and Result/Proof, then Mac-off/browser-off/P0.
Do not substitute the static worker or fabricated browser events for that path.

Paid model calls remain zero. Production admission and publication remain
DISABLED. DeepAgent, terminal adapters and CLOUD_COMPUTER remain deferred.
