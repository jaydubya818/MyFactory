# Sofie operator bypass: provider scope constraint

Status: **BLOCKED_PROVIDER_SECURITY_SCOPE**, 2026-10-02. The owner approved a
separate operator/test-runner-only Sofie qualification bypass. This is not a
request to repeat that approval. The provider requires a different credential
custody boundary from the one requested.

## Observed provider behavior

Project `sofie-cloud-qualification` (`prj_XU7fJW735PtsnKoAYtGfzdnsotIB`)
had no bypass entries. Creation succeeded, but changing that sole entry to
`isEnvVar:false` returned HTTP 400:

> One bypass must be the VERCEL_AUTOMATION_BYPASS_SECRET Environment Variable set on deployments.

Both attempts were immediately revoked. The second attempt preserved the exact
sanitized provider error after the first generic error obscured it. No further
creation attempts are planned without resolving this scope constraint.

Creation uses the provider's default environment-injection flag. No deployment
was created while either credential existed. Final provider readback found zero
bypass entries, no explicit automation-bypass environment variable and no new
deployments. The test held the credential in memory only; it was not written to
a file, browser, prompt, repository, artifact, Result or worker configuration.
This is not a comprehensive runtime credential scan PASS.

[Provider update API](https://vercel.com/docs/rest-api/projects/update-protection-bypass-for-automation)
supports generation, `update.isEnvVar` and revocation, but the connected provider
rejected disabling injection on the only entry. A second dormant bypass marked
for injection would introduce another runtime credential, not solve operator-only
custody. No such workaround was created; the Factory bypass was not reused.

## Evidence

- [Attempt 1](sofie-operator-access-attempt-1.json): configuration failed and
  credential revoked; the initial redirect detector was too strict.
- [Attempt 2](sofie-operator-access-attempt-2.json): exact provider constraint
  observed; no-bypass and revoked-credential requests both returned a Vercel
  authentication redirect (HTTP 302).
- [Final provider readback](sofie-operator-bypass-cleanup.json): zero bypasses,
  deployment protection still `all_except_custom_domains`, no new deployments.
- [Current matrix](sofie-operator-access-matrix.json): application-authentication
  cases and Factory service-to-service matrix **NOT_RUN**. Full access-then-revoke
  journey **PARTIAL**, since the configuration failed before access qualification.

No canonical Work was dispatched. Cloud harness, verifier, Mac-off, browser-off
and P0 remain NOT_RUN. Paid calls are zero; production admission and publication
remain disabled. Attempt-8 and all runtime code are unchanged by this checkpoint.

## Concrete decision

Option A: authorize Vercel's required `VERCEL_AUTOMATION_BYPASS_SECRET` injection
into **only this dedicated Sofie qualification project's build/server runtime**,
as well as the operator runner. This broadens credential custody beyond the
runner. Application code or build dependencies could access the infrastructure
credential; it still grants zero application/Work authority. No production
project, producer or verifier receives it. Before any deployment, validate
server-only usage, public-variable exclusion, client bundle scanning, explicit
worker/verifier environment allowlists and log/evidence redaction. Then run the
full access matrix, revoke and confirm denial, using fresh explicitly scoped
credentials for subsequent approved qualification.

Option B: retain strict operator-only custody and supply a normal authenticated
Vercel operator session, or obtain provider support for a bypass with injection
disabled and no mandatory replacement secret. This preserves the requested
boundary but requires an external access/provider action.

Do not disable project protection, add a public proxy, copy the Factory bypass,
or introduce an injected placeholder bypass as a workaround.

## Revocation procedure and tested portion

An authorized infrastructure operator locates the exact named entry
`Sofie deterministic operator qualification revocation test` in this project.
Revoke using the project Deployment Protection UI or the documented PATCH API:
`revoke: { secret: <in-memory credential>, regenerate: false }`. Send the secret
in a private request body, never command arguments, query strings or logs.
Confirm the entry is absent. Reissue a request with that revoked credential and
no provider session cookie; require Vercel authentication protection, not an
application response. These metadata/deployment-protection checks passed.

No active credential remains. Any later credential creation must use the
approved custody boundary; do not automatically regenerate during revocation.


## Resolved by explicit owner approval

The owner approved Option 1. The [subsequent hosted access matrix and revocation check](sofie-runtime-access.md) pass; this document retains the historical blocked attempts.
