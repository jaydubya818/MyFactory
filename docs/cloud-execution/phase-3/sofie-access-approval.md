# Sofie staging access approval boundary

**Current custody correction — 2026-10-02:** The local Factory diagnostic exceeded the backend-only bypass boundary. Both old Factory bypasses are revoked; rejection is CONNECTED PASS through Sofie. Unsafe local entry points are retired. Replacement custody/access qualification is blocked on the protection-mechanism decision; preview-only OIDC trust is proposed, not enabled. The separately authorized Sofie operator bypass is active. Earlier configuration/access statements below are historical and do not establish current custody. [Incident, evidence, regression and next decision](factory-bypass-custody-incident.md). Paid models: 0; production admission/publication: DISABLED.

The VCR image blocker is resolved. The dedicated staging infrastructure-only
lifecycle passed: exact source, deterministic checks, private artifact custody,
readback and confirmed sandbox deletion. This does not establish canonical cloud
Work, the Codex harness, independent verification, Mac-off or Playwright P0.

The next deployed client is `sofie-cloud-qualification`
(`prj_XU7fJW735PtsnKoAYtGfzdnsotIB`). Its separately provisioned empty owner-side
Neon database has the canonical MyEve migrations. Factory execution state and
custody remain exclusively in `myfactory-cloud-staging`
(`prj_IRXTY6HOzS2q9wRPdabsJnmddzl4`).

## Concrete requested action

Create one named Protection Bypass for Automation secret on the dedicated
**MyFactory staging project**, and store that secret only in Sofie's isolated
staging backend configuration. Do not store the bypass in operator files.
Send it as the `x-vercel-protection-bypass` header alongside the separate
Factory application bearer credential. Never use URL query parameters, expose it
to the browser, or pass it to a producer/verifier sandbox.

This provider secret applies to **all deployments within this staging project**
until revoked; it is not path-scoped. Possession bypasses provider deployment
protection and certain provider security checks. The canonical Factory API still
requires its independent staging client credential and exact source/Work grants.
It grants no Factory database, artifact store, worker-control, signing, verifier
or publication credentials. No existing production project or resource changes.

References: [Vercel protection-bypass behavior](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
and [creation API](https://vercel.com/docs/rest-api/projects/update-protection-bypass-for-automation).

## Approval received — 2026-10-02

The earlier automatic approval review rejected creation of this persistent project-scoped
bypass because that security change and its scope were not explicitly approved.
The rejected action did not execute. No new bypass was created, and no existing
bypass was copied into Sofie to circumvent that rejection. Ordinary staging
application/signing credentials were created separately as sensitive preview-only
variables under the previously authorized staging scope.

The project already had one provider bypass entry from earlier operator work;
this does not authorize extending that credential to a new hosted client. Its
value was not retrieved or redistributed in this step. Existing deployment
protection remains enabled.

## Qualification status at this boundary

- Provider image and infrastructure-only hosted lifecycle: CONNECTED PASS.
- Hosted queue infrastructure receipt after requester exit: CONNECTED PASS.
- Canonical PostgreSQL dispatch/custody/cancellation/terminal/limit tests:
  CONNECTED PASS in isolated schemas, 8 checks.
- Deterministic worker/source/Git candidate/patch/signature pipeline: local
  deterministic test PASS; **not a cloud Work PASS**.
- New canonical hosted Work execution: NOT_RUN.
- Qualified Codex harness in cloud: NOT_RUN.
- Independent cloud verifier: NOT_RUN.
- Sofie/browser-off/restart/Mac-off/P0 Golden Journey: NOT_RUN.
- Public cloud admission: DISABLED. Paid model calls: 0. Publication effects: 0.

After approval, qualify the deployed authenticated client contract first, then
resume the existing deterministic cloud Work/harness/verifier/product gates.
Do not use the image or deployment success as authorization for a paid canary.

## Approved configuration and revocation

Jay explicitly approved one dedicated MyFactory staging project bypass, stored
only in Sofie staging server-side configuration. The named entry is
`Sofie isolated staging contract qualification`; its `isEnvVar` is false so the
provider does not inject it into Factory deployments. Sofie receives it as
`FACTORY_STAGING_PROTECTION_BYPASS`, sensitive and preview-only. No local bypass
file is created. Metadata is in `protection-bypass-configuration.json`.

To revoke, an authorized infrastructure operator opens the dedicated
`myfactory-cloud-staging` project's Deployment Protection settings and revokes
that exact named automation bypass. Alternatively use the documented PATCH
protection-bypass API with `revoke.secret` and `regenerate:false`, keeping the
value in memory and the request body off command arguments/logs. Delete the
corresponding sensitive preview variable in `sofie-cloud-qualification` and
redeploy its preview. Verify the previous Sofie request is blocked at deployment
protection. Do not revoke unrelated operator entries or disable project
protection. Revocation does not change independent Factory application grants.

Configuration is not qualification. The hosted five-case access matrix and
credential containment checks must pass before claiming this boundary PASS.

## Separate operator ingress boundary discovered

The Factory bypass was created successfully; it is not the current blocker.
The actual hosted Sofie app is separately protected by Vercel Authentication and
has no automation bypass entries. The CLI operator request could not reach its
fixed diagnostic. An in-app browser check returned `ERR_BLOCKED_BY_CLIENT`.
No Sofie bypass was created and no protection settings were weakened.

The five-case hosted matrix is **NOT_RUN**, not FAIL or PASS. Local application
regressions pass, and Sofie's hosted build scanned 77 browser static files with
zero credential matches. This does not establish runtime-log, worker, verifier,
or Result/Proof containment for an execution that has not run.

Concrete next permission: one separately named operator-only automation bypass
on `sofie-cloud-qualification`, for the deterministic qualification runner and
P0 browser ingress. It would have no Factory application or Work authority,
would never be passed to Factory/producer/verifier/model environments, and
would be revoked when qualification ends. Keep the Factory bypass in Sofie
backend configuration only. Alternatively Jay can provide authenticated operator
access through Vercel's normal sign-in path. The current approval explicitly
limits bypass creation to the Factory project, so this distinct project-scoped
security change has not been performed.


## Sofie approval received; provider constraint discovered

Jay approved the separate operator/test-runner bypass. That approval supersedes
the earlier pending permission above. Configuration now encounters a different
provider constraint: the only project bypass cannot have environment injection
disabled. See the [provider boundary evidence and decision](sofie-operator-bypass-provider-boundary.md). Both attempted credentials are revoked.


## Runtime injection approved and access qualified

The owner approved Option 1 for only the dedicated Sofie qualification server/build environment. [Hosted access and revocation qualification](sofie-runtime-access.md) supersedes the earlier pending provider-scope decision. Access PASS is not cloud Work PASS.
